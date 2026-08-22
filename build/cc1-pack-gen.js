'use strict';
// cc1-pack-gen.js -- build packs/cpm-cc1-g6.json and its art, level by level.
//
//   node build/cc1-pack-gen.js            (writes the pack and every SVG it needs)
//   node build/cc1-pack-gen.js --check    (exit 1 if either is stale)
//
// The gap fill for CPM Core Connections Course 1, as a PACK rather than as new generators. Plan
// section 4 and constraint 2: the six math IIFEs are never edited, and every missing concept needs
// a picture, so a pack is the right form. What the decision buys is itemised in the plan; what it
// costs is that a pack is a fixed bank, so replay comes from bank size.
//
// ONE SOURCE FOR THE PICTURE AND THE ANSWER. A geometry item's figure carries its own numbers, and
// a figure whose labelled sides disagree with the item's own answer is invisible to
// validate-pack: the JSON is well formed and the answer is an integer, and nothing relates the
// two. Every item below is generated FROM the same spec that generates its figure, so they cannot
// be authored apart. tests/figure-reconcile.js then re-derives the answer from the committed
// dataTable independently, which is what makes that a check rather than a restatement.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PACK_PATH = path.join(ROOT, 'packs', 'cpm-cc1-g6.json');
const ART_DIR = path.join(ROOT, 'art', 'cpm-cc1-g6');
const { genPolygon, labelledPerimeter } = require('./polygon-gen');
const { genDots, dotsAt } = require('./dots-gen');
const { genSvg } = require('./figure-gen');

const ACCENT = '#e0692b';

// ---------------------------------------------------------------------------
// VERTICES ARE COMPUTED FROM THE SIDE LENGTHS, never typed.
//
// tests/figure-reconcile.js caught six figures whose drawing disagreed with its own labels, and the
// worst of them drew a triangle's "7 cm" side as its LONGEST edge while labelling it shortest.
// Every one came from hand-typed coordinates. Blind certification could not catch it either: the
// blind reader is given the labels and the alt text, not the geometry, so the arithmetic came out
// right on a picture a child would have seen was wrong.
//
// The constructors below make that class of defect unreachable: a shape is described by the side
// lengths that will be printed on it, and the coordinates are solved from those. The gate stays as
// the independent check, because a bug in a constructor here would otherwise reproduce silently.
// ---------------------------------------------------------------------------

// Screen space is y-down, so every constructor builds y-up and flips at the end.
function flipY(v) {
  const maxY = Math.max(...v.map((p) => p[1]));
  return v.map(([x, y]) => [+x.toFixed(4), +(maxY - y).toFixed(4)]);
}

// Sides in traversal order: a = V0->V1, b = V1->V2, c = V2->V0. Trilateration.
function triangleVertices(a, b, c) {
  if (a + b <= c || b + c <= a || c + a <= b) throw new Error(`triangleVertices: ${a}, ${b}, ${c} break the triangle inequality`);
  const x = (a * a + c * c - b * b) / (2 * a);
  const y2 = c * c - x * x;
  if (y2 <= 0) throw new Error(`triangleVertices: ${a}, ${b}, ${c} give a degenerate triangle`);
  return flipY([[0, 0], [a, 0], [x, Math.sqrt(y2)]]);
}

// bottom = V0->V1, right leg = V1->V2, top = V2->V3, left leg = V3->V0.
function trapezoidVertices(bottom, rightLeg, top, leftLeg) {
  if (bottom === top) throw new Error('trapezoidVertices: bottom and top are equal, which is a parallelogram');
  const x2 = (leftLeg * leftLeg - rightLeg * rightLeg - top * top + bottom * bottom) / (2 * (bottom - top));
  const h2 = rightLeg * rightLeg - (x2 - bottom) * (x2 - bottom);
  if (h2 <= 0) throw new Error(`trapezoidVertices: ${bottom}, ${rightLeg}, ${top}, ${leftLeg} do not close into a trapezoid`);
  const h = Math.sqrt(h2);
  return flipY([[0, 0], [bottom, 0], [x2, h], [x2 - top, h]]);
}

// base = V0->V1 and V2->V3, side = V1->V2 and V3->V0. The lean angle is a drawing choice; the two
// side LENGTHS are exact whatever it is, which is what the labels have to match.
function parallelogramVertices(base, side, leanDeg) {
  const t = (leanDeg == null ? 62 : leanDeg) * Math.PI / 180;
  const dx = side * Math.cos(t), h = side * Math.sin(t);
  return flipY([[0, 0], [base, 0], [base + dx, h], [dx, h]]);
}

// An axis-aligned L, given the outer width and height and the notch cut out of the top right.
// Returns the sides ALONGSIDE the vertices, because typing the side list separately is how the
// first two L-shapes ended up labelled in the wrong traversal order: the constructor's own edges
// run w, h - notchH, notchW, notchH, w - notchW, h, which is not the order a person guesses.
function lShape(w, h, notchW, notchH) {
  if (notchW >= w || notchH >= h) throw new Error('lShape: the notch is not smaller than the figure');
  const vertices = flipY([[0, 0], [w, 0], [w, h - notchH], [w - notchW, h - notchH], [w - notchW, h], [0, h]]);
  const sides = [w, h - notchH, notchW, notchH, w - notchW, h];
  return { vertices, sides };
}

