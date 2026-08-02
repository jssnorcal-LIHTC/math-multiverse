'use strict';
// freshness-sim.js -- Task 7 seeded 10-run SIM gate. TWO independent check types, ratcheted
// against SEPARATE gate namespaces in the same tests/freshness-allowlist.json file, so a level
// entry and a campaign entry for the same module-grade can never collide on id:
//
//   LEVEL SCOPE (gate:"sim", id "<module>.g<grade>.i<level>"): per driver, per seed in
//   [11,22,33]: reset the ledger, run drawRun 10 times in a row at the driver's real N
//   (shared/persisted ledger across those 10 runs, exactly like a kid replaying one level 10
//   times), and assert zero repeated signatures across all 10xN draws combined. A driver must be
//   clean under ALL 3 seeds to PASS; a repeat under ANY seed is a FAIL for that driver (a real
//   content-thinness signal is not something a lucky seed should hide).
//
//   CAMPAIGN (gate:"sim-campaign", id "<module>.g<grade>"): per module-grade (12 groups), per
//   seed: two sequential "campaigns" (all 6 levels of that grade, in order, via drawRun, SHARED
//   ledger across both campaigns -- i.e. simulating a kid playing the whole grade, then playing
//   it again). TWO conditions per module-grade: within-campaign repeats (must be 0) and
//   cross-campaign repeat RATE (campaign-2 items whose signature already appeared in
//   campaign-1; must be <= 1%). Arming is PER MODULE-GRADE, not file-wide: a module-grade with
//   NO allowlist entry is armed on BOTH conditions immediately (a within-campaign repeat, or a
//   >1% cross rate, is an unlisted failure the moment it appears). A LISTED module-grade's
//   entry covers the COMPOSITE condition -- EXPECTED-FAIL while EITHER condition still fails,
//   STALE ("delete it") only once BOTH clear. (Task 11 fix: the original design armed
//   cross-campaign globally, for all 12 module-grades at once, the instant the WHOLE
//   sim-campaign namespace went empty -- the exact file-wide cliff that ambushed
//   master-builder's own cross-campaign rate in Task 10 and floating-bear's in Task 11,
//   purely because an UNRELATED module's entry happened to retire last. Per-module-grade
//   arming means each module's debt arms the moment ITS OWN entry retires, never sooner and
//   never because of an unrelated module's progress.)
//
// Runs the REAL MVFresh.drawRun path (not a direct driver.make() sample, that's freshness-lib.js's
// job) under a SEEDED Math, so results are deterministic and reproducible in CI.
//
// PER-DRIVER SEEDING (Task 14 rider, pulled forward from the T16 structural-fix carry-note): every
// level-scope driver's 10-run trial runs under its OWN derived Math, mulberry32(seed ^ fnv(driverId))
// -- never the one Math instance shared across all 72 drivers that every gate used through Task 13.
// Campaign rows derive per MODULE-GRADE the same way (mulberry32(seed ^ fnv(moduleGrade))), since
// all 6 levels of one module-grade share one module sandbox and are meant to share one ledger across
// their own two campaigns, just not with any other module or the other grade. Mechanism: buildDrivers
// is called ONCE per seed (as before) with a throwaway extraGlobals so every driver.sandbox is
// reachable, then `driver.sandbox.Math` is REASSIGNED to a fresh derived-seed instance right before
// that driver's (or that module-grade's) trial runs -- verified empirically that this is a clean,
// repeatable override (re-running the same derived seed after other drivers have run reproduces the
// exact same draw sequence) and that MVFresh's own Math.imul-based hashing keeps working across the
// swap. The property this buys: a driver's or module-grade's verdict is now a pure function of ITS
// OWN content and ITS OWN derived seed -- no other driver's widening, narrowing, or processing order
// can ever re-roll its luck. (This is what falsified the Task 9-13 assumption that a content fix for
// one module could never affect another's sim verdict: it could, silently, via the shared stream.)
//
// SYNTHETIC NEGATIVE CONTROL (content-independent, runs before anything else, every invocation):
// proves this file's OWN duplicate-detection logic actually works -- that it reports zero on a
// genuinely protected draw sequence and reports nonzero on a genuinely unprotected one -- before
// any of that logic is trusted to judge real content. See runNegativeControl() below for exactly
// why its two arms are structured the way they are (this was verified empirically, not assumed).
//
// Ratchet semantics for LEVEL SCOPE and every other gate (lib/shells/this file's own level-scope
// "sim"): unlisted failure -> GATE FAILURE; listed entry that now PASSES -> GATE FAILURE (stale,
// delete it); listed entry that fails -> OK, EXPECTED-FAIL; empty allowlist -> full enforcement.
// CAMPAIGN's ratchet is the composite variant described above (per module-grade, OR of two
// conditions). Zero drivers found -> FAIL LOUDLY.

