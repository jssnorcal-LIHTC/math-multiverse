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
// NOT-ARMED CONTRACT: a real pack may or may not declare a `gen: true` chart figure on any given
// run (Task 9 armed the sweep against the real pack). Finding zero targets and reporting clean
// anyway is the silent-clean failure this project bans hardest, so this gate refuses that shape
// structurally: zero real targets additionally prints the NOT-ARMED banner. It changes nothing
// about which controls run -- see FIX ROUND 3 below. (Fix round 2 is the team-lead zero-floor
// finding, Task 4, further down in this file -- unrelated to the fixture controls.)
//
// FIX ROUND 3 (this file; mirrors tests/figures-offline.js's own fix round 1 -- read that file's
// header before touching either): the first version of this gate put all three fixture checks --
// the positive control, the negative control, and the round-trip check -- INSIDE the
// `realTargets === 0` guard. The moment the real-pack sweep armed (realTargets > 0), the guard
// stopped opening at all: the negative control (the gate's ONLY proof its own byte-compare
// detector can still return a mismatch), the round-trip check (the ONLY proof "regenerate to fix a
// red gate" is actually true), and all coverage of tests/fixtures/vis-demo/f-chart.svg went dark
// with it, silently, the moment arming looked like an upgrade. That is a coverage DOWNGRADE
// disguised as an upgrade, and it is exactly the silent-clean shape this project bans. All three
// fixture checks now run on EVERY invocation, armed or not; only the NOT-ARMED banner is
// conditional.
//
// FIX ROUND 4 (this file, panels section below): paired mutation against the original single-
// series path proved the panels code path inherited its COUNT/CONTAINMENT checks (one polyline/one
// rect per point, inside the canvas) but never its VALUE-TRUTH checks -- the ones asserting a
// mark's SIZE or POSITION actually corresponds to its datum. See the comment at the panels
// value-truth block for the full finding; it is the panels-mode analogue of this file's own Part 1
// framing above (a self-consistent-but-wrong generator can pass every count check while drawing
// the wrong picture).
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
  layoutPanels, INK, GRID, GLYPH_W, PANEL_GAP, MIN_PANEL_H,
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
    // Fix round 4: the attribute-name class was letters-and-hyphen only, which silently drops any
    // digit-suffixed name -- x1/y1/x2/y2 on <line>, exactly the attrs a <line> element's own
    // endpoints are named. No check before this file's panels value-truth work ever read a line's
    // x1/y1/x2/y2 (only .stroke), so this parser bug had no failing check to expose it.
    const attrRe = /([a-zA-Z0-9-]+)="([^"]*)"/g;
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

// ---- fix round 2 (team-lead finding, Task 4): an axis for a quantity that cannot be negative must
// never OFFER a negative value just because the 8% pad pushed under zero. Applies to paddedExtent
// itself, so it covers every call site (single-chart x, single-chart y, bar's zero-inclusive y, and
// both of those again inside panels) with one guard rather than four repeated ones. ----

check('line x-axis: an all-non-negative series never gets a negative tick (was: season -10)', () => {
  const t = { type: 'line', xLabel: 'season', yLabel: 'y', series: [{ points: [[1, 76], [10, 64], [20, 52], [30, 39]] }] };
  const g = layout(t);
  assertTrue(g.xTicks[0] >= 0, `expected no negative x tick for an all-non-negative series, got ${JSON.stringify(g.xTicks)}`);
});

check('bar y-axis: an all-non-negative series never gets a negative tick (was: rainfall -10, swing -20)', () => {
  const t = { type: 'bar', xLabel: 'x', yLabel: 'y', series: [{ points: [[0, 9], [1, 42]] }] };
  const g = layout(t);
  assertTrue(g.yTicks[0] >= 0, `expected no negative y tick for an all-non-negative bar series, got ${JSON.stringify(g.yTicks)}`);
});

check('line y-axis: an all-non-negative series never gets a negative tick', () => {
  const t = { type: 'line', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, 5], [2, 8], [3, 6]] }] };
  const g = layout(t);
  assertTrue(g.yTicks[0] >= 0, `expected no negative y tick for an all-non-negative line series, got ${JSON.stringify(g.yTicks)}`);
});

