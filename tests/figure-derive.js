'use strict';
// figure-derive.js -- the figure-derive gate (Task 9). Also DOUBLES AS THE UNIT for
// build/figure-gen.js's genSvg: rather than a separate tests/figure-gen.test.js, the behavioral
// assertions on genSvg itself run first in this same file, then the pack-sweep/derive-gate logic
// runs. Both halves report through the same problems[] list and the same exit code.
//
// The gate's job: for every REAL pack figure declaring `kind: "chart", gen: true`, regenerate its
// SVG from its own committed dataTable via genSvg() and byte-compare the result against the
// committed `src` file. A mismatch means the picture on screen and the dataTable an item's answer
// key is graded against have drifted apart -- for the C-wave chart-reading items this phase is
// building toward, that is a wrong-answer defect, not a rendering nit (see task-9-brief.md).
//
// NOT-ARMED CONTRACT: no real pack declares a `gen: true` chart figure yet (same as Task 8's
// figures-offline gate), so the real-pack sweep below finds zero targets every time this runs
// today. Finding zero targets and reporting clean anyway is the silent-clean failure this project
// bans hardest, so this gate refuses that shape structurally: zero real targets prints the
// NOT-ARMED banner and runs BOTH fixture controls against tests/fixtures/vis-demo/ (never
// registered in the real packs/manifest.json) -- a positive control (regenerate the fixture's
// chart from its dataTable, byte-compare against the committed f-chart.svg) and a negative
// control (mutate the dataTable IN MEMORY, assert the mismatch is DETECTED). Both controls
// failing is exit 1 even while NOT ARMED; only "both controls green" earns exit 0 on this path.
// The moment a real pack ships a gen:true chart, the sweep below picks it up automatically and
// stops being NOT-ARMED.
//
//   node tests/figure-derive.js
//
// Exit 0 clean, 1 on any failure (including a failing control or a failing genSvg assertion),
// 2 on a harness error.

const fs = require('fs');
const path = require('path');
const { genSvg, resolveAccent } = require('../build/figure-gen.js');

const REPO_ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(REPO_ROOT, 'packs');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'vis-demo');
const NOT_ARMED_BANNER = 'figure-derive: NOT ARMED (no real pack declares a gen:true chart figure); fixture controls ran';

const problems = [];
const note = (m) => console.log('  ' + m);
function fail(m) { problems.push(m); }

// =====================================================================================================
// Part 1: genSvg unit checks (Step 1 of the brief -- this file doubles as the unit).
// =====================================================================================================

function check(name, fn) {
  try { fn(); note('ok   ' + name); }
  catch (e) { fail(`unit "${name}": ${e.message}`); console.log('  FAIL ' + name + ': ' + e.message); }
}