const fs = require('fs');
const path = require('path');
const { loadModules, buildDrivers } = require('./extract.js');
const { seededMath, fnv, driverId, padR, padL } = require('./gate-common.js');

const ALLOWLIST_PATH = path.join(__dirname, 'freshness-allowlist.json');
const QPL = [15, 18, 18, 20, 20, 20];
const SEEDS = [11, 22, 33];
const RUNS = 10;
const CROSS_CAMPAIGN_MAX_RATE = 0.01;

function loadAllowlistFor(gateName) {
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('freshness-allowlist.json must be a JSON array');
  return raw.filter((e) => e.gate === gateName);
}

function campaignId(moduleId, grade) { return moduleId + '.g' + grade; }

// Apply the shared ratchet rule to one (id, pass) result. Mutates `seen` and returns
// { verdict, isFailure }.
function ratchet(id, pass, allowlistByDriver, seen) {
  const entry = allowlistByDriver.get(id);
  if (entry) {
    seen.add(id);
    if (pass) return { verdict: 'FAIL (stale allowlist entry -- passes now, delete it)', isFailure: true };
    return { verdict: 'EXPECTED-FAIL (' + entry.reason + ')', isFailure: false };
  }
  if (pass) return { verdict: 'ok', isFailure: false };
  return { verdict: 'FAIL (unlisted)', isFailure: true };
}

// ---- self-check: seeded Math must not disturb MVFresh's internal Math.imul-based hashing ----
// extraGlobals.Math REPLACES the sandbox's Math wholesale; if seededMath() ever regresses to a
// plain object instead of Object.create(Math), MVFresh's fnv() (which calls Math.imul inside
// drawRun) would throw or silently misbehave. Verified directly here, before anything else runs.
function verifySeededMathPreservesImul() {
  const d = buildDrivers(loadModules(), { extraGlobals: { Math: seededMath(SEEDS[0]) } })[0];
  const F = d && d.sandbox && d.sandbox.MVFresh;
  if (!F) throw new Error('self-check: MVFresh not captured under seeded Math');
  F._resetForTest();
  const out = F.drawRun(() => ({ topic: 'selfcheck', text: 'n ' + Math.floor(Math.random() * 1e9), answer: 1 }), 'selfcheck.g5.i0', 1);
  if (!out || out.length !== 1) throw new Error('self-check: drawRun under seeded Math did not return 1 item -- Math.imul (used internally by MVFresh\'s fnv hash) may have been clobbered by extraGlobals.Math');
  console.log('self-check: seeded Math preserves Math.imul (one MVFresh.drawRun call succeeded under seeded Math) -- OK');
}