// Regular polygon vertices, computed. The first hand-typed pentagon rendered visibly lopsided and
// was a regular polygon in name only, which is exactly the figure-disagrees-with-its-label defect
// the reconcile gate exists for, arriving through the drawing rather than through the arithmetic.
function regularVertices(n, side) {
  const R = side / (2 * Math.sin(Math.PI / n));
  const out = [];
  for (let i = 0; i < n; i++) {
    // Start at the bottom and go clockwise in screen space (y down), so a flat edge sits at the
    // bottom of every even-sided figure and the shape reads as it would on paper.
    const a = Math.PI / 2 + Math.PI / n + (2 * Math.PI * i) / n;
    out.push([+(R * Math.cos(a)).toFixed(4), +(R * Math.sin(a)).toFixed(4)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LEVEL 1: perimeter of labelled polygons.
//
// CC1 lesson 6.2.3 (Algebra Tiles and Perimeter) and problem 1-21 of lesson 1.1.3. Ranked 1 on the
// crosswalk's build list, and the reason is not only that it is absent: perimeter is currently
// present in the app as the WRONG ANSWER inside area items, with the explain text naming it to
// rule it out. Tonight's homework asks for it as the right one.
//
// Each spec generates: one figure (SVG + dataTable), one perimeter item, and for most shapes one
// second item that attacks a specific misconception. `mistakes` names what each distractor is.
// ---------------------------------------------------------------------------
const L1 = [
  {
    id: 'rect-8-5', shape: 'rectangle', units: 'cm',
    vertices: [[0, 0], [8, 0], [8, 5], [0, 5]],
    sides: [8, 5, 8, 5],
    rightAngles: [0, 1, 2, 3],
    name: 'a rectangle',
    alt: 'A rectangle with the top and bottom sides labelled 8 cm and the left and right sides labelled 5 cm.  All four corners carry a right-angle mark.',
  },
  {
    id: 'rect-12-3', shape: 'rectangle', units: 'cm',
    vertices: [[0, 0], [12, 0], [12, 3], [0, 3]],
    sides: [12, 3, 12, 3],
    rightAngles: [0, 1, 2, 3],
    name: 'a long thin rectangle',
    alt: 'A wide rectangle with the top and bottom sides labelled 12 cm and the left and right sides labelled 3 cm.  All four corners carry a right-angle mark.',
  },
  {
    id: 'square-7', shape: 'rectangle', units: 'cm',
    vertices: [[0, 0], [7, 0], [7, 7], [0, 7]],
    sides: [7, 7, 7, 7],
    rightAngles: [0, 1, 2, 3],
    ticks: { 0: 1, 1: 1, 2: 1, 3: 1 },
    name: 'a square',
    alt: 'A square with all four sides labelled 7 cm.  Each side carries a single congruence tick and each corner carries a right-angle mark.',
  },
  {
    id: 'par-9-6', shape: 'parallelogram', units: 'cm',
    vertices: parallelogramVertices(9, 6),
    sides: [9, 6, 9, 6],
    ticks: { 0: 1, 2: 1, 1: 2, 3: 2 },
    name: 'a parallelogram',
    alt: 'A parallelogram.  The two long sides are labelled 9 cm and each carries one tick.  The two slanted sides are labelled 6 cm and each carries two ticks.',
    note: 'not a rectangle',
  },
  {
    id: 'trap-10-4-6-5', shape: 'trapezoid', units: 'cm',
    vertices: trapezoidVertices(10, 6, 5, 4),
    sides: [10, 6, 5, 4],
    name: 'a trapezoid',
    alt: 'A trapezoid.  The long bottom side is labelled 10 cm, the right slanted side 6 cm, the short top side 5 cm, and the left slanted side 4 cm.',
  },
  {
    id: 'tri-scalene-7-9-12', shape: 'triangle', units: 'cm',
    vertices: triangleVertices(12, 9, 7),
    sides: [12, 9, 7],
    name: 'a scalene triangle',
    alt: 'A triangle with three different side lengths, labelled 12 cm along the bottom, 9 cm on the right, and 7 cm on the left.',
  },
  {
    id: 'tri-right-6-8-10', shape: 'triangle', units: 'cm',
    vertices: triangleVertices(6, 10, 8),
    sides: [6, 10, 8],
    rightAngles: [0],
    name: 'a right triangle',
    alt: 'A right triangle.  The bottom side is labelled 6 cm, the slanted side 10 cm, and the upright side 8 cm.  The bottom-left corner carries a right-angle mark.',
  },
  {
    id: 'tri-isosceles-9-9-4', shape: 'triangle', units: 'cm',
    vertices: triangleVertices(4, 9, 9),
    sides: [4, 9, 9],
    ticks: { 1: 1, 2: 1 },
    name: 'an isosceles triangle',
    alt: 'An isosceles triangle.  The short bottom side is labelled 4 cm.  The two long slanted sides are each labelled 9 cm and each carries one tick.',
  },
  {
    id: 'pent-regular-6', shape: 'regular', units: 'cm',
    vertices: regularVertices(5, 6),
    sides: [6, 6, 6, 6, 6],
    ticks: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 },
    name: 'a regular pentagon',
    alt: 'A regular pentagon.  All five sides are labelled 6 cm and each carries a single congruence tick.',
  },
  {
    id: 'hex-regular-4', shape: 'regular', units: 'cm',
    vertices: regularVertices(6, 4),
    sides: [4, 4, 4, 4, 4, 4],
    ticks: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 },
    name: 'a regular hexagon',
    alt: 'A regular hexagon.  All six sides are labelled 4 cm and each carries a single congruence tick.',
  },
  {
    id: 'trap-right-12-5-7-4', shape: 'trapezoid', units: 'cm',
    vertices: trapezoidVertices(12, 5, 7, 4),
    sides: [12, 5, 7, 4],
    name: 'a right trapezoid',
    alt: 'A trapezoid with two right angles on the right-hand side.  The long bottom side is labelled 12 cm, the upright right side 5 cm, the top side 7 cm, and the slanted left side 4 cm.',
  },
  {
    id: 'par-wide-14-5', shape: 'parallelogram', units: 'cm',
    vertices: parallelogramVertices(14, 5, 55),
    sides: [14, 5, 14, 5],
    ticks: { 0: 1, 2: 1, 1: 2, 3: 2 },
    name: 'a wide parallelogram',
    alt: 'A wide parallelogram.  The two long sides are labelled 14 cm and each carries one tick.  The two short slanted sides are labelled 5 cm and each carries two ticks.',
    note: 'not a rectangle',
  },
  {
    id: 'oct-regular-3', shape: 'regular', units: 'cm',
    vertices: regularVertices(8, 3),
    sides: [3, 3, 3, 3, 3, 3, 3, 3],
    ticks: { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
    name: 'a regular octagon',
    alt: 'A regular octagon.  All eight sides are labelled 3 cm and each carries a single congruence tick.',
  },
  {
    id: 'lshape-2', shape: 'lshape', units: 'cm',
    ...lShape(7, 8, 4, 5),
    rightAngles: [0, 1, 2, 3, 4, 5],
    name: 'a second L-shaped figure',
    alt: 'A second L-shaped figure with six sides, labelled in order around the outside: 7 cm, 3 cm, 4 cm, 5 cm, 3 cm and 8 cm.  Every corner carries a right-angle mark.',
  },
  {
    id: 'lshape-1', shape: 'lshape', units: 'cm',
    ...lShape(10, 9, 6, 5),
    rightAngles: [0, 1, 2, 3, 4, 5],
    name: 'an L-shaped figure',
    alt: 'An L-shaped figure with six sides, labelled in order around the outside: 10 cm, 4 cm, 6 cm, 5 cm, 4 cm and 9 cm.  Every corner carries a right-angle mark.',
  },
];

// ---------------------------------------------------------------------------
// LEVEL 2: naming shapes.
//
// CC1 problem 1-22, and rank 2 on the crosswalk's build list. The app has ZERO content for this
// today: a full-text scan of the six math modules finds no occurrence of scalene, isosceles,
// rhombus, trapezoid or obtuse, in either grade. The two shell topics that LOOKED like coverage,
// coord-shape and coord-real-world, carried a label and a coach tip and were emitted by nothing;
// WP1 deleted both.
//
// Three strands, because 5.G.B.3 and 5.G.B.4 are about a HIERARCHY rather than a list of names:
//   by side     scalene, isosceles, equilateral
//   by angle    acute, right, obtuse
//   quadrilateral  the hierarchy itself, where every square is a rectangle and every rectangle a
//                  parallelogram, and the reverse is false
//
// The figures reuse build/polygon-gen.js, which means every shape here is also drawn from the side
// lengths that name it. A triangle called isosceles has two genuinely equal drawn edges, and
// tests/figure-reconcile.js proves it: a shape whose name disagrees with its drawing is the same
// defect class as a label that disagrees with its edge.
// ---------------------------------------------------------------------------
// BOTH classifications are COMPUTED from the side lengths, never typed.
//
// Blind certification caught a 12-9-7 triangle labelled acute.  It is not: the angle opposite the
// 12 is 96.4 degrees, so it is obtuse, and the item would have marked the right answer wrong.  A
// second spec was worse in a quieter way, 7-7-9.9 labelled right, which is obtuse by a hundredth
// and visually indistinguishable from a right angle;  a genuine isosceles right triangle needs an
// irrational hypotenuse and cannot carry a clean label at all, so it is not in this set.
//
// Typing a shape's NAME beside its measurements is the same defect as typing its coordinates, and
// it has now produced an error in both places.  Both are derived here instead.
function classifyByAngle(sides) {
  const [a, b, c] = sides.slice().sort((x, y) => x - y);
  const lhs = c * c, rhs = a * a + b * b;
  if (Math.abs(lhs - rhs) < 1e-9) return 'right';
  return lhs > rhs ? 'obtuse' : 'acute';
}
function classifyBySide(sides) {
  const u = new Set(sides).size;
  return u === 1 ? 'equilateral' : u === 2 ? 'isosceles' : 'scalene';
}

const L2_TRI = [
  { id: 'tri-name-scalene', sides: [7, 8, 9],
    alt: 'A triangle with three different side lengths, 7 cm, 8 cm and 9 cm.  No sides carry congruence ticks, and no corner carries a right-angle mark.' },
  { id: 'tri-name-isosceles', sides: [4, 9, 9], ticks: { 1: 1, 2: 1 },
    alt: 'A tall triangle with two equal sides of 9 cm, each carrying a single tick, and a short 4 cm side across the bottom.' },
  { id: 'tri-name-equilateral', sides: [8, 8, 8], ticks: { 0: 1, 1: 1, 2: 1 },
    alt: 'A triangle with all three sides equal at 8 cm, each carrying a single tick.' },
  { id: 'tri-name-right', sides: [6, 10, 8], rightAngles: [0],
    alt: 'A triangle with sides 6 cm, 10 cm and 8 cm.  The corner between the 6 cm and 8 cm sides carries a right-angle mark.' },
  { id: 'tri-name-obtuse', sides: [13, 6, 8],
    alt: 'A wide, flat triangle with sides 13 cm, 6 cm and 8 cm.  Its widest corner opens well past a square corner.' },
  { id: 'tri-name-isos-obtuse', sides: [5, 5, 9], ticks: { 0: 1, 1: 1 },
    alt: 'A wide, flat triangle with two equal sides of 5 cm, each carrying a tick, and a long 9 cm side.  The corner between the two equal sides opens well past square.' },
].map((t) => Object.assign({}, t, { byside: classifyBySide(t.sides), byangle: classifyByAngle(t.sides) }));

// The set has to teach that the two classifications are INDEPENDENT, which it only does if it
// actually contains a shape that is isosceles and obtuse, and one that is scalene and right.
{
  const pairs = new Set(L2_TRI.map((t) => t.byside + '/' + t.byangle));
  for (const need of ['scalene/acute', 'isosceles/acute', 'equilateral/acute', 'scalene/right', 'scalene/obtuse', 'isosceles/obtuse']) {
    if (!pairs.has(need)) throw new Error(`cc1-pack-gen: L2 triangles do not cover ${need}; got ${[...pairs].join(', ')}`);
  }
  // A right-angle mark may only appear on a triangle that genuinely has one.
  for (const t of L2_TRI) {
    if (t.rightAngles && t.byangle !== 'right') throw new Error(`cc1-pack-gen: ${t.id} draws a right-angle mark but computes as ${t.byangle}`);
    if (!t.rightAngles && t.byangle === 'right') throw new Error(`cc1-pack-gen: ${t.id} is a right triangle but draws no right-angle mark`);
  }
}

const SIDE_NAMES = {
  scalene: 'No two sides are the same length, which is what scalene means.',
  isosceles: 'Exactly two sides are the same length, which is what isosceles means, and the ticks are how the figure says so.',
  equilateral: 'All three sides are the same length, which is what equilateral means.',
};
const ANGLE_NAMES = {
  acute: 'Every corner is smaller than a square corner, which makes it acute.',
  right: 'One corner is exactly a square corner, marked with the small square, which makes it a right triangle.',
  obtuse: 'One corner opens wider than a square corner, which makes it obtuse.',
};

// The quadrilateral hierarchy, as figures and as the relationships between them. Sides and ticks
// are what make each name true, so the drawing carries the evidence rather than the caption.
const L2_QUAD = [
  { id: 'quad-square', shape: 'rectangle', vertices: [[0, 0], [6, 0], [6, 6], [0, 6]], sides: [6, 6, 6, 6],
    ticks: { 0: 1, 1: 1, 2: 1, 3: 1 }, rightAngles: [0, 1, 2, 3], name: 'square',
    alt: 'A quadrilateral with four equal sides of 6 cm, each carrying a tick, and a right-angle mark in every corner.' },
  { id: 'quad-rectangle', shape: 'rectangle', vertices: [[0, 0], [9, 0], [9, 5], [0, 5]], sides: [9, 5, 9, 5],
    rightAngles: [0, 1, 2, 3], name: 'rectangle',
    alt: 'A quadrilateral with opposite sides equal, 9 cm and 5 cm, and a right-angle mark in every corner.' },
  { id: 'quad-rhombus', shape: 'parallelogram', sides: [7, 7, 7, 7], ticks: { 0: 1, 1: 1, 2: 1, 3: 1 },
    name: 'rhombus', lean: 58,
    alt: 'A leaning quadrilateral with four equal sides of 7 cm, each carrying a tick, and no right-angle marks.' },
  { id: 'quad-parallelogram', shape: 'parallelogram', sides: [10, 6, 10, 6], ticks: { 0: 1, 2: 1, 1: 2, 3: 2 },
    name: 'parallelogram', lean: 62,
    alt: 'A leaning quadrilateral with opposite sides equal, 10 cm and 6 cm, marked with one tick and two ticks, and no right-angle marks.' },
  { id: 'quad-trapezoid', shape: 'trapezoid', sides: [11, 6, 5, 5], name: 'trapezoid',
    alt: 'A quadrilateral with one pair of parallel sides, 11 cm along the bottom and 5 cm along the top, and two slanted sides of 6 cm and 5 cm.' },
];

const QUAD_WHY = {
  square: 'Four equal sides AND four right angles.  A square is the one name that needs both.',
  rectangle: 'Four right angles, with opposite sides equal but not all four the same.',
  rhombus: 'Four equal sides, but the corners are not square, so it is a rhombus rather than a square.',
  parallelogram: 'Two pairs of equal opposite sides, no right angles, and no set of four equal sides.',
  trapezoid: 'Exactly one pair of parallel sides.  The other two sides go their own way.',
};

function specToDataTable(s) {
  return {
    shape: s.shape,
    units: s.units,
    vertices: s.vertices,
    sides: s.sides.map((n) => ({ label: String(n) + ' ' + s.units, len: n })),
    ticks: s.ticks || undefined,
    rightAngles: s.rightAngles || undefined,
    note: s.note || undefined,
  };
}

// Distractors are named mistakes, never noise. Each is a real thing a child does with a perimeter.
function perimeterDistractors(spec, P) {
  const s = spec.sides;
  const uniq = [...new Set(s)];
  const out = [];
  if (spec.shape === 'rectangle') {
    out.push({ v: uniq[0] * (uniq[1] || uniq[0]), why: 'This multiplies the two side lengths, which gives the AREA, not the distance round the outside.  Area fills the shape;  perimeter walks its edge.' });
    out.push({ v: uniq.reduce((a, b) => a + b, 0), why: 'This adds one long side and one short side and stops.  That is only half the way round: a rectangle has two of each.' });
  } else if (spec.shape === 'triangle') {
    out.push({ v: s[0] + s[1], why: 'This adds only two of the three sides.  Every side of the figure is part of the walk round it.' });
    out.push({ v: Math.round(s[0] * s[1] / 2), why: 'This is base times height over two, which is the AREA formula for a triangle.  The question asks how far it is round the outside.' });
  } else if (spec.shape === 'regular') {
    out.push({ v: s[0] * (s.length - 1), why: `This multiplies the side length by ${s.length - 1} instead of ${s.length}.  Count the sides on the figure before multiplying.` });
    out.push({ v: s[0] + s.length, why: 'This adds the side length to the number of sides.  A regular polygon\'s perimeter is the side length multiplied by how many sides there are.' });
  } else {
    out.push({ v: s.slice(0, Math.max(2, s.length - 1)).reduce((a, b) => a + b, 0), why: 'This misses one of the labelled sides.  Every labelled edge counts once, all the way round.' });
    out.push({ v: Math.max(...s) * s.length, why: 'This multiplies the longest side by the number of sides, which only works when every side is the same length.  These are not.' });
  }
  out.push({ v: P + Math.max(...s), why: 'This counts one of the sides twice.  Start at a corner, go all the way round, and stop where you started.' });
  return out;
}

function shuffleTo(correct, wrongs, seedIdx) {
  // Deterministic placement so a regenerate is byte-identical: the key rotates with the item index
  // rather than being random, which also stops the answer sitting in the same slot every time.
  const opts = [];
  const pool = wrongs.slice(0, 3);
  const keyAt = seedIdx % 4;
  let w = 0;
  for (let i = 0; i < 4; i++) opts.push(i === keyAt ? correct : pool[w++]);
  return { opts, keyAt };
}

function buildLevel1() {
  const items = [];
  const figures = [];
  L1.forEach((spec, idx) => {
    const dt = specToDataTable(spec);
    const P = labelledPerimeter(dt);
    const figId = `fig-l1-${spec.id}`;
    figures.push({
      id: figId,
      kind: 'diagram',
      genKind: 'polygon',
      caption: `Perimeter practice: ${spec.name}, every side labelled.`,
      credit: 'Built for this pack in the V1 design tokens (original work).',
      alt: spec.alt,
      src: `art/cpm-cc1-g6/${figId}.svg`,
      dataTable: dt,
    });

    // --- the perimeter item ---
    const wrongs = perimeterDistractors(spec, P).filter((d) => d.v !== P);
    const seen = new Set([P]);
    const clean = [];
    for (const d of wrongs) { if (!seen.has(d.v)) { seen.add(d.v); clean.push(d); } }
    if (clean.length < 3) throw new Error(`cc1-pack-gen: ${spec.id} produced only ${clean.length} distinct distractors`);
    const { opts, keyAt } = shuffleTo({ v: P }, clean, idx);
    const dr = {};
    opts.forEach((o, i) => { if (i !== keyAt) dr[String(i)] = o.why; });
    items.push({
      id: `l1-perim-${spec.id}`,
      type: 'mc',
      figureId: figId,
      passageId: 'p-how-to-read-a-figure',
      targets: ['math-r4-perimeter'],
      coachTopic: 'perimeter-labelled-polygon',
      dok: 2,
      stem: `Find the perimeter of ${spec.name} in the figure.  Every side is labelled.`,
      choices: opts.map((o) => `${o.v} ${spec.units}`),
      key: keyAt,
      distractorRationale: dr,
      explain: `Perimeter is the distance all the way round the outside, so add every labelled side once: `
        + `${spec.sides.join(' + ')} = ${P} ${spec.units}.  `
        + `The wrong options each come from a real habit: multiplying sides gives area rather than perimeter, `
        + `stopping early misses an edge, and counting an edge twice walks past the corner you started from.`,
    });

    // --- a second item on the shapes where a specific misconception is worth its own question ---
    if (spec.shape === 'regular') {
      const n = spec.sides.length;
      const side = spec.sides[0];
      const wrongs2 = [
        { v: `${side} + ${n}`, why: `This adds the side length to the number of sides.  Adding them mixes a length with a count;  the sides have to be added ${n} times, which is the same as multiplying.` },
        { v: `${side} x ${n - 1}`, why: `This uses ${n - 1} sides.  Count the edges on the figure: there are ${n}.` },
        { v: `${side} + ${side}`, why: 'This adds only two of the sides.  A regular polygon has more than two, and every one of them counts.' },
      ];
      const correct2 = { v: `${side} x ${n}` };
      const { opts: o2, keyAt: k2 } = shuffleTo(correct2, wrongs2, idx + 1);
      const dr2 = {};
      o2.forEach((o, i) => { if (i !== k2) dr2[String(i)] = o.why; });
      items.push({
        id: `l1-perim-rule-${spec.id}`,
        type: 'mc',
        figureId: figId,
      passageId: 'p-how-to-read-a-figure',
        targets: ['math-r4-perimeter'],
        coachTopic: 'perimeter-regular-polygon',
        dok: 2,
        stem: `${spec.name.charAt(0).toUpperCase() + spec.name.slice(1)} has every side the same length.  Which calculation gives its perimeter fastest?`,
        choices: o2.map((o) => o.v),
        key: k2,
        distractorRationale: dr2,
        explain: `Every side is ${side} ${spec.units} and there are ${n} of them, so the perimeter is ${side} x ${n} = ${side * n} ${spec.units}.  `
          + `Adding ${side} to itself ${n} times gives the same number;  multiplying is the shortcut, and it only works because every side matches.`,
      });
    }

    if (spec.shape === 'rectangle' && spec.sides[0] !== spec.sides[1]) {
      const [a, b] = [spec.sides[0], spec.sides[1]];
      const wrongs3 = [
        { v: `${a} x ${b}`, why: `This is the AREA of the rectangle, the space inside it, not the distance round its edge.` },
        { v: `${a} + ${b}`, why: 'This walks along one long side and one short side and stops.  That is half the way round.' },
        { v: `2 x ${a}`, why: 'This counts the two long sides and forgets the two short ones.' },
      ];
      const correct3 = { v: `2 x (${a} + ${b})` };
      const { opts: o3, keyAt: k3 } = shuffleTo(correct3, wrongs3, idx + 2);
      const dr3 = {};
      o3.forEach((o, i) => { if (i !== k3) dr3[String(i)] = o.why; });
      items.push({
        id: `l1-perim-rule-${spec.id}`,
        type: 'mc',
        figureId: figId,
      passageId: 'p-how-to-read-a-figure',
        targets: ['math-r4-perimeter'],
        coachTopic: 'perimeter-rectangle-rule',
        dok: 2,
        stem: `This rectangle is ${a} ${spec.units} by ${b} ${spec.units}.  Which calculation gives its perimeter?`,
        choices: o3.map((o) => o.v),
        key: k3,
        distractorRationale: dr3,
        explain: `A rectangle has two sides of ${a} ${spec.units} and two of ${b} ${spec.units}, so the perimeter is `
          + `2 x (${a} + ${b}) = ${2 * (a + b)} ${spec.units}.  ${a} x ${b} is the area, which measures the space inside rather than the walk round the edge.`,
      });
    }
  });

  // Two MISSING-SIDE items. Perimeter given, one side blank: the same relationship run backwards,
  // which is where a child finds out whether they understood it or only added. Built from specs
  // already in the level, so the figure they read is one they have already seen labelled.
  for (const [specId, hideIdx, seed] of [['rect-8-5', 1, 3], ['lshape-1', 2, 2]]) {
    const spec = L1.find((x) => x.id === specId);
    const P = spec.sides.reduce((a, b) => a + b, 0);
    const missing = spec.sides[hideIdx];
    const known = spec.sides.filter((_, i) => i !== hideIdx);
    const wrongs = [
      { v: P - missing, why: 'This is the total of the sides you were GIVEN.  The question asks for the one that is missing, which is what is left over after those are taken off the perimeter.' },
      { v: P + missing, why: 'This adds the missing side to the perimeter instead of taking the known sides away from it.  The perimeter already includes every side.' },
      { v: Math.round(P / spec.sides.length), why: `This divides the perimeter by ${spec.sides.length}, which only gives a side length when every side is the same.  These are not all the same.` },
    ];
    // A fourth named mistake, because one of the three above can collide with the answer: on the
    // L-shape the perimeter divided by the side count lands exactly on the missing side. Filtering
    // it out then left only two distractors and shuffleTo silently produced an undefined option,
    // which is the kind of hole an assertion has to close rather than a comment.
    wrongs.push({ v: Math.max(...spec.sides), why: 'This is the longest side on the figure, not the missing one.  The missing side is whatever is left of the perimeter once every labelled side is taken off.' });
    const clean = [];
    const seen = new Set([missing]);
    for (const d of wrongs) { if (!seen.has(d.v)) { seen.add(d.v); clean.push(d); } }
    if (clean.length < 3) throw new Error(`cc1-pack-gen: missing-side item for ${specId} produced only ${clean.length} distinct distractors`);
    const { opts, keyAt } = shuffleTo({ v: missing }, clean, seed);
    const dr = {};
    opts.forEach((o, i) => { if (i !== keyAt) dr[String(i)] = o.why; });
    items.push({
      id: `l1-missing-${specId}`,
      type: 'mc',
      figureId: `fig-l1-${specId}`,
      passageId: 'p-how-to-read-a-figure',
      targets: ['math-r4-perimeter'],
      coachTopic: 'perimeter-missing-side',
      dok: 3,
      stem: `The perimeter of ${spec.name} is ${P} ${spec.units}.  Every side is labelled except one.  `
        + `If the other sides are ${known.join(', ')} ${spec.units}, how long is the missing side?`,
      choices: opts.map((o) => `${o.v} ${spec.units}`),
      key: keyAt,
      distractorRationale: dr,
      explain: `The perimeter counts every side once, so the known sides plus the missing one make ${P} ${spec.units}.  `
        + `Add the known sides: ${known.join(' + ')} = ${P - missing}.  `
        + `Take that off the perimeter: ${P} - ${P - missing} = ${missing} ${spec.units}.`,
    });
  }

  return { items, figures };
}

// ---------------------------------------------------------------------------
function buildLevel2() {
  const items = [];
  const figures = [];

  // ---- triangles, named twice: once by side, once by angle ----
  L2_TRI.forEach((t) => {
    const dt = {
      shape: 'triangle', units: 'cm',
      vertices: triangleVertices(t.sides[0], t.sides[1], t.sides[2]),
      sides: t.sides.map((n) => ({ label: String(n) + ' cm', len: n })),
      ticks: t.ticks || undefined,
      rightAngles: t.rightAngles || undefined,
    };
    const figId = `fig-l2-${t.id}`;
    figures.push({
      id: figId, kind: 'diagram', genKind: 'polygon',
      caption: `Naming practice: a triangle with sides ${t.sides.join(', ')} cm.`,
      credit: 'Built for this pack in the V1 design tokens (original work).',
      alt: t.alt, src: `art/cpm-cc1-g6/${figId}.svg`, dataTable: dt,
    });

    const sideOpts = ['scalene', 'isosceles', 'equilateral', 'right'];
    const kSide = sideOpts.indexOf(t.byside);
    const drSide = {};
    sideOpts.forEach((o, i) => {
      if (i === kSide) return;
      drSide[String(i)] = o === 'right'
        ? 'Right names an ANGLE, not a set of side lengths.  This question asks about the sides.'
        : `A ${o} triangle needs ${o === 'scalene' ? 'no two sides equal' : o === 'isosceles' ? 'exactly two sides equal' : 'all three sides equal'}, and this figure does not have that.`;
    });
    items.push({
      id: `l2-side-${t.id}`, type: 'mc', figureId: figId, passageId: 'p-naming-shapes',
      targets: ['math-r5-classify-figures'], coachTopic: 'shape-triangle-by-side', dok: 2,
      stem: `Classify this triangle by its SIDES.  Its sides measure ${t.sides.join(' cm, ')} cm.`,
      choices: sideOpts, key: kSide, distractorRationale: drSide,
      explain: `${SIDE_NAMES[t.byside]}  Sides and angles are two separate classifications, and a triangle carries one name from each list.`,
    });

    const angOpts = ['acute', 'right', 'obtuse', 'equilateral'];
    const kAng = angOpts.indexOf(t.byangle);
    const drAng = {};
    angOpts.forEach((o, i) => {
      if (i === kAng) return;
      drAng[String(i)] = o === 'equilateral'
        ? 'Equilateral names the SIDES, not an angle.  This question asks about the corners.'
        : `An ${o} triangle needs ${o === 'acute' ? 'every corner smaller than a square corner' : o === 'right' ? 'one corner exactly square, which the figure would mark' : 'one corner wider than a square corner'}, and this figure does not have that.`;
    });
    items.push({
      id: `l2-angle-${t.id}`, type: 'mc', figureId: figId, passageId: 'p-naming-shapes',
      targets: ['math-r5-classify-figures'], coachTopic: 'shape-triangle-by-angle', dok: 2,
      stem: `Now classify that same triangle, the one with sides ${t.sides.join(', ')} cm, by its ANGLES.`,
      choices: angOpts, key: kAng, distractorRationale: drAng,
      explain: `${ANGLE_NAMES[t.byangle]}  A triangle takes one name from the side list and one from the angle list, and the two are independent: this one is ${t.byside} and ${t.byangle}.`,
    });
  });

  // ---- quadrilaterals, where the MOST EXACT name is the question ----
  L2_QUAD.forEach((q, idx) => {
    let vertices;
    if (q.shape === 'rectangle') vertices = q.vertices;
    else if (q.shape === 'parallelogram') vertices = parallelogramVertices(q.sides[0], q.sides[1], q.lean);
    else vertices = trapezoidVertices(q.sides[0], q.sides[1], q.sides[2], q.sides[3]);
    const dt = {
      shape: q.shape, units: 'cm', vertices,
      sides: q.sides.map((n) => ({ label: String(n) + ' cm', len: n })),
      ticks: q.ticks || undefined, rightAngles: q.rightAngles || undefined,
    };
    const figId = `fig-l2-${q.id}`;
    figures.push({
      id: figId, kind: 'diagram', genKind: 'polygon',
      caption: `Naming practice: a quadrilateral with sides ${q.sides.join(', ')} cm.`,
      credit: 'Built for this pack in the V1 design tokens (original work).',
      alt: q.alt, src: `art/cpm-cc1-g6/${figId}.svg`, dataTable: dt,
    });
    const others = ['square', 'rectangle', 'rhombus', 'parallelogram', 'trapezoid']
      .filter((o) => o !== q.name)
      .slice(0, 3)
      .map((o) => ({ v: o, why: `${QUAD_WHY[o]}  This figure does not meet that.` }));
    const { opts: shown, keyAt } = shuffleTo({ v: q.name }, others, idx);
    const dr = {};
    shown.forEach((o, i) => { if (i !== keyAt) dr[String(i)] = o.why; });
    items.push({
      id: `l2-quad-${q.id}`, type: 'mc', figureId: figId, passageId: 'p-naming-shapes',
      targets: ['math-r5-classify-figures'], coachTopic: 'shape-quadrilateral', dok: 2,
      stem: `What is the most exact name for this quadrilateral, whose sides are ${q.sides.join(', ')} cm?  Read the ticks and the corner marks first.`,
      choices: shown.map((o) => o.v), key: keyAt, distractorRationale: dr,
      explain: `${QUAD_WHY[q.name]}  The question asks for the MOST EXACT name, so a wider name that is also true is still the wrong answer here.`,
    });
  });

  // ---- the hierarchy itself, which a list of names never teaches ----
  const HIER = [
    {
      id: 'square-is-rectangle',
      stem: 'Is every square also a rectangle?',
      choices: [
        'Yes, because a square has four right angles, which is what a rectangle needs.',
        'No, because a rectangle must have two long sides and two short ones.',
        'Only when the square is drawn tilted.',
        'No, because a square already has its own name.',
      ],
      key: 0,
      dr: {
        1: 'A rectangle needs four right angles and equal opposite sides.  It never requires the long pair to differ from the short pair, so a square qualifies.',
        2: 'Turning a shape does not change what it is.  A tilted square is still a square, and still a rectangle.',
        3: 'Having a more exact name of its own does not remove a shape from the wider group.  A square is a rectangle with something extra.',
      },
      explain: 'A rectangle is any quadrilateral with four right angles and equal opposite sides.  A square has all of that AND four equal sides, so every square is a rectangle with something extra.  The reverse fails, because most rectangles are not squares.',
    },
    {
      id: 'rectangle-is-square',
      stem: 'Is every rectangle also a square?',
      choices: [
        'Yes, since both have four right angles.',
        'No, because a square also needs all four sides equal.',
        'Yes, if you measure carefully enough.',
        'No, because a rectangle has no right angles.',
      ],
      key: 1,
      dr: {
        0: 'Four right angles is what makes a rectangle, and a square needs that AND four equal sides.  That extra requirement is what makes this direction fail.',
        2: 'Measuring cannot turn a 9 by 5 rectangle into a square.  Its sides are genuinely different lengths.',
        3: 'A rectangle has four right angles by definition.  That part is exactly what the two shapes share.',
      },
      explain: 'The relationship runs one way only.  Every square is a rectangle, because a square meets every rectangle requirement and adds one more.  A rectangle with two long sides and two short ones meets no such extra requirement, so it is not a square.',
    },
    {
      id: 'square-is-rhombus',
      stem: 'A rhombus is a quadrilateral with four equal sides.  Is every square also a rhombus?',
      choices: [
        'No, a rhombus has to lean.',
        'Yes, because a square has four equal sides.',
        'No, a rhombus is not allowed right angles.',
        'Only squares smaller than the rhombus.',
      ],
      key: 1,
      dr: {
        0: 'Leaning is what a rhombus is usually DRAWN doing, not what the name requires.  The requirement is four equal sides.',
        2: 'A rhombus is not forbidden right angles;  it simply does not require them.  A square is the rhombus that happens to have them.',
        3: 'Size never decides a shape name.  The same shape drawn twice as large carries exactly the same name.',
      },
      explain: 'A rhombus needs four equal sides and nothing else.  A square has four equal sides, so every square is a rhombus, and it is a rectangle as well.  A square is the shape that sits in both groups at once.',
    },
  ];
  for (const h of HIER) {
    items.push({
      id: `l2-hier-${h.id}`, type: 'mc', passageId: 'p-naming-shapes',
      targets: ['math-r5-classify-figures'], coachTopic: 'shape-hierarchy', dok: 3,
      stem: h.stem, choices: h.choices, key: h.key, distractorRationale: h.dr, explain: h.explain,
    });
  }

  return { items, figures };
}

// ---------------------------------------------------------------------------
// LEVEL 4: decimals in words, BOTH directions.
//
// CC1 problem 1-20, and rank 5 on the build list. Half of this already exists: genWriteWord() at
// Math-Multiverse.html:6268 emits dec-write-word from F1 Apex Decimals Grade 5 level 1, at about
// 29% of that level's draws, and it turns a decimal INTO words. Every one of its four options is a
// word form, so the reverse direction, problem 1-20b, cannot be drawn from it at all.
//
// This level serves both, and deliberately runs the reverse direction more often, because that is
// the half nothing else can reach. No figures: the whole content is the words and the digits.
// ---------------------------------------------------------------------------

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

// Whole numbers under a thousand, in words. Enough for this level and no more: a partial
// implementation that silently mis-spells four figures would be worse than one that refuses.
function wordsForWhole(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error(`wordsForWhole: ${n} is outside 0 to 999`);
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    return r ? `${t}-${ONES[r]}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  const r = n % 100;
  return r ? `${h} ${wordsForWhole(r)}` : h;
}

const PLACE = { 1: 'tenths', 2: 'hundredths', 3: 'thousandths' };

// The house form CC1 uses, and the one the shell's own dec-write-word coach tip teaches: read the
// point as AND, then read the digits after it as one whole number named by the LAST place.
function wordsForDecimal(text) {
  const [w, d] = String(text).split('.');
  const whole = Number(w);
  if (!d) return wordsForWhole(whole);
  const frac = Number(d);
  const place = PLACE[d.length];
  if (!place) throw new Error(`wordsForDecimal: ${text} runs past thousandths`);
  const tail = `${wordsForWhole(frac)} ${place}`;
  return whole === 0 ? tail : `${wordsForWhole(whole)} and ${tail}`;
}

const L4_NUMBERS = [
  '3.24', '0.7', '12.05', '5.416', '40.9', '0.083', '7.5', '106.2', '9.007', '0.35',
  '21.6', '0.409', '8.13', '60.04', '2.008', '15.75',
];

function buildLevel4() {
  const items = [];

  L4_NUMBERS.forEach((num, idx) => {
    const [w, d] = num.split('.');
    const truth = wordsForDecimal(num);

    // ---- direction A: digits INTO words. The half the app already has, kept so the level
    // teaches the pair rather than only the missing side. ----
    if (idx % 3 !== 2) {
      const wrongs = [];
      // Name the wrong place: the single commonest error, and the one the shell's own coach tip
      // for dec-write-word is written about.
      const otherPlace = PLACE[d.length === 1 ? 2 : d.length - 1];
      wrongs.push({
        v: (Number(w) === 0 ? '' : `${wordsForWhole(Number(w))} and `) + `${wordsForWhole(Number(d))} ${otherPlace}`,
        why: `The digits after the point are read correctly here, but named by the wrong place.  Count the digits after the point: ${d.length} means ${PLACE[d.length]}.`,
      });
      // Read the decimal part digit by digit, which is how you say a phone number, not a number.
      wrongs.push({
        v: (Number(w) === 0 ? '' : `${wordsForWhole(Number(w))} point `) + d.split('').map((c) => ONES[Number(c)]).join(' '),
        why: 'This reads the digits one at a time, the way you read a phone number.  A decimal is read as one whole number named by its last place.',
      });
      // Drop the leading zero inside the decimal part, which changes the value.
      wrongs.push({
        v: (Number(w) === 0 ? '' : `${wordsForWhole(Number(w))} and `) + `${wordsForWhole(Number(d.replace(/^0+/, '') || '0'))} ${PLACE[d.length]}`,
        why: `A zero straight after the point is not decoration:  it holds the place.  Dropping it makes ${num} into a different number.`,
      });
      // A fourth named mistake, because the leading-zero one collapses onto the truth whenever the
      // decimal part has no leading zero, which is most of them.
      wrongs.push({
        v: `${wordsForWhole(Number(d))} and ${wordsForWhole(Number(w))} ${PLACE[d.length]}`,
        why: 'This swaps the two halves.  The number before AND is the whole number, and the number after it is the part past the point.',
      });
      const clean = [];
      const seen = new Set([truth]);
      for (const x of wrongs) { if (!seen.has(x.v)) { seen.add(x.v); clean.push(x); } }
      if (clean.length < 3) throw new Error(`cc1-pack-gen: L4 forward item for ${num} produced only ${clean.length} distractors`);
      const { opts, keyAt } = shuffleTo({ v: truth }, clean, idx);
      const dr = {};
      opts.forEach((o, i) => { if (i !== keyAt) dr[String(i)] = o.why; });
      items.push({
        id: `l4-towords-${num.replace('.', '-')}`,
        type: 'mc',
        passageId: 'p-reading-decimals',
        targets: ['math-r5-decimal-place-value'],
        coachTopic: 'decword-to-words',
        dok: 2,
        stem: `Write ${num} in words.`,
        choices: opts.map((o) => o.v),
        key: keyAt,
        distractorRationale: dr,
        explain: `Read the point as AND, then read the digits after it as one whole number named by the LAST place.  `
          + `${num} has ${d.length} digit${d.length === 1 ? '' : 's'} after the point, so that place is ${PLACE[d.length]}, and the answer is ${truth}.`,
      });
    }

    // ---- direction B: words back INTO digits. The half that exists nowhere in the app. ----
    // One place too far right: the digits are read correctly and then written a place late, which
    // is the error the place NAME exists to prevent. Padding to a shorter length instead produced
    // "0.70" for 0.7, which is the same number and made two options identical.
    const wrongsB = [
      { v: `${w}.0${d}`, why: `This writes the digits one place too far right, which makes ${d.length + 1} digits after the point instead of ${d.length}.  "${PLACE[d.length]}" is what fixes how many there should be.` },
      { v: `${w}.${d.replace(/^0+/, '') || '0'}`, why: 'This drops a zero that was holding a place.  A zero straight after the point changes which place every later digit sits in.' },
      { v: `${Number(d)}.${w}`, why: 'This swaps the whole-number part and the decimal part.  The words before AND are the whole number.' },
    ];
    const cleanB = [];
    const seenB = new Set([num]);
    for (const x of wrongsB) { if (!seenB.has(x.v)) { seenB.add(x.v); cleanB.push(x); } }
    if (cleanB.length < 3) {
      cleanB.push({ v: `${Number(w) + Number(d)}`, why: 'This adds the two halves together into one whole number.  A decimal point separates them;  it never joins them.' });
    }
    if (cleanB.length < 3) throw new Error(`cc1-pack-gen: L4 reverse item for ${num} produced only ${cleanB.length} distractors`);
    const { opts: optsB, keyAt: keyB } = shuffleTo({ v: num }, cleanB, idx + 1);
    const drB = {};
    optsB.forEach((o, i) => { if (i !== keyB) drB[String(i)] = o.why; });
    items.push({
      id: `l4-todigits-${num.replace('.', '-')}`,
      type: 'mc',
      passageId: 'p-reading-decimals',
      targets: ['math-r5-decimal-place-value'],
      coachTopic: 'decword-to-digits',
      dok: 2,
      stem: `Which number is "${truth}"?`,
      choices: optsB.map((o) => o.v),
      key: keyB,
      distractorRationale: drB,
      explain: `The place name at the end tells you how many digits go after the point:  ${PLACE[d.length]} means ${d.length}.  `
        + `"${wordsForWhole(Number(d))}" written with ${d.length} digit${d.length === 1 ? '' : 's'} is ${d}, so the number is ${num}.  `
        + `This is the direction the six worlds cannot ask:  their decimal-in-words generator only ever runs the other way.`,
    });
  });

  return { items, figures: [] };
}

// ---------------------------------------------------------------------------
// LEVEL 5: growing patterns, and the rule behind them.
//
// CC1 problem 1-19 and lesson 1.1.3, plus lessons 4.1.1 to 4.1.3, "Using Variables to Generalize",
// which the crosswalk lists as a separate GAP for the same underlying reason.
//
// What the app has is genCorrespondingTerm() at Math-Multiverse.html:11474, emitting pemdas-pattern
// out of The Floating Bear Grade 5 at no more than 15% of any level's draws. It hands over BOTH
// rules already written and asks the child to compare them. CC1 asks something harder and more
// useful: here are three figures, find the rule yourself, then use it to reach figure 100. That is
// the step from arithmetic to algebra, and it needs a picture to start from.
//
// Every item's answer is computed from the same rule that draws the dots, so a figure cannot show a
// count that disagrees with the rule the child is asked to find.
// ---------------------------------------------------------------------------
const L5 = [
  { id: 'p3n', a: 3, b: 0, layout: 'stack', far: 100,
    alt: 'Three dot figures in a row.  Figure 1 has 3 dots in a single row of three, figure 2 has 6 dots in two rows of three, and figure 3 has 9 dots in three rows of three.' },
  { id: 'p2n1', a: 2, b: 1, layout: 'stack', far: 100,
    alt: 'Three dot figures.  Figure 1 has 3 dots, figure 2 has 5 dots and figure 3 has 7 dots.  Each figure keeps one dot on top and adds another row of two below.' },
  { id: 'p4n2', a: 4, b: 2, layout: 'stack', far: 50,
    alt: 'Three dot figures.  Figure 1 has 6 dots, figure 2 has 10 dots and figure 3 has 14 dots.  Two dots sit on top of every figure and rows of four build up beneath.' },
  { id: 'p5n', a: 5, b: 0, layout: 'stack', far: 100,
    alt: 'Three dot figures.  Figure 1 has 5 dots in one row, figure 2 has 10 dots in two rows and figure 3 has 15 dots in three rows.' },
  { id: 'p3n2', a: 3, b: 2, layout: 'stack', far: 20,
    alt: 'Three dot figures.  Figure 1 has 5 dots, figure 2 has 8 dots and figure 3 has 11 dots.  Two dots sit on top and rows of three build up beneath.' },
  { id: 'p2n', a: 2, b: 0, layout: 'row', far: 100,
    alt: 'Three dot figures.  Figure 1 has 2 dots, figure 2 has 4 dots and figure 3 has 6 dots, each arranged in two rows.' },
];

function ruleText(a, b) {
  if (b === 0) return `${a} x n`;
  return `${a} x n + ${b}`;
}

function buildLevel5() {
  const items = [];
  const figures = [];

  L5.forEach((p, idx) => {
    const dt = { rule: { a: p.a, b: p.b }, shown: [1, 2, 3], layout: p.layout, dotUnit: 'dot' };
    const figId = `fig-l5-${p.id}`;
    const counts = [1, 2, 3].map((n) => dotsAt(dt, n));
    figures.push({
      id: figId, kind: 'diagram', genKind: 'dots',
      caption: `A growing dot pattern: figures 1, 2 and 3 hold ${counts.join(', ')} dots.`,
      credit: 'Built for this pack in the V1 design tokens (original work).',
      alt: p.alt, src: `art/cpm-cc1-g6/${figId}.svg`, dataTable: dt,
    });

    // ---- the NEXT figure: the step CC1 asks for first, by drawing figure 4 ----
    const next = dotsAt(dt, 4);
    const nextWrongs = [
      { v: counts[2] + 1, why: 'This adds one more dot than figure 3.  Look at how much the pattern grows between figures 1 and 2, and again between 2 and 3;  it is the same jump every time, and it is not one.' },
      { v: counts[2] * 2, why: 'This doubles figure 3.  The pattern ADDS the same amount each time rather than doubling, which is why the jumps between figures are all equal.' },
      { v: next + p.a, why: 'This takes one jump too many and lands on figure 5.  Count carefully: figure 4 is one step past figure 3.' },
    ];
    const cleanNext = [];
    const seenNext = new Set([next]);
    for (const x of nextWrongs) { if (!seenNext.has(x.v)) { seenNext.add(x.v); cleanNext.push(x); } }
    const { opts: o1, keyAt: k1 } = shuffleTo({ v: next }, cleanNext, idx);
    const dr1 = {};
    o1.forEach((o, i) => { if (i !== k1) dr1[String(i)] = o.why; });
    items.push({
      id: `l5-next-${p.id}`, type: 'mc', figureId: figId, passageId: 'p-finding-the-rule',
      targets: ['math-r5-numerical-patterns'], coachTopic: 'growpattern-next-figure', dok: 2,
      stem: `Figures 1, 2 and 3 hold ${counts.join(', ')} dots.  How many dots would figure 4 have?`,
      choices: o1.map((o) => String(o.v)), key: k1, distractorRationale: dr1,
      explain: `The pattern grows by the same amount every step:  ${counts[1]} - ${counts[0]} = ${p.a}, and ${counts[2]} - ${counts[1]} = ${p.a}.  `
        + `So figure 4 has ${counts[2]} + ${p.a} = ${next} dots.`,
    });

    // ---- the RULE itself, which is the step into algebra ----
    const truthRule = ruleText(p.a, p.b);
    const ruleWrongs = [
      { v: ruleText(p.a + 1, p.b), why: `This grows by ${p.a + 1} each step.  Check it against figure 1:  the rule has to give ${counts[0]} when n is 1.` },
      { v: p.b === 0 ? `n + ${p.a}` : `n + ${p.a + p.b}`, why: 'This adds where the pattern multiplies.  A rule that only adds grows by one dot per figure, and this pattern grows by more than that.' },
      { v: p.b === 0 ? `${p.a} x n + 1` : `${p.a} x n`, why: `This gets the growth right and the starting point wrong.  Test it on figure 1:  it should give ${counts[0]}.` },
    ];
    const cleanRule = [];
    const seenRule = new Set([truthRule]);
    for (const x of ruleWrongs) { if (!seenRule.has(x.v)) { seenRule.add(x.v); cleanRule.push(x); } }
    const { opts: o2, keyAt: k2 } = shuffleTo({ v: truthRule }, cleanRule, idx + 1);
    const dr2 = {};
    o2.forEach((o, i) => { if (i !== k2) dr2[String(i)] = o.why; });
    items.push({
      id: `l5-rule-${p.id}`, type: 'mc', figureId: figId, passageId: 'p-finding-the-rule',
      targets: ['math-r5-numerical-patterns', 'math-ee-generalize'], coachTopic: 'growpattern-rule', dok: 3,
      stem: `This pattern runs ${counts.join(', ')} dots across figures 1, 2 and 3.  Which rule gives the number of dots in figure n?`,
      choices: o2.map((o) => o.v), key: k2, distractorRationale: dr2,
      explain: `The pattern grows by ${p.a} each step, so the rule multiplies n by ${p.a}.  `
        + (p.b === 0
          ? `Figure 1 has ${counts[0]} dots and ${p.a} x 1 = ${counts[0]}, so nothing is added on:  the rule is ${truthRule}.`
          : `That alone would give ${p.a} for figure 1, but figure 1 has ${counts[0]}, so ${p.b} more are always there:  the rule is ${truthRule}.`)
        + `  Every rule can be tested the same way, by putting n = 1 into it and checking against the first figure.`,
    });

    // ---- the FAR term, which is why a rule is worth having ----
    const far = dotsAt(dt, p.far);
    // Five named mistakes rather than three, because several of them collapse onto the right
    // answer when b is 0, which is what the guard below caught on the first build.
    const farWrongs = [
      { v: p.a * p.far + p.b * p.far, why: `This adds the ${p.b} once per figure instead of once altogether.  Look at the figures:  that group of ${p.b} is the SAME ${p.b} dots every time, not a new ${p.b} each step.` },
      { v: p.a * (p.far - 1) + p.b, why: `This lands on figure ${p.far - 1}.  The rule takes the figure number itself, so put ${p.far} into it.` },
      { v: p.a * (p.far + 1) + p.b, why: `This lands on figure ${p.far + 1}, one step too far.` },
      { v: p.far + p.a + p.b, why: 'This adds the numbers in the rule to the figure number.  The rule MULTIPLIES the figure number, which is why the pattern grows the way it does.' },
      { v: p.a * p.far - p.b, why: `This subtracts the ${p.b} instead of adding it.  Test the rule on figure 1:  it has to give ${counts[0]}.` },
    ];
    const cleanFar = [];
    const seenFar = new Set([far]);
    for (const x of farWrongs) { if (!seenFar.has(x.v) && x.v > 0) { seenFar.add(x.v); cleanFar.push(x); } }
    if (cleanFar.length < 3) throw new Error(`cc1-pack-gen: L5 far item for ${p.id} produced only ${cleanFar.length} distractors`);
    const { opts: o3, keyAt: k3 } = shuffleTo({ v: far }, cleanFar, idx + 2);
    const dr3 = {};
    o3.forEach((o, i) => { if (i !== k3) dr3[String(i)] = o.why; });
    items.push({
      id: `l5-far-${p.id}`, type: 'mc', figureId: figId, passageId: 'p-finding-the-rule',
      targets: ['math-r5-numerical-patterns', 'math-ee-generalize'], coachTopic: 'growpattern-far-term', dok: 3,
      stem: `The pattern that runs ${counts.join(', ')} dots keeps going.  How many dots are in figure ${p.far}?  Use the rule rather than drawing it.`,
      choices: o3.map((o) => String(o.v)), key: k3, distractorRationale: dr3,
      explain: `The rule is ${truthRule}, so figure ${p.far} has ${p.a} x ${p.far}${p.b ? ' + ' + p.b : ''} = ${far} dots.  `
        + `This is what a rule is FOR:  drawing figure ${p.far} would take all evening, and the rule answers it in one line.`,
    });
  });

  return { items, figures };
}

// ---------------------------------------------------------------------------
// LEVEL 3: reading a data display.
//
// CC1 lesson 1.1.4, "Graphical Representations of Data: Histograms and Bar Graphs", and problem
// 1-23. Rank 3 on the build list, and the lesson the class reaches next after 1.1.3.
//
// What the app has is nothing. g6-stats-mean, -median and -range read a comma-separated LIST of
// numbers and never a display; the only real chart-reading in the whole app is shelved under
// Science, in Outpost Protocol level 2, and it is a line chart rather than a categorical bar graph.
//
// SCOPE, stated rather than glossed. This level serves the BAR-SHAPED displays: the categorical bar
// graph and the histogram, which is lesson 1.1.4 exactly. Stem-and-leaf (lesson 2.1.2) and box
// plots (lessons 8.1.4 to 8.1.5) need panel types build/figure-gen.js does not have, so they stay
// GAP in the crosswalk and the mission keeps saying so. Building a chart generator for them is its
// own work package, not something to fake here.
//
// Every item's answer is read out of the same dataTable that draws the bars, so a chart cannot
// disagree with the question beside it.
// ---------------------------------------------------------------------------
const L3 = [
  {
    id: 'pets', kind: 'bar', short: 'the pets in Class 6B', yLabel: 'children',
    cats: ['dog', 'cat', 'fish', 'bird'], vals: [12, 9, 5, 3],
    what: 'children in Class 6B and the pet each one keeps',
    unit: 'children',
    alt: 'A bar graph titled by pet type.  Dog stands at 12 children, cat at 9, fish at 5 and bird at 3.',
  },
  {
    id: 'walk', kind: 'bar', short: 'how the class travels to school', yLabel: 'students',
    cats: ['walk', 'bus', 'car', 'bike'], vals: [14, 11, 6, 4],
    what: 'how the 35 students in one class travel to school',
    unit: 'students',
    alt: 'A bar graph of travel to school.  Walking stands at 14 students, bus at 11, car at 6 and bike at 4.',
  },
  {
    id: 'fruit', kind: 'bar', short: 'the fruit sold', yLabel: 'pieces sold',
    cats: ['apple', 'banana', 'pear', 'plum'], vals: [24, 30, 12, 18],
    what: 'pieces of fruit the school shop sold on Monday',
    unit: 'pieces',
    alt: 'A bar graph of fruit sold.  Apple stands at 24 pieces, banana at 30, pear at 12 and plum at 18.',
  },
  {
    id: 'minutes', kind: 'hist', short: 'minutes spent reading', yLabel: 'students',
    cats: ['0-9', '10-19', '20-29', '30-39'], vals: [4, 9, 13, 6],
    what: 'how many minutes each student spent reading last night, grouped into intervals',
    unit: 'students',
    alt: 'A histogram of reading minutes in four intervals.  The 0 to 9 bar stands at 4 students, 10 to 19 at 9, 20 to 29 at 13 and 30 to 39 at 6.  The bars sit side by side with no gaps, because the intervals join.',
  },
  {
    id: 'heights', kind: 'hist', short: 'seedling heights', yLabel: 'plants',
    cats: ['0-4', '5-9', '10-14', '15-19'], vals: [3, 8, 11, 2],
    what: 'the height in centimetres of each seedling in a tray, grouped into intervals',
    unit: 'plants',
    alt: 'A histogram of seedling heights in four intervals.  The 0 to 4 bar stands at 3 plants, 5 to 9 at 8, 10 to 14 at 11 and 15 to 19 at 2.',
  },
];

function buildLevel3() {
  const items = [];
  const figures = [];

  L3.forEach((c, idx) => {
    const dt = {
      type: 'bar',
      yLabel: c.yLabel,
      xLabel: c.kind === 'hist' ? 'interval' : 'category',
      categoryLabels: c.cats,
      // A histogram's bars TOUCH, because its horizontal axis is a number line and one interval runs
      // straight into the next; a bar graph's do not, because its categories are separate names.
      // The items in this level teach that gap as the visible difference between the two displays,
      // so the figure has to show it. See the BAR SPACING note in build/figure-gen.js.
      barGap: c.kind === 'hist' ? 0 : undefined,
      series: [{ label: c.yLabel, points: c.vals.map((v, i) => [i, v]) }],
    };
    const figId = `fig-l3-${c.id}`;
    const total = c.vals.reduce((a, b) => a + b, 0);
    const maxI = c.vals.indexOf(Math.max(...c.vals));
    const minI = c.vals.indexOf(Math.min(...c.vals));
    figures.push({
      id: figId, kind: 'chart', gen: true,
      caption: `${c.kind === 'hist' ? 'A histogram' : 'A bar graph'} of ${c.what}.`,
      credit: 'Built for this pack in the V1 design tokens (original work); the data is this pack\'s own.',
      alt: c.alt, src: `art/cpm-cc1-g6/${figId}.svg`, dataTable: dt,
    });

    // ---- read one value straight off the display ----
    {
      const truth = c.vals[maxI];
      const wrongs = [
        { v: c.vals[minI], why: `That is the ${c.kind === 'hist' ? 'shortest bar' : 'smallest bar'}, not the tallest one.  Read the question again:  it asks which is the most.` },
        { v: truth + 1, why: 'This is one off.  Follow the top of the bar straight across to the scale on the left and read the line it lands on.' },
        { v: c.cats.length, why: `This counts the BARS rather than reading one.  There are ${c.cats.length} bars, but the question asks how many ${c.unit} the tallest one stands for.` },
      ];
      const clean = [];
      const seen = new Set([truth]);
      for (const x of wrongs) { if (!seen.has(x.v)) { seen.add(x.v); clean.push(x); } }
      if (clean.length < 3) clean.push({ v: total, why: `This is the total across every bar.  The question asks about one bar on its own.` });
      const { opts, keyAt } = shuffleTo({ v: truth }, clean, idx);
      const dr = {};
      opts.forEach((o, i) => { if (i !== keyAt) dr[String(i)] = o.why; });
      items.push({
        id: `l3-read-${c.id}`, type: 'mc', figureId: figId, passageId: 'p-reading-a-display',
        targets: ['math-r3-scaled-graphs', 'math-sp-displays'], coachTopic: 'display-read-a-value', dok: 2,
        stem: `Read the ${c.kind === 'hist' ? 'histogram' : 'bar graph'}.  How many ${c.unit} does the TALLEST bar stand for?`,
        choices: opts.map((o) => String(o.v)), key: keyAt, distractorRationale: dr,
        explain: `The tallest bar is ${c.cats[maxI]}, and following its top across to the scale gives ${truth} ${c.unit}.  `
          + `Reading a display starts with reading one bar accurately;  everything else is built on that.`,
      });
    }

    // ---- compare two bars, which is the "how many more" question CC1 asks ----
    {
      const diff = c.vals[maxI] - c.vals[minI];
      const wrongs = [
        { v: c.vals[maxI] + c.vals[minI], why: 'This ADDS the two bars.  "How many more" asks for the gap between them, which is a subtraction.' },
        { v: c.vals[maxI], why: 'This is the tallest bar on its own.  The question asks how much taller it is than the shortest, not how tall it is.' },
        { v: Math.abs(maxI - minI), why: 'This counts how far apart the two bars sit along the bottom.  The question is about their HEIGHTS, which is the scale up the side.' },
      ];
      const clean = [];
      const seen = new Set([diff]);
      for (const x of wrongs) { if (!seen.has(x.v)) { seen.add(x.v); clean.push(x); } }
      if (clean.length < 3) clean.push({ v: total, why: 'This is the total across every bar rather than the gap between two of them.' });
      const { opts, keyAt } = shuffleTo({ v: diff }, clean, idx + 1);
      const dr = {};
      opts.forEach((o, i) => { if (i !== keyAt) dr[String(i)] = o.why; });
      items.push({
        id: `l3-compare-${c.id}`, type: 'mc', figureId: figId, passageId: 'p-reading-a-display',
        targets: ['math-r3-scaled-graphs'], coachTopic: 'display-compare-bars', dok: 2,
        stem: `Look again at the display of ${c.short}.  How many more ${c.unit} does the tallest bar stand for than the shortest one?`,
        choices: opts.map((o) => String(o.v)), key: keyAt, distractorRationale: dr,
        explain: `The tallest bar is ${c.cats[maxI]} at ${c.vals[maxI]} and the shortest is ${c.cats[minI]} at ${c.vals[minI]}, `
          + `so the gap is ${c.vals[maxI]} - ${c.vals[minI]} = ${diff} ${c.unit}.  "How many more" is always a subtraction, whatever the display.`,
      });
    }

    // ---- the total, which only a display can be read for ----
    {
      const wrongs = [
        { v: c.vals[maxI], why: 'This is the tallest bar alone.  A total needs every bar added together.' },
        { v: total - c.vals[minI], why: 'This misses the shortest bar.  Every bar counts towards the total, however short it is.' },
        { v: c.cats.length, why: `This counts the bars.  There are ${c.cats.length} of them, but they stand for ${total} ${c.unit} altogether.` },
      ];
      const clean = [];
      const seen = new Set([total]);
      for (const x of wrongs) { if (!seen.has(x.v)) { seen.add(x.v); clean.push(x); } }
      const { opts, keyAt } = shuffleTo({ v: total }, clean, idx + 2);
      const dr = {};
      opts.forEach((o, i) => { if (i !== keyAt) dr[String(i)] = o.why; });
      items.push({
        id: `l3-total-${c.id}`, type: 'mc', figureId: figId, passageId: 'p-reading-a-display',
        targets: ['math-r3-scaled-graphs', 'math-sp-displays'], coachTopic: 'display-total', dok: 2,
        stem: `Still on the display of ${c.short}, how many ${c.unit} does the whole set add up to?`,
        choices: opts.map((o) => String(o.v)), key: keyAt, distractorRationale: dr,
        explain: `Add every bar:  ${c.vals.join(' + ')} = ${total} ${c.unit}.  A display shows the whole set at once, which is exactly what it is for.`,
      });
    }
  });

  // ---- bar graph or histogram? The distinction lesson 1.1.4 is actually about ----
  const KIND = [
    {
      id: 'which-is-histogram',
      stem: 'One display groups its data into number intervals like 0 to 9 and 10 to 19, and its bars touch.  What is that display called?',
      choices: ['a histogram', 'a bar graph', 'a dot plot', 'a stem-and-leaf plot'],
      key: 0,
      dr: {
        1: 'A bar graph sorts data into named categories such as dog or bus, and its bars are drawn with gaps between them because the categories do not join.',
        2: 'A dot plot marks one dot per value along a number line.  It shows every single value, not counts inside intervals.',
        3: 'A stem-and-leaf plot splits each number into a stem and a leaf, so the original values can still be read back.  A histogram cannot be read back that way.',
      },
      explain: 'A histogram groups numbers into intervals and counts how many fall in each one, so its bars touch:  the intervals join with no gap between them.  That touching is the visible difference, and it is there because the horizontal axis is a number line rather than a list of names.',
    },
    {
      id: 'why-bars-touch',
      stem: 'Why are the bars of a histogram drawn touching, while the bars of a bar graph have gaps between them?',
      choices: [
        'Because a histogram usually holds more data.',
        'Because a histogram\'s intervals join up along a number line, and a bar graph\'s categories do not.',
        'Because histograms are always drawn taller.',
        'Because a bar graph is allowed only four bars.',
      ],
      key: 1,
      dr: {
        0: 'The amount of data makes no difference.  A histogram of ten values still touches, and a bar graph of a thousand still has gaps.',
        2: 'Height comes from the counts, not the type of display.  Either kind can be tall or short.',
        3: 'A bar graph can have any number of categories.  The number of bars is not what separates the two.',
      },
      explain: 'The gap is information.  A histogram\'s bottom axis is a number line, so 0 to 9 runs straight into 10 to 19 with nothing missing between them, and the bars touch to show it.  A bar graph\'s bottom axis is a list of separate names, and the gaps say those categories do not run into each other.',
    },
    {
      id: 'what-a-display-cannot-say',
      stem: 'A histogram shows that 13 students read for 20 to 29 minutes.  What can it NOT tell you?',
      choices: [
        'How many students read for 20 to 29 minutes.',
        'Which interval holds the most students.',
        'Exactly how long any one of those 13 students read for.',
        'How many intervals the data was grouped into.',
      ],
      key: 2,
      dr: {
        0: 'It can:  that is the height of that bar, and the question itself quotes it.',
        1: 'It can:  the tallest bar names that interval directly.',
        3: 'It can:  counting the bars gives the number of intervals.',
      },
      explain: 'Grouping is what a histogram does, and grouping loses the individual values.  Those 13 students each read somewhere between 20 and 29 minutes, and the display cannot say which.  A stem-and-leaf plot keeps that detail;  a histogram trades it away for a clearer shape.',
    },
  ];
  for (const k of KIND) {
    items.push({
      id: `l3-kind-${k.id}`, type: 'mc', passageId: 'p-reading-a-display',
      targets: ['math-sp-displays'], coachTopic: 'display-which-kind', dok: 3,
      stem: k.stem, choices: k.choices, key: k.key, distractorRationale: k.dr, explain: k.explain,
    });
  }

  return { items, figures };
}

// ---------------------------------------------------------------------------
// Assemble.
// ---------------------------------------------------------------------------
const l1 = buildLevel1();
const l2 = buildLevel2();
const l4 = buildLevel4();
const l5 = buildLevel5();
const l3 = buildLevel3();

const pack = {
  meta: { id: 'cpm-cc1-g6', subject: 'math', grade: 6, title: 'Field Notes', standards: 'CCSS Math 6 (CPM CC1)', version: 1 },
  skin: { color: ACCENT, icon: '📐', grandGoal: 'Chief Surveyor' },
  passages: [
    {
      id: 'p-how-to-read-a-figure',
      title: 'How to read a figure',
      docKind: 'field-manual',
      genre: 'informational',
      source: 'original',
      // Landed by MEASUREMENT, not by feel, and it took two overshoots to get there. The first
      // draft came in at Flesch-Kincaid 3.5 against this pack's 5.5 to 8 band, which is too SIMPLE
      // and is its own kind of wrong for a grade-6 pack. Reaching for real vocabulary then
      // overshot the other way to 9.5, with Coleman-Liau at 12.0 against a 9.5 ceiling. This draft
      // measures FK 6.4 and CL 8.3, both comfortably inside, with a longest sentence of 27 words,
      // which also clears the prose-clarity ratchet this pack is pinned at.
      text: 'Every figure in these notes is already labelled, and each side carries its own length printed '
        + 'beside it.  Those printed labels are the only numbers to work from.  Never measure a drawing with '
        + 'a ruler.  A figure is drawn to be clear, not to scale, so a side marked twelve may look shorter '
        + 'than a side marked five.\n\n'
        + 'Perimeter is the distance all the way around the outside of a shape.  Start at any corner, travel '
        + 'along every edge once, and finish at the corner you started from.  Add the labels together as you '
        + 'go.  The most common mistake is getting back to the start and carrying on, which counts one edge '
        + 'twice.\n\n'
        + 'Two marks turn up again and again, and both are worth learning now.  A small square drawn inside '
        + 'a corner means that corner is a right angle, exactly ninety degrees.  Short ticks drawn across '
        + 'two sides mean those sides are equal to each other, which is how a figure tells you about a side '
        + 'it never labelled.\n\n'
        + 'Perimeter measures the boundary.  Area measures the space shut inside that boundary.  They answer '
        + 'different questions, and multiplying two side lengths gives you area, never perimeter.',
    },
    {
      id: 'p-naming-shapes',
      title: 'Naming a shape',
      docKind: 'field-manual',
      genre: 'informational',
      source: 'original',
      text: 'A triangle takes two names at once, and they answer different questions.  The first name '
        + 'describes its sides.  Scalene means no two sides match.  Isosceles means exactly two match.  '
        + 'Equilateral means all three match.  Ticks drawn across two sides are how a figure tells you '
        + 'they are equal without printing the same number twice.\n\n'
        + 'The second name describes its corners.  Acute means every corner is smaller than a square '
        + 'corner.  Right means one corner is exactly square, and a figure marks that with a small '
        + 'square.  Obtuse means one corner opens wider than square.  A triangle can only ever have one '
        + 'corner that is right or obtuse, so those names are never shared.\n\n'
        + 'Quadrilateral names work differently, because they nest inside one another.  A rectangle is '
        + 'any four-sided shape with four right angles and equal opposite sides.  A rhombus is any '
        + 'four-sided shape with four equal sides.  A square meets both of those, so a square is a '
        + 'rectangle and a rhombus at the same time.\n\n'
        + 'That nesting runs in one direction only.  Every square is a rectangle, but most rectangles '
        + 'are certainly not squares.  When a question asks for the most exact name available, a wider '
        + 'name that happens to be true still counts as the wrong answer.',
    },
    {
      id: 'p-reading-decimals',
      title: 'Reading a decimal out loud',
      docKind: 'field-manual',
      genre: 'informational',
      source: 'original',
      text: 'A decimal is read in three parts.  Say the whole number first, then say the word AND for '
        + 'the point itself, then read every digit after the point as a single whole number.  Finish by '
        + 'naming the place the LAST digit lands in.  So 3.24 is read three AND twenty-four hundredths, '
        + 'because the 4 sits in the hundredths place.\n\n'
        + 'The place names run in order.  One digit after the point is tenths.  Two digits is '
        + 'hundredths.  Three digits is thousandths.  Counting the digits is therefore the whole trick, '
        + 'and it works in both directions.\n\n'
        + 'Going backwards is the harder direction and the one worth practising.  Given the words, the '
        + 'place name at the end tells you exactly how many digits belong after the point.  Thousandths '
        + 'means three, so eight thousandths is written 0.008 rather than 0.8, and those two zeros are '
        + 'doing real work.\n\n'
        + 'A zero straight after the point is never decoration.  It holds a place, and removing it '
        + 'shifts every digit behind it into a different place and changes the value of the number.',
    },
    {
      id: 'p-finding-the-rule',
      title: 'Finding the rule',
      docKind: 'field-manual',
      genre: 'informational',
      source: 'original',
      text: 'A growing pattern is a set of figures where each one is built from the one before it by '
        + 'adding the same amount.  The figures are numbered, and figure 1 is where the counting '
        + 'starts.  Three figures is enough to see what is happening, which is why three is what you '
        + 'are usually given.\n\n'
        + 'Work out the growth first.  Count the dots in each figure, then find the difference between '
        + 'figure 1 and figure 2, and between figure 2 and figure 3.  Those two differences are equal '
        + 'in every pattern here, and that shared number is how much the pattern grows each step.\n\n'
        + 'The rule multiplies the figure number by that growth.  If a pattern grows by 3 each step, '
        + 'the rule starts as 3 times n, where n stands for the figure number.  Then check it against '
        + 'figure 1.  If the rule gives fewer dots than figure 1 actually has, the difference is a '
        + 'fixed group.  It sits in every figure, and it gets added on the end.\n\n'
        + 'A rule earns its keep on the figures nobody would draw.  Figure 100 takes one line of '
        + 'arithmetic with a rule and an entire evening without one.  That is the whole reason for '
        + 'writing the rule down instead of counting on.',
    },
    {
      id: 'p-reading-a-display',
      title: 'Reading a display',
      docKind: 'field-manual',
      genre: 'informational',
      source: 'original',
      text: 'A display turns a pile of numbers into a picture, and reading one starts with a single '
        + 'bar.  Follow the top of the bar straight across to the scale up the side, and read the line '
        + 'it lands on.  Comparing bars, or adding them up, is built on getting that one reading '
        + 'right.\n\n'
        + 'The same two questions come up again and again.  How many MORE is always one bar taken away '
        + 'from another, and never a sum.  The TOTAL is every bar added together, including the short '
        + 'ones that are easy to skip.\n\n'
        + 'A bar graph and a histogram look alike, and they are not the same thing.  A bar graph sorts '
        + 'data into named groups, such as dog, cat and fish, and its bars are drawn with gaps.  Those '
        + 'names do not run into each other, so the bars do not either.  A histogram sorts numbers into '
        + 'intervals instead, such as 0 to 9 and 10 to 19.  Its bars touch, because one interval runs '
        + 'straight into the next along a number line.\n\n'
        + 'That gap between the bars is information rather than decoration.  Sorting numbers into '
        + 'groups costs you something as well.  A histogram may show 13 students in the 20 to 29 '
        + 'interval, but it cannot tell you how long any one of them read for.',
    },
  ],
  levels: [
    {
      id: 1,
      name: 'Walk the Edge',
      goal: 'Find the perimeter of a labelled figure, from a rectangle to an L-shape.',
      targets: ['math-r4-perimeter'],
      lives: 4,
      questions: 8,
      briefing: {
        title: 'What perimeter is',
        lines: [
          'Perimeter is the distance all the way round the outside of a shape.  Picture walking the edge of a field and ending back where you started.',
          'Every figure here is labelled, so you never measure the drawing.  Add the labels, going round once, and count every side exactly one time.',
          'Watch for the trap.  Multiplying two sides gives you AREA, the space inside.  That is a different question, and it is the one this app used to ask.',
        ],
      },
      itemIds: l1.items.map((i) => i.id),
    },
    {
      id: 2,
      name: 'Name the Shape',
      goal: 'Name a triangle by its sides and by its angles, and give a quadrilateral its most exact name.',
      targets: ['math-r5-classify-figures'],
      lives: 4,
      questions: 8,
      briefing: {
        title: 'Two names, not one',
        lines: [
          'A triangle gets TWO names, and they answer different questions.  One describes its sides.  Scalene means no two match, isosceles means exactly two match, equilateral means all three match.',
          'The other describes its corners.  Acute means every corner is smaller than a square corner.  Right means one corner is exactly square.  Obtuse means one corner opens wider than square.',
          'Quadrilaterals work differently.  Their names nest inside each other, so a square is also a rectangle and also a rhombus.  When a question asks for the most exact name, a wider name that is still true is the wrong answer.',
        ],
      },
      itemIds: l2.items.map((i) => i.id),
    },
    {
      id: 3,
      name: 'Say the Number',
      goal: 'Read a decimal into words, and read the words back into a decimal.',
      targets: ['math-r5-decimal-place-value'],
      lives: 4,
      questions: 8,
      briefing: {
        title: 'Both directions',
        lines: [
          'Reading a decimal has a rule.  Say the whole number, say AND for the point, read the digits after it as one whole number, then name the place the last digit sits in.',
          'So 3.24 is three AND twenty-four hundredths.  Two digits after the point means hundredths.  Count the digits and the place names itself.',
          'The harder direction is going back.  Given the words, the place name tells you how many digits belong after the point.  Eight thousandths is 0.008, and those zeros are doing real work.',
        ],
      },
      itemIds: l4.items.map((i) => i.id),
    },
    {
      id: 4,
      name: 'Find the Rule',
      goal: 'Read a growing pattern, write the rule behind it, and use the rule to reach figure 100.',
      targets: ['math-r5-numerical-patterns', 'math-ee-generalize'],
      lives: 4,
      questions: 8,
      briefing: {
        title: 'Three figures, one rule',
        lines: [
          'A growing pattern adds the same number of dots every step.  You get figures 1, 2 and 3, and your job is to work out what is being added and where it starts.',
          'Count the dots, then find the jump from figure 1 to figure 2, and from 2 to 3.  Those jumps are equal.  That number is what n gets multiplied by.',
          'Then test your rule on figure 1.  If it comes up short, the difference is a fixed group sitting in every figure, and it is added on the end.',
          'The point of a rule is figure 100.  Drawing it would take all evening.  The rule answers it in one line.',
        ],
      },
      itemIds: l5.items.map((i) => i.id),
    },
    {
      id: 5,
      name: 'Read the Chart',
      goal: 'Read a bar graph and a histogram, compare their bars, and tell the two kinds apart.',
      targets: ['math-r3-scaled-graphs', 'math-sp-displays'],
      lives: 4,
      questions: 8,
      briefing: {
        title: 'Bars and what they mean',
        lines: [
          'Reading a display starts with one bar.  Follow its top straight across to the scale up the side and read the line it lands on.  Comparing and totalling come after that.',
          'How many MORE is always a subtraction between two bars.  The TOTAL is every bar added up, including the short ones.',
          'A bar graph and a histogram look alike.  A bar graph sorts named categories and leaves gaps between its bars.  A histogram groups numbers into intervals, and its bars touch, because one interval runs straight into the next.',
        ],
      },
      itemIds: l3.items.map((i) => i.id),
    },
  ],
  items: l1.items.concat(l2.items, l4.items, l5.items, l3.items),
  figures: l1.figures.concat(l2.figures, l4.figures, l5.figures, l3.figures),
};

// The interleave rule validate-pack enforces: the first `questions` ids must cover every item type
// the level carries, because a fresh profile is served that slice verbatim. This level is all mc,
// so the rule is satisfied by construction; the assertion is here so a later level cannot quietly
// break it.
for (const lv of pack.levels) {
  const types = new Set(lv.itemIds.map((id) => pack.items.find((i) => i.id === id).type));
  const firstTypes = new Set(lv.itemIds.slice(0, lv.questions).map((id) => pack.items.find((i) => i.id === id).type));
  if (firstTypes.size !== types.size) {
    throw new Error(`cc1-pack-gen: level ${lv.id}'s first ${lv.questions} ids cover ${firstTypes.size} of ${types.size} item types; interleave the list`);
  }
}

const checkOnly = process.argv.includes('--check');
const svgs = new Map();
for (const f of pack.figures) {
  if (f.genKind === 'polygon') svgs.set(path.join(ART_DIR, path.basename(f.src)), genPolygon(f.dataTable, ACCENT));
  else if (f.genKind === 'dots') svgs.set(path.join(ART_DIR, path.basename(f.src)), genDots(f.dataTable, ACCENT));
  else if (f.gen === true) svgs.set(path.join(ART_DIR, path.basename(f.src)), genSvg(f.dataTable, ACCENT));
}
const packText = JSON.stringify(pack, null, 1) + '\n';

if (checkOnly) {
  let stale = [];
  if (!fs.existsSync(PACK_PATH) || fs.readFileSync(PACK_PATH, 'utf8').split('\r\n').join('\n') !== packText) stale.push('packs/cpm-cc1-g6.json');
  for (const [p, svg] of svgs) {
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8').split('\r\n').join('\n') !== svg) stale.push(path.relative(ROOT, p));
  }
  if (stale.length) {
    console.error('cc1-pack-gen --check: STALE:\n  ' + stale.join('\n  ') + '\n  Run: node build/cc1-pack-gen.js');
    process.exit(1);
  }
  console.log(`cc1-pack-gen --check: pack and ${svgs.size} figure(s) match a fresh build.`);
  process.exit(0);
}

fs.mkdirSync(ART_DIR, { recursive: true });
fs.writeFileSync(PACK_PATH, packText);
for (const [p, svg] of svgs) fs.writeFileSync(p, svg);

console.log(`wrote packs/cpm-cc1-g6.json`);
console.log(`  ${pack.levels.length} level(s), ${pack.items.length} item(s), ${pack.figures.length} figure(s), ${svgs.size} SVG(s) into art/cpm-cc1-g6/`);
for (const lv of pack.levels) console.log(`  L${lv.id} ${lv.name}: ${lv.itemIds.length} items, ${lv.questions} per play`);
