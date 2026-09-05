'use strict';
// figure-prose.js -- the gate that links an item's PROSE ABOUT THE PICTURE to the picture.
//
// WHY IT EXISTS. Night Rounds needed four review rounds. Every defect any of them found had one
// cause: a figure was edited and the items describing that figure were not re-read. Nothing in the
// build could see it. figure-fidelity checks that every LABEL is verbatim in the passage, so it
// stays green when a label is deleted. figure-derive checks the SVG is derivable from the
// dataTable, so it stays green when the dataTable changes. The blind certifier is shown the
// dataTable, so it cannot notice that an item's DESCRIPTION of the drawing has gone stale, and it
// returned "agree at high confidence" on an item that had become unanswerable.
//
// This gate closes the part of that hole a machine can close. Three checks:
//
//   1. COUNTS. "Three arrows run down the page" is a claim about the drawing, and the drawing's
//      element counts are derivable from the dataTable. A claim of more than exists FAILS.
//      A totality verb ("the plan stacks five boxes") requires EXACT equality.
//   2. EMPTINESS. "the row left blank", "nothing follows it" is a claim that the figure draws an
//      empty field, and a figure can only draw one if its dataTable says so. Without an explicit
//      blank marker the claim FAILS -- which is the check that would have caught the transfer slip
//      through all four of its wrong drawings.
//   3. VOCABULARY. A stem may not name a drawing device by its draughtsman's name ("the hatched
//      band", "the connector", "the node"). An eleven-year-old reads pictures, not draughting.
//
// WHAT IT DOES NOT COVER, said plainly rather than left to be discovered. A count claim of FEWER
// elements than exist passes: "three arrows" is true of a drawing with four. The asymmetry is
// deliberate, because "one arrow is labelled X" is a legitimate sentence about one of several. The
// dominant failure in practice is an element being REMOVED by a pixel fix, and that direction is
// caught. Spatial claims ("above", "between", "at the far corner") are not checked at all: they
// depend on layout the dataTable does not fix. Those remain the fidelity reviewers' work.

const path = require('path');
const { loadPackFile } = require('./validate-pack.js');

const PACKS_DIR = path.join(__dirname, '..', 'packs');
const fs = require('fs');

// ------------------------------------------------------------------------------------------
// what the drawing actually contains, per countable noun, derived from the dataTable
// ------------------------------------------------------------------------------------------
const len = (a) => (Array.isArray(a) ? a.length : 0);

const COUNTERS = {
  arrow: (dt) => len(dt.edges),
  box: (dt) => len(dt.nodes),
  node: (dt) => len(dt.nodes),
  lane: (dt) => (len(dt.tracks) || (dt.events ? 1 : 0)),
  track: (dt) => (len(dt.tracks) || (dt.events ? 1 : 0)),
  // IN A TABLE, "ROWS" MEANS THE TABLE'S ROWS.  This used to read len(dt.lines) || len(dt.rowLabels),
  // which is blind to a columns-style facsimile, where the rows live inside each column.  On
  // fig-l3-three-seconds that counted the 2 free-standing lines above the table and reported the
  // drawing as having 2 rows, so a correct sentence -- Theo's column does hold three row texts --
  // was called an over-claim.  A gate that reddens correct prose gets prose rewritten to suit it,
  // which is the wrong direction of travel.  Column rows win where a table has them;  the free
  // lines and the row labels stay as the fallback for a card that is not a table.
  row: (dt) => ((dt.columns || []).reduce((m, c) => Math.max(m, len(c.rows)), 0)
    || len(dt.lines) || len(dt.rowLabels)),
  column: (dt) => len(dt.columns),
  stop: (dt) => len(dt.stops),
  bar: (dt) => (len(dt.categoryLabels) || len((dt.series && dt.series[0] && dt.series[0].values) || [])),
  step: (dt) => len(dt.events),
  event: (dt) => len(dt.events),
  entry: (dt) => (len(dt.events) || len(dt.lines)),
};

