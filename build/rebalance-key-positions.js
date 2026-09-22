'use strict';
// rebalance-key-positions.js -- spreads a finished pack's keys evenly across the answer positions.
//
//   node build/rebalance-key-positions.js <pack-id> [--since <git-ref>] [--dry]
//
// WHY.  tests/key-spread.js held only the figure-stimulus items to an even spread and REPORTED the
// rest, because moving a certified key means re-running its blind pass and that was a pack owner's
// call.  Justin made it on 26-0921 ("rewrite item 1 and recheck each one"):  every item is being
// re-checked anyway.  Measured at 2ebf9b8, Vault's EBSR Part A key sat at position A in 48 of 48 sets,
// Cold Signal's mc key in 26 of 43, and Night Rounds keyed 11 of its 15 multi-selects exactly the
// first three options.
//
// build/shuffle-mc.js spreads keys at DRAFT stage and returns a finished item untouched, so it cannot
// do this.  This works on finished items and moves as little as it can:
//
//   - A set is moved by SWAPPING its keyed option with the option at the target position, so two
//     options move and the rest stay where the author put them.
//   - Everything indexed by option travels with it:  the key, distractorRationale (item level, or a
//     cloze blank's own), and for EBSR the Part B key map (its keys are Part A indices, its values
//     Part B indices).
//   - Figure-stimulus items (those with a figureFact) are NEVER moved.  key-spread already holds
//     them to an even spread of their own, and their svgRead notes name options by index ("which is
//     what distractors 0 and 1 turn on"), which a swap would falsify.  Their positions are counted,
//     and the rest are placed around them.
//   - Quotas are an even share, the remainder going to the positions that already hold the most.
//     Sets already at a position under its quota stay put;  among those, sets UNCHANGED since
//     --since (default HEAD) are the ones kept, so the moves land on items whose blind verdict is
//     being re-run already, and as few new items as possible go stale.
//   - A multi-select is moved key by key:  a key at an over-full position trades places with a
//     non-key option at an under-full one, and an item keyed exactly its first k options is broken
//     up first, because "the answers are the top three" is a pattern of its own.
//
// Deterministic:  the same pack and ref give the same moves.  --dry prints them without writing.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const packId = argv[0];
if (!packId || packId.startsWith('--')) { console.error('usage: node build/rebalance-key-positions.js <pack-id> [--since <ref>] [--dry]'); process.exit(2); }
const flag = (f) => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const since = opt('--since', 'HEAD');
const packPath = path.join(ROOT, 'packs', `${packId}.json`);
const raw = fs.readFileSync(packPath, 'utf8');
const pack = JSON.parse(raw);
// Written back at the indent it came in with:  Outpost's pack is one space, the others two.
const INDENT = [2, 1, 4].find((n) => JSON.stringify(pack, null, n) + '\n' === raw);
if (INDENT === undefined) { console.error('pack does not round-trip byte-exact at any indent;  refusing'); process.exit(1); }

let before = new Map();
try {
  const old = JSON.parse(execFileSync('git', ['show', `${since}:packs/${packId}.json`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }));
  before = new Map((old.items || []).map((i) => [i.id, JSON.stringify(i)]));
} catch (e) { console.log(`(no ${since} copy of the pack to compare against;  every item counts as changed)`); }
const changed = (it) => before.get(it.id) !== JSON.stringify(it);

// ---- the swap, with everything indexed by option carried along ----
const swapIn = (arr, a, b) => { const t = arr[a]; arr[a] = arr[b]; arr[b] = t; };
function swapRationale(obj, a, b) {
  if (!obj || typeof obj !== 'object') return;
  const A = obj[a], B = obj[b];
  delete obj[a]; delete obj[b];
  if (B !== undefined) obj[a] = B;
  if (A !== undefined) obj[b] = A;
  // keep the numeric key order the packs are written in
  const sorted = Object.keys(obj).sort((x, y) => Number(x) - Number(y));
  const copy = Object.fromEntries(sorted.map((k) => [k, obj[k]]));
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, copy);
}
const swaps = {
  mc(it, a, b) { swapIn(it.choices, a, b); it.key = it.key === a ? b : it.key === b ? a : it.key; swapRationale(it.distractorRationale, a, b); },
  ms(it, a, b) { swapIn(it.choices, a, b); it.key = it.key.map((k) => (k === a ? b : k === b ? a : k)).sort((x, y) => x - y); swapRationale(it.distractorRationale, a, b); },
  partA(it, a, b) {
    swapIn(it.partA.choices, a, b);
    it.partA.key = it.partA.key === a ? b : it.partA.key === b ? a : it.partA.key;
    swapRationale(it.distractorRationale, a, b);
    swapRationale(it.partB.key, a, b);
  },
  partB(it, a, b) {
    swapIn(it.partB.choices, a, b);
    for (const k of Object.keys(it.partB.key)) { const v = it.partB.key[k]; it.partB.key[k] = v === a ? b : v === b ? a : v; }
  },
  cloze(it, a, b, blank) {
    const bl = it.blanks[blank];
    swapIn(bl.choices, a, b); bl.key = bl.key === a ? b : bl.key === b ? a : bl.key; swapRationale(bl.distractorRationale, a, b);
  },
};

