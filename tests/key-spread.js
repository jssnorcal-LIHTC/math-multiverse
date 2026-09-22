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
// WIDENED 26-0921, BY THE PACK OWNER.  Justin:  "rewrite item 1 and recheck each one", all five
// reading packs.  Every item in those packs is being re-checked anyway, so the reason for reporting
// the rest and gating only the wave is gone, and the whole of each READING pack (every pack but the
// math one) is now gated too, by the same even-share rule, grouped by kind and width, with
// EBSR Part A and the Part B line mapped from Part A's key counted as sets of their own.  Measured at
// 2ebf9b8:  Vault's Part A key sat at position A in 48 of 48 sets, Cold Signal's mc key in 26 of 43,
// and Night Rounds keyed 11 of its 15 multi-selects exactly their first three options.  A
// multi-select keyed exactly its first k options now fails on its own, because "the answers are the
// top ones" is a pattern whatever the per-position counts say.  build/rebalance-key-positions.js
// does the moving.  The math pack is generated, is not a reading pack, and stays REPORTED.
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

// The offence: a position holding more than an even share plus the slack -- OR FEWER THAN AN EVEN
// SHARE MINUS IT.
//
// WHY THERE IS A FLOOR, added 26-0905.  The first version of this gate had a ceiling only, and a
// ceiling-only gate cannot see the over-correction it causes.  The Vault C-wave was authored under a
// brief that quoted this gate, and it came back with NINE mc keys at positions {1:4, 2:1, 3:4} and
// TEN cloze blanks at {1:5, 2:5}: not one key at A, and not one cloze key at index 0.  The gate was
// green.  "The answer is never the first option" is exactly as learnable as "the answer is always
// the first option", and a child who eliminates A on sight is reading the test rather than the
// drawing -- the very thing this file exists to stop.  Under a uniform draw that pair of holes has
// probability 0.0013, so it was the brief's doing, not chance.
//
// The floor is the ceiling's mirror and it degrades safely: with fewer slots than positions,
// floor(even) - SLACK goes to zero or below and nothing can be flagged, so a short wave is never
// punished for a hole it had no room to fill.  Checked against the two shipped packs before it
// landed: Cold Signal mc {0:2,1:2,2:2,3:1} and cloze {0:4,1:4,2:4}, and night-rounds, all clear.
function offenders(bucket) {
  const bad = [];
  if (!bucket.slots || !bucket.width) return bad;
  const even = bucket.slots / bucket.width;
  const ceiling = Math.ceil(even) + SLACK;
  const floorN = Math.max(0, Math.floor(even) - SLACK);
  for (let p = 0; p < bucket.width; p++) {
    const c = bucket.counts[p] || 0;
    if (c > ceiling) bad.push({ pos: p, count: c, ceiling, even: +even.toFixed(2), how: 'over' });
    else if (c < floorN) bad.push({ pos: p, count: c, floor: floorN, even: +even.toFixed(2), how: 'under' });
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
      problems.push(o.how === 'over'
        ? `${id} ${type}: position ${o.pos} holds ${o.count} of ${g.slots} keyed slot(s), over the `
          + `${o.ceiling} an even share of ${o.even} allows.  The answer's POSITION is an answer.  `
          + `Spread the keys and re-run the blind pass for every item you move.`
        : `${id} ${type}: position ${o.pos} holds only ${o.count} of ${g.slots} keyed slot(s), under `
          + `the ${o.floor} an even share of ${o.even} requires.  A position the answer NEVER takes is `
          + `as learnable as one it always takes.  Spread the keys and re-run the blind pass for `
          + `every item you move.`);
    }
  }
}