const NOUNS = Object.keys(COUNTERS);
const PLURAL = { box: 'boxes', entry: 'entries' };
const pluralOf = (n) => PLURAL[n] || (n + 's');

const NUMBER = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

// A verb that makes the count a claim about the WHOLE drawing rather than about some of it.
const TOTALITY = '(?:draws|drawn as|stacks|shows|has|have|carries|contains|joins|runs|sets out|lists)';

// ------------------------------------------------------------------------------------------
// every user-visible string on an item, wherever it lives
// ------------------------------------------------------------------------------------------
const SKIP_KEYS = new Set([
  'id', 'type', 'passageId', 'figureId', 'figureFact', 'targets', 'coachTopic',
  'dok', 'key', 'src', 'level', 'kind', 'alt',
]);

function proseOf(node, where, out) {
  if (typeof node === 'string') { if (node.trim()) out.push({ where, text: node }); return out; }
  if (Array.isArray(node)) { node.forEach((v, i) => proseOf(v, `${where}[${i}]`, out)); return out; }
  if (node && typeof node === 'object') {
    Object.keys(node).forEach((k) => {
      if (SKIP_KEYS.has(k)) return;
      proseOf(node[k], where ? `${where}.${k}` : k, out);
    });
  }
  return out;
}

// The stem is what a child reads before anything else, so the vocabulary rule binds there and on
// the answer choices. An explain may name a device only after the child has already seen it.
const READER_FACING = /^(stem|choices|blanks|tiles|rowLabels|colLabels|pairs)/;

// ------------------------------------------------------------------------------------------
// checks
// ------------------------------------------------------------------------------------------
// Ban the CLAIM, not the string. "hatched" alone is what chicks do, and one of these packs has a
// seabird chart whose choices say so; only "hatched band" is draughting.
const BANNED_WORDS = [
  'hatched\\s+(?:band|area|region|strip|stretch|section|panel)',
  'cross-?hatch\\w*', 'connector', 'glyph', 'viewbox', 'tspan', 'polyline',
  'swimlane', 'ordinal axis', 'the node', 'a node', 'nodes',
  // Added after C4 round 5 found "Finish the description of the schematic." in a stem, on a figure
  // whose own caption says "The boxes run down the page" and whose sibling item opens "Two boxes sit
  // one above the other". Counted before banning, which is the rule that saved "labelled": across
  // every pack, "schematic" appears in exactly TWO reader-facing fields, both written by this
  // program, against 151 uses of "labelled" that made it this repo's own form. Two is not a
  // convention, it is a slip. The word is a document TYPE in a dataTable and belongs there; it is
  // not what a child calls the picture in front of them.
  'schematic', 'facsimile',
];

const EMPTY_CLAIM = new RegExp(
  '(?:'
  + 'left (?:blank|empty)|is blank|is empty|nothing (?:follows|written|after|beside|in it)'
  + '|no (?:name|entry|word|words) (?:follows|is written|at all)'
  + '|(?:blank|empty) (?:row|line|field|space)'
  + '|(?:row|line|field) (?:left )?(?:blank|empty)'
  + ')', 'i');

// A dataTable may only support an emptiness claim if it SAYS something is empty. These are the
// only two ways this schema can say it.
function drawsAnEmptyField(dt) {
  const hit = (o) => o && typeof o === 'object'
    && (o.emphasis === 'blank' || (typeof o.text === 'string' && o.text.trim() === ''));
  const walk = (n) => {
    if (Array.isArray(n)) return n.some(walk);
    if (n && typeof n === 'object') return hit(n) || Object.keys(n).some((k) => walk(n[k]));
    return false;
  };
  if (walk(dt)) return true;
  if (Array.isArray(dt.absences) && dt.absences.length > 0) return true;
  // A figure can also SAY it: a timeline whose 8 p.m. marker is labelled "nothing written on it"
  // asserts the absence in words, and an item may key on that.
  const says = (n) => {
    if (typeof n === 'string') return EMPTY_CLAIM.test(n);
    if (Array.isArray(n)) return n.some(says);
    if (n && typeof n === 'object') return Object.keys(n).some((k) => says(n[k]));
    return false;
  };
  return says(dt);
}

