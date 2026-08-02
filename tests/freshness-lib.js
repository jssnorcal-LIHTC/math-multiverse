'use strict';
// freshness-lib.js -- Task 7 binding-constraint LIBRARY gate (gate:"lib" in freshness-allowlist.json).
//
// For each of the 72 (module, grade, level) drivers, draws 500 x N raw samples directly from the
// driver's real generator (driver.make(), NOT MVFresh.drawRun -- this gate measures the underlying
// CONTENT POOL's depth, not the ledger's rejection behavior; freshness-sim.js is the gate that
// exercises drawRun itself, seeded and repeated). Draws run under a SEEDED Math (deterministic,
// reproducible in CI). localStorage is deliberately absent from extraGlobals: this gate never calls
// MVFresh.drawRun/markSeenIds, only .sigOf() (a pure function) and driver.make(), so there is no
// persistence path to spy on. Storage plumbing itself is already exhaustively covered by Task 2's
// freshness.js; re-testing it here would just be duplicate coverage under a different gate's name.
//
// N = QPL[levelIndex], the driver's real per-run draw count. QPL = [15,18,18,20,20,20] is identical
// across all six modules (FR_QPL/QPL/RC_QPL/MB_QPL/RK_QPL/FB_QPL are all literally
// `[15, 18, 18, 20, 20, 20]` in Math-Multiverse.html, confirmed by direct grep), so it's safe to
// hardcode once here rather than extract it from each module's sandbox at runtime.
//
// Bucket key: check.op || topic -- finer than topic alone wherever a check object exists (per
// controller refinement #1). The three sanctioned phrasing-branch families from Task 6 (ns-div-*,
// dec-power-of-ten, coord-identify) carry no check field at all, so they stay topic-coarse under
// this key. That is EXPECTED, not a gap in this gate: those three are exactly the case the seeded
// SIM gate (freshness-sim.js) exists to police behaviorally (it runs the real drawRun/union-
// rejection path at real per-level draw counts); this LIB gate is only an analytic estimate of
// per-bucket pool depth, and is coarse wherever the content itself gives it nothing finer to key on.
//
// binding = min over buckets t of (distinct_t / weight_t), weight_t = draws_t / total draws.
// PASS iff binding >= 12 * N.
//
// Ratchet against tests/freshness-allowlist.json ({driver, gate, reason} entries, gate:"lib"):
//   unlisted driver fails  -> GATE FAILURE
//   listed driver PASSES   -> GATE FAILURE (stale entry -- delete it)
//   listed driver fails    -> OK, printed EXPECTED-FAIL
//   empty allowlist file   -> full enforcement (nothing left to forgive)
// Zero drivers found -> FAIL LOUDLY (no-packs-must-fail house rule: a harness that silently finds
// nothing must never report "clean").

const fs = require('fs');
const path = require('path');
const { loadModules, buildDrivers } = require('./extract.js');

const ALLOWLIST_PATH = path.join(__dirname, 'freshness-allowlist.json');
const QPL = [15, 18, 18, 20, 20, 20];
const DRAWS_PER_N = 500;
const SEED = 11; // fixed, deterministic; shared value with freshness-sim.js's first seed

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function seededMath(seed) { const m = Object.create(Math); m.random = mulberry32(seed); return m; }

function loadAllowlistFor(gateName) {
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('freshness-allowlist.json must be a JSON array');
  return raw.filter((e) => e.gate === gateName);
}

// check.op || topic -- see header note on why this is deliberately coarse for three topics.
function bucketKeyOf(q) {
  if (q && q.check && typeof q.check === 'object' && q.check.op) return String(q.check.op);
  return (q && q.topic) || '(no-topic)';
}