// ---- WHOLE READING PACKS (26-0921) ----
// Single-answer sets by kind and width;  a multi-select by width, one slot per key.
function wholeGroups(items) {
  const g = new Map();
  const bucket = (k, width) => { if (!g.has(k)) g.set(k, { counts: {}, slots: 0, width, n: 0, firstK: [] }); return g.get(k); };
  const bump = (b, pos) => { b.counts[pos] = (b.counts[pos] || 0) + 1; b.slots++; };
  for (const it of items) {
    if (it.type === 'mc' && Number.isInteger(it.key) && Array.isArray(it.choices)) {
      const b = bucket(`mc/${it.choices.length}`, it.choices.length); b.n++; bump(b, it.key);
    } else if (it.type === 'ebsr' && it.partA && it.partB && Number.isInteger(it.partA.key)) {
      const a = bucket(`partA/${it.partA.choices.length}`, it.partA.choices.length); a.n++; bump(a, it.partA.key);
      const kb = it.partB.key && typeof it.partB.key === 'object' ? it.partB.key[String(it.partA.key)] : null;
      if (Number.isInteger(kb)) { const b = bucket(`partB/${it.partB.choices.length}`, it.partB.choices.length); b.n++; bump(b, kb); }
    } else if (it.type === 'cloze' && Array.isArray(it.blanks)) {
      for (const bl of it.blanks) if (bl && Array.isArray(bl.choices) && Number.isInteger(bl.key)) { const b = bucket(`cloze/${bl.choices.length}`, bl.choices.length); b.n++; bump(b, bl.key); }
    } else if (it.type === 'ms' && Array.isArray(it.key) && Array.isArray(it.choices)) {
      const b = bucket(`ms/${it.choices.length}`, it.choices.length); b.n++;
      for (const k of it.key) bump(b, k);
      if (it.key.length && [...it.key].sort((x, y) => x - y).every((k, i) => k === i)) b.firstK.push(it.id || '(item)');
    }
  }
  return g;
}
const wholeRows = [];
for (const f of files) {
  let pack;
  try { pack = JSON.parse(fs.readFileSync(path.join(PACK_DIR, f), 'utf8')); } catch (e) { continue; }
  const id = f.replace(/\.json$/, '');
  const items = pack.items || [];
  const reading = ((pack.meta && pack.meta.subject) || '') !== 'math';   // the math pack has passages too
  for (const [k, b] of wholeGroups(items)) {
    wholeRows.push({ id, k, n: b.n, counts: JSON.stringify(b.counts), gated: reading });
    if (!reading) continue;
    for (const o of offenders(b)) {
      problems.push(`${id} ${k} (whole pack):  position ${o.pos} holds ${o.count} of ${b.slots} keyed slot(s), `
        + (o.how === 'over' ? `over the ${o.ceiling}` : `under the ${o.floor}`) + ` an even share of ${o.even} allows.  `
        + `node build/rebalance-key-positions.js ${id} spreads them;  re-run the blind pass for every item it moves.`);
    }
    if (b.firstK.length) problems.push(`${id} ${k} (whole pack):  ${b.firstK.length} multi-select(s) keyed exactly their first options:  ${b.firstK.join(', ')}`);
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

  // NEGATIVE CONTROL FOR THE FLOOR, on the real numbers that exposed the gap: the Vault C-wave as
  // its authors first returned it, 9 mc keys and 10 cloze blanks with position 0 empty in both.
  // This passed the ceiling-only version of this gate.
  const holed = [
    ...[1, 1, 1, 1, 2, 3, 3, 3, 3].map((k) => ({ type: 'mc', key: k, choices: [1, 2, 3, 4] })),
    ...[[1, 2], [1, 2], [1, 2], [1, 2], [1, 2]].map((ks) => ({ type: 'cloze', blanks: ks.map((k) => ({ key: k, choices: [1, 2, 3] })) })),
  ];
  const h = spreadOf(holed);
  const holeBad = ['mc', 'cloze'].filter((t) => offenders(h[t]).some((o) => o.how === 'under'));
  controls.push({
    name: 'NEGATIVE: a position the answer NEVER takes goes red',
    ok: holeBad.length === 2,
    detail: `under-flagged on ${holeBad.join(', ') || 'nothing'};  mc ${JSON.stringify(h.mc.counts)}, cloze ${JSON.stringify(h.cloze.counts)}`,
  });

  // CONTROL: a wave too short to fill every position must NOT be flagged for the holes it had no
  // room to fill, or the floor would punish every small wave.
  const tiny = spreadOf([{ type: 'mc', key: 0, choices: [1, 2, 3, 4] }, { type: 'mc', key: 2, choices: [1, 2, 3, 4] }]);
  controls.push({
    name: 'CONTROL: two items over four positions are NOT flagged for the two they cannot fill',
    ok: offenders(tiny.mc).length === 0,
    detail: JSON.stringify(tiny.mc.counts),
  });

  // A gate that cannot see a single-position pack is not measuring position at all.
  const allA = spreadOf([...Array(8)].map(() => ({ type: 'mc', key: 0, choices: [1, 2, 3, 4] })));
  controls.push({
    name: 'CONTROL: eight of eight keyed at position A goes red',
    ok: offenders(allA.mc).length > 0,
    detail: JSON.stringify(allA.mc.counts),
  });
}
{
  // WHOLE-PACK CONTROLS, on the real shapes that widened the gate:  Vault's Part A at 2ebf9b8 (48 of
  // 48 at position A), and a multi-select keyed exactly its first three.
  const vaultA = wholeGroups([...Array(48)].map(() => ({ type: 'ebsr', partA: { choices: [1, 2, 3, 4], key: 0 }, partB: { choices: [1, 2, 3, 4], key: { 0: 0, 1: 1, 2: 2, 3: 3 } } })));
  controls.push({ name: 'NEGATIVE (whole pack): Vault Part A as it stood, 48 of 48 at A, goes red',
    ok: offenders(vaultA.get('partA/4')).length > 0, detail: JSON.stringify(vaultA.get('partA/4').counts) });
  const evenA = wholeGroups([...Array(48)].map((_, i) => ({ type: 'ebsr', partA: { choices: [1, 2, 3, 4], key: i % 4 }, partB: { choices: [1, 2, 3, 4], key: { 0: (i + 1) % 4, 1: (i + 1) % 4, 2: (i + 1) % 4, 3: (i + 1) % 4 } } })));
  controls.push({ name: 'POSITIVE (whole pack): the spread the rebalancer leaves, 12/12/12/12 on both parts, goes green',
    ok: !offenders(evenA.get('partA/4')).length && !offenders(evenA.get('partB/4')).length,
    detail: `${JSON.stringify(evenA.get('partA/4').counts)} / ${JSON.stringify(evenA.get('partB/4').counts)}` });
  const top3 = wholeGroups([{ type: 'ms', id: 'x', choices: [1, 2, 3, 4, 5, 6], key: [0, 1, 2] }]);
  controls.push({ name: 'NEGATIVE (whole pack): a multi-select keyed exactly its first three is caught',
    ok: top3.get('ms/6').firstK.length === 1, detail: JSON.stringify(top3.get('ms/6').firstK) });
}
for (const c of controls) if (!c.ok) problems.push(`CONTROL "${c.name}" failed (${c.detail}); every measurement above is void`);

// ---- report ----
console.log('\n=== key spread: the answer\'s position must not be the answer ===');
console.log('pack'.padEnd(22) + 'type   items  slots  width  key positions (gated)      whole pack');
for (const r of rows) {
  console.log(r.id.padEnd(22) + r.type.padEnd(7) + String(r.n).padEnd(7) + String(r.slots).padEnd(7)
    + String(r.width).padEnd(7) + r.counts.padEnd(27) + r.packCounts + '  over ' + r.packN + ' item(s)');
}
console.log('\n  Gated above: items carrying a figureFact.  Below: every set in each pack, gated for the reading');
console.log('  packs (the pack owner\'s call, 26-0921) and reported for the generated math pack.');
console.log('\n' + 'pack'.padEnd(22) + 'group      sets   key positions');
for (const r of wholeRows) console.log(r.id.padEnd(22) + r.k.padEnd(11) + String(r.n).padEnd(7) + r.counts + (r.gated ? '' : '   (reported only)'));

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
