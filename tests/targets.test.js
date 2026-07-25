'use strict';
const assert = require('assert');
const { TARGETS, isTarget, COACH_FAMILIES } = require('./targets');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

check('every Smarter Balanced claim is represented', () => {
  const claims = new Set(Object.values(TARGETS).map(t => t.claim));
  assert.deepStrictEqual([...claims].sort(), [1, 2, 3, 4]);
});

check('claim 1 covers all seven reading targets for both text kinds', () => {
  const lit = Object.keys(TARGETS).filter(k => k.startsWith('c1-lit-'));
  const inf = Object.keys(TARGETS).filter(k => k.startsWith('c1-inf-'));
  assert.strictEqual(lit.length, 7, 'literary targets: ' + lit.length);
  assert.strictEqual(inf.length, 7, 'informational targets: ' + inf.length);
});

check('every target carries at least one CCSS code', () => {
  for (const [id, t] of Object.entries(TARGETS)) {
    assert.strictEqual(Array.isArray(t.ccss) && t.ccss.length > 0, true, id + ' has no ccss');
    assert.strictEqual(t.ccss.every(c => /^(RL|RI|W|L|SL)\.6\./.test(c)), true, id + ' has an off-grade ccss: ' + t.ccss);
  }
});

check('every target carries a human label', () => {
  for (const [id, t] of Object.entries(TARGETS)) {
    assert.strictEqual(typeof t.label === 'string' && t.label.length > 3, true, id + ' has no label');
  }
});

check('isTarget accepts known ids and rejects invented ones', () => {
  assert.strictEqual(isTarget('c1-lit-2-central-ideas'), true);
  assert.strictEqual(isTarget('c1-made-up'), false);
  assert.strictEqual(isTarget(''), false);
  assert.strictEqual(isTarget(undefined), false);
});

check('TARGETS is frozen so a pack cannot mutate the vocabulary', () => {
  assert.throws(() => { 'use strict'; TARGETS.nonsense = {}; }, TypeError);
});

check('coach families are non-empty lowercase slugs', () => {
  assert.strictEqual(COACH_FAMILIES.length > 0, true);
  assert.strictEqual(COACH_FAMILIES.every(f => /^[a-z]+$/.test(f)), true);
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
