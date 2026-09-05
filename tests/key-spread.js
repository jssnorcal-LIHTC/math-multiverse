'use strict';
// key-spread.js -- the answer's POSITION must not be the answer.
//
//   node tests/key-spread.js
//
// WHY THIS EXISTS, and why it is a new file rather than a line in an old one.
//
// build/shuffle-mc.js has been in this repo since the vault-of-ages wave, and its header states the
// whole case: "A hand-placed key is a learnable pattern: a child who notices the answer is usually B
// stops reading." tests/shuffle-mc.test.js proves the ALGORITHM spreads keys, asserting "the key
// spread is balanced: every position within 1 of N/4" against synthetic drafts.
//
// NOTHING HAS EVER CHECKED A SHIPPED PACK. The tool is a DRAFT-stage tool: shuffleDrafts acts only
// on objects carrying `_correct`/`_wrong` and returns a finished item untouched, so running it over
// a pack is a verified no-op that prints the very spread it objects to. So the tool existed, its
// unit test was green, and the packs drifted.
//
// WHAT IT HAD DRIFTED TO, measured on ela-g6-spy's 24 figure-stimulus items on 26-0905:
//     mc     keys 0,1,0,0,0,2,3        four of seven at position A
//     ms     all six keys included 0;  four keyed exactly [0,1,2], the first three of six
//     cloze  eleven of twelve blanks keyed index 0
// A child who always picked the first option scored heavily on exactly the items built to make them
// read the drawing. Found by the pedagogy lens of C4 round 12 and confirmed by three independent
// adversarial refuters, each of which re-derived the counts from the committed pack.
//
// SCOPE, and it is deliberately narrow. This gate holds the FIGURE-STIMULUS items -- the ones this
// programme wrote and can still fix -- to a standard, and REPORTS every pack's overall numbers
// without failing on them. The 144 pre-existing items in ela-g6-spy alone carry 24 of 36 mc keys at
// position 0; re-placing those means re-certifying 144 blind verdicts, which is a decision for a
// pack owner and not something a gate added mid-review gets to force.
//
// HARD RULES (constraint 12). A run that finds no figure-stimulus items FAILS rather than passing
// quietly, and both controls must fire: the real pre-fix distribution goes red, the post-fix one
// goes green.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const fs = require('fs');
const path = require('path');

const PACK_DIR = path.join(__dirname, '..', 'packs');

// A position may hold at most this many more than an even share. One is the same slack
// tests/shuffle-mc.test.js allows its own algorithm.
const SLACK = 1;

// Count how often each position is keyed, and how many "slots" were dealt in total.
// mc: one key per item.  ms: every index in the key array.  cloze: one key per blank.
function spreadOf(items) {
  const out = { mc: { counts: {}, slots: 0, width: 0, n: 0 },
                ms: { counts: {}, slots: 0, width: 0, n: 0 },
                cloze: { counts: {}, slots: 0, width: 0, n: 0 } };
  const bump = (b, pos, width) => { b.counts[pos] = (b.counts[pos] || 0) + 1; b.slots++; b.width = Math.max(b.width, width); };
  for (const it of items) {
    if (it.type === 'mc' && Number.isInteger(it.key) && Array.isArray(it.choices)) {
      out.mc.n++; bump(out.mc, it.key, it.choices.length);
    } else if (it.type === 'ms' && Array.isArray(it.key) && Array.isArray(it.choices)) {
      out.ms.n++; for (const k of it.key) bump(out.ms, k, it.choices.length);
    } else if (it.type === 'cloze' && Array.isArray(it.blanks)) {
      out.cloze.n++;
      for (const b of it.blanks) if (b && Array.isArray(b.choices) && Number.isInteger(b.key)) bump(out.cloze, b.key, b.choices.length);
    }
  }
  return out;
}

// The offence: a position holding more than an even share plus the slack.
function offenders(bucket) {
  const bad = [];
  if (!bucket.slots || !bucket.width) return bad;
  const even = bucket.slots / bucket.width;
  const ceiling = Math.ceil(even) + SLACK;
  for (let p = 0; p < bucket.width; p++) {
    const c = bucket.counts[p] || 0;
    if (c > ceiling) bad.push({ pos: p, count: c, ceiling, even: +even.toFixed(2) });
  }
  return bad;
}

const problems = [];
const rows = [];
let waveItems = 0;

const files = fs.existsSync(PACK_DIR)
  ? fs.readdirSync(PACK_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.verdicts.json')
      && f !== 'manifest.json' && !f.startsWith('curriculum-'))
  : [];

