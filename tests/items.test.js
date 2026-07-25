'use strict';
const assert = require('assert');
const MVItems = require('../engine/items.js');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

// ---------- registry ----------

// The FULL registry assertion lives in task 10, once every type exists. Asserting it here would
// leave tasks 8 and 9 committing a red suite, which is not a state this project ships.
check('the types added by this task are registered', () => {
  for (const t of ['mc', 'ms']) assert.strictEqual(typeof MVItems.types[t], 'object', 'missing type ' + t);
});

check('reserved types are absent so a stray item fails loudly', () => {
  assert.strictEqual(MVItems.types.listen, undefined);
  assert.strictEqual(MVItems.types.write, undefined);
});

check('grading an unknown type throws rather than returning correct', () => {
  assert.throws(() => MVItems.grade({ type: 'telepathy' }, 0), /unknown item type/i);
});

check('loading the module touched no DOM', () => {
  // If items.js referenced document at load time this require would already have thrown.
  assert.strictEqual(typeof MVItems.render, 'function');
});

// ---------- mc ----------

const MC = { type: 'mc', choices: ['a', 'b', 'c', 'd'], key: 2 };

check('mc is an instant-answer type', () => {
  assert.strictEqual(MVItems.needsCheck(MC), false);
});

check('mc grades the key correct and everything else wrong', () => {
  assert.deepStrictEqual(MVItems.grade(MC, 2), { correct: true, partial: 1, notes: [] });
  assert.strictEqual(MVItems.grade(MC, 0).correct, false);
  assert.strictEqual(MVItems.grade(MC, 0).partial, 0);
});

check('mc treats a null or out-of-range response as incomplete, not wrong', () => {
  assert.strictEqual(MVItems.isComplete(MC, null), false);
  assert.strictEqual(MVItems.isComplete(MC, 9), false);
  assert.strictEqual(MVItems.isComplete(MC, 0), true);
});

// ---------- ms ----------

const MS = { type: 'ms', choices: ['a', 'b', 'c', 'd', 'e'], key: [1, 3] };

check('ms needs an explicit check', () => {
  assert.strictEqual(MVItems.needsCheck(MS), true);
});

check('ms grades an exact set as correct regardless of pick order', () => {
  assert.strictEqual(MVItems.grade(MS, [1, 3]).correct, true);
  assert.strictEqual(MVItems.grade(MS, [3, 1]).correct, true);
  assert.strictEqual(MVItems.grade(MS, [1, 3]).partial, 1);
});

check('ms gives partial credit for one of two, and says so', () => {
  const r = MVItems.grade(MS, [1]);
  assert.strictEqual(r.correct, false);
  assert.strictEqual(r.partial, 0.5);
  assert.strictEqual(r.notes.some(n => /one of/i.test(n) || /missed/i.test(n)), true, 'notes: ' + JSON.stringify(r.notes));
});

check('ms penalises a wrong pick rather than rewarding shotgunning', () => {
  // Selecting everything must not score better than selecting nothing useful.
  const all = MVItems.grade(MS, [0, 1, 2, 3, 4]);
  assert.strictEqual(all.correct, false);
  assert.strictEqual(all.partial, 0, 'selecting every option must score 0, got ' + all.partial);
  const oneRightOneWrong = MVItems.grade(MS, [1, 0]);
  assert.strictEqual(oneRightOneWrong.partial, 0, 'one hit and one miss must net to 0');
});

check('ms is incomplete until at least one option is picked', () => {
  assert.strictEqual(MVItems.isComplete(MS, []), false);
  assert.strictEqual(MVItems.isComplete(MS, null), false);
  assert.strictEqual(MVItems.isComplete(MS, [0]), true);
});

check('ms ignores a duplicate pick instead of counting it twice', () => {
  assert.strictEqual(MVItems.grade(MS, [1, 1, 3]).correct, true);
});

// ---------- normalizeText ----------