// A distractor is SUPPOSED to be false about the figure -- that is the whole job of a wrong answer.
// Counting or emptiness claims inside one are therefore not defects, and checking them would punish
// correct item design. Readability still binds on every choice a child reads.
function isFalseByDesign(item, where) {
  const mc = /^choices\[(\d+)\]/.exec(where);
  if (mc) {
    const i = parseInt(mc[1], 10);
    if (item.type === 'ms') return !(Array.isArray(item.key) && item.key.indexOf(i) !== -1);
    return item.key !== i;
  }
  const cz = /^blanks\[(\d+)\]\.choices\[(\d+)\]/.exec(where);
  if (cz) {
    const b = (item.blanks || [])[parseInt(cz[1], 10)];
    return !b || b.key !== parseInt(cz[2], 10);
  }
  return false;
}

function checkItem(item, fig, problems, tally) {
  const dt = fig.dataTable || {};
  const strings = proseOf(item, '', []);

  strings.forEach(({ where, text }) => {
    const decoy = isFalseByDesign(item, where);
    // ---- 1. counts
    if (!decoy) NOUNS.forEach((noun) => {
      const actual = COUNTERS[noun](dt);
      const word = `(?:${noun}|${pluralOf(noun)})`;
      const num = '(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+)';
      const re = new RegExp(`(${TOTALITY}\\s+)?${num}\\s+${word}\\b`, 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        const raw = m[2].toLowerCase();
        const claimed = NUMBER[raw] !== undefined ? NUMBER[raw] : parseInt(raw, 10);
        if (!Number.isFinite(claimed)) continue;
        // A noun the drawing has none of is not this figure's noun -- the sentence is about the
        // passage, not the picture. Counting it would be a false positive, so it is not counted.
        if (actual === 0) continue;
        tally.counts++;
        const total = Boolean(m[1]);
        if (claimed > actual) {
          problems.push(`${item.id} ${where}: claims ${claimed} ${pluralOf(noun)}, and ${fig.id} draws ${actual}`
            + `\n      "${m[0].trim()}"`);
        } else if (total && claimed !== actual) {
          problems.push(`${item.id} ${where}: "${m[1].trim()}" makes this a count of the whole drawing, `
            + `so ${claimed} ${pluralOf(noun)} must equal the ${actual} ${fig.id} draws`
            + `\n      "${m[0].trim()}"`);
        }
      }
    });

    // ---- 2. emptiness
    if (!decoy && EMPTY_CLAIM.test(text)) {
      tally.empties++;
      if (!drawsAnEmptyField(dt)) {
        problems.push(`${item.id} ${where}: claims the figure shows something empty, and ${fig.id}'s `
          + `dataTable carries no blank field (no emphasis:"blank", no empty text, no absences)`
          + `\n      "${text.trim().slice(0, 120)}"`);
      }
    }

    // ---- 3. vocabulary
    if (READER_FACING.test(where)) {
      BANNED_WORDS.forEach((w) => {
        const re = new RegExp(`\\b(?:${w})\\b`, 'i');
        const hit = re.exec(text);
        if (hit) {
          tally.vocab++;
          problems.push(`${item.id} ${where}: "${hit[0]}" is draughting vocabulary, not what a child sees`
            + `\n      "${text.trim().slice(0, 120)}"`);
        }
      });
    }
  });
}