for (const f of files) {
  let pack;
  try { pack = JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8')); } catch (e) { continue; }
  const id = f.replace(/\.json$/, '');
  const items = pack.items || [];
  const wave = items.filter((it) => it && it.figureFact);
  if (!wave.length) continue;
  waveItems += wave.length;

  const gated = spreadOf(wave);
  const whole = spreadOf(items);
  for (const type of ['mc', 'ms', 'cloze']) {
    const g = gated[type];
    if (!g.slots) continue;
    rows.push({
      id, type, n: g.n, slots: g.slots, width: g.width,
      counts: JSON.stringify(g.counts),
      packCounts: JSON.stringify(whole[type].counts),
      packN: whole[type].n,
    });
    for (const o of offenders(g)) {
      problems.push(`${id} ${type}: position ${o.pos} holds ${o.count} of ${g.slots} keyed slot(s), over the `
        + `${o.ceiling} an even share of ${o.even} allows.  The answer's POSITION is an answer.  `
        + `Spread the keys and re-run the blind pass for every item you move.`);
    }
  }
}

// ---- CONTROLS.  The measurement has to be shown able to fail, on REAL data. ----
const controls = [];
{
  // ela-g6-spy's 24 figure-stimulus items as they stood at 7156c5e, before the spread was fixed.
  const before = [
    ...[0, 1, 0, 0, 0, 2, 3].map((k) => ({ type: 'mc', key: k, choices: [1, 2, 3, 4] })),
    ...[[0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 2, 4], [0, 1, 2], [0, 1, 3]].map((k) => ({ type: 'ms', key: k, choices: [1, 2, 3, 4, 5, 6] })),
    ...[[0, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]].map((ks) => ({ type: 'cloze', blanks: ks.map((k) => ({ key: k, choices: [1, 2, 3] })) })),
  ];
  const b = spreadOf(before);
  const bad = ['mc', 'ms', 'cloze'].filter((t) => offenders(b[t]).length);
  controls.push({
    name: 'NEGATIVE: the real pre-fix distribution goes red',
    ok: bad.length >= 2,
    detail: `red on ${bad.join(', ') || 'nothing'};  mc ${JSON.stringify(b.mc.counts)}, ms ${JSON.stringify(b.ms.counts)}, cloze ${JSON.stringify(b.cloze.counts)}`,
  });

  const after = [
    ...[0, 1, 2, 3, 0, 1, 2].map((k) => ({ type: 'mc', key: k, choices: [1, 2, 3, 4] })),
    ...[[0, 2, 4], [1, 3, 5], [0, 1, 4], [2, 3, 5], [0, 3, 4], [1, 2, 5]].map((k) => ({ type: 'ms', key: k, choices: [1, 2, 3, 4, 5, 6] })),
    ...[[0, 1], [2, 0], [1, 2], [0, 1], [2, 0], [1, 2]].map((ks) => ({ type: 'cloze', blanks: ks.map((k) => ({ key: k, choices: [1, 2, 3] })) })),
  ];
  const a = spreadOf(after);
  const stillBad = ['mc', 'ms', 'cloze'].filter((t) => offenders(a[t]).length);
  controls.push({
    name: 'POSITIVE: the spread that replaced it goes green',
    ok: stillBad.length === 0,
    detail: stillBad.length ? `still red on ${stillBad.join(', ')}` : 'green on all three types',
  });

  // A gate that cannot see a single-position pack is not measuring position at all.
  const allA = spreadOf([...Array(8)].map(() => ({ type: 'mc', key: 0, choices: [1, 2, 3, 4] })));
  controls.push({
    name: 'CONTROL: eight of eight keyed at position A goes red',
    ok: offenders(allA.mc).length > 0,
    detail: JSON.stringify(allA.mc.counts),
  });
}
for (const c of controls) if (!c.ok) problems.push(`CONTROL "${c.name}" failed (${c.detail}); every measurement above is void`);

// ---- report ----
console.log('\n=== key spread: the answer\'s position must not be the answer ===');
console.log('pack'.padEnd(22) + 'type   items  slots  width  key positions (gated)      whole pack');
for (const r of rows) {
  console.log(r.id.padEnd(22) + r.type.padEnd(7) + String(r.n).padEnd(7) + String(r.slots).padEnd(7)
    + String(r.width).padEnd(7) + r.counts.padEnd(27) + r.packCounts + '  over ' + r.packN + ' item(s)');
}
console.log('\n  Gated: items carrying a figureFact.  The "whole pack" column is REPORTED, not enforced:');
console.log('  re-placing a certified item\'s key means re-running its blind pass, which is a pack owner\'s');
console.log('  call and not a gate\'s.  A number far off an even share there is worth someone\'s attention.');

console.log('\ncontrols:');
for (const c of controls) console.log(`  ${c.ok ? 'ok  ' : 'BAD '} ${c.name}  (${c.detail})`);

if (!waveItems) {
  console.log('\nNOT ARMED: no pack carries a figure-stimulus item, so this gate measured nothing.');
  console.log('RESULT: FAILED');
  process.exit(1);
}
if (problems.length) {
  console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
  for (const p of problems) console.log('  ' + p);
  console.log('\nRESULT: FAIL');
  process.exit(1);
}
console.log(`\nRESULT: ALL CLEAN (${rows.length} pack/type group(s), ${waveItems} figure-stimulus item(s), ${controls.length} controls)`);
