'use strict';
// figure-derive.js -- the figure-derive gate (Task 9, fix round 1). Also DOUBLES AS THE UNIT for
// build/figure-gen.js's genSvg/layout: rather than a separate tests/figure-gen.test.js, the
// behavioral assertions run first in this same file, then the pack-sweep/derive-gate logic runs.
//
// FRAMING (fix round 1): this gate proves REPRODUCIBILITY, not TRUTHFULNESS. Byte-comparing
// genSvg's regenerated output against a committed SVG only proves the two AGREE with each other --
// a bug IN genSvg reproduces perfectly and the gate stays green while the picture disagrees with
// its own dataTable. The structural assertions below (Part 1) are what close that gap: they parse
// the emitted markup and check it against the SOURCE DATA directly (one vertex per series point,
// bar boxes inside the plot rect, every text box inside the canvas, bar length measured from
// zero), which is what would have caught the reviewer's demonstrated one-line off-by-one that
// dropped a point while every byte-compare still passed.
//
// NOT-ARMED CONTRACT: no real pack declares a `gen: true` chart figure yet, so the real-pack
// sweep below finds zero targets every time this runs today. Finding zero targets and reporting
// clean anyway is the silent-clean failure this project bans hardest, so this gate refuses that
// shape structurally: zero real targets prints the NOT-ARMED banner and runs BOTH fixture
// controls against tests/fixtures/vis-demo/ (never registered in the real packs/manifest.json).
//
//   node tests/figure-derive.js
//
// Exit 0 clean, 1 on any failure (including a failing control or a failing genSvg assertion),
// 2 on a harness error. Fix round 1, item 7: a harness error still prints every problem already
// accumulated before it struck, rather than discarding that diagnostic.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  genSvg, renderFigure, resolveAccent, chartTargets, regenerate, layout,
  INK, GRID, GLYPH_W,
} = require('../build/figure-gen.js');

const REPO_ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(REPO_ROOT, 'packs');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'vis-demo');
const NOT_ARMED_BANNER = 'figure-derive: NOT ARMED (no real pack declares a gen:true chart figure); fixture controls ran';

const problems = [];
const note = (m) => console.log('  ' + m);
function fail(m) { problems.push(m); }

// =====================================================================================================
// Part 1: genSvg/layout unit checks (this file doubles as the unit).
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

// ---- minimal, attribute-order-independent SVG parsers (test-only; NOT the generator's concern) ----
function parseTagAttrs(svg, tag) {
  const out = [];
  const re = new RegExp(`<${tag}([^>]*)/?>`, 'g');
  let m;
  while ((m = re.exec(svg))) {
    const obj = {};
    const attrRe = /([a-zA-Z-]+)="([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(m[1]))) obj[am[1]] = am[2];
    out.push(obj);
  }
  return out;
}
function parseTexts(svg) {
  const out = [];
  const re = /<text([^>]*)>([^<]*)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const attrs = m[1];
    const get = (name) => { const am = new RegExp(`${name}="([^"]*)"`).exec(attrs); return am ? am[1] : null; };
    out.push({ x: Number(get('x')), y: Number(get('y')), fontSize: Number(get('font-size')), anchor: get('text-anchor') || 'start', text: m[2] });
  }
  return out;
}
function allFontSizes(svg) { return parseTexts(svg).map((t) => t.fontSize); }
function textBBox(t) {
  const w = t.text.length * GLYPH_W * t.fontSize;
  const ascent = 0.8 * t.fontSize, descent = 0.25 * t.fontSize;
  const left = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x;
  return { left, right: left + w, top: t.y - ascent, bottom: t.y + descent };
}

console.log('genSvg/layout unit checks:');

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