// ---- synthetic negative control (content-independent; must run every invocation) ----
// Design, verified empirically: with a 30-item pool, 10 runs x 10 draws
// SHARED across one ledger (100 total demand > 30-item pool) is pigeonhole-impossible to keep
// clean -- MVFresh's own exhaustion/eviction path is forced to accept genuine repeats once the
// pool is exhausted, same as it would for any real thin content. That's a feature of MVFresh, not
// a bug in this control, but it means the "clean" arm has to be built differently: reset the
// ledger before EACH of the 10 trials, so every trial draws from a full, untouched 30-item pool
// (10 << 30, trivially, reliably clean via drawRun's own retry logic). The "must show repeats" arm
// stays naive and cumulative across all 10x10=100 raw draws with ZERO protection, which guarantees
// (by pigeonhole, not probability -- 100 draws, 30 possible values) at least one repeat regardless
// of seed.
function runNegativeControl() {
  console.log('=== synthetic negative control (content-independent; proves this file\'s own duplicate-detection logic before it judges anything) ===');
  const POOL = 30, COUNT = 10, TRIALS = 10;
  function poolGen() { const n = Math.floor(Math.random() * POOL); return { topic: 'negctrl-synthetic', text: 'synthetic n=' + n, answer: n }; }

  const d = buildDrivers(loadModules(), { extraGlobals: { Math: seededMath(SEEDS[0]) } })[0];
  const F = d.sandbox.MVFresh;
  let ledgerDupTotal = 0;
  const ledgerPerTrial = [];
  for (let t = 0; t < TRIALS; t++) {
    F._resetForTest();
    const out = F.drawRun(poolGen, 'negctrl.synthetic.i0', COUNT);
    const sigs = out.map(F.sigOf);
    const dup = sigs.length - new Set(sigs).size;
    ledgerPerTrial.push(dup);
    ledgerDupTotal += dup;
  }

  let naiveAll = [];
  for (let t = 0; t < TRIALS; t++) {
    const out = Array.from({ length: COUNT }, poolGen);
    naiveAll = naiveAll.concat(out.map((q) => 'p:' + q.topic + '#' + q.answer));
  }
  const naiveDup = naiveAll.length - new Set(naiveAll).size;

  console.log('  ledger-ON arm: ' + ledgerDupTotal + ' duplicate(s) across ' + TRIALS + ' independently-reset trials of ' + COUNT + ' (per-trial dup counts: ' + ledgerPerTrial.join(',') + ') -- expect 0');
  console.log('  naive arm:     ' + naiveDup + ' duplicate(s) across ' + (TRIALS * COUNT) + ' unprotected draws from a ' + POOL + '-item pool -- expect > 0 (pigeonhole-guaranteed once draws exceed the pool)');

  if (ledgerDupTotal !== 0) {
    console.log('HARNESS BROKEN: the ledger-protected arm produced a duplicate under trivial conditions (pool ' + POOL + ' >> count ' + COUNT + ', fresh ledger every trial). Either MVFresh.drawRun itself is broken, or this control is wired wrong. Refusing to judge any real driver.');
    process.exit(1);
  }
  if (naiveDup === 0) {
    console.log('HARNESS BROKEN: the naive unprotected arm came back clean. This is pigeonhole-impossible (' + (TRIALS * COUNT) + ' draws from a ' + POOL + '-item pool) unless the duplicate-detection logic in this file is broken. Refusing to judge any real driver.');
    process.exit(1);
  }
  console.log('  negative control: OK (this file can both certify a protected arm clean and catch an unprotected arm\'s repeats)');
}

// ---- level scope: per driver, per seed, 10 runs of drawRun at real N, shared ledger ----
// Per-driver derived seed (Task 14 rider): buildDrivers is called ONCE with a throwaway extraGlobals
// (truthy, nothing injected -- the shells.js idiom -- just to make .sandbox reachable), then EACH
// driver's sandbox.Math is reassigned to its own mulberry32(seed ^ fnv(driverId)) right before that
// driver's 10-run trial. No other driver's content can shift this driver's draws.
function runLevelScope(seed) {
  const drivers = buildDrivers(loadModules(), { extraGlobals: {} });
  const results = new Map(); // driverId -> { N, dupCount, totalDraws }
  for (const d of drivers) {
    const id = driverId(d);
    const N = QPL[d.levelIndex];
    d.sandbox.Math = seededMath(seed ^ fnv(id));
    const F = d.sandbox.MVFresh;
    F._resetForTest();
    let allSigs = [];
    for (let r = 0; r < RUNS; r++) {
      const out = F.drawRun(d.make, id, N);
      allSigs = allSigs.concat(out.map(F.sigOf));
    }
    results.set(id, { N, dupCount: allSigs.length - new Set(allSigs).size, totalDraws: allSigs.length });
  }
  return { drivers, results };
}