check('a GENUINELY negative-valued series is NOT clamped: its floor stays negative (regression guard)', () => {
  const t = { type: 'bar', xLabel: 'x', yLabel: 'y', series: [{ points: [[1, -50], [2, 50]] }] };
  const g = layout(t);
  assertTrue(g.yTicks[0] < 0, `expected a negative floor to survive for a series that actually goes negative, got ${JSON.stringify(g.yTicks)}`);
});

check('panels: shared line x-axis never gets a negative tick when both panels are all-non-negative', () => {
  const t = {
    panels: [
      { type: 'line', yLabel: 'a', series: [{ points: [[1, 76], [10, 64]] }] },
      { type: 'line', yLabel: 'b', series: [{ points: [[1, 20], [10, 19]] }] },
    ],
  };
  const g = layoutPanels(t);
  assertTrue(g.xTicks[0] >= 0, `expected no negative shared x tick, got ${JSON.stringify(g.xTicks)}`);
});

// ---- panels mode (Task 4, V2): the SAME truthfulness scrutiny given the original single-series
// path above, so a self-consistent-but-wrong genSvgPanels bug cannot hide behind a clean byte
// compare the way the original fix-round-1 defect did before item 3 closed that gap. ----

const SAMPLE_PANELS_LINE = {
  panels: [
    { type: 'line', yLabel: 'ppm-like unit', series: [{ points: [[1, 400], [2, 420], [3, 450]] }] },
    { type: 'line', yLabel: 'percent-like unit', series: [{ points: [[1, 20], [2, 19], [3, 18]] }] },
  ],
  xLabel: 'day',
  notes: ['Sample data for the panels unit check.'],
};
const SAMPLE_PANELS_BAR = {
  panels: [
    { type: 'bar', yLabel: 'metric A', series: [{ points: [[0, 9], [1, 42]] }] },
    { type: 'bar', yLabel: 'metric B', series: [{ points: [[0, 68], [1, 33]] }] },
  ],
  categoryLabels: ['Sable Flats', 'Cairn Bay'],
};
// Fix round 4: clean, distinct-per-panel ratios (panel 0 doubles, panel 1 triples) so a bug that
// shares one scale across both panels, or measures height from the wrong zero, cannot coincidentally
// produce the right ratio in one panel while being wrong in the other.
const PROPORTIONAL_PANELS_BAR = {
  panels: [
    { type: 'bar', yLabel: 'metric A', series: [{ points: [[0, 100], [1, 200]] }] },
    { type: 'bar', yLabel: 'metric B', series: [{ points: [[0, 50], [1, 150]] }] },
  ],
  categoryLabels: ['Sable Flats', 'Cairn Bay'],
};
// Fix round 4: panel 0 goes negative (proves downward-from-zero per panel); panel 1's first point
// is exactly zero (proves a zero value draws no visible bar per panel).
const NEG_ZERO_PANELS_BAR = {
  panels: [
    { type: 'bar', yLabel: 'metric A', series: [{ points: [[0, -50], [1, 50]] }] },
    { type: 'bar', yLabel: 'metric B', series: [{ points: [[0, 0], [1, 10]] }] },
  ],
  categoryLabels: ['Sable Flats', 'Cairn Bay'],
};

// ---- fix round 2 (team-lead finding, Task 4), panels variants: same zero-floor guarantee applies
// through layoutPanels(), since it calls the SAME paddedExtent() the single-chart path does. ----

check('panels: bar y-axes never get a negative tick when both panels are all-non-negative', () => {
  const g = layoutPanels(SAMPLE_PANELS_BAR);
  g.panelLayouts.forEach((panel, i) => {
    assertTrue(panel.yTicks[0] >= 0, `panel ${i}: expected no negative y tick, got ${JSON.stringify(panel.yTicks)}`);
  });
});

check('the CO2/O2 dome-drift shape is unaffected: its own far-from-zero axes were never clamped', () => {
  const before = genSvg(SAMPLE_PANELS_LINE, ACCENT);
  const g = layoutPanels(SAMPLE_PANELS_LINE);
  // Neither panel's data comes near zero, so the clamp is a structural no-op here: assert the
  // floors sit close to the data's own minimum (well above 0), not pinned AT 0 the way a
  // genuinely-near-zero series now would be.
  assertTrue(g.panelLayouts[0].yTicks[0] > 100, `panel 0 floor moved unexpectedly close to zero: ${JSON.stringify(g.panelLayouts[0].yTicks)}`);
  assertTrue(g.panelLayouts[1].yTicks[0] > 5, `panel 1 floor moved unexpectedly close to zero: ${JSON.stringify(g.panelLayouts[1].yTicks)}`);
  assertTrue(genSvg(SAMPLE_PANELS_LINE, ACCENT) === before, 'determinism holds under the fix');
});