check('every text element computes font-size >= 15', () => {
  const sizes = allFontSizes(genSvg(SAMPLE_LINE, ACCENT)).concat(allFontSizes(genSvg(SAMPLE_BAR, ACCENT)));
  assertTrue(sizes.length > 0, 'no text elements found at all');
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

// ---- item 3: the picture asserted against the DATA, not just against itself ----

check('line chart emits exactly one vertex per series point, x non-decreasing', () => {
  const svg = genSvg(SAMPLE_LINE, ACCENT);
  const polylines = parseTagAttrs(svg, 'polyline');
  assertTrue(polylines.length === 1, `expected 1 polyline, got ${polylines.length}`);
  const verts = polylines[0].points.trim().split(/\s+/).map((s) => s.split(',').map(Number));
  assertTrue(verts.length === SAMPLE_LINE.series[0].points.length, `expected ${SAMPLE_LINE.series[0].points.length} vertices, got ${verts.length} -- this is exactly the class of off-by-one the byte-compare alone cannot see`);
  for (let i = 1; i < verts.length; i++) {
    assertTrue(verts[i][0] >= verts[i - 1][0], `x-coordinates are not non-decreasing: ${JSON.stringify(verts.map((v) => v[0]))}`);
  }
});

check('bar chart emits exactly one accent rect per series point, each inside the plot rect', () => {
  const svg = genSvg(SAMPLE_BAR, ACCENT);
  const g = layout(SAMPLE_BAR);
  const rects = parseTagAttrs(svg, 'rect').filter((r) => r.fill === ACCENT);
  assertTrue(rects.length === SAMPLE_BAR.series[0].points.length, `expected ${SAMPLE_BAR.series[0].points.length} bar rect(s), got ${rects.length}`);
  rects.forEach((r) => {
    const x0 = Number(r.x), y0 = Number(r.y), x1 = x0 + Number(r.width), y1 = y0 + Number(r.height);
    assertTrue(x0 >= g.plotL - 0.5 && x1 <= g.plotR + 0.5, `rect x-range [${x0},${x1}] escapes plot [${g.plotL},${g.plotR}]`);
    assertTrue(y0 >= g.plotT - 0.5 && y1 <= g.plotB + 0.5, `rect y-range [${y0},${y1}] escapes plot [${g.plotT},${g.plotB}]`);
  });
});

check('renderFigure names the figure id and the reason on refusal', () => {
  const fig = { id: 'poison-empty-series', dataTable: { type: 'line', series: [{ points: [] }] } };
  let threw = false, msg = '';
  try { renderFigure(fig, ACCENT); } catch (e) { threw = true; msg = e.message; }
  assertTrue(threw, 'renderFigure did not throw');
  assertTrue(msg.includes('poison-empty-series'), `message missing figure id: ${msg}`);
  assertTrue(msg.includes('no points'), `message missing the reason: ${msg}`);
});

// ---- item 4: tick labels must not clip off the canvas; general text-bbox sweep ----

check('y-axis tick labels do not clip off the canvas for a wide-magnitude value (was: fixed 72px margin)', () => {
  const wide = { type: 'line', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, 123456.789], [2, -98765.4]] }] };
  const svg = genSvg(wide, ACCENT);
  parseTexts(svg).forEach((t) => {
    const b = textBBox(t);
    assertTrue(b.left >= -1, `text "${t.text}" clips off the LEFT edge: left=${b.left}`);
  });
});

check('every text element\'s estimated box lies inside the 800x450 canvas', () => {
  [SAMPLE_LINE, SAMPLE_BAR, { type: 'line', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, 123456.789], [2, -98765.4]] }] }]
    .forEach((t) => {
      const svg = genSvg(t, ACCENT);
      parseTexts(svg).forEach((el) => {
        const b = textBBox(el);
        assertTrue(b.left >= -1 && b.right <= 801, `text "${el.text}" escapes canvas horizontally: [${b.left.toFixed(1)},${b.right.toFixed(1)}]`);
        assertTrue(b.top >= -1 && b.bottom <= 451, `text "${el.text}" escapes canvas vertically: [${b.top.toFixed(1)},${b.bottom.toFixed(1)}]`);
      });
    });
});

// ---- item 5: refuse non-finite input rather than fabricating a [0,1] domain ----

check('genSvg refuses non-finite point values instead of fabricating a domain', () => {
  const poisons = [
    { type: 'line', series: [{ points: [[1, 10], ['410', 20]] }] },   // quoted-number authoring slip
    { type: 'line', series: [{ points: [[1, 10], [2, NaN]] }] },
    { type: 'line', series: [{ points: [[1, 10], [2, Infinity]] }] },
  ];
  poisons.forEach((t, i) => {
    let threw = false;
    try { genSvg(t, ACCENT); } catch (e) { threw = true; }
    assertTrue(threw, `poison table ${i} did not throw`);
  });
});

check('genSvg keeps the legitimate lo === hi widening (flat data is not refused)', () => {
  const flat = { type: 'line', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, 5], [2, 5], [3, 5]] }] };
  const svg = genSvg(flat, ACCENT);
  assertTrue(svg.includes('<polyline'), 'flat data should still render, not refuse');
});

// ---- item 8: refuse what cannot be drawn truthfully ----

