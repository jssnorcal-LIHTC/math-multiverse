'use strict';
// dots-gen.js -- deterministic SVG generator for growing dot patterns.
//
//   genDots(dataTable, accentColor) -> svg string
//
// Same purity contract as build/figure-gen.js and build/polygon-gen.js: a pure function of its two
// arguments, no Date, no Math.random, no locale-dependent formatting, every coordinate rounded
// before it reaches the string. Same input, byte-identical output, so a derive gate can regenerate
// and byte-compare.
//
// WHY THIS EXISTS. CC1 problem 1-19 shows figures 1, 2 and 3 of a growing pattern, asks the child
// to draw figure 4, and then asks how many dots figure 100 has. The app's nearest thing,
// genCorrespondingTerm() at Math-Multiverse.html:11474, does something meaningfully different: it
// hands over BOTH rules already written and asks for a comparison between them. Building the rule
// from a picture is the skill CC1 is teaching, and it needs a picture.
//
// dataTable shape:
//   { rule: { a: 3, b: 1 },        dots in figure n = a*n + b
//     shown: [1, 2, 3],            which figures are drawn
//     layout: 'row' | 'L' | 'stack',
//     dotUnit: 'dot' }
//
// The COUNT is computed from the rule for every drawn figure, never listed separately, so a figure
// cannot show a number of dots that disagrees with the rule the item asks the child to find. That
// is the same defect class polygon-gen's labels had, and it is closed the same way.

const PAD = 26;
const GAP = 30;
const CELL = 15;
const R = 5;

function n2(x) {
  const v = Math.round(Number(x) * 100) / 100;
  return Object.is(v, -0) ? '0' : String(v);
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function refuse(r) { throw new Error('dots-gen: ' + r); }

const LAYOUTS = ['row', 'L', 'stack'];

function validate(dt) {
  if (!dt || typeof dt !== 'object') refuse('dataTable is not an object');
  if (!dt.rule || !Number.isInteger(dt.rule.a) || !Number.isInteger(dt.rule.b)) refuse('rule must be integer a and b');
  if (dt.rule.a <= 0) refuse('rule.a must be positive, or the pattern does not grow');
  if (dt.rule.b < 0) refuse('rule.b must not be negative, or an early figure has fewer than zero dots');
  if (!Array.isArray(dt.shown) || dt.shown.length < 3) refuse('at least three figures must be shown, or there is no pattern to see');
  if (!dt.shown.every((n) => Number.isInteger(n) && n > 0)) refuse('every shown figure number must be a positive integer');
  if (!LAYOUTS.includes(dt.layout)) refuse(`unknown layout ${JSON.stringify(dt.layout)} (legal: ${LAYOUTS.join(', ')})`);
}

// Dots for figure n, as [col, row] cells. The COUNT always equals a*n + b: each layout arranges
// that many dots and never more.
function cellsFor(n, rule, layout) {
  // An unknown layout used to fall through to the L branch and draw something plausible. A
  // generator that silently substitutes a shape nobody asked for is the quiet version of the
  // figure-disagrees-with-its-own-data defect this whole pack is gated against, so it refuses.
  // Caught by tests/figure-reconcile.js's own control rather than by review.
  if (!LAYOUTS.includes(layout)) refuse(`unknown layout ${JSON.stringify(layout)} (legal: ${LAYOUTS.join(', ')})`);
  const total = rule.a * n + rule.b;
  const out = [];
  if (layout === 'row') {
    // b dots in a fixed top row, then a per figure-step laid out beneath in columns of n.
    for (let i = 0; i < rule.b; i++) out.push([i, 0]);
    for (let i = 0; i < rule.a * n; i++) out.push([i % n, 1 + Math.floor(i / n)]);
  } else if (layout === 'stack') {
    // A rectangle a wide and n tall, plus b extra on top.
    for (let i = 0; i < rule.b; i++) out.push([i, 0]);
    for (let r = 0; r < n; r++) for (let c = 0; c < rule.a; c++) out.push([c, (rule.b ? 1 : 0) + r]);
  } else {
    // An L: one arm across, one arm down, sharing the corner.
    let placed = 0;
    const arm = Math.ceil((total - 1) / 2);
    out.push([0, 0]); placed++;
    for (let i = 1; i <= arm && placed < total; i++) { out.push([i, 0]); placed++; }
    for (let i = 1; placed < total; i++) { out.push([0, i]); placed++; }
  }
  if (out.length !== total) refuse(`layout ${layout} placed ${out.length} dots for figure ${n} but the rule says ${total}`);
  return out;
}

function genDots(dataTable, accentColor) {
  validate(dataTable);
  const dt = dataTable;
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(accentColor || '')) ? accentColor : '#7aa8ff';

  const groups = dt.shown.map((n) => ({ n, cells: cellsFor(n, dt.rule, dt.layout) }));
  const widths = groups.map((g) => (Math.max(...g.cells.map((c) => c[0])) + 1) * CELL);
  const heights = groups.map((g) => (Math.max(...g.cells.map((c) => c[1])) + 1) * CELL);
  const H = PAD * 2 + Math.max(...heights) + 24;
  const W = PAD * 2 + widths.reduce((a, b) => a + b, 0) + GAP * (groups.length - 1);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n2(W)} ${n2(H)}" width="${n2(W)}" height="${n2(H)}" role="img">`);
  out.push(`<rect width="${n2(W)}" height="${n2(H)}" fill="#11131a"/>`);

  let x = PAD;
  const baseline = PAD + Math.max(...heights);
  groups.forEach((g, gi) => {
    const gh = heights[gi];
    for (const [c, r] of g.cells) {
      const cx = x + c * CELL + CELL / 2;
      const cy = baseline - gh + r * CELL + CELL / 2;
      out.push(`<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${R}" fill="${accent}"/>`);
    }
    out.push(`<text x="${n2(x + widths[gi] / 2)}" y="${n2(baseline + 17)}" fill="#8b93a7" font-family="system-ui,sans-serif" font-size="12" text-anchor="middle">Figure ${g.n}</text>`);
    x += widths[gi] + GAP;
  });
  out.push('</svg>');
  return out.join('');
}

// The count the RULE gives for a figure. The one number an item's answer must equal.
function dotsAt(dataTable, n) {
  validate(dataTable);
  return dataTable.rule.a * n + dataTable.rule.b;
}

module.exports = { genDots, dotsAt, cellsFor, validate, LAYOUTS };
