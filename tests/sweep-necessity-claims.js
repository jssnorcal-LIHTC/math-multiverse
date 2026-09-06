// FALSE NECESSITY CLAIMS, swept mechanically.
//
// Round 1 fixed eight whyTheFigureIsNeeded fields that asserted the passage cannot supply what it
// plainly supplies.  Round 2 found a NINTH and a TENTH, and the ninth was the TWIN of one round 1
// had already fixed -- same figure, same claim, different item.  That is the third time in two
// rounds that a fix reached one item and not its sibling.
//
// The class has a lexical signature: an absolute about what the drawing alone can do.  This does not
// judge whether the claim is true -- only a reader can -- it lists every place one is made, so a fix
// to one is checked against all of them.  Grouped BY FIGURE, because siblings on a figure are where
// the misses happen.
const fs = require('fs');
const PATTERNS = [
  /\bonly the (drawing|plan|card|figure|timeline|log|memo|table|entry)\b/i,
  /\bexists only in\b/i,
  /\bcan be seen only\b/i,
  /\bthe one place\b/i,
  /\bthe only place\b/i,
  /\bnever (joins|pairs|sets|says|shows|lines) [^.;]{0,60}\bso\b/i,
  /\bsingles out none\b/i,
  /\bnowhere in the (passage|prose|story|entry)\b/i,
];
let checked = 0, flagged = 0;
for (const id of (process.argv[2] ? [process.argv[2]] : ['vault-of-ages-g6', 'ela-g6-spy', 'night-rounds-g6'])) {
  const p = JSON.parse(fs.readFileSync(`packs/${id}.json`, 'utf8'));
  const byFig = {};
  for (const it of (p.items || []).filter((i) => i.figureFact)) (byFig[it.figureId] = byFig[it.figureId] || []).push(it);
  const hits = [];
  for (const [figId, items] of Object.entries(byFig)) {
    for (const it of items) {
      for (const field of ['whyTheFigureIsNeeded', 'explain']) {
        const t = it[field];
        if (typeof t !== 'string') continue;
        checked++;
        const m = PATTERNS.map((re) => (t.match(re) || [])[0]).filter(Boolean);
        if (m.length) { hits.push({ figId, item: it.id, field, m, t }); flagged++; }
      }
    }
  }
  console.log(`\n=== ${id} ===`);
  const grouped = {};
  for (const h of hits) (grouped[h.figId] = grouped[h.figId] || []).push(h);
  if (!Object.keys(grouped).length) console.log('  no absolute necessity claim in any figure-item why-field or explain');
  for (const [figId, hs] of Object.entries(grouped)) {
    console.log(`  ${figId}   (${(byFig[figId] || []).length} item(s) on this figure)`);
    for (const h of hs) {
      console.log(`    ${h.item}.${h.field}  -> ${JSON.stringify(h.m.join(' | '))}`);
      console.log(`        ${h.t.slice(0, 150)}`);
    }
  }
}
console.log(`\n  ${checked} field(s) read, ${flagged} carrying an absolute.  Each is a claim to CHECK against the`);
console.log('  passage, not a defect by itself.  Grouped by figure so a fix to one item is read against its');
console.log('  siblings, which is where the last three misses happened.');