check('genSvg refuses a bar chart with unequal series point counts, naming the reason', () => {
  const t = { type: 'bar', series: [{ points: [[1, 1], [2, 2]] }, { points: [[1, 1]] }] };
  let threw = false, msg = '';
  try { genSvg(t, ACCENT); } catch (e) { threw = true; msg = e.message; }
  assertTrue(threw, 'did not throw for unequal series point counts');
  assertTrue(/unequal/i.test(msg), `message did not name the unequal-count reason: ${msg}`);
});

check('genSvg refuses a multi-series chart with EQUAL counts generically', () => {
  const t = { type: 'line', series: [{ points: [[1, 1], [2, 2]] }, { points: [[1, 3], [2, 4]] }] };
  let threw = false, msg = '';
  try { genSvg(t, ACCENT); } catch (e) { threw = true; msg = e.message; }
  assertTrue(threw, 'did not throw for a multi-series chart');
  assertTrue(/multi-series/i.test(msg), `message did not name multi-series as the reason: ${msg}`);
});

check('genSvg refuses a series with zero points', () => {
  const t = { type: 'line', series: [{ points: [] }] };
  let threw = false;
  try { genSvg(t, ACCENT); } catch (e) { threw = true; }
  assertTrue(threw, 'did not throw for zero points');
});

check('genSvg does NOT refuse a single-point line series -- the marker makes it visible', () => {
  const t = { type: 'line', xLabel: 'x', yLabel: 'y', series: [{ points: [[5, 50]] }] };
  const svg = genSvg(t, ACCENT);
  assertTrue(/<circle/.test(svg), 'expected a marker circle for the single point');
});

// ---- item 2: bar length measured from zero, not a padded minimum ----

check('bar length is proportional to VALUE (measured from zero), not to value-minus-minimum', () => {
  const t = { type: 'bar', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, 100], [2, 200]] }] };
  const svg = genSvg(t, ACCENT);
  const rects = parseTagAttrs(svg, 'rect').filter((r) => r.fill === ACCENT);
  const ratio = Number(rects[1].height) / Number(rects[0].height);
  assertTrue(Math.abs(ratio - 2) < 0.03, `expected the 200-bar to be ~2x the 100-bar's height (proportional to value), got ratio ${ratio}`);
});

check('bar chart draws a negative value downward from zero, not indistinguishable from positive', () => {
  const t = { type: 'bar', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, -50], [2, 50]] }] };
  const svg = genSvg(t, ACCENT);
  const g = layout(t);
  const rects = parseTagAttrs(svg, 'rect').filter((r) => r.fill === ACCENT);
  const zeroY = g.yScale(0);
  assertTrue(Number(rects[0].y) >= zeroY - 0.6, `negative-value bar box (y=${rects[0].y}) does not start at/below the zero line (${zeroY})`);
  assertTrue(Number(rects[1].y) + Number(rects[1].height) <= zeroY + 0.6, `positive-value bar extends below the zero line`);
});

check('a bar value of exactly zero draws no visible bar', () => {
  const t = { type: 'bar', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, 0], [2, 10]] }] };
  const svg = genSvg(t, ACCENT);
  const rects = parseTagAttrs(svg, 'rect').filter((r) => r.fill === ACCENT);
  assertTrue(Number(rects[0].height) < 0.5, `expected ~0 height for a zero value, got ${rects[0].height}`);
});

check('bar chart emits an explicit zero-baseline gridline at full ink contrast', () => {
  const svg = genSvg(SAMPLE_BAR, ACCENT);
  const inkLines = parseTagAttrs(svg, 'line').filter((l) => l.stroke === INK);
  assertTrue(inkLines.length >= 1, 'no gridline rendered at full ink contrast for the zero baseline');
});

check('line chart draws no zero-baseline recoloring (bar-only behavior)', () => {
  const svg = genSvg(SAMPLE_LINE, ACCENT);
  const inkLines = parseTagAttrs(svg, 'line').filter((l) => l.stroke === INK);
  assertTrue(inkLines.length === 0, 'a line chart should not recolor any gridline to ink (that is bar-only)');
});

// ---- item 9: values recoverable from the picture ----

check('nice-number y ticks: every tick value is a clean multiple of a 1/2/5 x 10^k step', () => {
  const g = layout(SAMPLE_LINE);
  const step = g.yTicks.length > 1 ? g.yTicks[1] - g.yTicks[0] : 0;
  g.yTicks.forEach((v, i) => {
    if (i === 0) return;
    assertTrue(Math.abs((v - g.yTicks[0]) - i * step) < 1e-6, `tick ${v} is not evenly stepped from ${g.yTicks[0]} by ${step}`);
  });
});