check('panels: genSvg is deterministic for both line and bar panels', () => {
  assertTrue(genSvg(SAMPLE_PANELS_LINE, ACCENT) === genSvg(SAMPLE_PANELS_LINE, ACCENT), 'line panels: two calls differed');
  assertTrue(genSvg(SAMPLE_PANELS_BAR, ACCENT) === genSvg(SAMPLE_PANELS_BAR, ACCENT), 'bar panels: two calls differed');
});

check('panels: output has an <svg root and both panel yLabels appear', () => {
  const svg = genSvg(SAMPLE_PANELS_LINE, ACCENT);
  assertTrue(svg.startsWith('<svg'), 'output does not start with <svg');
  assertTrue(svg.includes('ppm-like unit'), 'panel 0 yLabel missing');
  assertTrue(svg.includes('percent-like unit'), 'panel 1 yLabel missing');
});

check('panels: every text element computes font-size >= 15 (line and bar)', () => {
  const sizes = allFontSizes(genSvg(SAMPLE_PANELS_LINE, ACCENT)).concat(allFontSizes(genSvg(SAMPLE_PANELS_BAR, ACCENT)));
  assertTrue(sizes.length > 0, 'no text elements found at all');
  const under = sizes.filter((n) => n < 15);
  assertTrue(under.length === 0, `found font-size(s) under 15: ${JSON.stringify(under)}`);
});

check('panels: accent color appears in both panel types', () => {
  assertTrue(genSvg(SAMPLE_PANELS_LINE, ACCENT).includes(ACCENT), 'accent missing from line-panels output');
  assertTrue(genSvg(SAMPLE_PANELS_BAR, ACCENT).includes(ACCENT), 'accent missing from bar-panels output');
});

check('panels: mutating EITHER panel changes the output (each panel\'s data actually reaches the picture)', () => {
  const before = genSvg(SAMPLE_PANELS_LINE, ACCENT);
  const mutateP0 = JSON.parse(JSON.stringify(SAMPLE_PANELS_LINE));
  mutateP0.panels[0].series[0].points[0][1] += 37;
  assertTrue(genSvg(mutateP0, ACCENT) !== before, 'mutating panel 0 did not change output -- panel 0 data may not reach the picture');
  const mutateP1 = JSON.parse(JSON.stringify(SAMPLE_PANELS_LINE));
  mutateP1.panels[1].series[0].points[0][1] += 37;
  assertTrue(genSvg(mutateP1, ACCENT) !== before, 'mutating panel 1 did not change output -- panel 1 data may not reach the picture (e.g. panel 0 rendered twice)');
});

check('panels (line): exactly one polyline PER PANEL, each with one vertex per its own series point, x non-decreasing', () => {
  const svg = genSvg(SAMPLE_PANELS_LINE, ACCENT);
  const polylines = parseTagAttrs(svg, 'polyline');
  assertTrue(polylines.length === 2, `expected 2 polylines (one per panel), got ${polylines.length}`);
  polylines.forEach((pl, i) => {
    const verts = pl.points.trim().split(/\s+/).map((s) => s.split(',').map(Number));
    const expected = SAMPLE_PANELS_LINE.panels[i].series[0].points.length;
    assertTrue(verts.length === expected, `panel ${i}: expected ${expected} vertices, got ${verts.length}`);
    for (let j = 1; j < verts.length; j++) {
      assertTrue(verts[j][0] >= verts[j - 1][0], `panel ${i}: x-coordinates not non-decreasing: ${JSON.stringify(verts.map((v) => v[0]))}`);
    }
  });
});

