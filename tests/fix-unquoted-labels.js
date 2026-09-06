// Close every cued drawn label at both edges, using THE SAME PREDICATE that found them, so the
// fixer and the sweep cannot disagree about what counts.  Three hand passes missed thirteen of
// these across six items, and one of the misses was in the very item a commit message named as done.
const fs = require('fs');
const P = process.argv[2];
if (!P) { console.error('usage: node tests/fix-unquoted-labels.js <path/to/pack.json>'); process.exit(2); }
const pack = JSON.parse(fs.readFileSync(P, 'utf8'));

const CUE = /\b(reading|reads|read|labelled|labeled|labels|label|headed|marked|named|naming|says|saying|gives|giving|carries|carrying|prints|printing)\s+$/i;

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

// Wrap every cued, unquoted occurrence of a 3+ word label.  Left to right, rebuilding as we go, so
// an inserted quote cannot shift an index we are still holding.
function closeLabels(text, labels) {
  let n = 0;
  let out = text;
  for (const L of labels) {
    if (L.split(/\s+/).length < 3) continue;
    let acc = '';
    let rest = out;
    for (;;) {
      const i = rest.indexOf(L);
      if (i === -1) { acc += rest; break; }
      const before = rest.slice(0, i);
      const after = rest.slice(i + L.length);
      const openQ = /["\u201c]\s*$/.test(before);
      const closeQ = /^\s*["\u201d]/.test(after);
      if (CUE.test(acc + before) && !(openQ && closeQ)) {
        acc += before + '"' + L + '"';
        n++;
      } else {
        acc += before + L;
      }
      rest = after;
    }
    out = acc;
  }
  return { text: out, n };
}

const figs = Object.fromEntries((pack.figures || []).map((f) => [f.id, f]));
let total = 0;
const touched = new Set();

for (const it of (pack.items || []).filter((i) => i.figureFact && i.figureId)) {
  const fig = figs[it.figureId];
  if (!fig) continue;
  const labels = drawnStrings(fig);
  const doField = (obj, key, where) => {
    if (typeof obj[key] !== 'string') return;
    const r = closeLabels(obj[key], labels);
    if (r.n) { obj[key] = r.text; total += r.n; touched.add(it.id); console.log(`  ${it.id}.${where}  +${r.n}`); }
  };
  for (const k of ['stem', 'explain', 'whyTheFigureIsNeeded']) doField(it, k, k);
  (it.choices || []).forEach((_, i) => doField(it.choices, i, `choices[${i}]`));
  (it.tiles || []).forEach((_, i) => doField(it.tiles, i, `tiles[${i}]`));
  (it.rowLabels || []).forEach((_, i) => doField(it.rowLabels, i, `rowLabels[${i}]`));
  (it.colLabels || []).forEach((_, i) => doField(it.colLabels, i, `colLabels[${i}]`));
  (it.blanks || []).forEach((b, n) => (b.choices || []).forEach((_, i) => doField(b.choices, i, `blanks[${n}].choices[${i}]`)));
  Object.keys(it.distractorRationale || {}).forEach((k) => doField(it.distractorRationale, k, `distractorRationale[${k}]`));
}

fs.writeFileSync(P, JSON.stringify(pack, null, 2) + '\n');
console.log(`\n${total} label use(s) closed across ${touched.size} item(s)`);
console.log('ITEMS TO RE-CERTIFY: ' + [...touched].join(','));
