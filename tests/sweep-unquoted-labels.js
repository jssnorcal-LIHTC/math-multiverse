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
//   node sweep-unquoted-labels.js <pack.json> [--all]
//
// Default reports only labels of three words or more, which is where the garden paths live.  --all
// includes short ones.
const fs = require('fs');

const pack = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ALL = process.argv.includes('--all');
const MINWORDS = ALL ? 1 : 3;

// Cue verbs that open a quotation of drawn text.
const CUE = /\b(reading|reads|read|labelled|labeled|labels|label|headed|marked|named|naming|says|saying|gives|giving|carries|carrying|prints|printing)\s+$/i;

// Every string a figure actually draws.
function drawnStrings(fig) {
  const out = new Set();
  const walk = (n) => {
    if (typeof n === 'string') { if (n.trim()) out.add(n.trim()); return; }
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') Object.values(n).forEach(walk);
  };
  walk(fig.dataTable);
  return [...out].sort((a, b) => b.length - a.length);
}

// Reader-facing fields only.  svgRead is authoring evidence and is excluded on purpose; a
// non-reader-facing field is allowed to be terse.
function readerStrings(it) {
  const out = [];
  const push = (where, v) => { if (typeof v === 'string' && v.trim()) out.push({ where, text: v }); };
  push('stem', it.stem);
  push('explain', it.explain);
  push('whyTheFigureIsNeeded', it.whyTheFigureIsNeeded);
  (it.choices || []).forEach((c, i) => push(`choices[${i}]`, c));
  (it.tiles || []).forEach((c, i) => push(`tiles[${i}]`, c));
  (it.rowLabels || []).forEach((c, i) => push(`rowLabels[${i}]`, c));
  (it.colLabels || []).forEach((c, i) => push(`colLabels[${i}]`, c));
  (it.blanks || []).forEach((b, n) => (b.choices || []).forEach((c, i) => push(`blanks[${n}].choices[${i}]`, c)));
  Object.entries(it.distractorRationale || {}).forEach(([k, v]) => push(`distractorRationale[${k}]`, v));
  return out;
}

const figs = Object.fromEntries((pack.figures || []).map((f) => [f.id, f]));
let checked = 0;
const hits = [];

for (const it of (pack.items || []).filter((i) => i.figureFact && i.figureId)) {
  const fig = figs[it.figureId];
  if (!fig) continue;
  const labels = drawnStrings(fig);
  for (const { where, text } of readerStrings(it)) {
    for (const L of labels) {
      if (L.split(/\s+/).length < MINWORDS) continue;
      let from = 0;
      for (;;) {
        const i = text.indexOf(L, from);
        if (i === -1) break;
        from = i + 1;
        const before = text.slice(0, i);
        if (!CUE.test(before)) continue;      // not introduced as a quotation
        checked++;
        const openQ = /["“]\s*$/.test(before);
        const after = text.slice(i + L.length);
        const closeQ = /^\s*["”]/.test(after);
        if (openQ && closeQ) continue;        // properly closed
        hits.push({ item: it.id, where, label: L, openQ, closeQ,
          ctx: (before.slice(-28) + '>>' + L + '<<' + after.slice(0, 24)).replace(/\s+/g, ' ') });
      }
    }
  }
}

console.log(`\nunquoted drawn labels in reader-facing prose: ${checked} cued use(s) of a label of ${MINWORDS}+ words\n`);
const byItem = {};
for (const h of hits) (byItem[h.item] = byItem[h.item] || []).push(h);
for (const [id, hs] of Object.entries(byItem)) {
  console.log(`  ${id}`);
  for (const h of hs) {
    const state = h.openQ ? 'opened but not closed' : (h.closeQ ? 'closed but not opened' : 'unquoted');
    console.log(`    ${h.where.padEnd(28)} ${state}`);
    console.log(`        ...${h.ctx}...`);
  }
}
console.log(hits.length
  ? `\n  ${hits.length} label use(s) not closed at both edges, across ${Object.keys(byItem).length} item(s).`
  : '\n  Every cued drawn label in reader-facing prose is closed at both edges.');