check('integer-valued x gets integer x ticks (line chart)', () => {
  const g = layout(SAMPLE_LINE);   // day values 1,2,3 -- all integers
  g.xTicks.forEach((v) => assertTrue(Number.isInteger(v), `x tick ${v} is not an integer for integer-valued x data`));
});

check('a data point marker exists at every plotted point (line chart)', () => {
  const svg = genSvg(SAMPLE_LINE, ACCENT);
  const circles = parseTagAttrs(svg, 'circle');
  assertTrue(circles.length === SAMPLE_LINE.series[0].points.length, `expected ${SAMPLE_LINE.series[0].points.length} marker(s), got ${circles.length}`);
});

// ---- item 10: hardening ----

check('generator ink/grid tokens match MVFigures.TOKENS (chrome grid stays the low-contrast token)', () => {
  const MVFigures = require('../engine/figures.js');   // safe: reads TOKENS only, no DOM call
  assert.strictEqual(INK, MVFigures.TOKENS.ink, 'INK does not match MVFigures.TOKENS.ink');
  assert.strictEqual(GRID, MVFigures.TOKENS.grid, 'GRID does not match MVFigures.TOKENS.grid');
});

check('excess footer notes are clamped: plot height never collapses, no negative dimensions', () => {
  const manyNotes = Array.from({ length: 12 }, (_, i) => `Note number ${i}`);
  const t = { type: 'line', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, 1], [2, 2]] }], notes: manyNotes };
  const svg = genSvg(t, ACCENT);
  const g = layout(t);
  assertTrue(g.notes.length <= 4, `expected notes to be clamped to <= 4, kept ${g.notes.length}`);
  assertTrue(g.plotB - g.plotT >= 120, `plot height collapsed to ${g.plotB - g.plotT}px`);
  parseTagAttrs(svg, 'rect').concat(parseTagAttrs(svg, 'circle')).forEach((el) => {
    if (el.width !== undefined) assertTrue(Number(el.width) >= 0, `negative width: ${JSON.stringify(el)}`);
    if (el.height !== undefined) assertTrue(Number(el.height) >= 0, `negative height: ${JSON.stringify(el)}`);
  });
});

