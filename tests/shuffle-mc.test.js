'use strict';
// Gate for build/shuffle-mc.js.
//
// Why this tool is committed rather than re-adapted per pack: three copies existed before this,
// one per content wave, each "adapted directly from" the last and each hard-wired to its own
// pack's draft filenames. Three copies of an algorithm nobody can diff is how a key-position bias
// gets reintroduced quietly, and a hand-placed key is a learnable pattern -- the same defect class
// the ebsr Part-B key shapes had.
const assert = require('assert');
const { shuffleDrafts, keySpread } = require('../build/shuffle-mc.js');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}: ${e && e.message}`); }
}

const draft = (i) => ({
  id: `d${i}`, type: 'mc', stem: `Question ${i}?`,
  _correct: `right-${i}`,
  _wrong: [{ text: `wrong-${i}-a`, why: 'a' }, { text: `wrong-${i}-b`, why: 'b' }, { text: `wrong-${i}-c`, why: 'c' }],
});
const drafts = (n) => Array.from({ length: n }, (_, i) => draft(i));

console.log('shuffle-mc:');

check('the correct text ends up at the declared key, for every item', () => {
  for (const out of shuffleDrafts(drafts(24), { seed: 7 })) {
    assert.strictEqual(out.choices.length, 4, `${out.id}: expected 4 choices`);
    assert.strictEqual(out.choices[out.key], `right-${out.id.slice(1)}`,
      `${out.id}: key ${out.key} does not point at the correct text`);
  }
});

check('every wrong answer survives, exactly once', () => {
  for (const out of shuffleDrafts(drafts(12), { seed: 3 })) {
    const i = out.id.slice(1);
    const got = out.choices.slice().sort();
    const want = [`right-${i}`, `wrong-${i}-a`, `wrong-${i}-b`, `wrong-${i}-c`].sort();
    assert.deepStrictEqual(got, want, `${out.id}: choice set changed`);
  }
});

check('the key spread is balanced: every position within 1 of N/4', () => {
  for (const n of [4, 12, 24, 25, 37]) {
    const spread = keySpread(shuffleDrafts(drafts(n), { seed: 11 }));
    const counts = [0, 1, 2, 3].map((p) => spread[p] || 0);
    const lo = Math.floor(n / 4), hi = Math.ceil(n / 4);
    for (const [p, c] of counts.entries()) {
      assert.ok(c >= lo - 1 && c <= hi + 1,
        `n=${n}: position ${p} holds ${c}, outside [${lo - 1}, ${hi + 1}] -- counts ${counts.join(',')}`);
    }
    assert.strictEqual(counts.reduce((a, b) => a + b, 0), n, `n=${n}: counts do not sum to n`);
  }
});

check('deterministic for a given seed, and a different seed really does differ', () => {
  const a = shuffleDrafts(drafts(24), { seed: 5 }).map((o) => o.key);
  const b = shuffleDrafts(drafts(24), { seed: 5 }).map((o) => o.key);
  assert.deepStrictEqual(a, b, 'same seed produced different keys');
  // The seed must not be decorative -- but asserting that EVERY pair of seeds differs would be a
  // flaky test, not a strict one: four positions have only 24 orderings (96 arrangements once the
  // rotation offset is included), so two arbitrary seeds colliding is expected rather than a
  // defect. Balance holds either way. So: across a spread of seeds, the arrangement must actually
  // move.
  const arrangements = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(
    (s) => shuffleDrafts(drafts(24), { seed: s }).map((o) => o.key).join('')));
  assert.ok(arrangements.size >= 4,
    `eight seeds produced only ${arrangements.size} distinct arrangements; the seed is barely doing anything`);
});

check('the draft-only fields are removed, so they cannot ship into a pack', () => {
  for (const out of shuffleDrafts(drafts(8), { seed: 1 })) {
    assert.ok(!('_correct' in out), `${out.id}: _correct survived`);
    assert.ok(!('_wrong' in out), `${out.id}: _wrong survived`);
    assert.strictEqual(typeof out.stem, 'string');
  }
});

check('distractorRationale is carried across, keyed by FINAL choice index', () => {
  for (const out of shuffleDrafts(drafts(8), { seed: 2 })) {
    const i = out.id.slice(1);
    assert.ok(out.distractorRationale, `${out.id}: no distractorRationale`);
    for (const [idx, why] of Object.entries(out.distractorRationale)) {
      assert.notStrictEqual(Number(idx), out.key, `${out.id}: a rationale is attached to the KEY`);
      const letter = out.choices[Number(idx)].slice(-1);
      assert.strictEqual(why, letter,
        `${out.id}: rationale at index ${idx} says "${why}" but that slot holds ${out.choices[Number(idx)]}`);
    }
    assert.strictEqual(Object.keys(out.distractorRationale).length, 3, `${out.id}: expected 3 rationales`);
  }
});

check('REFUSES a draft that is not shaped like an mc draft', () => {
  const bad = [
    { label: 'two wrong answers', d: { id: 'x', type: 'mc', stem: 's', _correct: 'c', _wrong: [{ text: 'a', why: 'a' }, { text: 'b', why: 'b' }] } },
    { label: 'no _correct', d: { id: 'x', type: 'mc', stem: 's', _wrong: [{ text: 'a', why: 'a' }, { text: 'b', why: 'b' }, { text: 'c', why: 'c' }] } },
    { label: 'duplicate choice text', d: { id: 'x', type: 'mc', stem: 's', _correct: 'a', _wrong: [{ text: 'a', why: 'a' }, { text: 'b', why: 'b' }, { text: 'c', why: 'c' }] } },
  ];
  for (const { label, d } of bad) {
    let threw = false;
    try { shuffleDrafts([d], { seed: 1 }); } catch (e) { threw = true; }
    assert.ok(threw, `${label}: accepted instead of refused`);
  }
});

check('a non-mc draft passes through untouched', () => {
  const ebsr = { id: 'e1', type: 'ebsr', partA: { stem: 's', key: 1 } };
  const out = shuffleDrafts([ebsr, draft(0)], { seed: 1 });
  assert.deepStrictEqual(out[0], ebsr, 'a non-mc draft was modified');
  assert.strictEqual(out.length, 2);
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
