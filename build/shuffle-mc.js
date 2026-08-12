'use strict';
// shuffle-mc.js -- turns position-neutral mc drafts into final {choices, key,
// distractorRationale} items, spreading the correct answer evenly across the four positions.
//
// WHY THIS IS COMMITTED. A hand-placed key is a learnable pattern: a child who notices the answer
// is usually B stops reading. Three near-identical copies of this algorithm existed before this
// file, one per content wave (vault-of-ages, then outpost-protocol "adapted directly from" it,
// then firsthand "adapted directly from" that), each hard-wired to its own pack's draft filenames
// and none of them diffable against the others. Three uncommitted copies is how the bias comes
// back quietly. One committed tool with a gate is the fix.
//
// DRAFT SHAPE IN:   { id, type: 'mc', stem, _correct: '...', _wrong: [{text, why} x3], ... }
// FINAL SHAPE OUT:  { id, type: 'mc', stem, choices: [4], key: <int>, distractorRationale: {...} }
// Anything that is not an mc draft passes through untouched, so a mixed bundle can be piped
// straight in.
//
// SPREAD. Positions are assigned by walking a rotation (0,1,2,3,0,1,...) whose START is chosen by
// the seed, rather than by drawing at random per item: random draws give a balanced spread only in
// expectation, and a wave of 24 can easily land 9/4/6/5. The rotation guarantees every position is
// within one of N/4 for any N, which is what the gate asserts.
//
// The seed rotates the starting offset and the ORDER positions are walked in, so two waves built
// with different seeds do not place their keys identically while both staying balanced.

function refuse(id, why) {
  throw new Error(`shuffle-mc: ${id}: ${why}`);
}

// A tiny deterministic PRNG. Math.random cannot be used: the whole point is that a given seed
// reproduces a given arrangement, so a re-run after an unrelated edit does not silently re-place
// every key and invalidate a ledger.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return function next() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function isMcDraft(d) {
  return d && typeof d === 'object' && d.type === 'mc' && ('_correct' in d || '_wrong' in d);
}

function shuffleDrafts(drafts, opts) {
  const seed = (opts && Number.isInteger(opts.seed)) ? opts.seed : 1;
  const next = rng(seed);
  // A seeded permutation of the four positions, walked in rotation. Balanced for any N by
  // construction, and seed-dependent so two waves do not share an arrangement.
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // The seed also picks where in the rotation the wave STARTS. Without this the whole arrangement
  // space is just the 24 permutations of four positions, so two arbitrary seeds collide often;
  // with it the space is 96. Collisions are still possible and that is fine -- balance holds
  // either way, and the seed exists so a rebuild REPRODUCES an arrangement, with variation second.
  let n = Math.floor(next() * 4);
  return drafts.map((d) => {
    if (!isMcDraft(d)) return d;
    const id = d.id || '(unnamed)';
    if (typeof d._correct !== 'string' || !d._correct.trim()) refuse(id, 'no _correct string');
    if (!Array.isArray(d._wrong) || d._wrong.length !== 3) {
      refuse(id, `expected exactly 3 _wrong entries, got ${Array.isArray(d._wrong) ? d._wrong.length : typeof d._wrong}`);
    }
    for (const [i, w] of d._wrong.entries()) {
      if (!w || typeof w.text !== 'string' || !w.text.trim()) refuse(id, `_wrong[${i}] has no text`);
      if (typeof w.why !== 'string' || !w.why.trim()) refuse(id, `_wrong[${i}] has no why (the named misconception)`);
    }
    const texts = [d._correct].concat(d._wrong.map((w) => w.text));
    if (new Set(texts.map((t) => t.trim())).size !== 4) {
      // Two identical choices make the item ungradable and a blind pass would disagree for a
      // reason that has nothing to do with the key.
      refuse(id, 'two choices have the same text');
    }

    const key = order[n % 4];
    n++;
    const choices = new Array(4);
    choices[key] = d._correct;
    const distractorRationale = {};
    let wi = 0;
    for (let i = 0; i < 4; i++) {
      if (i === key) continue;
      choices[i] = d._wrong[wi].text;
      distractorRationale[i] = d._wrong[wi].why;
      wi++;
    }
    const out = Object.assign({}, d, { choices, key, distractorRationale });
    delete out._correct;
    delete out._wrong;
    return out;
  });
}

function keySpread(items) {
  const spread = {};
  for (const it of items) {
    if (!it || it.type !== 'mc' || !Number.isInteger(it.key)) continue;
    spread[it.key] = (spread[it.key] || 0) + 1;
  }
  return spread;
}

function main(argv) {
  const fs = require('fs');
  const args = argv.slice(2);
  const inFile = args[0];
  const outIdx = args.indexOf('--out');
  const seedIdx = args.indexOf('--seed');
  if (!inFile || outIdx === -1) {
    console.error('usage: node build/shuffle-mc.js <drafts.json> --out <final.json> [--seed <n>]');
    return 2;
  }
  const seed = seedIdx === -1 ? 1 : parseInt(args[seedIdx + 1], 10);
  const drafts = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  if (!Array.isArray(drafts)) { console.error('shuffle-mc: input must be a JSON array of drafts'); return 2; }
  const out = shuffleDrafts(drafts, { seed });
  fs.writeFileSync(args[outIdx + 1], JSON.stringify(out, null, 2), 'utf8');
  const spread = keySpread(out);
  console.log(`shuffle-mc: ${out.length} draft(s), key spread ${JSON.stringify(spread)}, seed ${seed}`);
  return 0;
}

module.exports = { shuffleDrafts, keySpread };
if (require.main === module) process.exit(main(process.argv));
