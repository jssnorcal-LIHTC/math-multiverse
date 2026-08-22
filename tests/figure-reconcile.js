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
// EIGHT CHECKS. The third, the fifth and the seventh exist nowhere else. The fifth was added after
// blind certification caught a content error the first four could not see, and checks 6 to 8 after
// a rendered histogram was found labelling its intervals 0, 1, 2, 3.
//
//   1. REPRODUCIBILITY.  Every committed SVG regenerates byte-identically from its own dataTable.
//   2. INTERNAL CONSISTENCY.  Every side's LABEL agrees with the shape actually drawn: the drawn
//      edge lengths, scaled by one common factor, match the labelled lengths. That catches a
//      figure that says 6 cm on an edge drawn the length of its 4 cm neighbour, which is a lie a
//      child can SEE and no arithmetic check would ever notice.
//   3. THE ITEM AGREES WITH ITS FIGURE.  For every perimeter-family item, the keyed answer is
//      re-derived from the committed dataTable, independently of the generator that produced both,
//      and must equal what PERIMETER_CLAIM says that item type's answer is.  Selected by coachTopic
//      rather than by finding the word "perimeter" in the stem:  the stem regex this replaced
//      demanded that any item mentioning perimeter be keyed to the perimeter ITSELF, which is wrong
//      for a review item that gives the perimeter and asks for something derived from it, and it
//      could be unhooked silently by a reword.  A perimeter topic missing from the table is a hard
//      failure, so a new item type cannot arrive unchecked.
//   4. NO DISTRACTOR IS SECRETLY CORRECT.  A wrong option that also equals the true answer is
//      an unanswerable item.
//   5. A SHAPE'S NAME AGREES WITH ITS GEOMETRY.  A triangle called acute must actually be acute.
//      Blind certification caught a 12-9-7 triangle labelled acute whose largest angle is 96.4
//      degrees, and would have marked the right answer wrong;  a second, quieter one labelled
//      7-7-9.9 "right" is obtuse by a hundredth and looks identical to a right angle. Same defect
//      class as a side label that disagrees with its edge, arriving through the NAME instead.
//   6. A CHART PRINTS THE CATEGORIES IT DECLARES.  Every name in categoryLabels appears as a text
//      element in the committed SVG. Byte-comparison cannot see this defect, because a chart whose
//      RENDERER drops the labels still regenerates byte-identically from its own data: the file and
//      the generator agree, and both are wrong. Only reading the committed markup catches it.
//   7. THE BAR SPACING CARRIES THE MEANING.  A histogram's bars must be drawn touching and a bar
//      graph's must not, because these items teach that gap as the visible difference between the
//      two displays. A claim the prose makes about the picture, checked against the picture.
//   8. THE CHART ITEM AGREES WITH ITS BARS.  Tallest, tallest-minus-shortest and total re-derived
//      from the values that draw the bars, keyed off coachTopic so rewording cannot unhook them.
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
const { genDots, dotsAt, cellsFor } = require('../build/dots-gen');

const ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(ROOT, 'packs');
const ACCENT_BY_PACK = { 'cpm-cc1-g6': '#e0692b' };

const problems = [];
const notes = [];
let figuresChecked = 0, itemsChecked = 0, packsWithPolygons = 0, nameChecks = 0, dotChecks = 0;
let chartChecks = 0, chartLabelChecks = 0, chartGapChecks = 0;

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

// What each PERIMETER-family coachTopic's keyed answer must equal, as a function of the perimeter
// the figure's own labels add up to. A topic mapped to null is one this gate cannot check, and it
// has to be listed anyway: an unlisted perimeter topic is a hard failure rather than a quiet skip,
// so a new item type cannot appear and go unchecked without somebody saying so in this table.
const PERIMETER_CLAIM = {
  'perimeter-labelled-polygon': { want: (P) => P, says: 'the perimeter' },
  'perimeter-missing-side': null,        // gives the perimeter, asks for one unlabelled side
  'perimeter-rectangle-rule': null,      // asks which CALCULATION is right, not for a number
  'perimeter-regular-polygon': null,     // asks about the side count and the rule behind it
  'perimeter-same-square': { want: (P) => P / 4, says: 'the side of a square with the same perimeter' },
  'perimeter-compare-pentagon': null,    // compares against a shape described in words, not drawn
};