check('panels (bar): one accent rect PER POINT PER PANEL, each rect\'s box inside ITS OWN panel\'s plot rect', () => {
  const svg = genSvg(SAMPLE_PANELS_BAR, ACCENT);
  const g = layoutPanels(SAMPLE_PANELS_BAR);
  const rects = parseTagAttrs(svg, 'rect').filter((r) => r.fill === ACCENT);
  const expectedTotal = SAMPLE_PANELS_BAR.panels.reduce((s, p) => s + p.series[0].points.length, 0);
  assertTrue(rects.length === expectedTotal, `expected ${expectedTotal} bar rects total, got ${rects.length}`);
  // Panel 0's rects come first in draw order (panels are drawn top to bottom, in order).
  const perPanel = SAMPLE_PANELS_BAR.panels.map((p) => p.series[0].points.length);
  let idx = 0;
  g.panelLayouts.forEach((panel, pi) => {
    for (let k = 0; k < perPanel[pi]; k++, idx++) {
      const r = rects[idx];
      const x0 = Number(r.x), y0 = Number(r.y), x1 = x0 + Number(r.width), y1 = y0 + Number(r.height);
      assertTrue(x0 >= g.plotL - 0.5 && x1 <= g.plotR + 0.5, `panel ${pi} rect ${k}: x-range [${x0},${x1}] escapes [${g.plotL},${g.plotR}]`);
      assertTrue(y0 >= panel.plotT - 0.5 && y1 <= panel.plotB + 0.5, `panel ${pi} rect ${k}: y-range [${y0},${y1}] escapes ITS OWN panel plot [${panel.plotT},${panel.plotB}], not just the canvas -- this is exactly the check that would catch a panel drawing into the wrong vertical band`);
    }
  });
});

check('panels (bar): category axis renders the STRING labels verbatim, not the numeric n2() fallback', () => {
  const svg = genSvg(SAMPLE_PANELS_BAR, ACCENT);
  const g = layoutPanels(SAMPLE_PANELS_BAR);
  const lastPlotB = g.panelLayouts[g.panelLayouts.length - 1].plotB;
  // Identify the CATEGORY-axis text elements specifically (anchor=middle, below the plot: this
  // sample carries no xLabel, so the only middle-anchored text down there is the category row)
  // rather than scanning the whole SVG, since a bar chart's own y-tick labels legitimately include
  // "0" (the zero baseline) and a blanket string search would false-positive on that.
  const categoryTexts = parseTexts(svg).filter((t) => t.anchor === 'middle' && t.y > lastPlotB);
  assertTrue(categoryTexts.length === 2, `expected 2 category-axis text elements, got ${categoryTexts.length}`);
  const texts = categoryTexts.map((t) => t.text);
  assertTrue(texts.includes('Sable Flats'), `category label "Sable Flats" not found verbatim among ${JSON.stringify(texts)}`);
  assertTrue(texts.includes('Cairn Bay'), `category label "Cairn Bay" not found verbatim among ${JSON.stringify(texts)}`);
});

check('panels: renderFigure names the figure id and the reason on a panels refusal', () => {
  const fig = { id: 'poison-panels-count', dataTable: { panels: [{ type: 'line', series: [{ points: [[1, 1]] }] }] } };
  let threw = false, msg = '';
  try { renderFigure(fig, ACCENT); } catch (e) { threw = true; msg = e.message; }
  assertTrue(threw, 'renderFigure did not throw for a 1-panel table');
  assertTrue(msg.includes('poison-panels-count'), `message missing figure id: ${msg}`);
  assertTrue(/exactly 2 panels/.test(msg), `message missing the reason: ${msg}`);
});

check('panels: text boxes for both sample tables (and a long category-label case) lie inside the 800x450 canvas', () => {
  const longLabels = { panels: SAMPLE_PANELS_BAR.panels, categoryLabels: ['A Post With A Genuinely Long Name', 'Cairn Bay'] };
  [SAMPLE_PANELS_LINE, SAMPLE_PANELS_BAR, longLabels].forEach((t) => {
    const svg = genSvg(t, ACCENT);
    parseTexts(svg).forEach((el) => {
      const b = textBBox(el);
      assertTrue(b.left >= -1 && b.right <= 801, `text "${el.text}" escapes canvas horizontally: [${b.left.toFixed(1)},${b.right.toFixed(1)}]`);
      assertTrue(b.top >= -1 && b.bottom <= 451, `text "${el.text}" escapes canvas vertically: [${b.top.toFixed(1)},${b.bottom.toFixed(1)}]`);
    });
  });
});