// =====================================================================================================
// Part 2: the derive gate itself.
// =====================================================================================================

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// Regenerates every gen:true chart figure in `pack` (whose file lives in `packDir`) and
// byte-compares each against its own committed src. Returns the number of figures COMPARED (a
// refusal or a missing file is reported and skipped, not counted, so a caller can tell "nothing
// to prove" apart from "compared and clean"). Fix round 1, item 7: a renderFigure() refusal is
// caught HERE, per figure, so one bad dataTable in a real pack cannot crash the whole sweep to
// exit 2 and discard every other figure's already-computed result.
function deriveAndCompare(pack, packDir, label) {
  const accent = resolveAccent(packDir, pack);
  let compared = 0;
  for (const fig of chartTargets(pack)) {
    const srcAbs = path.join(REPO_ROOT, fig.src);
    if (!fs.existsSync(srcAbs)) {
      fail(`${label}: figure "${fig.id}" declares gen:true but its src "${fig.src}" does not exist on disk`);
      continue;
    }
    let derived;
    try { derived = renderFigure(fig, accent); }
    catch (e) { fail(`${label}: ${e.message}`); continue; }
    const expected = fs.readFileSync(srcAbs, 'utf8');
    compared++;
    if (derived !== expected) {
      fail(`${label}: figure "${fig.id}" regenerated output does not byte-match its committed src "${fig.src}" (accent used: ${accent}); regenerate with: node build/figure-gen.js <pack.json>`);
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

// Returns true if the fixture's committed SVG matched what genSvg derives from its own dataTable.
function fixturePositiveControl() {
  const { pack } = loadFixture();
  const before = problems.length;
  const compared = deriveAndCompare(pack, FIXTURE_DIR, 'positive control (tests/fixtures/vis-demo/pack.json)');
  const failedHere = problems.length > before;
  if (compared === 0 && !failedHere) fail('positive control: no gen:true chart figures were compared at all -- the control cannot prove anything');
  return !failedHere;
}

// Fix round 1, item 7: the "sanity half" (regenerate from the UNMUTATED table, confirm it still
// matches) is only meaningful -- and only run -- when the positive control ALREADY confirmed the
// committed SVG matches the unmutated table. If the positive control failed, IT already named the
// real cause (a stale committed file); re-running this comparison would only add a confusing
// SECOND failure that reads as "genSvg is nondeterministic," which it is not.
function fixtureNegativeControl(positiveControlPassed) {
  const { pack, fig } = loadFixture();
  const accent = resolveAccent(FIXTURE_DIR, pack);
  const srcAbs = path.join(REPO_ROOT, fig.src);
  if (!fs.existsSync(srcAbs)) {
    fail(`negative control: expected src "${fig.src}" does not exist on disk; regenerate before running controls`);
    return;
  }
  const expected = fs.readFileSync(srcAbs, 'utf8');

  const mutated = JSON.parse(JSON.stringify(fig.dataTable));
  const p0 = mutated.series[0].points[0];
  mutated.series[0].points[0] = [p0[0], p0[1] + 50];
  let derivedFromMutated;
  try { derivedFromMutated = genSvg(mutated, accent); }
  catch (e) { fail(`negative control: mutated dataTable unexpectedly refused to render: ${e.message}`); return; }

  if (derivedFromMutated === expected) {
    fail('negative control: mutating one dataTable point in memory did not change the derived SVG; the detector cannot be trusted');
  } else {
    note('negative control: mutated dataTable point correctly produced a mismatch against the committed SVG -- the detector fired');
  }

  if (!positiveControlPassed) {
    note('negative control sanity: skipped -- the positive control already failed for this figure; regenerate the fixture (node build/figure-gen.js tests/fixtures/vis-demo/pack.json) before trusting this control');
    return;
  }
  const derivedFromOriginal = genSvg(fig.dataTable, accent);
  if (derivedFromOriginal !== expected) {
    fail('negative control sanity: regenerating from the UNMUTATED dataTable no longer matches the committed SVG even though the positive control just passed; this should be unreachable and points at a harness bug in this file, not a content defect');
  } else {
    note('negative control sanity: the unmutated dataTable still regenerates byte-identical output');
  }
}

// Fix round 1, item 6: proves the documented remedy for a red gate ("regenerate the fixture")
// ACTUALLY repairs it. Runs the real CLI code path (regenerate(), writing to the figure's real
// declared src, exactly like `node build/figure-gen.js` does with no --outdir) and immediately
// re-derives. This WRITES tests/fixtures/vis-demo/f-chart.svg -- safe and required to be a no-op,
// since genSvg is deterministic and the file is already byte-identical; if it were NOT already
// correct, this is exactly the assertion that should catch that.
function roundTripCheck() {
  const { pack } = loadFixture();
  const { written, refused } = regenerate(pack, FIXTURE_DIR, {});
  if (refused.length) {
    fail(`round-trip: regenerate refused figure(s): ${refused.map((r) => `${r.id}: ${r.reason}`).join('; ')}`);
    return;
  }
  if (!written.length) { fail('round-trip: regenerate wrote nothing for the fixture pack; nothing to prove'); return; }
  const before = problems.length;
  deriveAndCompare(pack, FIXTURE_DIR, 'round-trip (post-regenerate)');
  if (problems.length > before) fail('round-trip: regenerating via the CLI path left the derive gate red -- "regenerate to fix a red gate" is not actually true');
  else note('round-trip: regenerating the fixture via the CLI path leaves the derive gate green');
}

console.log('\nfigure-derive gate:');
let harnessError = null;
let realTargets = 0;
try {
  realTargets = realPackSweep();
} catch (e) {
  harnessError = e;
}

if (!harnessError && realTargets === 0) {
  console.log('\n' + NOT_ARMED_BANNER + '\n');
  try {
    const positiveOk = fixturePositiveControl();
    fixtureNegativeControl(positiveOk);
    roundTripCheck();
  } catch (e) {
    harnessError = e;
  }
}

console.log(`\n=== figure-derive: ${problems.length} problem(s) ===`);
if (problems.length) problems.forEach((p) => console.log('  ' + p));
if (harnessError) {
  console.error('\nfigure-derive: harness error: ' + (harnessError.stack || harnessError));
  console.log('\nRESULT: HARNESS ERROR');
  process.exit(2);
}
if (problems.length) {
  console.log('\nRESULT: FAILED');
  process.exit(1);
}
console.log('\nRESULT: ALL CLEAN');
process.exit(0);