function driverId(d) { return d.moduleId + '.g' + d.grade + '.i' + d.levelIndex; }
function padR(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

// NOTE: no seeded-Math/Math.imul self-check in this file. This gate never calls MVFresh.drawRun
// (only the pure .sigOf() and driver.make()), and Math.imul is only ever exercised by drawRun's
// internal fnv hash -- so there is nothing here for such a check to actually exercise. The
// controller's self-check requirement is scoped to freshness-sim.js, which does call drawRun.

// ---- main ----
const allowlist = loadAllowlistFor('lib');
const allowlistByDriver = new Map(allowlist.map((e) => [e.driver, e]));
const seenAllowlistDrivers = new Set();

const drivers = buildDrivers(loadModules(), { extraGlobals: { Math: seededMath(SEED) } });
if (!drivers.length) {
  console.log('FAIL: zero drivers found (extraction broken -- refusing to report a clean gate on nothing)');
  process.exit(1);
}

console.log('=== freshness-lib: binding-constraint gate (seed ' + SEED + ', ' + DRAWS_PER_N + ' x N draws/driver) ===');
console.log(
  padR('driver', 30) + padL('N', 4) + '  ' + padR('worst-bucket', 24) + padL('distinct', 9) +
  padL('weight', 9) + padL('binding', 10) + padL('12N', 7) + '  verdict'
);

let gateFail = false;
let worstOverall = null;
const rollup = new Map(); // moduleId -> { ok, expectedFail, fail }
function bumpRollup(moduleId, bucket) {
  if (!rollup.has(moduleId)) rollup.set(moduleId, { ok: 0, expectedFail: 0, fail: 0 });
  rollup.get(moduleId)[bucket]++;
}
for (const d of drivers) {
  const id = driverId(d);
  const N = QPL[d.levelIndex];
  const total = DRAWS_PER_N * N;
  const F = d.sandbox.MVFresh;
  const bucketSigs = new Map();   // key -> Set(sig)
  const bucketCounts = new Map(); // key -> draw count
  for (let i = 0; i < total; i++) {
    const q = d.make();
    const key = bucketKeyOf(q);
    bucketCounts.set(key, (bucketCounts.get(key) || 0) + 1);
    if (!bucketSigs.has(key)) bucketSigs.set(key, new Set());
    bucketSigs.get(key).add(F.sigOf(q));
  }
  let binding = Infinity, worstKey = null, worstDistinct = 0, worstWeight = 0;
  for (const [key, count] of bucketCounts) {
    const distinct = bucketSigs.get(key).size;
    const weight = count / total;
    const ratio = distinct / weight;
    if (ratio < binding) { binding = ratio; worstKey = key; worstDistinct = distinct; worstWeight = weight; }
  }
  const threshold = 12 * N;
  const pass = binding >= threshold;

  const entry = allowlistByDriver.get(id);
  let verdict;
  if (entry) {
    seenAllowlistDrivers.add(id);
    if (pass) { verdict = 'FAIL (stale allowlist entry -- passes now, delete it)'; gateFail = true; bumpRollup(d.moduleId, 'fail'); }
    else { verdict = 'EXPECTED-FAIL (' + entry.reason + ')'; bumpRollup(d.moduleId, 'expectedFail'); }
  } else if (pass) {
    verdict = 'ok';
    bumpRollup(d.moduleId, 'ok');
  } else {
    verdict = 'FAIL (unlisted)';
    gateFail = true;
    bumpRollup(d.moduleId, 'fail');
  }

  console.log(
    padR(id, 30) + padL(N, 4) + '  ' + padR(worstKey, 24) + padL(worstDistinct, 9) +
    padL(worstWeight.toFixed(4), 9) + padL(binding.toFixed(1), 10) + padL(threshold, 7) + '  ' + verdict
  );

  if (worstOverall === null || binding / threshold < worstOverall.ratio) {
    worstOverall = { id, ratio: binding / threshold };
  }
}

console.log('--- per-module rollup (of 12 drivers each: 2 grades x 6 levels) ---');
console.log(padR('module', 18) + padL('ok', 5) + padL('expected-fail', 15) + padL('unlisted-fail', 15));
for (const [moduleId, r] of rollup) {
  console.log(padR(moduleId, 18) + padL(r.ok, 5) + padL(r.expectedFail, 15) + padL(r.fail, 15));
}

// Allowlist entries that never matched any of the 72 drivers (typo'd id, or content moved) are
// themselves a gate failure -- a silently-stale entry defeats the ratchet's whole purpose.
for (const e of allowlist) {
  if (!seenAllowlistDrivers.has(e.driver)) {
    console.log('FAIL: allowlist entry for unknown driver "' + e.driver + '" (gate:lib) never matched any of the ' + drivers.length + ' drivers -- typo or stale entry');
    gateFail = true;
  }
}

const worstNote = worstOverall ? ' (worst binding/threshold ratio: ' + worstOverall.id + ' at ' + worstOverall.ratio.toFixed(3) + 'x)' : '';
if (gateFail) { console.log('RESULT: FAIL' + worstNote); process.exit(1); }
console.log('RESULT: ALL CLEAN (' + drivers.length + ' drivers, ' + allowlist.length + ' allowlisted)' + worstNote);
