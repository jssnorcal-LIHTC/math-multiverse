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
// Bucket key: topic + '|' + (check.op || '') -- a COMPOSITE of both axes. Neither axis alone is
// safe to bucket on by itself. `topic` alone: post-Task-6, `topic` uniquely identifies the leaf
// generator everywhere except the three sanctioned phrasing-branch families noted below, so topic
// alone is usually fine but degenerates on those three. `check.op` alone is worse: it COLLIDES
// across distinct leaves in multiple places -- e.g. rocky-translator's genG6RatioTable and
// genG6EquivRatio both emit op:'proportion'; rocky-translator's genG6UnitRate and genG6PercentFind
// both emit op:'div'; master-builder's genG6Volume and genG6VolumeFrac both emit op:'mul3'.
// Bucketing by op alone MERGES those distinct leaves into one bucket and averages away real
// thinness in either one. The composite key is never coarser than either axis alone: topic
// separates leaves that op cannot, and op sub-splits a topic's internal branches once a later task
// (e.g. T12) gives them branch-distinct ops. The three sanctioned phrasing-branch families
// (ns-div-*, dec-power-of-ten, coord-identify) carry no check field at all, so their composite key
// degenerates to `topic + '|'` and stays topic-coarse. That is EXPECTED, not a gap in this gate:
// those three are exactly the case the seeded SIM gate (freshness-sim.js) exists to police
// behaviorally (it runs the real drawRun/union-rejection path at real per-level draw counts); this
// LIB gate is only an analytic estimate of per-bucket pool depth, and is coarse wherever the
// content itself gives it nothing finer to key on.
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
const { seededMath, driverId, padR, padL } = require('./gate-common.js');

const ALLOWLIST_PATH = path.join(__dirname, 'freshness-allowlist.json');
const QPL = [15, 18, 18, 20, 20, 20];
const DRAWS_PER_N = 500;
const SEED = 11; // fixed, deterministic; shared value with freshness-sim.js's first seed
const THIN_BUCKET_SAFETY = 3; // see the thin-bucket guard below

function loadAllowlistFor(gateName) {
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('freshness-allowlist.json must be a JSON array');
  return raw.filter((e) => e.gate === gateName);
}

// topic + '|' + (check.op || '') -- see header note for why the composite beats either axis alone.
function bucketKeyOf(q) {
  const topic = (q && q.topic) || '(no-topic)';
  const op = (q && q.check && typeof q.check === 'object' && q.check.op) ? String(q.check.op) : '';
  return topic + '|' + op;
}

// NOTE: no seeded-Math/Math.imul self-check in this file. This gate never calls MVFresh.drawRun
// (only the pure .sigOf() and driver.make()), and Math.imul is only ever exercised by drawRun's
// internal fnv hash -- so there is nothing here for such a check to actually exercise. That
// self-check lives in freshness-sim.js, which does call drawRun.

// THIN-BUCKET GUARD: a bucket that is drawn only rarely can report a misleadingly high binding
// ratio purely from having too few samples to collide, not from actually being deep. Extreme
// case: a bucket drawn exactly once has distinct=1, so ratio = 1/weight = total draws -- always
// enormous, always "passing," regardless of whether the underlying pool for that bucket is deep
// or shallow, because one draw carries no information about repeat risk at all. A bucket needs
// distinct >= 12*N*weight to pass at its own weight; observing that many distinct values (or
// confidently NOT observing them) needs a sample noticeably larger than that minimum, not just
// equal to it. A bucket whose own draw count is below THIN_BUCKET_SAFETY times that minimum is
// UNMEASURED: its ratio is not trusted either way, it is reported as such, and it is always
// treated as a failure for ratchet purposes (allowlistable like any other failure, never silently
// passed). With today's content this guard changes no verdict -- every bucket that actually gets
// drawn is drawn often enough to clear it -- but it exists so a future rarely-reached content
// branch cannot pass on sampling noise instead of real depth.

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
  padR('driver', 30) + padL('N', 4) + '  ' + padR('worst-bucket', 40) + padL('distinct', 9) +
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
  const threshold = 12 * N;
  // Worst MEASURED bucket (ordinary binding search, unmeasured buckets excluded so an inflated,
  // untrustworthy ratio can never win the min-search) and the worst UNMEASURED bucket (tracked
  // separately, ranked by how far short of its own required sample size it falls).
  let worstMeasured = { binding: Infinity, key: null, distinct: 0, weight: 0 };
  let worstUnmeasured = null;
  for (const [key, count] of bucketCounts) {
    const distinct = bucketSigs.get(key).size;
    const weight = count / total;
    const ratio = distinct / weight;
    const required = THIN_BUCKET_SAFETY * Math.ceil(12 * N * weight);
    if (count < required) {
      if (!worstUnmeasured || (required - count) > (worstUnmeasured.required - worstUnmeasured.count)) {
        worstUnmeasured = { key, distinct, weight, binding: ratio, count, required };
      }
      continue;
    }
    if (ratio < worstMeasured.binding) worstMeasured = { binding: ratio, key, distinct, weight };
  }
  const measuredPass = worstMeasured.key !== null && worstMeasured.binding >= threshold;
  const pass = !worstUnmeasured && measuredPass;
  // Report the unmeasured bucket when one exists (the more actionable finding); otherwise the
  // normal worst-measured-bucket numbers, exactly as before this guard existed.
  const display = worstUnmeasured || worstMeasured;
  const unmeasuredNote = worstUnmeasured
    ? 'UNMEASURED: bucket \'' + worstUnmeasured.key + '\' only drawn ' + worstUnmeasured.count + 'x, needs >= ' + worstUnmeasured.required + ' draws to trust its ratio'
    : null;

  const entry = allowlistByDriver.get(id);
  let verdict;
  if (entry) {
    seenAllowlistDrivers.add(id);
    if (pass) { verdict = 'FAIL (stale allowlist entry -- passes now, delete it)'; gateFail = true; bumpRollup(d.moduleId, 'fail'); }
    else { verdict = 'EXPECTED-FAIL (' + (unmeasuredNote ? unmeasuredNote + '; ' : '') + entry.reason + ')'; bumpRollup(d.moduleId, 'expectedFail'); }
  } else if (pass) {
    verdict = 'ok';
    bumpRollup(d.moduleId, 'ok');
  } else {
    verdict = 'FAIL (unlisted' + (unmeasuredNote ? ': ' + unmeasuredNote : '') + ')';
    gateFail = true;
    bumpRollup(d.moduleId, 'fail');
  }

  console.log(
    padR(id, 30) + padL(N, 4) + '  ' + padR(display.key, 40) + padL(display.distinct, 9) +
    padL(display.weight.toFixed(4), 9) + padL(display.binding.toFixed(1), 10) + padL(threshold, 7) + '  ' + verdict
  );

  if (worstOverall === null || display.binding / threshold < worstOverall.ratio) {
    worstOverall = { id, ratio: display.binding / threshold };
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
