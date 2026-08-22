'use strict';
// prose-clarity.js -- the long-sentence ratchet.
//
//   node tests/prose-clarity.js
//
// WHY THIS EXISTS. Justin tested the science pack with Niall on 26-0822 and reported it as too
// obtuse and short on context. The readability indices did not explain it: measured against
// Firsthand, the pack he says reads well, science ran FK 6.4 against 6.1 and Coleman-Liau 9.1
// against 8.9, and its MEAN sentence was actually SHORTER at 13.1 words against 12.2. What did
// explain it was the tail: science carried 21 sentences over 25 words against history's 7, and its
// worst was 51 words chaining three ideas through "so ... since ... not just".
//
// So the thing to gate is the TAIL, not the average. A pack can hold a perfect grade-6 index and
// still be unreadable for one child if a handful of its sentences run three clauses deep.
//
// A RATCHET, NOT A TARGET. Every pack is listed at a ceiling it already clears, so no pack can get
// worse, and none of the four packs nobody has complained about has to be rewritten to ship this.
// A pack that improves should have its number lowered; the gate says so when the slack gets wide,
// because a ceiling nothing approaches stops being a constraint and starts being decoration.
//
// HARD RULES (constraint 12). A run that finds no packs FAILS. Every ceiling is checked against a
// positive fixture (a compliant sentence) and a negative one (a deliberately over-long sentence),
// and an unlisted pack is a hard failure rather than a silent skip.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const fs = require('fs');
const path = require('path');
const { fleschKincaid, colemanLiau } = require('./readability');

const PACK_DIR = path.join(__dirname, '..', 'packs');

// packId -> longest sentence, in words, that this pack is allowed to contain.
// Each number is the pack's own measured worst at the time it was listed, so the entry is a
// ratchet: it can only ever be lowered.
const MAX_SENTENCE = {
  // Pinned at 28 by WP-P on 26-0822, down from 51. This is the pack the report was about, and 28
  // is a real editorial standard rather than a record of where it happened to land.
  'outpost-protocol-g6': 28,
  // The math pack is authored to the same standard from its first line, so it is pinned there too
  // rather than recorded wherever it happened to land.
  'cpm-cc1-g6': 27,
  // The other four are recorded where they already are. Nobody has reported them as hard to read,
  // and rewriting four shipped, blind-certified packs to hit a number nobody asked for would be
  // scope this gate has no business taking.
  'firsthand-g6': 31,
  'ela-g6-spy': 42,
  'night-rounds-g6': 35,
  'vault-of-ages-g6': 49,
};

// A briefing is new prose written under the standard WP-P set, so it is held to it everywhere.
const MAX_BRIEFING_SENTENCE = 28;

function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}
const words = (s) => s.split(/\s+/).filter(Boolean).length;

const problems = [];
const rows = [];

