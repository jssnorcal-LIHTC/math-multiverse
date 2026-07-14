'use strict';
// fuzz.js -- the boundary gate. Drives every module's REAL question dispatch (the same call its
// init() makes) across both grades and all levels, N times each, and verifies every generated
// question with the independent oracles. Then a mutation self-test proves the oracles actually
// reject corrupted answers. Exits non-zero on any failure, missing coverage, or weak oracle.
//
//   node tests/fuzz.js [N_per_driver]      (default 5000  -> ~360k questions)
//   FUZZ_N=20000 node tests/fuzz.js        (env override)
//
// HARD RULES (k8s-thinking): load failure must throw (never silent-clean); every oracle must
// fire; every mutation must be caught; no silent caps (dropped coverage is logged).

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8'); // Windows cp1252 guard

const { loadModules, buildDrivers } = require('./extract');
const { checkOracle, fractionOracle, structuralOracle, CHECK_OPS } = require('./oracles');

const N = parseInt(process.argv[2] || process.env.FUZZ_N || '5000', 10);
if (!Number.isInteger(N) || N < 1) { console.error('bad N'); process.exit(2); }

const mods = loadModules();
const drivers = buildDrivers(mods);
const fracMakeChoices = mods['fraction-rider'].makeChoices;
if (typeof fracMakeChoices !== 'function') throw new Error('fuzz: fraction makeChoices not captured');
if (drivers.length !== 72) throw new Error(`fuzz: expected 72 drivers, got ${drivers.length} (extraction drift)`);

// ---- counters ----
let total = 0, fails = 0;
const failSamples = [];
const covCheck = {};   // op -> count
const covFrac = {};    // kind -> count
let covStruct = 0, covFracApplicable = 0, covCheckFired = 0;

function fail(scope, d, reason) {
  fails++;
  if (failSamples.length < 60) failSamples.push(`[${scope}] ${d.moduleId} g${d.grade} ${(d.gen || 'L' + d.levelIndex)}: ${reason}`);
}

// ---- main fuzz pass ----
const t0 = Date.now();
for (const d of drivers) {
  for (let i = 0; i < N; i++) {
    let q;
    try { q = d.make(); }
    catch (e) { fail('gen', d, 'THREW ' + (e && e.message)); total++; continue; }
    total++;

    // structural (always)
    const s = structuralOracle(q, d.moduleId === 'fraction-rider' ? fracMakeChoices : undefined);
    if (s.ok) covStruct++; else fail('struct', d, s.reason);

    // check-contract (when present)
    const c = checkOracle(q);
    if (c.fired) {
      covCheckFired++;
      covCheck[c.op] = (covCheck[c.op] || 0) + 1;
      if (!c.ok) fail('check', d, c.reason);
    }

    // fraction arithmetic (fraction-rider answer-style)
    if (d.moduleId === 'fraction-rider') {
      const f = fractionOracle(q);
      if (f.applicable) {
        covFracApplicable++;
        if (f.ok) covFrac[f.kind] = (covFrac[f.kind] || 0) + 1;
        else fail('frac', d, f.reason);
      }
    }
  }
}
const genMs = Date.now() - t0;

// ---- mutation self-test: the oracles MUST reject corrupted answers ----
// M1 corrupt check.answer; M2 corrupt correctIdx; M3 corrupt fraction answer.
const mut = { m1: { run: 0, caught: 0 }, m2: { run: 0, caught: 0 }, m3: { run: 0, caught: 0 } };
const MUT_PER_DRIVER = 300;
for (const d of drivers) {
  for (let i = 0; i < MUT_PER_DRIVER; i++) {
    let q;
    try { q = d.make(); } catch (e) { continue; }

    if (q && q.check) {
      // M1: corrupt the contract answer
      const orig = q.check.answer;
      const corrupt = (typeof orig === 'number') ? orig + 1 + 1e-3 : String(orig) + '_X';
      q.check.answer = corrupt;
      mut.m1.run++;
      if (checkOracle(q).ok === false) mut.m1.caught++;
      q.check.answer = orig;

      // M2: point correctIdx at a different (distinct) option
      if (Array.isArray(q.answers) && q.answers.length >= 2 && Number.isInteger(q.correctIdx)) {
        const orig2 = q.correctIdx;
        const alt = (orig2 + 1) % q.answers.length;
        if (String(q.answers[alt]) !== String(q.answers[orig2])) {
          q.correctIdx = alt;
          mut.m2.run++;
          if (checkOracle(q).ok === false) mut.m2.caught++;
          q.correctIdx = orig2;
        }
      }
    }

    if (d.moduleId === 'fraction-rider') {
      const f0 = fractionOracle(q);
      if (f0.applicable && f0.ok && q.answer) {
        const on = q.answer.num;
        q.answer.num = on + q.answer.den; // shift by exactly 1 whole -> always a different value
        mut.m3.run++;
        if (fractionOracle(q).ok === false) mut.m3.caught++;
        q.answer.num = on;
      }
    }
  }
}

// ---- coverage / strength assertions ----
const problems = [];
const expectedOps = Object.keys(CHECK_OPS);
const missingOps = expectedOps.filter((op) => !covCheck[op]);
if (missingOps.length) problems.push(`check oracle never fired for ops: ${missingOps.join(', ')}`);

const REQUIRED_FRAC = ['+', '−', '×', '÷', 'of', 'simplify', 'compare', 'equiv'];
const missingFrac = REQUIRED_FRAC.filter((k) => !covFrac[k]);
if (missingFrac.length) problems.push(`fraction oracle never verified kinds: ${missingFrac.join(', ')}`);

if (covStruct < total * 0.99) problems.push(`structural oracle only validated ${covStruct}/${total}`);
if (covFracApplicable < 1000) problems.push(`fraction oracle applied only ${covFracApplicable} times`);
if (covCheckFired < 1000) problems.push(`check oracle fired only ${covCheckFired} times`);

for (const [k, m] of Object.entries(mut)) {
  if (m.run < 50) problems.push(`mutation ${k} ran only ${m.run} times (too few to trust)`);
  if (m.caught !== m.run) problems.push(`mutation ${k} caught ${m.caught}/${m.run} (oracle is weak!)`);
}

// ---- report ----
console.log(`\n=== Math Multiverse fuzz: N=${N}/driver, ${drivers.length} drivers, ${total} questions in ${genMs}ms ===`);
console.log(`structural ok: ${covStruct}/${total}`);
console.log(`check-contract fired: ${covCheckFired}  | coverage:`);
console.log('  ' + JSON.stringify(covCheck));
console.log(`fraction applicable: ${covFracApplicable}  | coverage by kind:`);
console.log('  ' + JSON.stringify(covFrac));
console.log(`mutation self-test: M1(answer)=${mut.m1.caught}/${mut.m1.run}  M2(correctIdx)=${mut.m2.caught}/${mut.m2.run}  M3(frac)=${mut.m3.caught}/${mut.m3.run}`);

if (fails) {
  console.log(`\n=== ${fails} FAILURES (first ${Math.min(60, failSamples.length)}) ===`);
  failSamples.forEach((s) => console.log('  ' + s));
}
if (problems.length) {
  console.log(`\n=== ${problems.length} COVERAGE/STRENGTH PROBLEMS ===`);
  problems.forEach((p) => console.log('  ' + p));
}

if (fails || problems.length) {
  console.log('\nRESULT: FAIL');
  process.exit(1);
} else {
  console.log('\nRESULT: ALL CLEAN');
  process.exit(0);
}
