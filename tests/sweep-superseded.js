// GREP THE SUPERSEDED VALUE, NOT THE NEW ONE.
//
// Five times across three C4 rounds, a fix reached one field and left the same claim standing in a
// sibling:
//
//   round 2  l3-ms    the ALT was fixed to name the connectors; the stem and explain were not
//   round 2  l1-ms    the learner-facing fields went to "corners"; svgRead kept "each side"
//   round 2  l4-mc    one necessity claim was fixed; its TWIN on the same figure was not
//   round 3  l6-mc    the explain was fixed; two distractorRationales kept the same false premise
//   round 3  l2-ms    l2-order lost "the missing institution"; its sibling on that figure kept it
//
// Every one of them is mechanically findable, and none of them needs judgement: after applying a
// fix batch, take every string the batch REPLACED and grep the whole pack for it. Anything still
// standing is either a sibling that was missed or a deliberate second use, and both want a look.
//
//   node sweep-superseded.js <pack.json> <fix-batch.json> [<fix-batch.json> ...]
//
// A fix batch is the {passage,figureData,figureText,items} shape this session's appliers take; each
// entry carries a `from`. Bare arrays of {from} work too.
const fs = require('fs');

const packPath = process.argv[2];
const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));

// Search item and figure prose separately so the report says WHERE, not just that it is present.
const targets = [];
for (const it of (pack.items || [])) {
  for (const [k, v] of Object.entries(it)) {
    if (typeof v === 'string') targets.push({ where: `${it.id}.${k}`, text: v });
    else if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) {
        if (typeof v2 === 'string') targets.push({ where: `${it.id}.${k}.${k2}`, text: v2 });
      }
    } else if (Array.isArray(v)) {
      v.forEach((s, i) => { if (typeof s === 'string') targets.push({ where: `${it.id}.${k}[${i}]`, text: s }); });
    }
  }
}
for (const f of (pack.figures || [])) {
  for (const k of ['alt', 'caption']) if (typeof f[k] === 'string') targets.push({ where: `${f.id}.${k}`, text: f[k] });
}
for (const p of (pack.passages || [])) if (typeof p.text === 'string') targets.push({ where: `${p.id}.text`, text: p.text });

const froms = [];
for (const bp of process.argv.slice(3)) {
  let b;
  try { b = JSON.parse(fs.readFileSync(bp, 'utf8')); } catch (e) { console.log(`  (skipped ${bp}: ${e.message})`); continue; }
  const groups = Array.isArray(b) ? [b] : [b.passage, b.figureData, b.figureText, b.items].filter(Boolean);
  for (const g of groups) for (const e of g) if (e && typeof e.from === 'string') froms.push({ from: e.from, batch: bp.split(/[\\/]/).pop(), id: e.id });
}

console.log(`\nsuperseded-string sweep: ${froms.length} replaced string(s) from ${process.argv.length - 3} batch(es),`
  + ` against ${targets.length} prose field(s) in ${packPath.split(/[\\/]/).pop()}\n`);

let live = 0;
for (const f of froms) {
  // Short fragments match everywhere and say nothing; the interesting misses are whole clauses.
  if (f.from.length < 18) continue;
  const hits = targets.filter((t) => t.text.indexOf(f.from) !== -1);
  if (!hits.length) continue;
  live++;
  console.log(`  STILL PRESENT  (${f.batch}, fixed on ${f.id})`);
  console.log(`    ${JSON.stringify(f.from.slice(0, 100))}`);
  for (const h of hits) console.log(`      -> ${h.where}`);
}
console.log(live
  ? `\n  ${live} replaced string(s) still standing somewhere in the pack.  Each is a sibling that was`
    + '\n  missed or a deliberate second use.  Read every one.'
  : '\n  No replaced string is still standing anywhere in the pack.');