// ---- the sets ----
function setsOf() {
  const out = [];
  for (const it of pack.items || []) {
    const fixed = !!it.figureFact;
    if (it.type === 'mc' && Number.isInteger(it.key)) out.push({ kind: 'mc', it, width: it.choices.length, get: () => it.key, fixed });
    if (it.type === 'ebsr' && it.partA && it.partB && it.partB.key && typeof it.partB.key === 'object') {
      out.push({ kind: 'partA', it, width: it.partA.choices.length, get: () => it.partA.key, fixed });
      out.push({ kind: 'partB', it, width: it.partB.choices.length, get: () => it.partB.key[String(it.partA.key)], fixed });
    }
    if (it.type === 'cloze') (it.blanks || []).forEach((b, i) => out.push({ kind: 'cloze', it, blank: i, width: b.choices.length, get: () => b.key, fixed }));
    if (it.type === 'ms' && Array.isArray(it.key)) out.push({ kind: 'ms', it, width: it.choices.length, get: () => it.key, fixed });
  }
  return out;
}
const tag = (s) => s.it.id + (s.blank !== undefined ? `#${s.blank}` : '');

// THE INVARIANT a move must keep, checked before anything is written:  every item says the same
// thing by option TEXT as it did by index.  Which texts are keyed, which rationale explains which
// option, and which Part B line supports which Part A claim.  A remap that drops one of these
// silently re-keys an item, so the file is not written unless all of them survive.
function meaning(it) {
  const rat = (choices, r) => Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [choices[k], v]));
  if (it.type === 'mc') return { key: it.choices[it.key], rat: rat(it.choices, it.distractorRationale), all: [...it.choices].sort() };
  if (it.type === 'ms') return { key: it.key.map((k) => it.choices[k]).sort(), rat: rat(it.choices, it.distractorRationale), all: [...it.choices].sort() };
  if (it.type === 'ebsr') return {
    key: it.partA.choices[it.partA.key], rat: rat(it.partA.choices, it.distractorRationale),
    support: Object.fromEntries(Object.entries(it.partB.key).map(([a, b]) => [it.partA.choices[a], it.partB.choices[b]])),
    all: [...it.partA.choices].sort().concat([...it.partB.choices].sort()),
  };
  if (it.type === 'cloze') return (it.blanks || []).map((b) => ({ key: b.choices[b.key], rat: rat(b.choices, b.distractorRationale), all: [...b.choices].sort() }));
  return null;
}
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const meant = new Map((pack.items || []).map((it) => [it.id, canon(meaning(it))]));

