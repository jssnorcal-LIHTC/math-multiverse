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
// WHAT IT WILL NOT DO, AND WHY EACH EXCLUSION WAS EARNED.
//
// A ROW OR COLUMN LABEL that IS a drawn string, whole, has no cue to key on and no single right
// rewrite: quoting it bare and wrapping it in the pack's idiom ('the line reading "x"') are
// different editorial choices, and a match grid's row labels are what the child drags.
//
// A FIGURE ALT OR CAPTION, never, as of the cross-cutting pass on 26-0915.  The sweep reads them
// and this file does not touch them, and the asymmetry is deliberate.  Batch-applying to the alts
// of two shipped packs damaged NINE of them in two ways that a cue-and-substring predicate cannot
// tell apart from a real fix:
//
//   the list.  An alt names drawn items in series -- "six numbered stops labelled barn owls, red
//   foxes, otter pool, ..." -- and one cue governs all six.  Quoting the first and leaving five
//   bare reads worse than leaving all six bare.  Seven alts came back like that.
//   the common noun.  "a labelled box for the fence" and "a labelled willow": both are drawn
//   strings elsewhere in that figure, neither is a quotation here.
//   the substring.  fig-l3-monitoring's gap label is the whole string "8:22 to 9:04, some forty
//   minutes", and "8:22" is separately a drawn tick.  The fixer quoted the tick, turning a correct
//   sentence into one that misnames the caption.
//
// An alt is prose about a picture, so its drawn strings arrive in lists and as ordinary words.  An
// item's stem or rationale cites ONE label at a time, which is why the same predicate is safe there
// and is not safe here.  Alts are listed at the end for a hand read.
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

// REPORTED, NEVER REWRITTEN.  See the header: a cue-and-substring predicate cannot tell a real
// unclosed label in an alt from a list, a common noun, or a substring of the label it belongs to,
// and it got all three wrong on nine alts before this exclusion existed.
const figureHits = [];
for (const fig of (pack.figures || [])) {
  const labels = drawnStrings(fig);
  for (const k of ['alt', 'caption']) {
    if (typeof fig[k] !== 'string') continue;
    const r = closeLabels(fig[k], labels, MINWORDS);
    if (r.n) figureHits.push(`${fig.id}.${k}  (${r.n} cued use(s) the sweep can see)`);
  }
}

fs.writeFileSync(P, JSON.stringify(pack, null, 2) + '\n');
console.log(`\n${total} label use(s) closed across ${touched.size} item(s)/figure(s)`);
console.log('ITEMS TO RE-CERTIFY: ' + [...touched].filter((t) => !t.startsWith('fig-')).join(','));
if (figureHits.length) {
  console.log('');
  console.log(`${figureHits.length} figure alt/caption field(s) carry a cued label the sweep can see.`);
  console.log('NOT rewritten, by design;  read each one and edit by hand:');
  figureHits.forEach((s2) => console.log('  ' + s2));
}
if (standalone.length) {
  console.log(`\n${standalone.length} bare drawn label(s) standing as a whole row/column label.`);
  console.log('NOT rewritten;  each needs a hand decision:');
  standalone.forEach((s) => console.log('  ' + s));
}