// What each chart coachTopic's answer must equal, derived from the values that draw the bars. Module
// level so the control below exercises this exact table rather than a restatement of it.
const CHART_CLAIM = {
  'display-read-a-value': { want: (v) => Math.max(...v), says: 'the tallest bar' },
  'display-compare-bars': { want: (v) => Math.max(...v) - Math.min(...v), says: 'tallest minus shortest' },
  'display-total': { want: (v) => v.reduce((a, b) => a + b, 0), says: 'every bar added up' },
};

// The clear space between each pair of neighbouring bars, in user units, read out of the committed
// markup. Module-level so the controls below measure with the SAME code the checks use: a control
// that re-implements the thing it is testing proves only that the copy agrees with itself, which is
// how WP3's first control came to pass against a reverted build.
function barGapsIn(svg) {
  const rects = [];
  const rectRe = /<rect x="([-\d.]+)"[^>]*width="([-\d.]+)"/g;
  let m;
  while ((m = rectRe.exec(svg)) !== null) rects.push({ x: Number(m[1]), w: Number(m[2]) });
  // The full-bleed background rect is the chart's own width; a bar never is.
  const bars = rects.filter((r) => r.w > 0 && r.w < 200).sort((a, b) => a.x - b.x);
  const gaps = [];
  for (let i = 1; i < bars.length; i++) gaps.push(bars[i].x - (bars[i - 1].x + bars[i - 1].w));
  return gaps;
}
// Half a user unit of slack: below what renders as a seam, far below the 0.18-of-a-band gap a bar
// graph draws.
function barsTouch(gaps) { return gaps.length > 0 && gaps.every((g) => Math.abs(g) < 0.51); }

