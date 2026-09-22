'use strict';
// svgread-current.js -- every coordinate or piece of SVG markup an item's svgRead cites must still be
// in the figure file it names.
//
// WHY THIS EXISTS.  svgRead is authoring evidence:  "Counted in art/.../fig-l5-frostbank-vault.svg:
// <polygon points="254.4,244 243.4,249 243.4,239"/> pointing right into the twelfth box".  It is what
// a reviewer checks a key against, and C4 treats a false one as a finding.  But it quotes COORDINATES,
// and coordinates move whenever the art is regenerated, which no gate here noticed:
//
//   Stage C (PR #77) inset the gap bands by the marker radius, and l3-order-log-with-the-unseen-
//   minutes went on quoting the band's old rect, x="290.67" width="234.67".  Shipped that way.
//   Stage D (per-character text widths) re-laid-out every document figure at once.
//
// figure-derive proves a figure matches a fresh render, figure-fidelity proves its labels match the
// passage;  neither reads svgRead, because svgRead is prose.  So this reads it, in every form the
// notes actually use.  THE FIRST VERSION OF THIS GATE READ ONLY THE FIRST TWO and reported the pack
// clean while 26 more coordinates stood stale, written as x=306, as "at y 342", and as
// "(544,250.08 to 544,312.24)":
//
//   MARKUP    <polygon points="..."/>    a quoted tag, matched attribute by attribute (it may be
//                                        abbreviated) against the file's elements of that name
//   QUOTED    width="234.67"             must appear verbatim in the file
//   BARE      x=306   rx=32              the named attribute with that value;  x and y also accept
//             y 342   x 78               x1/x2/cx and y1/y2/cy, and a rect's right or bottom edge,
//                                        because "from x 398 to x 770" names a band's two edges
//   POINT     (544,250.08 to 544,324.24) a pair is a polygon point, a line end, a circle centre, or a
//                                        rect/text origin
//   RECT      (56,34,688,386)            a rect's x, y, width and height, in that order
//
// CONTROLS in the same pass, one per form:  a real, currently-passing citation of each form is
// altered in memory and must then be reported stale, or that form's matcher could not have failed.
//
//   node tests/svgread-current.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const num = String.raw`-?\d+(?:\.\d+)?`;
const tagRe = (tag) => new RegExp('<' + tag + '(?=[\\s/>])[^>]*>', 'g');
const attrOf = (el, a) => { const m = new RegExp('\\s' + a + '="(' + num + ')"').exec(el); return m ? Number(m[1]) : null; };
const same = (a, b) => a !== null && Math.abs(a - b) < 0.005;

function model(svg) {
  const els = [...svg.matchAll(/<(rect|line|circle|polygon|text|tspan)\b[^>]*>/g)].map((m) => ({ tag: m[1], src: m[0] }));
  const xs = new Set(), ys = new Set(), pairs = new Set(), rects = [];
  const add = (set, v) => { if (v !== null) set.add(Math.round(v * 100) / 100); };
  for (const e of els) {
    for (const a of ['x', 'x1', 'x2', 'cx']) add(xs, attrOf(e.src, a));
    for (const a of ['y', 'y1', 'y2', 'cy']) add(ys, attrOf(e.src, a));
    const pt = (x, y) => { if (x !== null && y !== null) pairs.add(`${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`); };
    pt(attrOf(e.src, 'x'), attrOf(e.src, 'y')); pt(attrOf(e.src, 'x1'), attrOf(e.src, 'y1'));
    pt(attrOf(e.src, 'x2'), attrOf(e.src, 'y2')); pt(attrOf(e.src, 'cx'), attrOf(e.src, 'cy'));
    const pm = /\spoints="([^"]*)"/.exec(e.src);
    if (pm) for (const p of pm[1].trim().split(/\s+/)) { const [a, b] = p.split(',').map(Number); pt(a, b); }
    if (e.tag === 'rect') {
      const r = ['x', 'y', 'width', 'height'].map((a) => attrOf(e.src, a));
      if (r.every((v) => v !== null)) { rects.push(r); add(xs, r[0] + r[2]); add(ys, r[1] + r[3]); }
    }
  }
  return { svg, els, xs, ys, pairs, rects };
}
const key = (v) => Math.round(Number(v) * 100) / 100;