check('a stray null, boolean or numeric string is NOT a pick', () => {
  // Number(null) is 0 and Number(true) is 1, so coercing made garbage read as choosing option A and
  // isComplete return true. Only a real integer counts.
  assert.strictEqual(MVItems.isComplete(MS, [null]), false);
  assert.strictEqual(MVItems.isComplete(MS, [true]), false);
  assert.strictEqual(MVItems.isComplete(MS, ['2']), false);
  assert.strictEqual(MVItems.isComplete(MS, [undefined]), false);
  assert.strictEqual(MVItems.isComplete(MS, [NaN]), false);
  // and a null mixed in with a real pick must not be counted as a second pick
  assert.deepStrictEqual(MVItems.grade(MS, [null, 3]).partial, MVItems.grade(MS, [3]).partial);
  assert.strictEqual(MVItems.isComplete(MS, [1, 3]), true, 'real picks must still work');
});

check('ms rejects an out-of-range pick as incomplete, matching mc', () => {
  // mc range-checked and ms did not; an asymmetry between two types answering the same question is
  // how the next type inherits the bug.
  assert.strictEqual(MVItems.isComplete(MS, [99]), false);
  assert.strictEqual(MVItems.isComplete(MS, [-1]), false);
  assert.strictEqual(MVItems.isComplete(MS, [1, 99]), false);
  assert.strictEqual(MVItems.isComplete(MS, [1, 4]), true, 'the last real index must still be valid');
});

check('normalizeText folds case, punctuation, articles and whitespace', () => {
  const n = MVItems.normalizeText;
  assert.strictEqual(n('  A  Dead   Drop! '), 'dead drop');
  assert.strictEqual(n('the chalk mark'), 'chalk mark');
  assert.strictEqual(n('Chalk-mark'), 'chalk mark');
  assert.strictEqual(n(null), '');
});

// ---------- ebsr ----------

const EBSR = {
  type: 'ebsr',
  partA: { stem: 'Why?', choices: ['cheap', 'unnoticed', 'quick', 'copyable'], key: 1 },
  partB: { stem: 'Which line proves it?', choices: ['q0', 'q1', 'q2', 'q3'], key: { '0': 1, '1': 0, '2': 0, '3': 1 } },
};

check('ebsr needs a check and is incomplete until both parts are answered', () => {
  assert.strictEqual(MVItems.needsCheck(EBSR), true);
  assert.strictEqual(MVItems.isComplete(EBSR, { a: 1, b: null }), false);
  assert.strictEqual(MVItems.isComplete(EBSR, { a: null, b: 0 }), false);
  assert.strictEqual(MVItems.isComplete(EBSR, { a: 1, b: 0 }), true);
});

check('ebsr is correct only when Part A is right AND Part B matches the key for that A', () => {
  const r = MVItems.grade(EBSR, { a: 1, b: 0 });   // partB.key["1"] === 0
  assert.strictEqual(r.correct, true);
  assert.strictEqual(r.partial, 1);
});

check('ebsr with the right A but the wrong evidence is not correct', () => {
  const r = MVItems.grade(EBSR, { a: 1, b: 2 });
  assert.strictEqual(r.correct, false);
  assert.strictEqual(r.partial, 0.5, 'A right alone is worth half');
  assert.strictEqual(r.consistent, false);
});

check('ebsr rewards evidence that matches the students own wrong claim', () => {
  // A is wrong (0 instead of 1), but partB.key["0"] === 1, so picking 1 IS consistent reasoning.
  const r = MVItems.grade(EBSR, { a: 0, b: 1 });
  assert.strictEqual(r.correct, false);
  assert.strictEqual(r.consistent, true);
  assert.strictEqual(r.partial, 0.5, 'consistent evidence for a wrong claim earns the evidence half');
  assert.strictEqual(r.notes.some(n => /matched your/i.test(n)), true, 'notes: ' + JSON.stringify(r.notes));
});

check('ebsr scores zero when the claim is wrong and the evidence does not fit it either', () => {
  const r = MVItems.grade(EBSR, { a: 0, b: 3 });   // partB.key["0"] === 1, not 3
  assert.strictEqual(r.correct, false);
  assert.strictEqual(r.consistent, false);
  assert.strictEqual(r.partial, 0);
});

check('ebsr never reads partB.key as a scalar', () => {
  // A homemade EBSR with a fixed Part B key must not silently grade as if it were valid.
  const broken = { type: 'ebsr', partA: EBSR.partA, partB: { stem: 'x', choices: ['q0', 'q1'], key: 0 } };
  assert.throws(() => MVItems.grade(broken, { a: 1, b: 0 }), /partB\.key/i);
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
