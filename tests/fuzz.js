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
// Every distinct `topic` any generator actually emits. The coaching gate at the bottom of this
// file needs the emitted set, not the authored one: topics are built at runtime ('g6-dec-' + mode,
// 'g6-stats-' + op), so no static scan of the source can enumerate them honestly.
const emittedTopics = new Set();

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
    if (q && typeof q.topic === 'string' && q.topic) emittedTopics.add(q.topic);

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

// ---- coaching coverage: every topic a generator emits must reach a tip ----
//
// Ticket 2.2 asked for finer coaching buckets, and commit 138f4da (26-0802) already delivered them:
// `g6-dec-ops` and `g6-stats` survive only as level-config and dispatch identifiers, while the
// emitted topics are `g6-dec-add/sub/mul/divide` and `g6-stats-mean/median/range`, each with its own
// COACH_TIPS entry. What was never gated is that they STAY reached, and the shell's own comment on
// COACH_FAMILY_FALLBACK says why that matters: "topics and tips are authored in different places and
// have drifted before".
//
// The emitted set comes from this fuzz pass rather than from a static scan, because topics are built
// at runtime ('g6-dec-' + mode) and a scan for string literals would silently miss exactly the ones
// this ticket is about. Resolution mirrors showCoach: the topic's own entry, else its family's
// coarse fallback after stripping a `g6-` prefix and taking the first hyphen segment.
//
// COACH_TIPS and COACH_FAMILY_FALLBACK are read out of the shell as text. That is a parse, so it is
// checked rather than trusted: too few keys, or a fallback map that does not resolve, fails here
// instead of quietly making every topic look covered.
{
  const fs = require('fs');
  const { HTML_PATH } = require('./extract');
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const block = (name) => {
    const i = html.indexOf(`const ${name} = {`);
    if (i < 0) return null;
    const end = html.indexOf('\n};', i);
    return end < 0 ? null : html.slice(i, end);
  };
  const keysOf = (src) => new Set([...src.matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]));
  const tipsSrc = block('COACH_TIPS');
  const famSrc = block('COACH_FAMILY_FALLBACK');
  if (!tipsSrc || !famSrc) {
    problems.push('coaching: COACH_TIPS or COACH_FAMILY_FALLBACK could not be located in the shell, so coaching coverage was not measured at all');
  } else {
    const tips = keysOf(tipsSrc);
    const fam = new Map([...famSrc.matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
    // The parse has to be shown working before its results mean anything.
    if (tips.size < 40) problems.push(`coaching: only ${tips.size} COACH_TIPS keys parsed out of the shell, which is too few to be a real read of that object`);
    if (!fam.size) problems.push('coaching: COACH_FAMILY_FALLBACK parsed to zero entries, so every unmatched topic would look uncoachable');
    for (const [, target] of fam) {
      if (!tips.has(target)) problems.push(`coaching: the family fallback points at "${target}", which is not a COACH_TIPS key -- that family coaches nothing`);
    }

    // showCoach's own fallback: strip a `g6-` prefix, take the first hyphen segment, look that
    // family up. Mirrored here rather than reimplemented differently, so this measures the
    // shipped behaviour and not the gate's opinion of it.
    const familyTip = (topic) => fam.get(String(topic).replace(/^g6-/, '').split('-')[0]);
    const resolves = (topic) => tips.has(topic) || tips.has(familyTip(topic));
    if (!emittedTopics.size) {
      problems.push('coaching: zero topics were emitted across the whole fuzz pass, so this check measured nothing');
    }
    const uncoached = [...emittedTopics].filter((t) => !resolves(t)).sort();
    for (const t of uncoached) {
      problems.push(`coaching: topic "${t}" is emitted by a generator but resolves to no tip, so the coach fires on it with nothing to say`);
    }
    // Reported, not failed. A topic reaching only its family's coarse tip is coached, just less
    // precisely than one with its own entry, and the fallback exists deliberately. It is printed
    // because THAT is the quantity ticket 2.2 was about: a silent slide from own-entry to
    // family-fallback is a precision regression that no count of "uncoached" would ever show.
    const fallbackOnly = [...emittedTopics].filter((t) => !tips.has(t) && tips.has(familyTip(t))).sort();
    // NEGATIVE CONTROL: a topic that cannot exist must NOT resolve. Without it, a resolver that
    // returned true for everything would report full coverage and no test would notice.
    if (resolves('zz-not-a-real-topic')) {
      problems.push('coaching: the NEGATIVE CONTROL topic resolved to a tip -- this resolver accepts anything, so the coverage result above is void');
    }
    console.log(`\ncoaching coverage: ${emittedTopics.size} distinct topic(s) emitted, ${tips.size} COACH_TIPS keys, ${fam.size} family fallback(s), ${uncoached.length} uncoached`);
    console.log(`  own tip: ${emittedTopics.size - fallbackOnly.length}   family fallback only: ${fallbackOnly.length}${fallbackOnly.length ? ' (' + fallbackOnly.join(', ') + ')' : ''}`);
    console.log(`  ticket 2.2 granularity, as emitted: ${[...emittedTopics].filter((t) => /^g6-dec-|^g6-stats-/.test(t)).sort().join(', ')}`);
    console.log('  negative control: "zz-not-a-real-topic" correctly resolves to nothing');
  }
}

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