// Each citation is {form, text, ok(model)}.  Markup and quoted pairs are read first and their spans
// blanked, so a bare-form pass never re-reads the inside of a quoted tag.
function citations(note) {
  const out = [];
  let rest = note;
  for (const m of note.matchAll(/<[a-z]+\b[^<>]*\/?>/g)) {
    const fr = m[0], tag = fr.match(/^<([a-z]+)/)[1], prs = [...fr.matchAll(/[a-z-]+="[^"]*"/g)].map((x) => x[0]);
    out.push({ form: 'MARKUP', text: fr, ok: (md) => [...md.svg.matchAll(tagRe(tag))].some((e) => prs.every((p) => e[0].includes(p))) });
    rest = rest.replace(fr, ' '.repeat(fr.length));
  }
  for (const m of rest.matchAll(/\b([a-z][a-z0-9-]*)="([^"]*\d[^"]*)"/g)) {
    out.push({ form: 'QUOTED', text: m[0], ok: (md) => md.svg.includes(m[0]) });
    rest = rest.replace(m[0], ' '.repeat(m[0].length));
  }
  // (?<![a-z]) so a colour, rgba(232,238,247,0.5), is not read as a rect's four numbers.
  for (const m of rest.matchAll(new RegExp(String.raw`(?<![a-z])\((${num}),(${num}),(${num}),(${num})\)`, 'g'))) {
    const r = m.slice(1, 5).map(Number);
    out.push({ form: 'RECT', text: m[0], ok: (md) => md.rects.some((q) => q.every((v, i) => same(v, r[i]))) });
    rest = rest.replace(m[0], ' '.repeat(m[0].length));
  }
  for (const m of rest.matchAll(new RegExp(String.raw`(?<![\w.,])(${num}),(${num})(?![\w,]|\.\d)`, 'g'))) {
    const pr = `${key(m[1])},${key(m[2])}`;
    out.push({ form: 'POINT', text: m[0], ok: (md) => md.pairs.has(pr) });
  }
  const bare = new RegExp(String.raw`(?<![\w"-])(x|y|cx|cy|x1|x2|y1|y2|width|height|r|rx)(?:=| )(${num})(?![\d"])(?!\.\d)`, 'g');
  for (const m of rest.matchAll(bare)) {
    const a = m[1], v = Number(m[2]);
    const ok = (md) => {
      if (/^(x|cx|x1|x2)$/.test(a)) return md.xs.has(key(v));
      if (/^(y|cy|y1|y2)$/.test(a)) return md.ys.has(key(v));
      return md.els.some((e) => same(attrOf(e.src, a), v));
    };
    out.push({ form: 'BARE', text: m[0], ok });
  }
  return out;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'manifest.json'), 'utf8'));
const cases = [];
const problems = [];
for (const e of manifest.packs) {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', `${e.id}.json`), 'utf8'));
  const figs = new Map((pack.figures || []).map((f) => [f.id, f]));
  for (const it of pack.items || []) {
    if (typeof it.svgRead !== 'string') continue;
    const fid = it.figureId || ((pack.passages || []).find((q) => q.id === it.passageId) || { figureIds: [] }).figureIds?.[0];
    const f = figs.get(fid);
    if (!f || !f.src) continue;
    const file = path.join(ROOT, f.src);
    if (!fs.existsSync(file)) { problems.push(`${e.id}/${it.id}: svgRead names a figure whose file ${f.src} does not exist`); continue; }
    const cites = citations(it.svgRead);
    if (cites.length) cases.push({ where: `${e.id}/${it.id}`, fig: fid, md: model(fs.readFileSync(file, 'utf8')), cites });
  }
}

const byForm = {};
let checked = 0;
for (const c of cases) {
  for (const ct of c.cites) {
    checked++;
    byForm[ct.form] = (byForm[ct.form] || 0) + 1;
    if (!ct.ok(c.md)) problems.push(`STALE  ${c.where} on ${c.fig}:  ${ct.form}  ${ct.text}`);
  }
}
console.log(`svgread-current: ${cases.length} item(s) cite their figure, ${checked} citation(s) looked up in the current files `
  + `(${Object.entries(byForm).map(([k, v]) => `${k} ${v}`).join(', ')})`);

// One control per form:  bump the last number in a real, passing citation and re-read it.
for (const form of ['MARKUP', 'QUOTED', 'BARE', 'POINT', 'RECT']) {
  let donor = null;
  for (const c of cases) {
    const ct = c.cites.find((x) => x.form === form && /\d/.test(x.text) && x.ok(c.md));
    if (ct) { donor = { c, ct }; break; }
  }
  if (!donor) { if (byForm[form]) problems.push(`CONTROL ${form} could not run: no passing citation of that form to alter`); continue; }
  const altered = donor.ct.text.replace(new RegExp(String.raw`(\d+(?:\.\d+)?)(?!.*\d)`), (d) => String(Number(d) + 7));
  const reread = citations(altered).find((x) => x.form === form);
  if (!reread) problems.push(`CONTROL ${form}: the altered citation ${JSON.stringify(altered)} no longer parses as ${form}`);
  else if (reread.ok(donor.c.md)) problems.push(`CONTROL ${form} did not fire: ${JSON.stringify(altered)} (altered from a real citation in ${donor.c.where}) still reads as present`);
  else console.log(`  control ${form}: ${JSON.stringify(altered)} (altered from ${donor.c.where}) is reported stale  (fired)`);
}

if (problems.length) {
  console.log(`\n=== svgread-current: ${problems.length} problem(s) ===`);
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nRESULT: FAILED');
  process.exit(1);
}
console.log('\nRESULT: ALL CLEAN');
