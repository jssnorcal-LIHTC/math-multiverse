'use strict';
// answer-cues.js -- an answer's LENGTH must not be the answer.
//
//   node tests/answer-cues.js                  every reading pack;  exits 1 on any cue
//   node tests/answer-cues.js --targets <pack> the edit list for one pack, as JSON (see TARGETS)
//
// WHY THIS EXISTS.  tests/key-spread.js stops the answer's POSITION from being the answer.  Nothing
// stopped its LENGTH, and "pick the longest option" is the oldest test-wise rule there is:  the key
// gets written carefully, qualified until it is exactly true, and the distractors get written
// quickly.  Measured on the five reading packs at 2ebf9b8 (26-0921), by the rule below:
//
//     Vault of Ages    EBSR Part A   the key is the longest option in 47 of 48 sets   (98%)
//     Cold Signal      mc            longest in 80%;  Part A 74%;  cloze blanks 64%
//     Night Rounds     mc            78%;  cloze 59%
//     Outpost, Firsthand  Part A     81%, 85%
//
// against a chance rate of 25% (four options) or 33% (three).  A child who never read a passage and
// always tapped the longest option would have passed most of these levels.  Part B, where every
// option is a sentence quoted from the passage, was already at chance in every pack:  nobody wrote
// those to length.  Justin, 26-0921:  "rewrite item 1 and recheck each one", all five reading packs.
//
// THE RULE.  A single-answer set (an mc, an EBSR Part A, an EBSR Part B read against the Part A key,
// or one cloze blank) gives its key a LENGTH RANK:  1 is the longest option, w the shortest, and a
// tie splits the set evenly across the ranks it spans.  Grouped by pack, kind and width, the share
// of sets whose key holds rank r must be at most 4/(3w) for EVERY r:  a third over chance, which is
// 1/3 with four options and 4/9 with three.  Holding every rank, not only the first, is deliberate.
// A gate on "longest" alone is passed by making every key the second-longest, and "skip the longest
// and the shortest, pick a middle one" is the next test-wise rule a child learns.  Checking the
// shortest rank closes the reverse cue that an over-correction produces.
//
// A multi-select set with k keys among n options is held to the same margin:  a child who taps the k
// longest options may find, on average, at most 4/3 of the k*k/n keys chance would give them, and
// the same for the k shortest.
//
// Length is characters, trimmed:  what the eye measures on the screen.  A group with fewer than 2w
// sets is reported and not gated, because a share over six sets says nothing.
//
// TARGETS.  --targets <pack> prints, for every group of that pack the gate FAILS, the sets to change
// and the length rank each should move to.  The ranks come out even:  each rank gets an equal quota, the sets
// already holding a rank keep it up to that quota (those most firmly placed first, so the cheapest
// sets are the ones moved), and every other set goes to an open rank by the fewest characters it
// would take to get there.  Deterministic, so two runs on the same pack give the same list.
//
// CONTROLS in the same pass, on synthetic sets built to each shape:  the real pre-fix Vault Part A
// distribution goes red;  an even distribution goes green;  every key at the second rank goes red;
// every key the shortest goes red;  all-equal lengths go green;  an ms whose keys are always the
// longest goes red and an interleaved one goes green.  If a gated pack yields no group at all, the
// run FAILS as unarmed.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const len = (s) => String(s == null ? '' : s).trim().length;
const capFor = (w) => 4 / (3 * w);
const MIN_SETS = (w) => 2 * w;

// Every answer set in a pack.  `field` is the item path to the set's choices, for the targets list.
function setsOf(pack) {
  const out = [];
  for (const it of pack.items || []) {
    if (it.type === 'mc' && Array.isArray(it.choices) && Number.isInteger(it.key)) {
      out.push({ kind: 'mc', id: it.id, field: 'choices', choices: it.choices, key: it.key });
    } else if (it.type === 'ebsr' && it.partA && it.partB) {
      if (Array.isArray(it.partA.choices) && Number.isInteger(it.partA.key)) {
        out.push({ kind: 'partA', id: it.id, field: 'partA.choices', choices: it.partA.choices, key: it.partA.key });
        const kb = it.partB.key && typeof it.partB.key === 'object' && !Array.isArray(it.partB.key)
          ? it.partB.key[it.partA.key] : it.partB.key;
        if (Number.isInteger(kb) && Array.isArray(it.partB.choices)) {
          out.push({ kind: 'partB', id: it.id, field: 'partB.choices', choices: it.partB.choices, key: kb });
        }
      }
    } else if (it.type === 'cloze' && Array.isArray(it.blanks)) {
      it.blanks.forEach((b, i) => {
        if (b && Array.isArray(b.choices) && Number.isInteger(b.key)) {
          out.push({ kind: 'cloze', id: it.id, field: `blanks.${i}.choices`, choices: b.choices, key: b.key });
        }
      });
    } else if (it.type === 'ms' && Array.isArray(it.choices) && Array.isArray(it.key) && it.key.length) {
      out.push({ kind: 'ms', id: it.id, field: 'choices', choices: it.choices, keys: it.key });
    }
  }
  return out;
}

