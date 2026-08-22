'use strict';
// figure-reconcile.js -- the gate WP2 needs and nothing else provides.
//
//   node tests/figure-reconcile.js
//
// A geometry figure carries its own numbers. A figure whose labelled sides disagree with the item's
// own answer is wrong in a way validate-pack cannot see: the JSON is well formed, the answer is an
// integer in the choice list, the distractors all have rationales, and NOTHING relates the picture
// to the arithmetic beside it. tests/figure-derive.js already solves the equivalent problem for
// charts by parsing the emitted markup against the source data; this extends the same idea to
// polygons, and adds the half charts never needed: reconciling the figure against the ITEM.
//
// FIVE CHECKS. The third and the fifth exist nowhere else, and the fifth was added after blind
// certification caught a content error the first four could not see.
//
//   1. REPRODUCIBILITY.  Every committed SVG regenerates byte-identically from its own dataTable.
//   2. INTERNAL CONSISTENCY.  Every side's LABEL agrees with the shape actually drawn: the drawn
//      edge lengths, scaled by one common factor, match the labelled lengths. That catches a
//      figure that says 6 cm on an edge drawn the length of its 4 cm neighbour, which is a lie a
//      child can SEE and no arithmetic check would ever notice.
//   3. THE ITEM AGREES WITH ITS FIGURE.  For every item whose stem asks for a perimeter, the
//      keyed answer is re-derived from the committed dataTable, independently of the generator
//      that produced both, and must equal it.
//   4. NO DISTRACTOR IS SECRETLY CORRECT.  A wrong option that also equals the true perimeter is
//      an unanswerable item.
//   5. A SHAPE'S NAME AGREES WITH ITS GEOMETRY.  A triangle called acute must actually be acute.
//      Blind certification caught a 12-9-7 triangle labelled acute whose largest angle is 96.4
//      degrees, and would have marked the right answer wrong;  a second, quieter one labelled
//      7-7-9.9 "right" is obtuse by a hundredth and looks identical to a right angle. Same defect
//      class as a side label that disagrees with its edge, arriving through the NAME instead.
//
// HARD RULES (constraint 12). A run that finds zero polygon figures FAILS rather than reporting
// clean, and so does one that reconciles zero perimeter items or zero shape names. That last
// counter earned its place immediately: check 5 was first appended AFTER checks 3 and 4, where it
// silently never ran, and only the arming counter said so. A check that never runs is worse than no
// check, because it reads as coverage. Each check also carries fixture controls, including a
// deliberately falsified side label and the exact 12-9-7 triangle the blind pass rejected.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const fs = require('fs');
const path = require('path');
const { genPolygon, labelledPerimeter, drawnPerimeter } = require('../build/polygon-gen');

const ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'packs');
const ACCENT_BY_PACK = { 'cpm-cc1-g6': '#e0692b' };

const problems = [];
const notes = [];
let figuresChecked = 0, itemsChecked = 0, packsWithPolygons = 0, nameChecks = 0;

// A triangle's true classification, from its side lengths alone. The largest side against the
// other two decides the angle; the count of distinct lengths decides the sides.
function trueTriangleNames(lens) {
  const [a, b, c] = lens.slice().sort((x, y) => x - y);
  const lhs = c * c, rhs = a * a + b * b;
  const byAngle = Math.abs(lhs - rhs) < 1e-9 ? 'right' : (lhs > rhs ? 'obtuse' : 'acute');
  const u = new Set(lens).size;
  return { byAngle, bySide: u === 1 ? 'equilateral' : u === 2 ? 'isosceles' : 'scalene' };
}

// The perimeter an ITEM claims, read out of its own keyed choice. Deliberately parsed from the
// shipped choice string rather than taken from any build-time variable: this has to be able to
// disagree with the generator, or it is measuring the generator against itself.
function keyedNumber(item) {
  if (item.type !== 'mc' || !Array.isArray(item.choices)) return null;
  const c = item.choices[item.key];
  if (typeof c !== 'string') return null;
  const m = c.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:[a-z]+)?\s*$/i);
  return m ? Number(m[1]) : null;
}