check('panels: refuses non-finite point values inside either panel, naming that panel', () => {
  const t = {
    panels: [
      { type: 'line', series: [{ points: [[1, 10], [2, NaN]] }] },
      { type: 'line', series: [{ points: [[1, 10], [2, 20]] }] },
    ],
  };
  let threw = false, msg = '';
  try { genSvg(t, ACCENT); } catch (e) { threw = true; msg = e.message; }
  assertTrue(threw, 'did not throw for a non-finite point inside panel 0');
  assertTrue(msg.startsWith('panels[0]:'), `message did not name the panel: ${msg}`);
});

check('panels: refuses a panel count other than 2', () => {
  [1, 3].forEach((n) => {
    const t = { panels: Array.from({ length: n }, () => ({ type: 'line', series: [{ points: [[1, 1], [2, 2]] }] })) };
    let threw = false, msg = '';
    try { genSvg(t, ACCENT); } catch (e) { threw = true; msg = e.message; }
    assertTrue(threw, `did not throw for ${n} panel(s)`);
    assertTrue(/exactly 2 panels/.test(msg), `message did not name the reason for ${n} panel(s): ${msg}`);
  });
});

check('panels: refuses mixed panel types', () => {
  const t = { panels: [{ type: 'line', series: [{ points: [[1, 1], [2, 2]] }] }, { type: 'bar', series: [{ points: [[1, 1]] }] }] };
  let threw = false, msg = '';
  try { genSvg(t, ACCENT); } catch (e) { threw = true; msg = e.message; }
  assertTrue(threw, 'did not throw for mixed panel types');
  assertTrue(/mixed-type panels/.test(msg), `message did not name mixed-type as the reason: ${msg}`);
});

check('panels (line): refuses when panels\' x-values do not match (a shared x-axis requires alignment)', () => {
  const t = { panels: [{ type: 'line', series: [{ points: [[1, 1], [2, 2]] }] }, { type: 'line', series: [{ points: [[1, 1], [3, 2]] }] }] };
  let threw = false, msg = '';
  try { genSvg(t, ACCENT); } catch (e) { threw = true; msg = e.message; }
  assertTrue(threw, 'did not throw for mismatched x-values across line panels');
  assertTrue(/do not match/.test(msg), `message did not name the mismatch: ${msg}`);
});

check('panels (bar): refuses without categoryLabels, and refuses on a length mismatch', () => {
  const noLabels = { panels: [{ type: 'bar', series: [{ points: [[0, 1], [1, 2]] }] }, { type: 'bar', series: [{ points: [[0, 1], [1, 2]] }] }] };
  let threw1 = false, msg1 = '';
  try { genSvg(noLabels, ACCENT); } catch (e) { threw1 = true; msg1 = e.message; }
  assertTrue(threw1, 'did not throw for bar panels with no categoryLabels');
  assertTrue(/categoryLabels/.test(msg1), `message did not name categoryLabels: ${msg1}`);

  const shortLabels = { panels: [{ type: 'bar', series: [{ points: [[0, 1], [1, 2]] }] }, { type: 'bar', series: [{ points: [[0, 1], [1, 2]] }] }], categoryLabels: ['Only One'] };
  let threw2 = false, msg2 = '';
  try { genSvg(shortLabels, ACCENT); } catch (e) { threw2 = true; msg2 = e.message; }
  assertTrue(threw2, 'did not throw for a categoryLabels length mismatch');
  assertTrue(/categoryLabels/.test(msg2), `message did not name categoryLabels: ${msg2}`);
});

check('panels: excess footer notes stay clamped to 4, each panel stays above MIN_PANEL_H, no negative dimensions', () => {
  const manyNotes = Array.from({ length: 12 }, (_, i) => `Note number ${i}`);
  const t = { ...SAMPLE_PANELS_LINE, notes: manyNotes };
  const svg = genSvg(t, ACCENT);
  const g = layoutPanels(t);
  assertTrue(g.notes.length <= 4, `expected notes clamped to <= 4, kept ${g.notes.length}`);
  g.panelLayouts.forEach((panel, i) => {
    assertTrue(panel.plotB - panel.plotT >= MIN_PANEL_H - 0.01, `panel ${i} height collapsed to ${panel.plotB - panel.plotT}px, below MIN_PANEL_H=${MIN_PANEL_H}`);
  });
  parseTagAttrs(svg, 'rect').concat(parseTagAttrs(svg, 'circle')).forEach((el) => {
    if (el.width !== undefined) assertTrue(Number(el.width) >= 0, `negative width: ${JSON.stringify(el)}`);
    if (el.height !== undefined) assertTrue(Number(el.height) >= 0, `negative height: ${JSON.stringify(el)}`);
  });
});