// The key's length rank, 1-based, as a list of the ranks a tie spans.
function rankSpan(choices, key) {
  const ls = choices.map(len);
  const longer = ls.filter((l) => l > ls[key]).length;
  const tied = ls.filter((l) => l === ls[key]).length;
  return Array.from({ length: tied }, (_, j) => longer + 1 + j);
}

// How many of the k longest (or shortest) options are keys, with ties split fairly:  the expected
// number a child would find by tapping k options by length and breaking ties at random.
function lengthPickHits(choices, keys, longest) {
  const ls = choices.map(len);
  const k = keys.length;
  const ks = new Set(keys);
  const sorted = [...new Set(ls)].sort((a, b) => (longest ? b - a : a - b));
  let left = k, hits = 0;
  for (const l of sorted) {
    if (left <= 0) break;
    const at = ls.map((x, i) => [x, i]).filter(([x]) => x === l).map(([, i]) => i);
    const take = Math.min(left, at.length);
    hits += take * (at.filter((i) => ks.has(i)).length / at.length);
    left -= take;
  }
  return hits;
}

// Groups:  single-answer sets by kind and width, ms by kind alone.
function measure(sets) {
  const groups = new Map();
  for (const s of sets) {
    const gk = s.kind === 'ms' ? 'ms' : `${s.kind}/${s.choices.length}`;
    if (!groups.has(gk)) groups.set(gk, { kind: s.kind, width: s.kind === 'ms' ? null : s.choices.length, sets: [] });
    groups.get(gk).sets.push(s);
  }
  const out = [];
  for (const [gk, g] of groups) {
    if (g.kind === 'ms') {
      let chance = 0, longHits = 0, shortHits = 0, keySlots = 0;
      for (const s of g.sets) {
        const k = s.keys.length, n = s.choices.length;
        chance += (k * k) / n;
        keySlots += k;
        longHits += lengthPickHits(s.choices, s.keys, true);
        shortHits += lengthPickHits(s.choices, s.keys, false);
      }
      const gated = g.sets.length >= 8;
      const bad = [];
      if (gated && longHits > (4 / 3) * chance + 1e-9) bad.push(`tapping the k longest options finds ${longHits.toFixed(1)} of ${keySlots} keys, over the ${((4 / 3) * chance).toFixed(1)} a third over chance allows (chance ${chance.toFixed(1)})`);
      if (gated && shortHits > (4 / 3) * chance + 1e-9) bad.push(`tapping the k shortest options finds ${shortHits.toFixed(1)} of ${keySlots} keys, over the ${((4 / 3) * chance).toFixed(1)} a third over chance allows (chance ${chance.toFixed(1)})`);
      out.push({ gk, kind: 'ms', n: g.sets.length, gated, bad,
        summary: `longest-k ${longHits.toFixed(1)}, shortest-k ${shortHits.toFixed(1)}, chance ${chance.toFixed(1)} of ${keySlots} keys` });
      continue;
    }
    const w = g.width;
    const share = Array(w).fill(0);
    for (const s of g.sets) { const span = rankSpan(s.choices, s.key); for (const r of span) share[r - 1] += 1 / span.length; }
    const n = g.sets.length;
    const cap = capFor(w);
    const gated = n >= MIN_SETS(w);
    const bad = [];
    if (gated) share.forEach((c, i) => { if (c / n > cap + 1e-9) bad.push(`the key holds length rank ${i + 1} of ${w}${i === 0 ? ' (longest)' : i === w - 1 ? ' (shortest)' : ''} in ${c.toFixed(1)} of ${n} sets, ${(100 * c / n).toFixed(0)}%, over the ${(100 * cap).toFixed(0)}% a third over chance allows`); });
    out.push({ gk, kind: g.kind, width: w, n, gated, bad, share,
      summary: `ranks ${share.map((c) => (100 * c / n).toFixed(0) + '%').join(' / ')}  (longest first;  cap ${(100 * cap).toFixed(0)}% each)` });
  }
  return out;
}

