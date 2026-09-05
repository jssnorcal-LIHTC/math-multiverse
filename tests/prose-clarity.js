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

// A FIGURE-STIMULUS ITEM -- one carrying a `figureFact` -- is new prose the ELA figures programme
// wrote, so like a briefing it is held to a standard rather than to wherever it landed. The stem is
// the instruction a child reads before anything else and the explain is what they are shown on
// reveal; both are rendered, and NEITHER was measured by anything until 26-0905.
//
// WHY THESE TWO NUMBERS. Measured across all 48 such items in the two C-waves shipped so far, the
// worst stem sentence is 25 words and the worst explain sentence is 42. They are pinned there, so
// the gate is a ratchet on exactly the prose this programme is still writing.
//
// THEY WOULD HAVE FIRED. C4 round 3 rewrote l5-order-longest-hold-to-shortest's stem from 25 words
// to 35 while chaining three imperatives, and rewrote l3-order-plan-and-real-time-in-one-order's
// explain from 33 words to 52 by bolting a corrected clause onto the front of the old sentence.
// Round 4's reviewers caught both by hand. The pack-level ceiling could not: ela-g6-spy is pinned
// at 42 for its PASSAGES, and both defects sat under it.
//
// A CLOZE STEM IS NOT WHAT THE CHILD READS. engine/items.js types.cloze.render splits the stem on
// {{n}} and drops an inline <select> into the running sentence, so the sentence the child reads is
// the stem WITH THE CHOSEN OPTION IN IT, and the grader's own miss note tells them to "Read the
// whole sentence aloud with your choice in it". Measuring `it.stem` raw counts "{{0}}," as one word:
// l3-cloze-which-record-holds-the-thumb scored 24 against a ceiling of 25 while rendering at 45,
// the longest sentence in the pack. Found by C4 round 5, in the gate this session had just written.
//
// So a cloze is measured RENDERED, with each blank replaced by its keyed option, against its own
// ceiling. 32 is the worst of the six once round 5's two rewrites landed (45 -> 26, 40 -> 20).
const MAX_FIGURE_ITEM = { stem: 25, explain: 42 };
const MAX_FIGURE_CLOZE_STEM = 32;

// The stem exactly as engine/items.js renders it: every {{n}} replaced by the option the key names.
function renderedStem(item) {
  return String(item.stem || '').replace(/\{\{(\d+)\}\}/g, (m, n) => {
    const b = (item.blanks || [])[Number(n)];
    if (!b || !Array.isArray(b.choices)) return m;
    const k = b.choices[b.key];
    return typeof k === 'string' ? k : m;
  });
}

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

  // Figure-stimulus items, where a pack has them.
  let figureItemSents = 0;
  for (const it of pack.items || []) {
    if (!it || !it.figureFact) continue;
    Object.keys(MAX_FIGURE_ITEM).forEach((field) => {
      const isCloze = it.type === 'cloze' && field === 'stem';
      const cap = isCloze ? MAX_FIGURE_CLOZE_STEM : MAX_FIGURE_ITEM[field];
      const text = isCloze ? renderedStem(it) : it[field];
      for (const sen of sentencesOf(text)) {
        figureItemSents++;
        const n = words(sen);
        if (n > cap) {
          problems.push(`${id}/${it.id} ${field}${isCloze ? ' (as rendered, with the key in it)' : ''}: `
            + `a ${n}-word sentence, over the ${cap}-word figure-item ${field} ceiling: `
            + `${JSON.stringify(sen.slice(0, 90))}.  `
            + `A question about a drawing may not be harder to read than the drawing.`);
        }
      }
    });
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
    figureItemSents,
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
  // The two figure-item ceilings get the REAL sentences C4 round 3 wrote and round 4 removed, so
  // the control is a defect that actually shipped rather than a synthetic one.
  const r3stem = 'Read that row across, then use what the article says about the first tunnel, and put '
    + 'the three tunnels in order of how long the beacon held, from the longest hold down to the shortest.';
  const r3explain = 'The passage puts the plan\'s check-in and its end in the same paragraph that opens '
    + 'with Ines going in, and the man in the jacket only a paragraph later, so reading it straight through '
    + 'puts the check-in time and the end of the exercise before the man in the jacket ever appears.';
  const r4stem = 'Then read what the article says about the first tunnel.';
  const nStem = words(sentencesOf(r3stem)[0] || r3stem);
  const nExpl = words(sentencesOf(r3explain)[0] || r3explain);
  const nOk = words(sentencesOf(r4stem)[0] || r4stem);
  controls.push({
    name: 'NEGATIVE: round 3\'s 35-word stem is over the figure-item stem ceiling',
    ok: nStem > MAX_FIGURE_ITEM.stem,
    detail: `${nStem} words against ${MAX_FIGURE_ITEM.stem}`,
  });
  controls.push({
    name: 'NEGATIVE: round 3\'s 52-word explain is over the figure-item explain ceiling',
    ok: nExpl > MAX_FIGURE_ITEM.explain,
    detail: `${nExpl} words against ${MAX_FIGURE_ITEM.explain}`,
  });
  controls.push({
    name: 'POSITIVE: the sentence that replaced it is under the stem ceiling',
    ok: nOk <= MAX_FIGURE_ITEM.stem,
    detail: `${nOk} words against ${MAX_FIGURE_ITEM.stem}`,
  });
  // The rendered-cloze path gets the REAL item round 5 rewrote, so the control is a defect that
  // actually shipped and the substitution is shown to happen at all.
  const clozeBefore = {
    type: 'cloze',
    stem: 'Finish the sentence about the Halloway timeline.  The timeline keeps two records, and the entry '
      + 'reading my thumb on the transmit key goes on {{0}}, while The rule holds only {{1}}.',
    blanks: [
      { choices: ['I write down times, the record of what the narrator saw, heard or did herself'], key: 0 },
      { choices: ['what the plan required, whether it happened or not'], key: 0 },
    ],
  };
  const rawWorst = Math.max(...sentencesOf(clozeBefore.stem).map(words));
  const renWorst = Math.max(...sentencesOf(renderedStem(clozeBefore)).map(words));
  controls.push({
    name: 'CONTROL: rendering a cloze stem substitutes the key, so the sentence gets longer',
    ok: renWorst > rawWorst,
    detail: `${rawWorst} words raw against ${renWorst} rendered`,
  });
  controls.push({
    name: 'NEGATIVE: round 5\'s 45-word RENDERED cloze stem is over the cloze ceiling, though its raw form is under',
    ok: renWorst > MAX_FIGURE_CLOZE_STEM && rawWorst <= MAX_FIGURE_ITEM.stem,
    detail: `raw ${rawWorst} <= ${MAX_FIGURE_ITEM.stem}, rendered ${renWorst} > ${MAX_FIGURE_CLOZE_STEM}`,
  });
  // A ceiling that no pack's items are measured against is decoration: say how many were read.
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
const figureItemSents = rows.reduce((n, r) => n + r.figureItemSents, 0);
if (!figureItemSents) {
  console.log('\nNOT ARMED: no pack carries a figure-stimulus item, so the figure-item ceilings measured nothing.');
  console.log('RESULT: FAILED');
  process.exit(1);
}
console.log(`\nRESULT: ALL CLEAN (${rows.length} pack(s), ${rows.reduce((n, r) => n + r.briefingSents, 0)} briefing sentence(s), ${figureItemSents} figure-item sentence(s), ${controls.length} controls)`);
process.exit(0);
