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
// Assemble.
// ---------------------------------------------------------------------------
const l1 = buildLevel1();

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
  ],
  items: l1.items,
  figures: l1.figures,
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