// ---- TARGETS ----
// Characters needed to move a single-answer set's key to rank r:  lengthen the distractors that must
// pass it, or pad the ones that must fall behind it (whichever side r lies on), one character past.
function costTo(s, r) {
  const ls = s.choices.map(len);
  const kl = ls[s.key];
  const others = ls.filter((_, i) => i !== s.key).sort((a, b) => b - a);   // longest first
  let cost = 0;
  // r - 1 distractors must be strictly longer than the key, the rest strictly shorter.
  others.forEach((l, j) => {
    if (j < r - 1) cost += Math.max(0, kl + 1 - l);
    else cost += Math.max(0, l - (kl - 1));
  });
  return cost;
}
const firmness = (s, r) => { // how far the set would have to move to leave rank r:  bigger keeps first
  const w = s.choices.length;
  return Math.min(...Array.from({ length: w }, (_, j) => j + 1).filter((q) => q !== r).map((q) => costTo(s, q)));
};

function targetsFor(pack) {
  const sets = setsOf(pack);
  // Only a group the gate fails is re-authored.  A passing group is left as it is, whatever its
  // spread:  Part B's options are sentences quoted from the passage, at chance in every pack already,
  // and re-choosing a quotation to even out a distribution nobody can exploit is churn, not a fix.
  const failing = new Set(measure(sets).filter((g) => g.gated && g.bad.length).map((g) => g.gk));
  const groups = new Map();
  for (const s of sets) {
    if (s.kind === 'ms') continue;
    if (!failing.has(`${s.kind}/${s.choices.length}`)) continue;
    const gk = `${s.kind}/${s.choices.length}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(s);
  }
  const edits = [];
  for (const [gk, list] of groups) {
    const w = list[0].choices.length;
    if (list.length < MIN_SETS(w)) continue;
    const n = list.length;
    // Integer quotas summing to n.  The remainder goes to the ranks holding the most sets now, so the
    // fewest sets move.
    const now = Array(w).fill(0);
    const cur = new Map(list.map((s) => { const span = rankSpan(s.choices, s.key); return [s, span.length === 1 ? span[0] : null]; }));
    for (const r of cur.values()) if (r) now[r - 1]++;
    const quota = Array(w).fill(Math.floor(n / w));
    const order = now.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i);
    for (let e = 0; e < n - Math.floor(n / w) * w; e++) quota[order[e]]++;
    const assigned = new Map();
    for (let r = 1; r <= w; r++) {
      const here = list.filter((s) => cur.get(s) === r)
        .sort((a, b) => firmness(b, r) - firmness(a, r) || (a.id + a.field < b.id + b.field ? -1 : 1));
      here.slice(0, quota[r - 1]).forEach((s) => assigned.set(s, r));
    }
    const left = quota.map((q, i) => q - [...assigned.values()].filter((r) => r === i + 1).length);
    let pool = list.filter((s) => !assigned.has(s));
    while (pool.length) {
      let best = null;
      for (const s of pool) {
        for (let r = 1; r <= w; r++) {
          if (left[r - 1] <= 0) continue;
          const c = costTo(s, r);
          const tag = s.id + '|' + s.field;
          if (!best || c < best.c || (c === best.c && (tag < best.tag || (tag === best.tag && r < best.r)))) best = { s, r, c, tag };
        }
      }
      assigned.set(best.s, best.r);
      left[best.r - 1]--;
      pool = pool.filter((s) => s !== best.s);
    }
    for (const s of list) {
      const t = assigned.get(s);
      if (cur.get(s) === t) continue;
      edits.push({ group: gk, id: s.id, field: s.field, key: s.key,
        currentRank: cur.get(s) || `tied ${rankSpan(s.choices, s.key).join('-')}`, targetRank: t, of: w,
        lengths: s.choices.map(len), charsAtLeast: costTo(s, t) });
    }
  }
  // ms:  the items that give the most keys away to a length-picker, until the pack is at chance.
  const ms = sets.filter((s) => s.kind === 'ms');
  if (failing.has('ms')) {
    const chance = ms.reduce((a, s) => a + (s.keys.length * s.keys.length) / s.choices.length, 0);
    const scored = ms.map((s) => ({ s, long: lengthPickHits(s.choices, s.keys, true), short: lengthPickHits(s.choices, s.keys, false) }));
    const msBad = measure(ms).find((g) => g.gk === 'ms').bad;
    for (const side of ['long', 'short'].filter((sd) => msBad.some((b) => b.includes(sd === 'long' ? 'k longest' : 'k shortest')))) {
      let total = scored.reduce((a, x) => a + x[side], 0);
      const want = chance;   // aim AT chance, so the gate's margin is left unspent
      const byGive = [...scored].sort((a, b) => b[side] - a[side] || (a.s.id < b.s.id ? -1 : 1));
      for (const x of byGive) {
        if (total <= want) break;
        const k = x.s.keys.length;
        const fair = (k * k) / x.s.choices.length;
        if (x[side] <= fair) continue;
        const to = Math.max(0, Math.floor(fair));
        edits.push({ group: 'ms', id: x.s.id, field: 'choices', keys: x.s.keys,
          side: side === 'long' ? `keys among the ${k} longest` : `keys among the ${k} shortest`,
          current: +x[side].toFixed(2), targetAtMost: to, lengths: x.s.choices.map(len) });
        total -= x[side] - to;
      }
    }
  }
  return edits;
}

// ---- run ----
const argv = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'manifest.json'), 'utf8'));
const readPack = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', `${id}.json`), 'utf8'));
// A READING pack is any pack but math.  The math pack is measured and reported, not gated:  the
// directive was the five reading packs, and its generated distractors are at chance already.  (Not
// "has passages":  the math pack carries passages too, on how to read a figure.)
const isReading = (pack) => ((pack.meta && pack.meta.subject) || '') !== 'math';

if (argv[0] === '--targets') {
  const id = argv[1];
  if (!id) { console.error('usage: node tests/answer-cues.js --targets <pack-id>'); process.exit(2); }
  console.log(JSON.stringify(targetsFor(readPack(id)), null, 2));
  process.exit(0);
}

const problems = [];
let gatedGroups = 0;
console.log('=== answer cues: the answer\'s length must not be the answer ===');
for (const e of manifest.packs) {
  const pack = readPack(e.id);
  const reading = isReading(pack);
  const res = measure(setsOf(pack));
  for (const r of res) {
    const gated = reading && r.gated;
    if (gated) gatedGroups++;
    console.log(`  ${e.id.padEnd(22)} ${r.gk.padEnd(9)} n=${String(r.n).padEnd(4)} ${gated ? '' : reading ? '(too few to gate) ' : '(reported only) '}${r.summary}`);
    if (gated) r.bad.forEach((b) => problems.push(`${e.id} ${r.gk}:  ${b}`));
  }
}

// ---- controls ----
{
  // A set of width w whose key holds rank r exactly:  lengths 10, 20, 30, ... with the key placed.
  const at = (w, r) => { const ls = Array.from({ length: w }, (_, i) => 10 * (w - i)); return { kind: 'mc', choices: ls.map((l) => 'x'.repeat(l)), key: r - 1 }; };
  const ranks = (counts) => counts.flatMap((c, i) => Array.from({ length: c }, () => at(counts.length, i + 1)));
  const red = (sets) => measure(sets).some((g) => g.bad.length);
  const cases = [
    ['NEGATIVE: Vault Part A as it stood at 2ebf9b8 (47 longest, 1 shortest, of 48)', ranks([47, 0, 0, 1]), true],
    ['POSITIVE: an even spread, 12/12/12/12', ranks([12, 12, 12, 12]), false],
    ['NEGATIVE: every key the second-longest (the "pick a middle one" rule)', ranks([0, 48, 0, 0]), true],
    ['NEGATIVE: every key the shortest (the over-correction)', ranks([0, 0, 0, 48]), true],
    ['POSITIVE: all options the same length', Array.from({ length: 12 }, () => ({ kind: 'mc', choices: ['aaaa', 'bbbb', 'cccc', 'dddd'], key: 0 })), false],
    ['NEGATIVE: an ms whose three keys are always the three longest',
      Array.from({ length: 10 }, () => ({ kind: 'ms', choices: ['x'.repeat(60), 'x'.repeat(50), 'x'.repeat(40), 'x'.repeat(30), 'x'.repeat(20), 'x'.repeat(10)], keys: [0, 1, 2] })), true],
    ['POSITIVE: an ms whose keys interleave with the distractors',
      Array.from({ length: 10 }, (_, i) => ({ kind: 'ms', choices: ['x'.repeat(60), 'x'.repeat(50), 'x'.repeat(40), 'x'.repeat(30), 'x'.repeat(20), 'x'.repeat(10)], keys: i % 2 ? [0, 3, 4] : [1, 2, 5] })), false],
  ];
  console.log('\ncontrols:');
  for (const [name, sets, wantRed] of cases) {
    const got = red(sets);
    console.log(`  ${got === wantRed ? 'ok  ' : 'BAD '} ${name}  (${got ? 'red' : 'green'})`);
    if (got !== wantRed) problems.push(`CONTROL "${name}" came back ${got ? 'red' : 'green'};  every measurement above is void`);
  }
}

if (!gatedGroups) {
  console.log('\nNOT ARMED: no reading pack yielded a group large enough to gate.');
  console.log('RESULT: FAILED');
  process.exit(1);
}
if (problems.length) {
  console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
  problems.forEach((p) => console.log('  ' + p));
  console.log('\n  node tests/answer-cues.js --targets <pack> lists the sets to change and the rank each should reach.');
  console.log('\nRESULT: FAILED');
  process.exit(1);
}
console.log(`\nRESULT: ALL CLEAN (${gatedGroups} gated group(s))`);