// ---- campaign: per module-grade, per seed, 2 sequential campaigns, shared ledger ----
// Per-module-grade derived seed (Task 14 rider): all 6 levels of one module-grade already share one
// module sandbox (and are meant to share one ledger across their own two campaigns), so the seed is
// derived once per group as mulberry32(seed ^ fnv(gid)) -- independent of every OTHER module-grade,
// including the other grade of the SAME module (g5 and g6 no longer draw from one continuous stream
// either).
function runCampaigns(seed) {
  const drivers = buildDrivers(loadModules(), { extraGlobals: {} });
  const groups = new Map(); // "<moduleId>.g<grade>" -> [driver x 6]
  for (const d of drivers) {
    const gid = d.moduleId + '.g' + d.grade;
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(d);
  }
  const results = new Map(); // gid -> { withinDup1, withinDup2, crossDup, crossTotal }
  for (const [gid, levelDrivers] of groups) {
    levelDrivers.sort((a, b) => a.levelIndex - b.levelIndex);
    levelDrivers[0].sandbox.Math = seededMath(seed ^ fnv(gid));
    const F = levelDrivers[0].sandbox.MVFresh; // shared instance across all 6 (same module sandbox)
    F._resetForTest();
    function playCampaign() {
      let sigs = [];
      for (const d of levelDrivers) {
        const out = F.drawRun(d.make, driverId(d), QPL[d.levelIndex]);
        sigs = sigs.concat(out.map(F.sigOf));
      }
      return sigs;
    }
    const camp1 = playCampaign();
    const camp2 = playCampaign();
    const camp1Set = new Set(camp1);
    results.set(gid, {
      withinDup1: camp1.length - new Set(camp1).size,
      withinDup2: camp2.length - new Set(camp2).size,
      crossDup: camp2.filter((s) => camp1Set.has(s)).length,
      crossTotal: camp2.length,
    });
  }
  return results;
}

// ================= main =================
verifySeededMathPreservesImul();
runNegativeControl();

const allowlist = loadAllowlistFor('sim');
const allowlistByDriver = new Map(allowlist.map((e) => [e.driver, e]));
const seenAllowlistDrivers = new Set();
let gateFail = false;

// ---- level scope, 3 seeds ----
console.log('=== freshness-sim: level scope (10 runs x real N, seeds ' + SEEDS.join(',') + ') ===');
const levelResultsBySeed = SEEDS.map(runLevelScope);
const firstDrivers = levelResultsBySeed[0].drivers;
if (!firstDrivers.length) {
  console.log('FAIL: zero drivers found (extraction broken -- refusing to report a clean gate on nothing)');
  process.exit(1);
}

console.log(padR('driver', 30) + padL('N', 4) + '  ' + padR('per-seed dup counts (11,22,33)', 32) + 'verdict');
const levelRollup = new Map(); // moduleId -> { ok, expectedFail, fail }
function bumpRollup(moduleId, bucket) {
  if (!levelRollup.has(moduleId)) levelRollup.set(moduleId, { ok: 0, expectedFail: 0, fail: 0 });
  levelRollup.get(moduleId)[bucket]++;
}
for (const d of firstDrivers) {
  const id = driverId(d);
  const perSeed = levelResultsBySeed.map((r) => r.results.get(id));
  const N = perSeed[0].N;
  const dupCounts = perSeed.map((r) => r.dupCount);
  const pass = dupCounts.every((c) => c === 0);
  const { verdict, isFailure } = ratchet(id, pass, allowlistByDriver, seenAllowlistDrivers);
  if (isFailure) gateFail = true;
  bumpRollup(d.moduleId, verdict === 'ok' ? 'ok' : (verdict.indexOf('EXPECTED-FAIL') === 0 ? 'expectedFail' : 'fail'));
  console.log(padR(id, 30) + padL(N, 4) + '  ' + padR(dupCounts.join(','), 32) + verdict);
}
console.log('--- per-module rollup, level scope (of 12 drivers each: 2 grades x 6 levels) ---');
console.log(padR('module', 18) + padL('ok', 5) + padL('expected-fail', 15) + padL('unlisted-fail', 15));
for (const [moduleId, r] of levelRollup) {
  console.log(padR(moduleId, 18) + padL(r.ok, 5) + padL(r.expectedFail, 15) + padL(r.fail, 15));
}

