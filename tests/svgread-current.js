'use strict';
// svgread-current.js -- every piece of SVG markup an item's svgRead quotes must still be in the file.
//
// WHY THIS EXISTS.  svgRead is authoring evidence:  "Counted in art/.../fig-l5-frostbank-vault.svg:
// <polygon points="254.4,244 243.4,249 243.4,239"/> pointing right into the twelfth box".  It is what
// a reviewer checks a key against, and C4 treats a false one as a finding.  But it quotes COORDINATES,
// and coordinates move whenever the art is regenerated, which no gate here noticed:
//
//   Stage C (PR #77) inset the gap bands by the marker radius, and l3-order-log-with-the-unseen-
//   minutes went on quoting the band's old rect, x="290.67" width="234.67".  Shipped that way.
//   Stage D (per-character text widths) re-laid-out every document figure, and 23 quoted fragments
//   across 7 items stopped being true at once.
//
// figure-derive proves a figure matches a fresh render, figure-fidelity proves its labels match the
// passage;  neither reads svgRead, because svgRead is prose.  So this reads it:  every quoted tag and
// every attr="number" pair in an svgRead is looked up in the CURRENT file of the figure the item is
// on.  A quoted tag may be abbreviated (attributes left out), so a tag is matched attribute by
// attribute against the elements of that name.
//
// NEGATIVE CONTROL in the same pass:  one real, currently-passing fragment is altered in memory and
// must then be reported stale, or the matcher could not have failed.
//
//   node tests/svgread-current.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const tagRe = (tag) => new RegExp('<' + tag + '(?=[\\s/>])[^>]*>', 'g');
function fragmentsOf(note) {
  return [...note.matchAll(/<[a-z]+\b[^<>]*\/?>/g)].map((m) => m[0])
    .concat([...note.matchAll(/\b[a-z-]+="[^"]*\d[^"]*"/g)].map((m) => m[0]));
}
function present(fr, svg) {
  if (!fr.startsWith('<')) return svg.includes(fr);
  const pairs = [...fr.matchAll(/[a-z-]+="[^"]*"/g)].map((m) => m[0]);
  return [...svg.matchAll(tagRe(fr.match(/^<([a-z]+)/)[1]))].some((m) => pairs.every((pr) => m[0].includes(pr)));
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'manifest.json'), 'utf8'));
const cases = [];
for (const e of manifest.packs) {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', `${e.id}.json`), 'utf8'));
  const figs = new Map((pack.figures || []).map((f) => [f.id, f]));
  for (const it of pack.items || []) {
    if (typeof it.svgRead !== 'string') continue;
    const fid = it.figureId || ((pack.passages || []).find((q) => q.id === it.passageId) || { figureIds: [] }).figureIds?.[0];
    const f = figs.get(fid);
    if (!f || !f.src) continue;
    const file = path.join(ROOT, f.src);
    if (!fs.existsSync(file)) { cases.push({ where: `${e.id}/${it.id}`, missing: f.src }); continue; }
    const frags = fragmentsOf(it.svgRead);
    if (frags.length) cases.push({ where: `${e.id}/${it.id}`, fig: fid, svg: fs.readFileSync(file, 'utf8'), frags });
  }
}

const problems = [];
let checked = 0;
for (const c of cases) {
  if (c.missing) { problems.push(`${c.where}: svgRead names a figure whose file ${c.missing} does not exist`); continue; }
  for (const fr of c.frags) { checked++; if (!present(fr, c.svg)) problems.push(`STALE  ${c.where} on ${c.fig}:  ${fr}`); }
}
console.log(`svgread-current: ${cases.length} item(s) quote SVG markup, ${checked} fragment(s) looked up in the current files`);

// The control: take the first fragment that carries a number and currently passes, bump the number.
const donor = cases.find((c) => c.frags && c.frags.some((fr) => /\d/.test(fr) && present(fr, c.svg)));
if (!donor) problems.push('NEGATIVE CONTROL could not run: no passing numeric fragment to alter');
else {
  const fr = donor.frags.find((x) => /\d/.test(x) && present(x, donor.svg));
  const altered = fr.replace(/(\d+)(?!.*\d)/, (d) => String(Number(d) + 7));
  if (present(altered, donor.svg)) problems.push(`NEGATIVE CONTROL did not fire: ${JSON.stringify(altered)} (altered from ${JSON.stringify(fr)}) still reads as present`);
  else console.log(`  control: ${JSON.stringify(altered)} (altered from a real fragment in ${donor.where}) is reported stale  (fired)`);
}

if (problems.length) {
  console.log(`\n=== svgread-current: ${problems.length} problem(s) ===`);
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nRESULT: FAILED');
  process.exit(1);
}
console.log('\nRESULT: ALL CLEAN');