const moves = [];
const groups = new Map();
for (const s of setsOf()) { const g = `${s.kind}/${s.width}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }

for (const [g, list] of groups) {
  const w = list[0].width;
  if (list[0].kind !== 'ms') {
    const n = list.length;
    const now = Array(w).fill(0); list.forEach((s) => now[s.get()]++);
    const quota = Array(w).fill(Math.floor(n / w));
    now.map((c, p) => [c, p]).sort((x, y) => y[0] - x[0] || x[1] - y[1]).slice(0, n - Math.floor(n / w) * w).forEach(([, p]) => quota[p]++);
    const need = quota.slice();
    list.filter((s) => s.fixed).forEach((s) => need[s.get()]--);
    if (need.some((x) => x < 0)) { console.error(`${g}: the figure items alone overfill a position (${JSON.stringify(need)});  fix key-spread first`); process.exit(1); }
    const movable = list.filter((s) => !s.fixed)
      .sort((a, b) => (changed(a.it) - changed(b.it)) || (tag(a) < tag(b) ? -1 : 1));   // unchanged first:  they are the ones kept
    const toPlace = [];
    for (const s of movable) { const p = s.get(); if (need[p] > 0) need[p]--; else toPlace.push(s); }
    toPlace.sort((a, b) => (tag(a) < tag(b) ? -1 : 1));
    for (const s of toPlace) {
      const from = s.get();
      const to = need.findIndex((x) => x > 0);
      need[to]--;
      swaps[s.kind](s.it, from, to, s.blank);
      moves.push(`${g.padEnd(9)} ${tag(s)}:  key ${from} -> ${to}${changed(s.it) ? '' : '   (was unchanged)'}`);
    }
    continue;
  }
  // ms, key by key.
  const slots = list.reduce((a, s) => a + s.get().length, 0);
  const quota = Array(w).fill(Math.floor(slots / w));
  const now = Array(w).fill(0); list.forEach((s) => s.get().forEach((k) => now[k]++));
  now.map((c, p) => [c, p]).sort((x, y) => y[0] - x[0] || x[1] - y[1]).slice(0, slots - Math.floor(slots / w) * w).forEach(([, p]) => quota[p]++);
  const count = () => { const c = Array(w).fill(0); list.forEach((s) => s.get().forEach((k) => c[k]++)); return c; };
  const firstK = (s) => s.get().every((k, i) => k === i);
  const movable = list.filter((s) => !s.fixed);
  const order = [...movable].sort((a, b) => (firstK(b) - firstK(a)) || (changed(b.it) - changed(a.it)) || (tag(a) < tag(b) ? -1 : 1));
  let guard = 0;
  for (;;) {
    if (++guard > 500) { console.error(`${g}: did not settle in 500 moves`); process.exit(1); }
    const c = count();
    const over = c.map((x, p) => [x - quota[p], p]).filter(([d]) => d > 0).sort((x, y) => y[0] - x[0] || x[1] - y[1]).map(([, p]) => p);
    const under = c.map((x, p) => [quota[p] - x, p]).filter(([d]) => d > 0).sort((x, y) => y[0] - x[0] || x[1] - y[1]).map(([, p]) => p);
    const stuck = movable.filter(firstK);
    let done = false;
    // First break up any item keyed exactly its first k options, trading its highest key for a free
    // position, preferring an under-full one.
    if (stuck.length) {
      const s = order.find(firstK);
      const ks = s.get();
      const free = [...Array(w).keys()].filter((p) => !ks.includes(p));
      const to = free.find((p) => under.includes(p)) ?? free[free.length - 1];
      const from = over.find((p) => ks.includes(p)) ?? ks[ks.length - 1];
      swaps.ms(s.it, from, to);
      moves.push(`${g.padEnd(9)} ${tag(s)}:  key ${from} -> ${to}  (was keyed its first ${ks.length})`);
      done = true;
    } else if (over.length && under.length) {
      for (const s of order) {
        const ks = s.get();
        const from = over.find((p) => ks.includes(p));
        const to = under.find((p) => !ks.includes(p));
        if (from === undefined || to === undefined) continue;
        swaps.ms(s.it, from, to);
        if (firstK(s)) { swaps.ms(s.it, to, from); continue; }   // never create the pattern it just broke
        moves.push(`${g.padEnd(9)} ${tag(s)}:  key ${from} -> ${to}${changed(s.it) ? '' : '   (was unchanged)'}`);
        done = true;
        break;
      }
    }
    if (!done) break;
  }
}

const after = new Map();
for (const s of setsOf()) { const g = `${s.kind}/${s.width}`; if (!after.has(g)) after.set(g, Array(s.width).fill(0)); const k = s.get(); (Array.isArray(k) ? k : [k]).forEach((p) => after.get(g)[p]++); }
console.log(`rebalance ${packId}:  ${moves.length} move(s)`);
moves.forEach((m) => console.log('  ' + m));
for (const [g, c] of after) console.log(`  ${g.padEnd(9)} positions now ${JSON.stringify(c)}`);
const broken = (pack.items || []).filter((it) => canon(meaning(it)) !== meant.get(it.id)).map((it) => it.id);
if (broken.length) { console.error(`REFUSED:  ${broken.length} item(s) would say something different by option text:  ${broken.join(', ')}`); process.exit(1); }
console.log(`  invariant held:  every item keys, explains and supports the same option TEXT as before`);
if (flag('--dry')) { console.log('(dry run, nothing written)'); process.exit(0); }
fs.writeFileSync(packPath, JSON.stringify(pack, null, INDENT) + '\n');
console.log(`written ${packPath}`);