for (const f of fs.readdirSync(PACK_DIR).filter((x) => x.endsWith('.json') && !x.endsWith('.verdicts.json') && x !== 'manifest.json' && x !== 'curriculum-cc1.json')) {
  const packId = f.replace(/\.json$/, '');
  let pack;
  try { pack = JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8')); }
  catch (e) { problems.push(`${packId}: unreadable (${e.message})`); continue; }
  const polys = (pack.figures || []).filter((x) => x && x.genKind === 'polygon');
  if (!polys.length) continue;
  packsWithPolygons++;
  const accent = ACCENT_BY_PACK[packId];
  if (!accent) {
    problems.push(`${packId} ships polygon figures but has no accent colour in ACCENT_BY_PACK, so its SVGs cannot be regenerated for comparison`);
    continue;
  }
  const itemsByFig = new Map();
  for (const it of pack.items || []) {
    if (!it.figureId) continue;
    if (!itemsByFig.has(it.figureId)) itemsByFig.set(it.figureId, []);
    itemsByFig.get(it.figureId).push(it);
  }

  for (const fig of polys) {
    figuresChecked++;
    const where = `${packId}/${fig.id}`;
    const dt = fig.dataTable;
    if (!dt) { problems.push(`${where}: genKind "polygon" with no dataTable, so nothing can be reconciled against it`); continue; }

    // ---- 1. reproducibility ----
    const file = path.join(ROOT, fig.src);
    if (!fs.existsSync(file)) { problems.push(`${where}: src ${fig.src} is not on disk`); continue; }
    const onDisk = fs.readFileSync(file, 'utf8').split('\r\n').join('\n');
    let fresh;
    try { fresh = genPolygon(dt, accent); }
    catch (e) { problems.push(`${where}: regenerating threw (${e.message})`); continue; }
    if (onDisk !== fresh) {
      problems.push(`${where}: the committed SVG does not match a fresh render of its own dataTable. Run: node build/cc1-pack-gen.js`);
    }

    // ---- 2. the labels agree with the shape actually drawn ----
    const labelled = labelledPerimeter(dt);
    const drawn = drawnPerimeter(dt);
    const k = drawn / labelled;                 // one scale factor for the whole figure
    const offenders = [];
    for (let i = 0; i < dt.sides.length; i++) {
      const a = dt.vertices[i], b = dt.vertices[(i + 1) % dt.vertices.length];
      const drawnLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const expect = dt.sides[i].len * k;
      // 2% of the figure's own scale. Tighter than any drawing error a human would make and looser
      // than float noise.
      if (Math.abs(drawnLen - expect) > expect * 0.02) {
        offenders.push(`side ${i} is labelled ${dt.sides[i].len} but is drawn ${(drawnLen / k).toFixed(2)} at the figure's own scale`);
      }
    }
    if (offenders.length) {
      problems.push(`${where}: the drawing disagrees with its own labels, which is a lie a child can SEE: ${offenders.join('; ')}`);
    }

    // ---- 5. a shape's NAME against its geometry ----
    // Placed before checks 3 and 4 rather than after them, deliberately: appended after that loop
    // it silently never ran, and a check that never runs is worse than no check at all. Its own
    // ARMING counter is what surfaced that.
    if (dt.shape === 'triangle') {
      const truth = trueTriangleNames(dt.sides.map((x) => x.len));
      const drawnRight = Array.isArray(dt.rightAngles) && dt.rightAngles.length > 0;
      if (drawnRight !== (truth.byAngle === 'right')) {
        problems.push(`${where}: the figure ${drawnRight ? 'draws a right-angle mark' : 'draws no right-angle mark'} `
          + `but its sides (${dt.sides.map((x) => x.len).join(', ')}) make it ${truth.byAngle}`);
      }
      for (const nameItem of itemsByFig.get(fig.id) || []) {
        if (!Array.isArray(nameItem.choices) || typeof nameItem.key !== 'number') continue;
        const claim = String(nameItem.choices[nameItem.key]).trim().toLowerCase();
        const stem = String(nameItem.stem || '');
        if (/angle/i.test(stem) && ['acute', 'right', 'obtuse'].includes(claim)) {
          nameChecks++;
          if (claim !== truth.byAngle) {
            problems.push(`${packId}/${nameItem.id}: keyed to "${claim}", but sides ${dt.sides.map((x) => x.len).join(', ')} `
              + `make this triangle ${truth.byAngle}. The item would mark the right answer wrong.`);
          }
        } else if (/side/i.test(stem) && ['scalene', 'isosceles', 'equilateral'].includes(claim)) {
          nameChecks++;
          if (claim !== truth.bySide) {
            problems.push(`${packId}/${nameItem.id}: keyed to "${claim}", but sides ${dt.sides.map((x) => x.len).join(', ')} `
              + `make this triangle ${truth.bySide}.`);
          }
        }
      }
    }

    // ---- 3 and 4. the items agree with the figure ----
    for (const it of itemsByFig.get(fig.id) || []) {
      const asksPerimeter = /perimeter/i.test(String(it.stem || '')) && !/which calculation|missing/i.test(String(it.stem || ''));
      if (!asksPerimeter) continue;
      itemsChecked++;
      const claimed = keyedNumber(it);
      if (claimed == null) {
        problems.push(`${packId}/${it.id}: asks for a perimeter but its keyed choice is not a number, so nothing can be reconciled`);
        continue;
      }
      if (claimed !== labelled) {
        problems.push(`${packId}/${it.id}: the keyed answer is ${claimed}, but the figure's own labels add to ${labelled}. `
          + 'The picture and the answer disagree, and no other gate can see it.');
      }
      for (let i = 0; i < it.choices.length; i++) {
        if (i === it.key) continue;
        const n = keyedNumber({ type: 'mc', choices: it.choices, key: i });
        if (n === labelled) {
          problems.push(`${packId}/${it.id}: distractor ${i} (${JSON.stringify(it.choices[i])}) also equals the true perimeter ${labelled}, so the item has two correct answers`);
        }
      }
    }

  }
}

// ---- ARMING ----
if (!figuresChecked) {
  problems.push('ARMING: zero polygon figures were found, so this gate measured nothing. If the math pack '
    + 'has been removed, remove this gate with it; if it has not, the genKind marker has drifted.');
}
if (!itemsChecked) {
  problems.push('ARMING: zero perimeter items were reconciled against a figure, so check 3, the only one '
    + 'no other gate performs, ran on nothing.');
}
if (!nameChecks) {
  problems.push('ARMING: zero shape-name claims were re-derived from a figure, so check 5 ran on nothing. '
    + 'That is the check that caught a triangle labelled acute at 96.4 degrees.');
}

// ---- CONTROLS ----
const controls = [];
{
  // A correct fixture: a 6-8-10 right triangle, drawn to scale, labelled honestly.
  const good = {
    shape: 'triangle', units: 'cm',
    vertices: [[0, 8], [6, 8], [0, 0]],
    sides: [{ label: '6 cm', len: 6 }, { label: '10 cm', len: 10 }, { label: '8 cm', len: 8 }],
  };
  const kGood = drawnPerimeter(good) / labelledPerimeter(good);
  const goodOk = good.sides.every((s, i) => {
    const a = good.vertices[i], b = good.vertices[(i + 1) % good.vertices.length];
    return Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - s.len * kGood) <= s.len * kGood * 0.02;
  });
  controls.push({ name: 'POSITIVE: an honestly labelled figure passes the label-versus-drawing check', ok: goodOk });

  // The same triangle with ONE label falsified: the 8 cm side relabelled 14 cm. The perimeter
  // arithmetic still works out to a whole number, and validate-pack sees nothing wrong at all.
  const bad = JSON.parse(JSON.stringify(good));
  bad.sides[2] = { label: '14 cm', len: 14 };
  const kBad = drawnPerimeter(bad) / labelledPerimeter(bad);
  const caught = bad.sides.some((s, i) => {
    const a = bad.vertices[i], b = bad.vertices[(i + 1) % bad.vertices.length];
    return Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - s.len * kBad) > s.len * kBad * 0.02;
  });
  controls.push({
    name: 'NEGATIVE: one falsified side label is caught by the label-versus-drawing check',
    ok: caught,
    detail: 'an 8 cm side relabelled 14 cm, drawn unchanged',
  });

  // An item whose key disagrees with its figure.
  const fakeItem = { type: 'mc', choices: ['24 cm', '30 cm', '18 cm', '26 cm'], key: 1 };
  controls.push({
    name: 'NEGATIVE: an item keyed to the wrong number is caught by the item-versus-figure check',
    ok: keyedNumber(fakeItem) !== labelledPerimeter(good),
    detail: `keyed ${keyedNumber(fakeItem)} against a true perimeter of ${labelledPerimeter(good)}`,
  });

  // And the number parser must actually parse, or check 3 passes vacuously on everything.
  // The classifier must be able to call the real error the blind pass caught.
  controls.push({
    name: 'NEGATIVE: a 12-9-7 triangle is correctly read as obtuse, not acute',
    ok: trueTriangleNames([12, 9, 7]).byAngle === 'obtuse',
    detail: 'the exact spec blind certification rejected; its largest angle is 96.4 degrees',
  });
  controls.push({
    name: 'CONTROL: the classifier separates all three angle names and all three side names',
    ok: trueTriangleNames([6, 8, 10]).byAngle === 'right'
      && trueTriangleNames([7, 8, 9]).byAngle === 'acute'
      && trueTriangleNames([8, 8, 8]).bySide === 'equilateral'
      && trueTriangleNames([4, 9, 9]).bySide === 'isosceles'
      && trueTriangleNames([7, 8, 9]).bySide === 'scalene',
    detail: 'right, acute, equilateral, isosceles and scalene each read back correctly',
  });
  controls.push({
    name: 'CONTROL: the keyed-answer parser reads a real choice string',
    ok: keyedNumber({ type: 'mc', choices: ['26 cm'], key: 0 }) === 26 && keyedNumber({ type: 'mc', choices: ['not a number'], key: 0 }) === null,
    detail: 'reads "26 cm" as 26 and refuses "not a number"',
  });
}
for (const c of controls) if (!c.ok) problems.push(`CONTROL "${c.name}" failed${c.detail ? ' (' + c.detail + ')' : ''}; every result above is void`);

// ---- report ----
console.log('\n=== figure reconcile: the drawing, its labels, and the item ===');
console.log(`${packsWithPolygons} pack(s) with polygon figures, ${figuresChecked} figure(s) regenerated and checked, `
  + `${itemsChecked} perimeter item(s) and ${nameChecks} shape-name claim(s) reconciled against their own figure`);
for (const n of notes) console.log('  ' + n);
console.log('controls:');
for (const c of controls) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);

if (problems.length) {
  console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nRESULT: FAIL');
  process.exit(1);
}
console.log(`\nRESULT: ALL CLEAN (${figuresChecked} figures, ${itemsChecked} items, ${controls.length} controls)`);
process.exit(0);
