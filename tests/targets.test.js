'use strict';
const assert = require('assert');
const { TARGETS, isTarget, COACH_FAMILIES } = require('./targets');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

// The vocabulary now spans two subjects sharing one id namespace. ELA ids never carry the 'sci-'
// prefix and science ids always do (see tests/targets.js), so the prefix is a stable, non-circular
// way to scope an assertion to its subject without relying on the very field the assertion checks.
const SCI_IDS = Object.keys(TARGETS).filter(id => id.startsWith('sci-'));
const ELA_IDS = Object.keys(TARGETS).filter(id => !id.startsWith('sci-'));

check('every Smarter Balanced claim is represented (ELA subset)', () => {
  const claims = new Set(ELA_IDS.map(id => TARGETS[id].claim));
  assert.deepStrictEqual([...claims].sort(), [1, 2, 3, 4]);
});

check('claim 1 covers all seven reading targets for both text kinds', () => {
  const lit = Object.keys(TARGETS).filter(k => k.startsWith('c1-lit-'));
  const inf = Object.keys(TARGETS).filter(k => k.startsWith('c1-inf-'));
  assert.strictEqual(lit.length, 7, 'literary targets: ' + lit.length);
  assert.strictEqual(inf.length, 7, 'informational targets: ' + inf.length);
});

check('every ELA target carries at least one valid grade-6 CCSS code', () => {
  for (const id of ELA_IDS) {
    const t = TARGETS[id];
    assert.strictEqual(Array.isArray(t.ccss) && t.ccss.length > 0, true, id + ' has no ccss');
    assert.strictEqual(t.ccss.every(c => /^(RL|RI|W|L|SL)\.6\./.test(c)), true, id + ' has an off-grade ccss: ' + t.ccss);
  }
});

check('every science target declares subject "sci"', () => {
  for (const id of SCI_IDS) {
    assert.strictEqual(TARGETS[id].subject, 'sci', id + ' must declare subject "sci"');
  }
});

check('every science target carries a valid PE-code array and a legal confidence tier', () => {
  const CONFIDENCE_TIERS = ['verified', 'inherited-plausible', 'inferred', 'thematic'];
  for (const id of SCI_IDS) {
    const t = TARGETS[id];
    assert.strictEqual(Array.isArray(t.pe), true, id + ' pe must be an array (empty is legal for thematic targets)');
    assert.strictEqual(t.pe.every(p => /^MS-(ESS|LS|PS|ETS)[0-9]-[0-9]$/.test(p)), true, id + ' has a malformed PE code: ' + JSON.stringify(t.pe));
    assert.strictEqual(CONFIDENCE_TIERS.includes(t.confidence), true, id + ' has an invalid confidence tier: ' + JSON.stringify(t.confidence));
  }
});

check('every target carries a human label', () => {
  for (const [id, t] of Object.entries(TARGETS)) {
    assert.strictEqual(typeof t.label === 'string' && t.label.length > 3, true, id + ' has no label');
  }
});

check('isTarget accepts known ids and rejects invented ones', () => {
  assert.strictEqual(isTarget('c1-lit-2-central-ideas'), true);
  assert.strictEqual(isTarget('sci-t5-warming-adaptation'), true);
  assert.strictEqual(isTarget('c1-made-up'), false);
  assert.strictEqual(isTarget('sci-made-up'), false);
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
