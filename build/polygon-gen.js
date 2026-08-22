'use strict';
// polygon-gen.js -- deterministic SVG generator for labelled-polygon schematics.
//
//   genPolygon(dataTable, accentColor) -> svg string
//
// Same contract as build/figure-gen.js and for the same reason: genPolygon is a PURE function of
// its two arguments. No Date, no Math.random, no locale-dependent formatting, every coordinate
// rounded through n2() before it reaches the string. Same input, byte-identical output, forever,
// so a derive gate can regenerate and byte-compare.
//
// WHY THE SHAPE LIVES IN THE dataTable. A geometry figure carries its own numbers, and a figure
// whose labelled sides disagree with the item's answer is wrong in a way validate-pack cannot see:
// the JSON is well-formed, the answer is an integer, and nothing relates the two. Putting the side
// lengths in the dataTable makes the picture and the arithmetic answerable from one source, and
// tests/figure-reconcile.js then checks the item's own answer against it independently.
//
// dataTable shape:
//   { shape: 'rectangle' | 'parallelogram' | 'trapezoid' | 'triangle' | 'regular' | 'lshape',
//     units: 'cm',
//     sides: [ { label: '8', len: 8 }, ... ]          in drawing order
//     vertices: [[x, y], ...]                          unit-space polygon, y down
//     ticks: { '0': 1, '2': 1 }                        optional congruence ticks per side index
//     note: 'string'                                   optional
//   }
//
// The generator draws `vertices` and labels each edge from `sides`, in the same order. It never
// computes a side length from the geometry: the LABEL is the authority, because the label is what
// a child reads and what the answer must agree with. tests/figure-reconcile.js is what proves the
// drawn geometry and the labels are consistent with each other and with the item.

// Sized from what the figure strip and the item rail actually give a diagram, and PAD is set by
// the LABELS rather than by the polygon: a side label sits outside the edge, so the polygon has to
// stop well short of the box or the label lands on the boundary. Measured at PAD 34 the left label
// of an 8x5 rectangle touched x=0.
const W = 360;
const H = 250;
const PAD = 52;
const LABEL_GAP = 16;

function n2(x) {
  const v = Math.round(Number(x) * 100) / 100;
  return Object.is(v, -0) ? '0' : String(v);
}
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function refuse(reason) { throw new Error('polygon-gen: ' + reason); }

const SHAPES = ['rectangle', 'parallelogram', 'trapezoid', 'triangle', 'regular', 'lshape'];

function validate(dt) {
  if (!dt || typeof dt !== 'object') refuse('dataTable is not an object');
  if (!SHAPES.includes(dt.shape)) refuse(`unknown shape ${JSON.stringify(dt.shape)} (legal: ${SHAPES.join(', ')})`);
  if (!Array.isArray(dt.vertices) || dt.vertices.length < 3) refuse('vertices must hold at least 3 points');
  if (!Array.isArray(dt.sides) || dt.sides.length !== dt.vertices.length) {
    refuse(`sides (${dt.sides ? dt.sides.length : 0}) must have one entry per vertex (${dt.vertices.length}); an unlabelled edge is a figure a child cannot answer from`);
  }
  for (const v of dt.vertices) {
    if (!Array.isArray(v) || v.length !== 2 || !isFinite(v[0]) || !isFinite(v[1])) refuse('a vertex is not a finite [x, y]');
  }
  for (const s of dt.sides) {
    if (!s || typeof s !== 'object') refuse('a side is not an object');
    if (!isFinite(s.len) || s.len <= 0) refuse(`side length ${JSON.stringify(s.len)} is not a positive number`);
    if (typeof s.label !== 'string' || !s.label.length) refuse('a side has no label');
  }
  if (typeof dt.units !== 'string' || !dt.units) refuse('units missing');
}

// Fit the unit-space polygon into the drawing box, preserving aspect.
function project(vertices) {
  const xs = vertices.map((v) => v[0]);
  const ys = vertices.map((v) => v[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = Math.max(1e-6, x1 - x0), h = Math.max(1e-6, y1 - y0);
  const k = Math.min((W - 2 * PAD) / w, (H - 2 * PAD) / h);
  const offX = (W - k * w) / 2 - k * x0;
  const offY = (H - k * h) / 2 - k * y0;
  return vertices.map(([x, y]) => [k * x + offX, k * y + offY]);
}

// Ray-casting point-in-polygon. Needed because "outward" cannot be decided from the centroid on a
// CONCAVE shape: at the L-shape's notch the centroid lies on the outside of that edge, so the
// centroid test pushed the label into the fill. Measured on fig-l1-lshape-1, where the 6 cm label
// landed on top of the shape.
function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) hit = !hit;
  }
  return hit;
}