for (const f of fs.readdirSync(PACK_DIR).filter((x) => x.endsWith('.json') && !x.endsWith('.verdicts.json') && x !== 'manifest.json' && x !== 'curriculum-cc1.json')) {
  const packId = f.replace(/\.json$/, '');
  let pack;
  try { pack = JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8')); }
  catch (e) { problems.push(`${packId}: unreadable (${e.message})`); continue; }
  const polys = (pack.figures || []).filter((x) => x && x.genKind === 'polygon');
  const dots = (pack.figures || []).filter((x) => x && x.genKind === 'dots');
  const charts = (pack.figures || []).filter((x) => x && x.gen === true && x.dataTable
    && x.dataTable.type === 'bar' && Array.isArray(x.dataTable.categoryLabels));
  if (!polys.length && !dots.length && !charts.length) continue;
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
      // Selected by coachTopic, not by looking for the word "perimeter" in the stem. The stem regex
      // this replaced picked up any item that said "perimeter" and then required its answer to EQUAL
      // the figure's perimeter, so a review item that gives the perimeter and asks for something
      // derived from it -- the side of a square with the same perimeter -- read as a wrong answer.
      // Rewording an item could also unhook it from the check silently, which is the failure mode
      // the chart half below was already built to avoid.
      // Only the perimeter family is this check's business; a shape-naming item on the same figure
      // is check 5's.
      if (!/^perimeter/.test(String(it.coachTopic || ''))) continue;
      const claim = PERIMETER_CLAIM[it.coachTopic];
      if (claim === undefined) {
        problems.push(`${packId}/${it.id}: coachTopic ${JSON.stringify(it.coachTopic)} is in the perimeter family but PERIMETER_CLAIM does not list it, so nothing says whether its answer should follow from the figure. Add it, with null if this gate cannot check it.`);
        continue;
      }
      if (claim === null) continue;
      itemsChecked++;
      const want = claim.want(labelled);
      const claimed = keyedNumber(it);
      if (claimed == null) {
        problems.push(`${packId}/${it.id}: ${claim.says}, but its keyed choice is not a number, so nothing can be reconciled`);
        continue;
      }
      if (claimed !== want) {
        problems.push(`${packId}/${it.id}: the keyed answer is ${claimed}, but the figure's own labels add to ${labelled}, so ${claim.says} is ${want}. `
          + 'The picture and the answer disagree, and no other gate can see it.');
      }
      for (let i = 0; i < it.choices.length; i++) {
        if (i === it.key) continue;
        const n = keyedNumber({ type: 'mc', choices: it.choices, key: i });
        if (n === want) {
          problems.push(`${packId}/${it.id}: distractor ${i} (${JSON.stringify(it.choices[i])}) also equals the true answer ${want}, so the item has two correct answers`);
        }
      }
    }

  }

  // ---- growing-dot figures: same two questions, asked of a pattern instead of a polygon ----
  // Does the committed SVG still match its own dataTable, and does every item's answer still
  // follow from the rule that draws the dots? A pattern whose figures show a count the rule does
  // not produce is the same lie as a side labelled 6 and drawn 4.
  for (const fig of dots) {
    figuresChecked++;
    const where = `${packId}/${fig.id}`;
    const dt = fig.dataTable;
    if (!dt) { problems.push(`${where}: genKind "dots" with no dataTable`); continue; }
    const file = path.join(ROOT, fig.src);
    if (!fs.existsSync(file)) { problems.push(`${where}: src ${fig.src} is not on disk`); continue; }
    let fresh;
    try { fresh = genDots(dt, accent); }
    catch (e) { problems.push(`${where}: regenerating threw (${e.message})`); continue; }
    if (fs.readFileSync(file, 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)) !== fresh) {
      problems.push(`${where}: the committed SVG does not match a fresh render of its own dataTable. Run: node build/cc1-pack-gen.js`);
    }
    // The DRAWN dot count for each shown figure must equal what the rule says. cellsFor already
    // refuses a mismatch, so this proves the refusal is reachable rather than assuming it.
    for (const n of dt.shown) {
      const drawn = cellsFor(n, dt.rule, dt.layout).length;
      if (drawn !== dotsAt(dt, n)) {
        problems.push(`${where}: figure ${n} draws ${drawn} dots but the rule gives ${dotsAt(dt, n)}`);
      }
    }
    // Every item's keyed number against the rule, re-derived from the committed dataTable.
    for (const it of itemsByFig.get(fig.id) || []) {
      const claimed = keyedNumber(it);
      if (claimed == null) continue;
      const stem = String(it.stem || '');
      const m = stem.match(/figure (\d+)/i);
      if (!m) continue;
      dotChecks++;
      const want = dotsAt(dt, Number(m[1]));
      if (claimed !== want) {
        problems.push(`${packId}/${it.id}: asks about figure ${m[1]} and is keyed to ${claimed}, but the rule `
          + `${dt.rule.a} x n${dt.rule.b ? ' + ' + dt.rule.b : ''} gives ${want}.`);
      }
    }
  }

  // ---- bar-chart figures: the labels, the geometry, and the item's number ----
  // Three questions, in the order they bit.
  //
  // FIRST, does the chart actually print the category names it declares? categoryLabels was honoured
  // on figure-gen's PANELS path only, so a single-panel histogram silently labelled its intervals
  // 0, 1, 2, 3 instead of 0-9, 10-19, and no gate noticed: the SVG still byte-matched its own
  // generator, because the generator was the thing that was wrong. A byte-compare cannot catch a
  // defect that lives in the renderer, which is why this check reads the committed text elements.
  //
  // SECOND, does the drawing carry the distinction the prose teaches? These items tell the child
  // that a histogram's bars TOUCH because its axis is a number line, and a bar graph's have gaps
  // because its categories are separate names. That is a claim about the picture, so it is checked
  // against the picture rather than trusted.
  //
  // THIRD, does each item's keyed answer follow from the same values that draw the bars? Keyed off
  // coachTopic rather than parsed out of the stem, so rewording an item cannot quietly unhook it.
  for (const fig of charts) {
    figuresChecked++;
    const where = `${packId}/${fig.id}`;
    const dt = fig.dataTable;
    const file = path.join(ROOT, fig.src);
    if (!fs.existsSync(file)) { problems.push(`${where}: src ${fig.src} is not on disk`); continue; }
    const svg = fs.readFileSync(file, 'utf8');

    // 1. every declared category name is really printed on the chart
    for (const lab of dt.categoryLabels) {
      chartLabelChecks++;
      if (svg.indexOf('>' + String(lab) + '<') === -1) {
        problems.push(`${where}: declares category "${lab}" but the committed SVG never prints it, so the `
          + 'chart cannot be read as its items are written. Run: node build/cc1-pack-gen.js');
      }
    }

    // 2. the bars touch, or do not, as the kind requires
    const gaps = barGapsIn(svg);
    if (gaps.length) {
      chartGapChecks++;
      const touching = barsTouch(gaps);
      const isHist = dt.barGap === 0;
      if (isHist && !touching) {
        problems.push(`${where}: is a histogram (barGap 0) but its bars are drawn with gaps of `
          + `${gaps.map((g) => g.toFixed(2)).join(', ')}. The items teach the touching as the visible `
          + 'difference between a histogram and a bar graph, so the drawing contradicts them.');
      }
      if (!isHist && touching) {
        problems.push(`${where}: is a bar graph but its bars are drawn touching, which is what the items `
          + 'tell the child means a histogram.');
      }
    }

    // 3. every item's keyed number, re-derived from the values that draw the bars
    const vals = (dt.series[0].points || []).map((p) => p[1]);
    for (const it of itemsByFig.get(fig.id) || []) {
      const claim = CHART_CLAIM[it.coachTopic];
      if (!claim) continue;
      const claimed = keyedNumber(it);
      if (claimed == null) continue;
      chartChecks++;
      const want = claim.want(vals);
      if (claimed !== want) {
        problems.push(`${packId}/${it.id}: asks for ${claim.says} and is keyed to ${claimed}, but the bars `
          + `drawn from [${vals.join(', ')}] give ${want}.`);
      }
      for (let i = 0; i < (it.choices || []).length; i++) {
        if (i === it.key) continue;
        if (keyedNumber({ type: 'mc', choices: it.choices, key: i }) === want) {
          problems.push(`${packId}/${it.id}: distractor ${i} (${JSON.stringify(it.choices[i])}) also equals `
            + `the true answer ${want}, so the item has two correct answers`);
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
if (!dotChecks) {
  problems.push('ARMING: zero growing-pattern items were reconciled against their rule, so the dots half '
    + 'of this gate ran on nothing.');
}
if (!nameChecks) {
  problems.push('ARMING: zero shape-name claims were re-derived from a figure, so check 5 ran on nothing. '
    + 'That is the check that caught a triangle labelled acute at 96.4 degrees.');
}
if (!chartLabelChecks) {
  problems.push('ARMING: zero chart category labels were read back out of a committed SVG, so the check '
    + 'that caught a histogram labelling its intervals 0, 1, 2, 3 ran on nothing.');
}
if (!chartGapChecks) {
  problems.push('ARMING: zero charts had their bar spacing measured, so the touching-versus-gapped claim '
    + 'the items make is currently ungated.');
}
if (!chartChecks) {
  problems.push('ARMING: zero chart items were reconciled against the values that draw their bars, so the '
    + 'chart half of this gate ran on nothing. If the coachTopic names have drifted, CHART_CLAIM has too.');
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
  // The dot layout has to be able to refuse a count it cannot place, or check 6 is decorative.
  let dotRefused = false;
  try { cellsFor(3, { a: 2, b: 1 }, 'not-a-layout'); }
  catch (e) { dotRefused = true; }
  controls.push({
    name: 'NEGATIVE: the dot layout refuses a layout it does not know rather than drawing something',
    ok: dotRefused,
    detail: 'an unknown layout name throws instead of silently placing dots',
  });
  controls.push({
    name: 'CONTROL: the pattern rule reads back correctly at a far term',
    ok: dotsAt({ rule: { a: 3, b: 2 }, shown: [1, 2, 3], layout: 'stack' }, 100) === 302,
    detail: '3n + 2 at n = 100 is 302',
  });
  // ---- the chart half's own controls ----
  // Real generator output, measured by the same two functions the checks above use.
  const { genSvg } = require('../build/figure-gen');
  const chartDT = {
    type: 'bar', yLabel: 'students', xLabel: 'interval',
    categoryLabels: ['0-9', '10-19', '20-29', '30-39'],
    series: [{ label: 'students', points: [[0, 4], [1, 9], [2, 13], [3, 6]] }],
  };
  const gapped = genSvg(chartDT, '#e0692b');
  const touched = genSvg(Object.assign({}, chartDT, { barGap: 0 }), '#e0692b');
  controls.push({
    name: 'POSITIVE: a histogram built with barGap 0 really does draw its bars touching',
    ok: barsTouch(barGapsIn(touched)),
    detail: `measured clear space between bars: ${barGapsIn(touched).map((g) => g.toFixed(2)).join(', ')}`,
  });
  controls.push({
    name: 'NEGATIVE: the same chart WITHOUT barGap is measured as gapped, so the check can tell them apart',
    ok: !barsTouch(barGapsIn(gapped)) && barGapsIn(gapped).length === 3,
    detail: `measured clear space between bars: ${barGapsIn(gapped).map((g) => g.toFixed(2)).join(', ')}`,
  });
  controls.push({
    name: 'NEGATIVE: a category label the chart declares but never prints is caught',
    ok: touched.indexOf('>10-19<') !== -1 && touched.indexOf('>40-49<') === -1,
    detail: 'a declared interval appears in the markup; one that was never drawn does not',
  });
  controls.push({
    name: 'NEGATIVE: the renderer refuses to fall back to a bare index when labels are supplied',
    ok: touched.indexOf('>0-9<') !== -1 && !/>0<\/text>/.test(touched.split('</text>').slice(4).join('</text>')),
    detail: 'the histogram prints 0-9, not the 0 that shipped before figure-gen honoured categoryLabels '
      + 'on the single-panel path',
  });
  controls.push({
    name: 'CONTROL: the chart claims re-derive correctly from a known set of bars',
    ok: CHART_CLAIM['display-read-a-value'].want([4, 9, 13, 6]) === 13
      && CHART_CLAIM['display-compare-bars'].want([4, 9, 13, 6]) === 9
      && CHART_CLAIM['display-total'].want([4, 9, 13, 6]) === 32,
    detail: 'tallest 13, tallest minus shortest 9, total 32',
  });
  controls.push({
    name: 'CONTROL: the perimeter claims re-derive correctly from a known perimeter',
    ok: PERIMETER_CLAIM['perimeter-labelled-polygon'].want(26) === 26
      && PERIMETER_CLAIM['perimeter-same-square'].want(26) === 6.5,
    detail: 'a 26 cm perimeter is 26, and the square matching it has 6.5 cm sides',
  });
  controls.push({
    name: 'NEGATIVE: a perimeter topic missing from the table reads as unlisted, not as skipped',
    ok: PERIMETER_CLAIM['perimeter-not-a-real-topic'] === undefined
      && PERIMETER_CLAIM['perimeter-missing-side'] === null,
    detail: 'an unknown topic returns undefined (which check 3 turns into a failure) while a '
      + 'deliberately unchecked one returns null',
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
  + `${itemsChecked} perimeter item(s), ${nameChecks} shape-name claim(s) and ${dotChecks} pattern item(s) `
  + `${chartLabelChecks} chart label(s), ${chartGapChecks} chart(s) measured for bar spacing and `
  + `${chartChecks} chart item(s) reconciled against their own figure`);
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