// A FIGURE'S OWN alt AND caption ARE READER-FACING TOO, and until 26-0905 nothing looked at them.
// engine/figures.js sets the img alt attribute from f.alt and the button's aria-label from
// f.caption, so the alt is a non-visual reader's ONLY access to the drawing and the caption is read
// out to anyone who tabs to it. The vocabulary rule was written for what a child receives, and a
// child who hears "a hatched band" receives the draughtsman's word for it.
//
// COUNTED BEFORE BANNING, which is the rule that saved "labelled": across every pack there are
// exactly TWO such uses in a figure alt, "hatched band" and "facsimile", both written by this
// program. Two is a slip, not a convention. The count and emptiness checks are NOT extended here:
// both need an item's claim to measure against a dataTable, while an alt describes its own figure
// and is checked for fidelity by tests/figure-fidelity.js instead.
function checkFigureProse(fig, problems, tally) {
  ['alt', 'caption'].forEach((k) => {
    const text = fig[k];
    if (typeof text !== 'string' || !text.trim()) return;
    BANNED_WORDS.forEach((w) => {
      const re = new RegExp(`\\b(?:${w})\\b`, 'i');
      const hit = re.exec(text);
      if (hit) {
        tally.vocab++;
        problems.push(`${fig.id} ${k}: "${hit[0]}" is draughting vocabulary, not what a child hears`
          + `\n      "${text.trim().slice(0, 120)}"`);
      }
    });
  });
}