// ---- fix round 4 (team-lead finding): the panels path inherited the original single-series
// path's COUNT and CONTAINMENT checks (one polyline/one rect per point, inside the canvas) but
// never its VALUE-TRUTH checks -- the ones that assert a mark's SIZE or POSITION actually
// corresponds to its datum, not merely that a mark exists somewhere legal. Paired mutation against
// the original path proved the gap: drawing bar height from the wrong zero fails 3 checks on the
// original path and 0 here; suppressing point markers fails 2 checks there and 0 here; and worst
// of all, drawing BOTH panels' line data through panel 0's own y-scale -- so panel 1's data paints
// inside panel 0's band -- fails NOTHING here, because the only line-panel geometry check above
// (vertex count / x monotonicity) never looks at y. fig-dome-drift, the real figure the panels
// feature exists for, is exactly this shape (a line panel), so this is not academic. The checks
// below mirror the original path's own value-truth checks one for one, per panel; every one of
// them was proven able to fail by mutating build/figure-gen.js in a scratch copy outside the repo
// (see the fix report), not merely written to spec. ----

check('panels (line): every vertex of a panel\'s polyline lies within THAT PANEL\'s own plot rect (catches data painted into the wrong band)', () => {
  const svg = genSvg(SAMPLE_PANELS_LINE, ACCENT);
  const g = layoutPanels(SAMPLE_PANELS_LINE);
  const polylines = parseTagAttrs(svg, 'polyline');
  assertTrue(polylines.length === 2, `expected 2 polylines, got ${polylines.length}`);
  polylines.forEach((pl, i) => {
    const panel = g.panelLayouts[i];
    const verts = pl.points.trim().split(/\s+/).map((s) => s.split(',').map(Number));
    verts.forEach(([, y], j) => {
      assertTrue(y >= panel.plotT - 0.5 && y <= panel.plotB + 0.5, `panel ${i} vertex ${j}: y=${y} escapes ITS OWN panel plot [${panel.plotT},${panel.plotB}] -- exactly the check that would catch panel 1's data painting into panel 0's band`);
    });
  });
});

check('panels (line): a data point marker exists at every plotted point, in every panel', () => {
  const svg = genSvg(SAMPLE_PANELS_LINE, ACCENT);
  const circles = parseTagAttrs(svg, 'circle');
  const expectedTotal = SAMPLE_PANELS_LINE.panels.reduce((s, p) => s + p.series[0].points.length, 0);
  assertTrue(circles.length === expectedTotal, `expected ${expectedTotal} marker(s) total (one per point per panel), got ${circles.length}`);
});

check('panels: nice-number y ticks per panel -- each panel\'s OWN tick ladder is evenly stepped (a mis-stepped ladder in either panel fails, not just a shared one)', () => {
  const g = layoutPanels(SAMPLE_PANELS_LINE);
  g.panelLayouts.forEach((panel, i) => {
    const step = panel.yTicks.length > 1 ? panel.yTicks[1] - panel.yTicks[0] : 0;
    panel.yTicks.forEach((v, j) => {
      if (j === 0) return;
      assertTrue(Math.abs((v - panel.yTicks[0]) - j * step) < 1e-6, `panel ${i} tick ${v} is not evenly stepped from ${panel.yTicks[0]} by ${step}`);
    });
  });
});

check('panels (bar): each panel\'s bar height is proportional to VALUE, measured from THAT PANEL\'s own zero (not a shared scale)', () => {
  const svg = genSvg(PROPORTIONAL_PANELS_BAR, ACCENT);
  const rects = parseTagAttrs(svg, 'rect').filter((r) => r.fill === ACCENT);
  assertTrue(rects.length === 4, `expected 4 bar rects total, got ${rects.length}`);
  const [r0a, r0b, r1a, r1b] = rects;
  const ratio0 = Number(r0b.height) / Number(r0a.height);
  const ratio1 = Number(r1b.height) / Number(r1a.height);
  assertTrue(Math.abs(ratio0 - 2) < 0.03, `panel 0: expected the 200-bar to be ~2x the 100-bar (measured from panel 0's own zero), got ratio ${ratio0}`);
  assertTrue(Math.abs(ratio1 - 3) < 0.03, `panel 1: expected the 150-bar to be ~3x the 50-bar (measured from panel 1's own zero), got ratio ${ratio1}`);
});

