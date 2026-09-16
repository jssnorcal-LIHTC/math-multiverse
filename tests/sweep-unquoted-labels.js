// UNQUOTED DRAWN LABELS IN READER-FACING PROSE.
//
// A drawn label dropped into a sentence after a cue verb ("the line reading X", "the row labelled
// X", "the plan labels X") with no quotation marks around it is a garden path waiting to happen,
// because a clause-shaped label supplies its own subject and verb and the reader cannot tell where
// the quotation stopped.  The pack's own idiom, used in l4-match and l6-cloze from the start, is to
// quote them.
//
// WHY THIS IS A SWEEP AND NOT A HAND PASS.  Round 2 quoted the labels in four items by hand and the
// commit said so.  Round 3 found, on three independent lenses, that the pass had reached only ONE
// FIELD of the first item it named: l3-mc's rationale 1 was closed and its three choices were not.
// Two more items had the same class untouched.  A claim of completeness in a commit message is not
// completeness;  this is.
//
//   node sweep-unquoted-labels.js <pack.json> [--min N]
//
// THIS IS VERSION 2, AND VERSION 1 IS WHY IT EXISTS.  C4 round 4 found that v1 reported "Every cued
// drawn label in reader-facing prose is closed at both edges" over a pack carrying seven unclosed
// ones, and that the miss had three independent causes.  All three are the same shape as the defect
// this file was written to catch, one level up: a predicate that reaches one case and not the case
// beside it.
//
//   THE FLOOR.  v1 defaulted to MINWORDS = 3 and hid anything shorter behind --all.  Its SIBLING,
//   tests/sweep-caption-key.js, was written in the SAME COMMIT and carries its own post-mortem at
//   line 5 saying v1 of THAT sweep skipped keys shorter than three words and that v2 therefore has
//   no length floor.  The identical floor was diagnosed, written up and removed in one sweep and
//   left standing in the other.  Measured on 51f56d3: vault 0 hits at the floor and 7 without it,
//   ela-g6-spy 15 and 31, night-rounds-g6 9 and 18.  The short ones are not the harmless ones:
//   "the row named check it" and "the row reading a ruler" are the two worst garden paths in the
//   Vault pack, and the shipping commit for v1 cited "a ruler" BY NAME as its motivating example.
//   There is now no floor.  --min N raises one for triage; --all is accepted and is a no-op.
//
//   THE CUE GATE.  v1's CUE required the cue verb to sit immediately left of the label, so any
//   intervening noun hid it: "the plan marks it with the words <label>", "the card prints the words
//   <label>", "the message ends with the words <label>".  Six-word clause-shaped labels were
//   invisible at every floor.  The cue may now carry an intervening "the words / the line / the
//   phrase", and "with the words" is a cue in its own right.
//
//   THE ITERATION SET.  v1's loop was `(pack.items || [])`, so a figure's own alt and caption were
//   never read at all, and the alt is the non-visual reader's whole substitute for the drawing.
//   Four of round 4's findings were on figure alts.  Figures are now swept against their own drawn
//   strings.
//
//   THE STANDALONE LABEL.  A cue-based predicate cannot see a label that IS the entire field, which
//   is how a match item's rowLabels are written.  l1-match ships three bare ones, one an imperative
//   with a terminal full stop, while its sibling l4-match quotes all six of its row and column
//   labels in the pack's idiom.  Row and column labels are now checked whole.
const fs = require('fs');
const { drawnStrings, readerStrings, eachCuedUse } = require('./unquoted-labels-lib');

const pack = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const minArg = process.argv.indexOf('--min');
const MINWORDS = minArg > -1 ? Math.max(1, parseInt(process.argv[minArg + 1], 10) || 1) : 1;

const figs = Object.fromEntries((pack.figures || []).map((f) => [f.id, f]));
let checked = 0;
const hits = [];

// One prose field against one figure's drawn strings.  `owner` is what gets reported: an item id
// for item prose, a figure id for an alt or a caption.
function sweepField(owner, where, text, labels) {
  eachCuedUse(text, labels, MINWORDS, (u) => {
    checked++;
    if (u.closed) return;
    hits.push({ item: owner, where, label: u.label, openQ: u.openQ, closeQ: u.closeQ,
      ctx: (u.before.slice(-28) + '>>' + u.label + '<<' + u.after.slice(0, 24)).replace(/\s+/g, ' ') });
  });
}

// A row or column label that IS a drawn string, whole, carries no cue to key on and so is
// invisible to sweepField at any floor.  The pack's idiom wraps it: the line reading "x".
function sweepStandalone(owner, where, text, labelSet) {
  const bare = text.trim();
  if (!labelSet.has(bare)) return;
  checked++;
  hits.push({ item: owner, where, label: bare, openQ: false, closeQ: false, standalone: true,
    ctx: ('>>' + bare + '<<').replace(/\s+/g, ' ') });
}

for (const it of (pack.items || []).filter((i) => i.figureFact && i.figureId)) {
  const fig = figs[it.figureId];
  if (!fig) continue;
  const labels = drawnStrings(fig);
  const labelSet = new Set(labels);
  for (const { where, text } of readerStrings(it)) {
    sweepField(it.id, where, text, labels);
    if (/^(rowLabels|colLabels)\[/.test(where)) sweepStandalone(it.id, where, text, labelSet);
  }
}

// The alt is the non-visual reader's entire substitute for the drawing, and v1 never read one.
for (const fig of (pack.figures || [])) {
  const labels = drawnStrings(fig);
  for (const k of ['alt', 'caption']) {
    if (typeof fig[k] === 'string' && fig[k].trim()) sweepField(fig.id, k, fig[k], labels);
  }
}

console.log(`\nunquoted drawn labels in reader-facing prose: ${checked} cued use(s) of a label of ${MINWORDS}+ words\n`);
const byItem = {};
for (const h of hits) (byItem[h.item] = byItem[h.item] || []).push(h);
for (const [id, hs] of Object.entries(byItem)) {
  console.log(`  ${id}`);
  for (const h of hs) {
    const state = h.standalone ? 'bare drawn label, whole field'
      : h.openQ ? 'opened but not closed' : (h.closeQ ? 'closed but not opened' : 'unquoted');
    console.log(`    ${h.where.padEnd(28)} ${state}`);
    console.log(`        ...${h.ctx}...`);
  }
}
console.log(hits.length
  ? `\n  ${hits.length} label use(s) not closed at both edges, across ${Object.keys(byItem).length} item(s).`
  : '\n  Every cued drawn label in reader-facing prose is closed at both edges.');