// Where an edge's label goes: square off the edge, on whichever side is genuinely outside the
// polygon. The edge's own perpendicular rather than the direction from the centroid, because on a
// tall narrow shape the centroid direction slides the label along the edge and onto the fill.
function labelPos(pts, a, b, gap) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  let ex = b[0] - a[0], ey = b[1] - a[1];
  const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
  let nx = -ey, ny = ex;
  if (inside(pts, mx + nx * gap * 0.6, my + ny * gap * 0.6)) { nx = -nx; ny = -ny; }
  return [mx + nx * gap, my + ny * gap];
}

function genPolygon(dataTable, accentColor) {
  validate(dataTable);
  const dt = dataTable;
  const pts = project(dt.vertices);
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(accentColor || '')) ? accentColor : '#7aa8ff';

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`);
  out.push(`<rect width="${W}" height="${H}" fill="#11131a"/>`);
  const poly = pts.map((p) => `${n2(p[0])},${n2(p[1])}`).join(' ');
  out.push(`<polygon points="${poly}" fill="${accent}" fill-opacity="0.16" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round"/>`);

  // Right-angle marks, where the shape declares them.
  if (Array.isArray(dt.rightAngles)) {
    for (const i of dt.rightAngles) {
      const p = pts[i], prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
      const u = [(prev[0] - p[0]), (prev[1] - p[1])];
      const v = [(next[0] - p[0]), (next[1] - p[1])];
      const nu = Math.hypot(u[0], u[1]) || 1, nv = Math.hypot(v[0], v[1]) || 1;
      const s = 11;
      const a = [p[0] + u[0] / nu * s, p[1] + u[1] / nu * s];
      const c = [p[0] + v[0] / nv * s, p[1] + v[1] / nv * s];
      const b = [a[0] + v[0] / nv * s, a[1] + v[1] / nv * s];
      out.push(`<polyline points="${n2(a[0])},${n2(a[1])} ${n2(b[0])},${n2(b[1])} ${n2(c[0])},${n2(c[1])}" fill="none" stroke="#e8ecf5" stroke-width="1.6" opacity="0.85"/>`);
    }
  }

  // Congruence ticks: one, two or three short strokes across an edge's midpoint.
  const ticks = dt.ticks || {};
  for (const key of Object.keys(ticks).sort()) {
    const i = Number(key);
    const n = Number(ticks[key]);
    if (!Number.isInteger(i) || i < 0 || i >= pts.length || !Number.isInteger(n) || n < 1 || n > 3) {
      refuse(`ticks["${key}"] = ${JSON.stringify(ticks[key])} is not 1 to 3 marks on a real side index`);
    }
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let ex = b[0] - a[0], ey = b[1] - a[1];
    const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const px = -ey, py = ex;                              // edge normal
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 5;
      const bx = mx + ex * off, by = my + ey * off;
      out.push(`<line x1="${n2(bx - px * 6)}" y1="${n2(by - py * 6)}" x2="${n2(bx + px * 6)}" y2="${n2(by + py * 6)}" stroke="#e8ecf5" stroke-width="1.8" opacity="0.85"/>`);
    }
  }

  // One label per edge, in `sides` order, which is `vertices` order.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const [lx, ly] = labelPos(pts, a, b, LABEL_GAP);
    const t = esc(dt.sides[i].label);
    // Painted twice: a dark stroke behind, then the fill. A label that has to sit close to the
    // shape stays readable instead of dissolving into it.
    out.push(`<text x="${n2(lx)}" y="${n2(ly)}" fill="none" stroke="#11131a" stroke-width="4" stroke-linejoin="round" font-family="system-ui,sans-serif" font-size="13" font-weight="600" text-anchor="middle" dominant-baseline="middle">${t}</text>`);
    out.push(`<text x="${n2(lx)}" y="${n2(ly)}" fill="#e8ecf5" font-family="system-ui,sans-serif" font-size="13" font-weight="600" text-anchor="middle" dominant-baseline="middle">${t}</text>`);
  }

  out.push(`<text x="${n2(W - 8)}" y="${n2(H - 8)}" fill="#8b93a7" font-family="system-ui,sans-serif" font-size="11" text-anchor="end">all lengths in ${esc(dt.units)}</text>`);
  if (typeof dt.note === 'string' && dt.note) {
    out.push(`<text x="8" y="${n2(H - 8)}" fill="#8b93a7" font-family="system-ui,sans-serif" font-size="11">${esc(dt.note)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

// The perimeter the LABELS declare. The one number an item's answer must equal.
function labelledPerimeter(dataTable) {
  validate(dataTable);
  return dataTable.sides.reduce((a, s) => a + s.len, 0);
}

// The perimeter the DRAWING actually has, in unit space, so a label can be checked against the
// geometry rather than only against itself.
function drawnPerimeter(dataTable) {
  validate(dataTable);
  const v = dataTable.vertices;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

module.exports = { genPolygon, labelledPerimeter, drawnPerimeter, validate, SHAPES, W, H };
