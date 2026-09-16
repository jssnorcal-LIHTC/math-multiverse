// Close every cued drawn label at both edges, using THE SAME PREDICATE that found them, so the
// fixer and the sweep cannot disagree about what counts.  Three hand passes missed thirteen of
// these across six items, and one of the misses was in the very item a commit message named as done.
//
// THAT CLAIM USED TO BE FALSE.  Until C4 round 4 this file held its own copy of the cue regex and
// its own hardcoded three-word floor, and the copies had drifted from the sweep's on three axes.
// Both now require tests/unquoted-labels-lib.js and neither defines a predicate of its own, so the
// paragraph above is true rather than aspirational.  See that module's header for the divergence.
//
//   node tests/fix-unquoted-labels.js <path/to/pack.json> [--min N]
//
// WHAT IT WILL NOT DO.  A row or column label that IS a drawn string, whole, has no cue to key on
// and no single right rewrite: quoting it bare and wrapping it in the pack's idiom
// ('the line reading "x"') are different editorial choices, and a match grid's row labels are what
// the child drags.  Those are listed at the end for a hand decision and are never rewritten here.
const fs = require('fs');
const { drawnStrings, readerStrings, closeLabels } = require('./unquoted-labels-lib');

const P = process.argv[2];
if (!P) { console.error('usage: node tests/fix-unquoted-labels.js <path/to/pack.json> [--min N]'); process.exit(2); }
const minArg = process.argv.indexOf('--min');
const MINWORDS = minArg > -1 ? Math.max(1, parseInt(process.argv[minArg + 1], 10) || 1) : 1;
const pack = JSON.parse(fs.readFileSync(P, 'utf8'));

const figs = Object.fromEntries((pack.figures || []).map((f) => [f.id, f]));
let total = 0;
const touched = new Set();
const standalone = [];

function doField(obj, key, owner, where, labels) {
  if (typeof obj[key] !== 'string') return;
  const r = closeLabels(obj[key], labels, MINWORDS);
  if (r.n) { obj[key] = r.text; total += r.n; touched.add(owner); console.log(`  ${owner}.${where}  +${r.n}`); }
}

for (const it of (pack.items || []).filter((i) => i.figureFact && i.figureId)) {
  const fig = figs[it.figureId];
  if (!fig) continue;
  const labels = drawnStrings(fig);
  const labelSet = new Set(labels);
  for (const k of ['stem', 'explain', 'whyTheFigureIsNeeded']) doField(it, k, it.id, k, labels);
  (it.choices || []).forEach((_, i) => doField(it.choices, i, it.id, `choices[${i}]`, labels));
  (it.tiles || []).forEach((_, i) => doField(it.tiles, i, it.id, `tiles[${i}]`, labels));
  (it.rowLabels || []).forEach((_, i) => doField(it.rowLabels, i, it.id, `rowLabels[${i}]`, labels));
  (it.colLabels || []).forEach((_, i) => doField(it.colLabels, i, it.id, `colLabels[${i}]`, labels));
  (it.blanks || []).forEach((b, n) => (b.choices || []).forEach((_, i) => doField(b.choices, i, it.id, `blanks[${n}].choices[${i}]`, labels)));
  Object.keys(it.distractorRationale || {}).forEach((k) => doField(it.distractorRationale, k, it.id, `distractorRationale[${k}]`, labels));

  // Reported, never rewritten.  See the header.
  for (const { where, text } of readerStrings(it)) {
    if (!/^(rowLabels|colLabels)\[/.test(where)) continue;
    if (labelSet.has(text.trim())) standalone.push(`${it.id}.${where}  ${JSON.stringify(text)}`);
  }
}

// The alt is the non-visual reader's entire substitute for the drawing, and v1 never read one.
for (const fig of (pack.figures || [])) {
  const labels = drawnStrings(fig);
  for (const k of ['alt', 'caption']) doField(fig, k, fig.id, k, labels);
}

fs.writeFileSync(P, JSON.stringify(pack, null, 2) + '\n');
console.log(`\n${total} label use(s) closed across ${touched.size} item(s)/figure(s)`);
console.log('ITEMS TO RE-CERTIFY: ' + [...touched].filter((t) => !t.startsWith('fig-')).join(','));
if (standalone.length) {
  console.log(`\n${standalone.length} bare drawn label(s) standing as a whole row/column label.`);
  console.log('NOT rewritten;  each needs a hand decision:');
  standalone.forEach((s) => console.log('  ' + s));
}
