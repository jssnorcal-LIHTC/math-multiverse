'use strict';
const assert = require('assert');
const R = require('../engine/runner.js');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

const items = ['a','b','c','d','e','f'].map((id, i) => ({ id, type: 'mc', choices: ['1','2','3','4'], key: i % 4, stem: id }));

// Deterministic rng so shuffling is testable.
function seeded(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

check('pickItems returns exactly level.questions items', () => {
  const level = { questions: 3, itemIds: ['a','b','c','d','e','f'] };
  assert.strictEqual(R.pickItems(level, items, seeded(1)).length, 3);
});

check('pickItems never repeats an item inside one level', () => {
  const level = { questions: 6, itemIds: ['a','b','c','d','e','f'] };
  const got = R.pickItems(level, items, seeded(7)).map(i => i.id);
  assert.strictEqual(new Set(got).size, 6, 'got ' + got.join(','));
});

check('pickItems only draws from the level itemIds', () => {
  const level = { questions: 2, itemIds: ['a','b'] };
  const got = R.pickItems(level, items, seeded(3)).map(i => i.id);
  assert.strictEqual(got.every(id => id === 'a' || id === 'b'), true, 'got ' + got.join(','));
});

check('pickItems shuffles rather than returning source order every time', () => {
  const level = { questions: 6, itemIds: ['a','b','c','d','e','f'] };
  const seen = new Set();
  for (let s = 1; s <= 12; s++) seen.add(R.pickItems(level, items, seeded(s)).map(i => i.id).join(''));
  assert.strictEqual(seen.size > 1, true, 'every seed produced the same order');
});

check('pickItems throws rather than silently shrinking when a level is over-subscribed', () => {
  const level = { questions: 9, itemIds: ['a','b'] };
  assert.throws(() => R.pickItems(level, items, seeded(1)), /questions/i);
});

check('scoreFor pays full for correct and proportional for partial', () => {
  assert.strictEqual(R.scoreFor({ correct: true, partial: 1 }), 100);
  assert.strictEqual(R.scoreFor({ correct: false, partial: 0.5 }), 50);
  assert.strictEqual(R.scoreFor({ correct: false, partial: 0 }), 0);
});

check('summarize applies the math star ladder', () => {
  const ok = { correct: true, partial: 1 };
  const bad = { correct: false, partial: 0 };
  assert.strictEqual(R.summarize([ok, ok, ok], 3).stars, 3);
  assert.strictEqual(R.summarize([ok, ok, bad], 3).stars, 2);
  assert.strictEqual(R.summarize([ok, bad, bad], 3).stars, 1);
  assert.strictEqual(R.summarize([bad, bad, bad], 3).stars, 0);
});

check('summarize counts a partial answer as a mistake but keeps its score', () => {
  const half = { correct: false, partial: 0.5 };
  const s = R.summarize([{ correct: true, partial: 1 }, half], 4);
  assert.strictEqual(s.mistakes, 1, 'a partially correct answer is still not correct');
  assert.strictEqual(s.score, 150);
  assert.strictEqual(s.stars, 2);
});

check('summarize marks dnf only when mistakes reach the life count', () => {
  const bad = { correct: false, partial: 0 };
  assert.strictEqual(R.summarize([bad, bad, bad], 3).dnf, true);
  assert.strictEqual(R.summarize([bad, bad, bad], 4).dnf, false, 'four lives means a third mistake still finishes');
  assert.strictEqual(R.summarize([bad, bad, bad], 4).stars, 0, 'finishing with three mistakes still earns no stars');
  assert.strictEqual(R.summarize([bad, bad, bad, bad], 4).dnf, true);
});

check('summarize defaults to three lives when a level does not set one', () => {
  const bad = { correct: false, partial: 0 };
  assert.strictEqual(R.summarize([bad, bad, bad], undefined).dnf, true);
});

check('register wires the pack under its own id, not a prefixed one', () => {
  const reg = {};
  R.register({ meta: { id: 'ela-g6-spy' }, levels: [], items: [], passages: [] }, reg);
  assert.strictEqual(typeof reg['ela-g6-spy'].init, 'function');
  assert.strictEqual(reg['pack:ela-g6-spy'], undefined);
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