// ---- campaign, 3 seeds (own gate namespace: "sim-campaign", separate from level scope's "sim") ----
console.log('=== freshness-sim: campaign (2x full-grade playthrough, seeds ' + SEEDS.join(',') + ') ===');
const campaignAllowlist = loadAllowlistFor('sim-campaign');
const campaignAllowlistByDriver = new Map(campaignAllowlist.map((e) => [e.driver, e]));
const seenCampaignAllowlistIds = new Set();

const campaignResultsBySeed = SEEDS.map(runCampaigns);
const gids = Array.from(campaignResultsBySeed[0].keys()).sort();

// Composite, PER-MODULE-GRADE ratchet (Task 11 fix -- see the header note above for why this
// replaced a file-wide empty-check). `ratchet()` above can't express this: it only compares one
// boolean against one allowlist entry, but a campaign entry covers an OR of two independent
// conditions and only counts as stale once BOTH clear, so this gets its own bespoke pass rather
// than reusing that helper.
console.log(padR('module-grade', 22) + padR('within-dup (11,22,33)', 26) + padR('cross-rate (11,22,33)', 30) + 'verdict');
for (const gid of gids) {
  const perSeed = campaignResultsBySeed.map((m) => m.get(gid));
  const withinPass = perSeed.every((r) => r.withinDup1 === 0 && r.withinDup2 === 0);
  const withinDupsStr = perSeed.map((r) => r.withinDup1 + '/' + r.withinDup2).join(',');
  const rates = perSeed.map((r) => r.crossDup / r.crossTotal);
  const ratesStr = rates.map((r) => (r * 100).toFixed(2) + '%').join(',');
  const worstRate = Math.max(...rates);
  const crossPass = worstRate <= CROSS_CAMPAIGN_MAX_RATE;
  const bothPass = withinPass && crossPass;

  const gidMatch = /^(.*)\.g(\d+)$/.exec(gid);
  if (!gidMatch) throw new Error('malformed module-grade id: ' + gid);
  const id = campaignId(gidMatch[1], gidMatch[2]);

  const entry = campaignAllowlistByDriver.get(id);
  let verdict;
  if (entry) {
    seenCampaignAllowlistIds.add(id);
    if (bothPass) {
      verdict = 'FAIL (stale allowlist entry -- both within-campaign and cross-campaign now clear, delete it)';
      gateFail = true;
    } else {
      verdict = 'EXPECTED-FAIL (' + entry.reason + ')';
    }
  } else if (bothPass) {
    verdict = 'ok';
  } else {
    const reasons = [];
    if (!withinPass) reasons.push('within-campaign repeats');
    if (!crossPass) reasons.push('cross-campaign rate ' + (worstRate * 100).toFixed(2) + '% > ' + (CROSS_CAMPAIGN_MAX_RATE * 100).toFixed(0) + '%');
    verdict = 'FAIL (unlisted: ' + reasons.join(' + ') + ')';
    gateFail = true;
  }

  console.log(padR(gid, 22) + padR(withinDupsStr, 26) + padR(ratesStr, 30) + verdict);
}

// Allowlist entries that never matched anything (typo'd id, stale after a rename) are themselves
// a gate failure -- a silently-stale entry defeats the ratchet's whole purpose. Checked per gate
// namespace since level-scope ("sim") and campaign ("sim-campaign") are now separate allowlists.
for (const e of allowlist) {
  if (!seenAllowlistDrivers.has(e.driver)) {
    console.log('FAIL: allowlist entry for unknown id "' + e.driver + '" (gate:sim) never matched any driver -- typo or stale entry');
    gateFail = true;
  }
}
for (const e of campaignAllowlist) {
  if (!seenCampaignAllowlistIds.has(e.driver)) {
    console.log('FAIL: allowlist entry for unknown id "' + e.driver + '" (gate:sim-campaign) never matched any module-grade -- typo or stale entry');
    gateFail = true;
  }
}

if (gateFail) { console.log('RESULT: FAIL'); process.exit(1); }
console.log('RESULT: ALL CLEAN (' + firstDrivers.length + ' drivers x ' + SEEDS.length + ' seeds level-scope, ' + allowlist.length + ' allowlisted; ' + gids.length + ' module-grades x ' + SEEDS.length + ' seeds campaign, ' + campaignAllowlist.length + ' allowlisted)');