function assertTrue(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const SAMPLE_LINE = {
  type: 'line', xLabel: 'day', yLabel: 'CO2 (ppm)',
  series: [{ label: 'CO2', points: [[1, 410], [2, 430], [3, 452]] }],
  notes: ['Sample data for the unit check.'],
};
const SAMPLE_BAR = {
  type: 'bar', xLabel: 'week', yLabel: 'count',
  series: [{ label: 'A', points: [[1, 4], [2, 7], [3, 3]] }],
};
const ACCENT = '#7aa8ff';

function allFontSizes(svg) {
  const out = [];
  const re = /font-size="([0-9.]+)"/g;
  let m;
  while ((m = re.exec(svg))) out.push(Number(m[1]));
  return out;
}

console.log('genSvg unit checks:');

check('genSvg is deterministic across two calls with the same table', () => {
  const a = genSvg(SAMPLE_LINE, ACCENT);
  const b = genSvg(SAMPLE_LINE, ACCENT);
  assertTrue(a === b, 'two calls with an identical dataTable produced different output');
});

check('output has an <svg root', () => {
  assertTrue(genSvg(SAMPLE_LINE, ACCENT).startsWith('<svg'), 'output does not start with <svg');
});

check('both axis labels appear in the output (line)', () => {
  const svg = genSvg(SAMPLE_LINE, ACCENT);
  assertTrue(svg.includes(SAMPLE_LINE.xLabel), 'xLabel missing from output');
  assertTrue(svg.includes(SAMPLE_LINE.yLabel), 'yLabel missing from output');
});

check('line chart emits exactly one polyline per series', () => {
  const svg = genSvg(SAMPLE_LINE, ACCENT);
  const count = (svg.match(/<polyline/g) || []).length;
  assertTrue(count === SAMPLE_LINE.series.length, `expected ${SAMPLE_LINE.series.length} polyline(s), got ${count}`);
});

check('bar chart emits one accent-filled rect per series point (grouped rects)', () => {
  const svg = genSvg(SAMPLE_BAR, ACCENT);
  const totalPoints = SAMPLE_BAR.series.reduce((n, s) => n + s.points.length, 0);
  const accentRects = (svg.match(new RegExp(`<rect[^>]*fill="${ACCENT}"`, 'g')) || []).length;
  assertTrue(accentRects === totalPoints, `expected ${totalPoints} accent-filled rect(s), got ${accentRects}`);
});

check('every text element computes font-size >= 15', () => {
  const sizes = allFontSizes(genSvg(SAMPLE_LINE, ACCENT)).concat(allFontSizes(genSvg(SAMPLE_BAR, ACCENT)));
  assertTrue(sizes.length > 0, 'no font-size attributes found at all');
  const under = sizes.filter((n) => n < 15);
  assertTrue(under.length === 0, `found font-size(s) under 15: ${JSON.stringify(under)}`);
});

check('accent color appears in the output', () => {
  assertTrue(genSvg(SAMPLE_LINE, ACCENT).includes(ACCENT), 'accent color string not found in line output');
  assertTrue(genSvg(SAMPLE_BAR, ACCENT).includes(ACCENT), 'accent color string not found in bar output');
});

check('changing one point changes the output', () => {
  const before = genSvg(SAMPLE_LINE, ACCENT);
  const mutated = JSON.parse(JSON.stringify(SAMPLE_LINE));
  mutated.series[0].points[0] = [mutated.series[0].points[0][0], mutated.series[0].points[0][1] + 37];
  const after = genSvg(mutated, ACCENT);
  assertTrue(before !== after, 'mutating one data point did not change genSvg output');
});

// =====================================================================================================
// Part 2: the derive gate itself.
// =====================================================================================================

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function chartTargets(pack) {
  return (pack.figures || []).filter((f) => f && f.kind === 'chart' && f.gen === true);
}

// Regenerates every gen:true chart figure in `pack` (whose file lives in `packDir`) and
// byte-compares each against its own committed src. Shared by the real-pack sweep and both
// fixture controls so there is exactly one comparison code path to trust.
function deriveAndCompare(pack, packDir, label) {
  const accent = resolveAccent(packDir, pack);
  let compared = 0;
  for (const fig of chartTargets(pack)) {
    const srcAbs = path.join(REPO_ROOT, fig.src);
    if (!fs.existsSync(srcAbs)) {
      fail(`${label}: figure "${fig.id}" declares gen:true but its src "${fig.src}" does not exist on disk`);
      continue;
    }
    const expected = fs.readFileSync(srcAbs, 'utf8');
    const derived = genSvg(fig.dataTable, accent);
    compared++;
    if (derived !== expected) {
      fail(`${label}: figure "${fig.id}" regenerated output does not byte-match its committed src "${fig.src}" (accent used: ${accent})`);
    } else {
      note(`${label}: figure "${fig.id}" regenerated output byte-matches "${fig.src}" (accent ${accent})`);
    }
  }
  return compared;
}

function realPackSweep() {
  let realTargets = 0;
  if (!fs.existsSync(PACK_DIR)) return 0;
  const files = fs.readdirSync(PACK_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.verdicts.json') && f !== 'manifest.json');
  for (const f of files) {
    const abs = path.join(PACK_DIR, f);
    let pack;
    try { pack = loadJson(abs); } catch (e) { fail(`${f}: invalid JSON: ${e.message}`); continue; }
    const targets = chartTargets(pack);
    if (!targets.length) continue;
    realTargets += targets.length;
    deriveAndCompare(pack, PACK_DIR, f);
  }
  return realTargets;
}

function loadFixture() {
  const pack = loadJson(path.join(FIXTURE_DIR, 'pack.json'));
  const fig = chartTargets(pack).find((f) => f.id === 'fig-chart');
  if (!fig) throw new Error('fixture pack has no gen:true chart figure named "fig-chart"');
  return { pack, fig };
}

function fixturePositiveControl() {
  const { pack, fig } = loadFixture();
  const compared = deriveAndCompare(pack, FIXTURE_DIR, 'positive control (tests/fixtures/vis-demo/pack.json)');
  if (compared === 0) fail('positive control: no gen:true chart figures were compared at all -- the control cannot prove anything');
}

function fixtureNegativeControl() {
  const { pack, fig } = loadFixture();
  const accent = resolveAccent(FIXTURE_DIR, pack);
  const srcAbs = path.join(REPO_ROOT, fig.src);
  const expected = fs.readFileSync(srcAbs, 'utf8');

  // Mutate the dataTable IN MEMORY only -- pack.json and f-chart.svg on disk are untouched.
  const mutated = JSON.parse(JSON.stringify(fig.dataTable));
  const p0 = mutated.series[0].points[0];
  mutated.series[0].points[0] = [p0[0], p0[1] + 50];
  const derivedFromMutated = genSvg(mutated, accent);

  if (derivedFromMutated === expected) {
    fail('negative control: mutating one dataTable point in memory did not change the derived SVG; the detector cannot be trusted');
  } else {
    note('negative control: mutated dataTable point correctly produced a mismatch against the committed SVG -- the detector fired');
  }

  // Sanity half: regenerating from the UNMUTATED dataTable must still match, proving the mismatch
  // above came from the mutation and not from some unrelated nondeterminism in genSvg itself.
  const derivedFromOriginal = genSvg(fig.dataTable, accent);
  if (derivedFromOriginal !== expected) {
    fail('negative control sanity: regenerating from the UNMUTATED dataTable no longer matches the committed SVG; something other than the deliberate mutation is causing drift');
  } else {
    note('negative control sanity: the unmutated dataTable still regenerates byte-identical output');
  }
}

console.log('\nfigure-derive gate:');
let realTargets = 0;
try {
  realTargets = realPackSweep();
} catch (e) {
  console.error('figure-derive: harness error during real-pack sweep:', e && e.stack || e);
  process.exit(2);
}

if (realTargets === 0) {
  console.log('\n' + NOT_ARMED_BANNER + '\n');
  try {
    fixturePositiveControl();
    fixtureNegativeControl();
  } catch (e) {
    console.error('figure-derive: harness error during fixture controls:', e && e.stack || e);
    process.exit(2);
  }
}

console.log(`\n=== figure-derive: ${problems.length} problem(s) ===`);
if (problems.length) {
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nRESULT: FAILED');
  process.exit(1);
}
console.log('\nRESULT: ALL CLEAN');
process.exit(0);