const files = fs.existsSync(PACK_DIR)
  ? fs.readdirSync(PACK_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.verdicts.json') && f !== 'manifest.json' && f !== 'curriculum-cc1.json')
  : [];
if (!files.length) {
  console.error('prose-clarity: no packs found. A gate that measures nothing must not report clean.');
  process.exit(2);
}

for (const f of files) {
  const id = f.replace(/\.json$/, '');
  let pack;
  try { pack = JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8')); }
  catch (e) { problems.push(`${id}: could not be read (${e.message})`); continue; }
  if (!Array.isArray(pack.passages)) { problems.push(`${id}: no passages[]`); continue; }

  const ceiling = MAX_SENTENCE[id];
  if (ceiling === undefined) {
    problems.push(`${id} is not listed in MAX_SENTENCE. Measure its worst sentence and list it, so `
      + 'the ratchet covers every pack rather than only the ones somebody remembered.');
    continue;
  }

  const offenders = [];
  let sentTotal = 0, wordTotal = 0, over25 = 0, worst = 0;
  const fks = [], cls = [];
  for (const p of pack.passages) {
    fks.push(fleschKincaid(p.text));
    cls.push(colemanLiau(p.text));
    for (const s of sentencesOf(p.text)) {
      const n = words(s);
      sentTotal++; wordTotal += n;
      if (n > 25) over25++;
      if (n > worst) worst = n;
      if (n > ceiling) offenders.push({ pid: p.id, n, s });
    }
  }
  for (const o of offenders) {
    problems.push(`${id}/${o.pid}: a ${o.n}-word sentence, over this pack's ${ceiling}-word ceiling: `
      + JSON.stringify(o.s.slice(0, 90) + (o.s.length > 90 ? '...' : '')));
  }

  // Briefings, where a pack has them.
  let briefingSents = 0;
  for (const lv of pack.levels || []) {
    const b = lv && lv.briefing;
    if (!b || !Array.isArray(b.lines)) continue;
    for (const line of b.lines) {
      for (const s of sentencesOf(line)) {
        briefingSents++;
        const n = words(s);
        if (n > MAX_BRIEFING_SENTENCE) {
          problems.push(`${id} level ${lv.id} briefing: a ${n}-word sentence, over the ${MAX_BRIEFING_SENTENCE}-word `
            + `briefing ceiling: ${JSON.stringify(s.slice(0, 90))}.  A briefing may not out-obtuse the passage it introduces.`);
        }
      }
    }
  }

  // A ceiling nothing comes near is decoration. Reported, not failed: lowering it is an editorial
  // decision, not something a gate gets to make on its own.
  const slack = ceiling - worst;
  rows.push({
    id, ceiling, worst, slack, over25,
    mean: +(wordTotal / sentTotal).toFixed(1),
    fk: +(fks.reduce((a, b) => a + b, 0) / fks.length).toFixed(1),
    cl: +(cls.reduce((a, b) => a + b, 0) / cls.length).toFixed(1),
    briefingSents,
  });
}

for (const id of Object.keys(MAX_SENTENCE)) {
  if (!files.includes(id + '.json')) {
    problems.push(`MAX_SENTENCE lists "${id}", which is not on disk. Remove the entry so the ratchet `
      + 'cannot outlive the pack it constrains.');
  }
}

// ---- CONTROLS. The measurement has to be shown able to fail. ----
const controls = [];
{
  const long = 'Carbon dioxide is a greenhouse gas: it lets sunlight in but traps some of the heat that '
    + 'would otherwise escape back to space, so more of it in the air points to a warmer planet on '
    + 'average, a real physical mechanism, not just two numbers that happen to be rising together.';
  const short = 'Carbon dioxide is a greenhouse gas.';
  const longN = words(sentencesOf(long)[0] || long);
  const shortN = words(sentencesOf(short)[0] || short);
  controls.push({
    name: 'NEGATIVE: the real 51-word sentence WP-P removed is over every ceiling here',
    ok: longN > Math.max(...Object.values(MAX_SENTENCE)),
    detail: `${longN} words against the widest ceiling ${Math.max(...Object.values(MAX_SENTENCE))}`,
  });
  controls.push({
    name: 'POSITIVE: a short sentence is under every ceiling',
    ok: shortN <= Math.min(...Object.values(MAX_SENTENCE)),
    detail: `${shortN} words against the tightest ceiling ${Math.min(...Object.values(MAX_SENTENCE))}`,
  });
  // The splitter has to actually split, or every count above is one sentence long.
  const multi = sentencesOf('One. Two! Three?  Four.');
  controls.push({
    name: 'CONTROL: the sentence splitter finds sentence boundaries at all',
    ok: multi.length === 4,
    detail: `split into ${multi.length}: ${JSON.stringify(multi)}`,
  });
}
for (const c of controls) {
  if (!c.ok) problems.push(`CONTROL "${c.name}" failed (${c.detail}); every measurement above is void`);
}

// ---- report ----
console.log('\n=== prose clarity: the long-sentence ratchet ===');
console.log('pack'.padEnd(22) + 'ceiling  worst  slack  >25w  mean  FK    CL    briefing sents');
for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(r.id.padEnd(22)
    + String(r.ceiling).padEnd(9) + String(r.worst).padEnd(7) + String(r.slack).padEnd(7)
    + String(r.over25).padEnd(6) + String(r.mean).padEnd(6) + String(r.fk).padEnd(6) + String(r.cl).padEnd(6)
    + String(r.briefingSents));
}
const loose = rows.filter((r) => r.slack >= 6);
if (loose.length) {
  console.log('\nceilings with slack to give back (lower them when the pack is next edited):');
  for (const r of loose) console.log(`  ${r.id}: ceiling ${r.ceiling}, worst ${r.worst}`);
}
console.log('\ncontrols:');
for (const c of controls) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}  (${c.detail})`);

if (problems.length) {
  console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nRESULT: FAIL');
  process.exit(1);
}
console.log(`\nRESULT: ALL CLEAN (${rows.length} pack(s), ${rows.reduce((n, r) => n + r.briefingSents, 0)} briefing sentence(s), ${controls.length} controls)`);
process.exit(0);
