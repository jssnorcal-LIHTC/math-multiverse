// THE FIGURE'S CAPTION AND ALT ARE LIVE WHILE THE ITEM IS ANSWERED.
// engine/figures.js:105 sets the caption as the figure button's aria-label and :193 prints it in
// the lightbox, so a caption that carries an item's key hands the child the answer.
//
// THIS IS VERSION 2, AND VERSION 1 IS WHY IT EXISTS.  V1 skipped any key shorter than three words
// and compared by exact substring.  Both holes fired at once: on l1-cloze the key "one" was skipped
// by the length floor, and the key "after Dash has arrived" did not substring-match a caption
// reading "even after Dash arrives".  A caption I wrote using V1's clean result then stated BOTH of
// that item's keys, on one of only three items the necessity instrument found load-bearing.
// A sweep used to license a fix must not be quieter than the fix is dangerous.
//
// V2: no length floor, crude stemming so inflections match, and it reports the OVERLAP FRACTION of
// the key's content words rather than demanding containment, because the second leak was a
// PARAPHRASE ("gives nothing there" against "has no entry") that no lexical containment test can
// see.  Everything at or above the threshold is printed for a human to read.  Its silence is weak
// evidence;  the authority is reading each caption against each item keyed on that figure.
const fs = require('fs');

const STOP = new Set(('the a an of and in on at to it its that this these those with for from by as '
  + 'is are was were be been being do does did has have had will would can could s t so but or if '
  + 'then than there here what which who whom when where how while into over under out up down off '
  + 'about above below after before between both each other another same own very just also').split(' '));

const stem = (w) => {
  let s = w;
  for (const suf of ['ing', 'ies', 'ed', 'es', 's']) {
    if (s.length > suf.length + 2 && s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
};
const toks = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).map(stem);
const contentOf = (s) => { const t = toks(s).filter((w) => !STOP.has(w)); return t.length ? t : toks(s); };

const THRESHOLD = Number(process.argv[3] || 0.6);
let checked = 0;
const rows = [];

for (const id of (process.argv[2] ? [process.argv[2]] : ['vault-of-ages-g6', 'ela-g6-spy', 'night-rounds-g6'])) {
  const p = JSON.parse(fs.readFileSync(`packs/${id}.json`, 'utf8'));
  const figs = Object.fromEntries((p.figures || []).map((f) => [f.id, f]));
  for (const it of (p.items || []).filter((i) => i.figureFact)) {
    const f = figs[it.figureId]; if (!f) continue;
    const keys = [];
    if (it.type === 'mc' && Array.isArray(it.choices)) keys.push(['key', it.choices[it.key]]);
    if (it.type === 'ms' && Array.isArray(it.choices)) (it.key || []).forEach((k, n) => keys.push([`key[${n}]`, it.choices[k]]));
    if (it.type === 'cloze') (it.blanks || []).forEach((b, n) => keys.push([`blank ${n}`, (b.choices || [])[b.key]]));
    if (it.type === 'order' && Array.isArray(it.tiles)) (it.key || []).forEach((t, n) => keys.push([`tile ${n}`, it.tiles[t]]));
    for (const [where, k] of keys) {
      if (typeof k !== 'string' || !k.trim()) continue;
      const kc = contentOf(k);
      if (!kc.length) continue;
      checked++;
      for (const surf of ['caption', 'alt']) {
        const text = f[surf];
        if (typeof text !== 'string') continue;
        const have = new Set(toks(text));
        const hit = kc.filter((w) => have.has(w));
        const frac = hit.length / kc.length;
        if (frac >= THRESHOLD) rows.push({ pack: id, item: it.id, where, surf, fig: f.id, frac, k, hit });
      }
    }
  }
}

rows.sort((a, b) => b.frac - a.frac);
console.log(`\ncaption/alt key overlap, threshold ${THRESHOLD}, ${checked} keyed string(s) checked\n`);
for (const r of rows) {
  console.log(`  ${(r.frac * 100).toFixed(0).padStart(3)}%  ${r.pack.slice(0, 12).padEnd(13)} ${r.item}  ${r.where}  -> ${r.surf} of ${r.fig}`);
  console.log(`        key: ${JSON.stringify(r.k).slice(0, 110)}`);
  console.log(`        shared content words: ${r.hit.join(', ')}`);
}
console.log(`\n  ${rows.length} pair(s) at or above ${THRESHOLD}.  A hit is a REASON TO READ the caption against`);
console.log('  the item, not a verdict: an alt naming a drawn label is the alt doing its job for a');
console.log('  non-visual reader.  A caption stating the key is not.');