check('panels (bar): a negative value draws downward from THAT PANEL\'s own zero line, not indistinguishable from positive', () => {
  const svg = genSvg(NEG_ZERO_PANELS_BAR, ACCENT);
  const g = layoutPanels(NEG_ZERO_PANELS_BAR);
  const rects = parseTagAttrs(svg, 'rect').filter((r) => r.fill === ACCENT);
  const panel0 = g.panelLayouts[0];
  const zeroY0 = panel0.yScale(0);
  const [r0neg, r0pos] = rects;
  assertTrue(Number(r0neg.y) >= zeroY0 - 0.6, `panel 0 negative-value bar box (y=${r0neg.y}) does not start at/below its own zero line (${zeroY0})`);
  assertTrue(Number(r0pos.y) + Number(r0pos.height) <= zeroY0 + 0.6, `panel 0 positive-value bar extends below its own zero line`);
});

check('panels (bar): a value of exactly zero draws no visible bar, in either panel', () => {
  const svg = genSvg(NEG_ZERO_PANELS_BAR, ACCENT);
  const rects = parseTagAttrs(svg, 'rect').filter((r) => r.fill === ACCENT);
  const r1zero = rects[2];   // panel 1's first point (value 0); panel 0's 2 rects come first in draw order
  assertTrue(Number(r1zero.height) < 0.5, `expected ~0 height for panel 1's zero value, got ${r1zero.height}`);
});

// Fix round 4, continued: this check's ORIGINAL body only asserted `plotL > 0`, which cannot fail
// -- plotL is floored at MIN_LEFT=48 by construction, so the assertion is a tautology dressed as a
// check. Fixed to assert what its name actually claims: both panels' own y-axis border lines (the
// only elements drawn with the GRID chrome token) land at the identical x, proving the SVG itself,
// not just the layout numbers, uses one shared margin rather than two independently-computed ones.
check('panels: both panels share one left margin (vertical alignment) and never overlap vertically', () => {
  const svg = genSvg(SAMPLE_PANELS_LINE, ACCENT);
  const axisLines = parseTagAttrs(svg, 'line').filter((l) => l.stroke === GRID);
  assertTrue(axisLines.length === 2, `expected 2 panel y-axis border lines (one per panel), got ${axisLines.length}`);
  assertTrue(Number(axisLines[0].x1) === Number(axisLines[1].x1), `panel y-axis lines are drawn at different x (${axisLines[0].x1} vs ${axisLines[1].x1}) -- the panels do not actually share one left margin`);

  const g = layoutPanels(SAMPLE_PANELS_LINE);
  const [p0, p1] = g.panelLayouts;
  assertTrue(p1.plotT - p0.plotB === PANEL_GAP, `expected the gap between panels to be exactly PANEL_GAP=${PANEL_GAP}, got ${p1.plotT - p0.plotB}`);
  assertTrue(p0.plotB <= p1.plotT, `panels overlap: panel 0 bottom ${p0.plotB} is below panel 1 top ${p1.plotT}`);
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
}

// All three fixture checks run on EVERY invocation, armed or not (see FIX ROUND 3 in the header
// comment). The negative control is the gate's only proof its own byte-compare detector can still
// fire, and the round-trip check is the only proof "regenerate to fix a red gate" is actually
// true -- arming the real-pack sweep above must not retire either proof, or tests/fixtures/vis-
// demo/f-chart.svg rots undetected exactly the way it did before this fix. The round-trip check's
// write to that file is a verified no-op regardless of arming: genSvg is deterministic and the
// fixture is never registered in the real packs/manifest.json, so regenerating it writes back the
// same bytes already committed no matter what the real-pack sweep found.
try {
  const positiveOk = fixturePositiveControl();
  fixtureNegativeControl(positiveOk);
  roundTripCheck();
} catch (e) {
  if (!harnessError) harnessError = e;
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