// ------------------------------------------------------------------------------------------
// negative controls: the gate must go red on a defect it claims to catch, or it is decoration
// ------------------------------------------------------------------------------------------
function controls() {
  const out = [];
  const run = (name, item, fig, expectRed) => {
    const p = [];
    checkItem(item, fig, p, { counts: 0, empties: 0, vocab: 0 });
    const red = p.length > 0;
    out.push({ name, red, ok: red === expectRed });
  };

  const schematic = { id: 'ctl-fig', dataTable: { type: 'schematic', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b' }] } };
  run('count over: "two arrows" where one is drawn', { id: 'ctl1', stem: 'Two arrows run down the page.' }, schematic, true);
  run('count under: "one arrow" where one is drawn', { id: 'ctl2', stem: 'One arrow is labelled x.' }, schematic, false);
  run('totality mismatch: "the plan draws one box" where two are drawn', { id: 'ctl3', stem: 'The plan draws one box.' }, schematic, true);
  run('totality match: "the plan draws two boxes"', { id: 'ctl4', stem: 'The plan draws two boxes.' }, schematic, false);

  // The row counter has to keep catching an over-claim on a COLUMNS facsimile, or widening it above
  // traded a false positive for a false negative.
  const cols = { id: 'ctl-cols', dataTable: { type: 'facsimile',
    lines: [{ text: 'a heading line' }, { text: 'a second heading line' }],
    columns: [{ heading: 'A', rows: ['r1', 'r2', 'r3'] }, { heading: 'B', rows: ['r1', 'r2', 'r3'] }] } };
  run('columns facsimile: "three rows" where each column holds three', { id: 'ctl7', stem: 'The left column holds three rows.' }, cols, false);
  run('columns facsimile: "five rows" where each column holds three', { id: 'ctl8', stem: 'The card sets out five rows.' }, cols, true);

  const noBlank = { id: 'ctl-fac', dataTable: { type: 'facsimile', lines: [{ text: 'a name' }] } };
  const withBlank = { id: 'ctl-fac2', dataTable: { type: 'facsimile', lines: [{ text: 'a name', emphasis: 'blank' }] } };
  run('emptiness with nothing empty drawn', { id: 'ctl5', stem: 'The row is left blank.' }, noBlank, true);
  run('emptiness with a blank field drawn', { id: 'ctl6', stem: 'The row is left blank.' }, withBlank, false);

  // The alt/caption vocabulary check gets its own pair, because it runs on a different object.
  {
    const bad = { id: 'ctl-fig-alt', alt: 'A timeline with a hatched band across the middle.' };
    const good = { id: 'ctl-fig-alt2', alt: 'A timeline with a shaded stretch across the middle.' };
    const pa = []; checkFigureProse(bad, pa, { counts: 0, empties: 0, vocab: 0 });
    out.push({ name: 'draughting word in a FIGURE ALT', red: pa.length > 0, ok: pa.length > 0 });
    const pb = []; checkFigureProse(good, pb, { counts: 0, empties: 0, vocab: 0 });
    out.push({ name: 'the same alt in a child\'s words', red: pb.length > 0, ok: pb.length === 0 });
  }
  run('draughting word in a stem', { id: 'ctl7', stem: 'What does the hatched band show?' }, noBlank, true);
  run('same word in an explain', { id: 'ctl8', explain: 'The hatched band covers it.' }, noBlank, false);

  return out;
}

// ------------------------------------------------------------------------------------------
function main() {
  const problems = [];
  const tally = { counts: 0, empties: 0, vocab: 0 };
  let itemsChecked = 0;
  let figuresChecked = 0;
  let packsWithFigures = 0;

  const files = fs.readdirSync(PACKS_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.verdicts.json')
      && f !== 'manifest.json' && !f.startsWith('curriculum-'));

  files.forEach((f) => {
    let pack;
    try { pack = loadPackFile(path.join(PACKS_DIR, f)); } catch (e) { return; }
    const figs = new Map((pack.figures || []).map((x) => [x.id, x]));
    if (!figs.size) return;
    packsWithFigures++;
    // Every figure, not only the ones an item is keyed on: an alt ships to a reader whether or not
    // a question ever points at that figure.
    figs.forEach((fig) => { figuresChecked++; checkFigureProse(fig, problems, tally); });
    (pack.items || []).forEach((it) => {
      if (!it.figureId) return;
      const fig = figs.get(it.figureId);
      if (!fig) return;
      itemsChecked++;
      checkItem(it, fig, problems, tally);
    });
  });

  // ---- arming. Constraint 12: a gate that finds no targets must say so, not pass quietly.
  const ctl = controls();
  const ctlBad = ctl.filter((c) => !c.ok);
  console.log('=== figure-prose ===');
  console.log(`  packs with figures: ${packsWithFigures}   items keyed on a figure: ${itemsChecked}`
    + `   figure alts and captions read: ${figuresChecked}`);
  console.log(`  claims measured: ${tally.counts} count, ${tally.empties} emptiness, `
    + `${tally.vocab} vocabulary`);
  console.log('  negative controls:');
  ctl.forEach((c) => console.log(`    ${c.ok ? 'ok  ' : 'BAD '} ${c.name} -> ${c.red ? 'red' : 'green'}`));

  if (ctlBad.length) {
    console.log(`\n${ctlBad.length} NEGATIVE CONTROL(S) FAILED -- the gate does not catch what it claims to.`);
    console.log('RESULT: FAILED');
    process.exit(1);
  }
  if (!itemsChecked) {
    console.log('\nNOT ARMED: no item in any pack is keyed on a figure, so this gate measured nothing.');
    console.log('RESULT: FAILED');
    process.exit(1);
  }
  if (!tally.counts && !tally.empties) {
    console.log('\nNOT ARMED: no item makes a countable or an emptiness claim about its figure, so the');
    console.log('two checks that link prose to picture measured nothing. Either the items stopped');
    console.log('describing their drawings, or the extractor stopped seeing that they do.');
    console.log('RESULT: FAILED');
    process.exit(1);
  }

  if (problems.length) {
    console.log('');
    problems.forEach((p) => console.log('  ' + p));
    console.log(`\n=== figure-prose: ${problems.length} problem(s) ===`);
    console.log('RESULT: FAILED');
    process.exit(1);
  }
  console.log('\n=== figure-prose: 0 problems ===');
  console.log('RESULT: ALL CLEAN');
}

if (require.main === module) main();
module.exports = { checkItem, drawsAnEmptyField, COUNTERS, controls };
