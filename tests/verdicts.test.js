'use strict';
const assert = require('assert');
const path = require('path');
const { itemHash, stableStringify, blindQuestion, authoredKeyOf, validateLedger } = require('./verdicts');
const { loadPackFile } = require('./validate-pack');

const GOOD = path.join(__dirname, 'fixtures', 'pack-good.json');
const clone = () => JSON.parse(JSON.stringify(loadPackFile(GOOD)));

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

// Rebuild every object with its keys inserted in reverse-sorted order, recursively, preserving all
// content. Do NOT use the array form of JSON.stringify's replacer for this: that argument is a
// recursive allowlist, so it silently drops nested maps such as distractorRationale, and the test
// would then be asserting that deleting content leaves the hash unchanged.
function reorderKeys(v) {
  if (Array.isArray(v)) return v.map(reorderKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort().reverse()) out[k] = reorderKeys(v[k]);
    return out;
  }
  return v;
}

function ledgerFor(pack, overrides) {
  return {
    packId: pack.meta.id,
    model: 'test-model',
    records: pack.items.map(it => Object.assign({
      itemId: it.id, itemHash: itemHash(it),
      blind: authoredKeyOf(it), authored: authoredKeyOf(it), status: 'agree',
    }, (overrides && overrides[it.id]) || {})),
  };
}

check('stableStringify is key-order independent', () => {
  assert.strictEqual(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.notStrictEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

check('itemHash is stable across key reordering but changes with content', () => {
  const it = clone().items[0];
  const reordered = reorderKeys(it);
  assert.notDeepStrictEqual(Object.keys(it), Object.keys(reordered), 'the reorder helper did not reorder anything');
  assert.deepStrictEqual(reordered, it, 'the reorder helper must not change content, only key order');
  assert.strictEqual(itemHash(it), itemHash(reordered));
  const edited = JSON.parse(JSON.stringify(it));
  edited.choices[1] = 'a different distractor entirely';
  assert.notStrictEqual(itemHash(it), itemHash(edited));
});

check('authoredKeyOf reads mc, ms and ebsr partA keys', () => {
  const p = clone();
  assert.strictEqual(authoredKeyOf(p.items[0]), 0);
  assert.strictEqual(authoredKeyOf(p.items[1]), 1);   // ebsr uses partA.key
  assert.deepStrictEqual(authoredKeyOf({ type: 'ms', key: [0, 2] }), [0, 2]);
  assert.strictEqual(authoredKeyOf({ type: 'order' }), null);
});

check('blindQuestion hides the key, the explanation and the rationales', () => {
  const it = clone().items[0];
  const p = clone().passages[0];
  const { prompt, optionCount } = blindQuestion(it, p);
  assert.strictEqual(optionCount, 4);
  assert.strictEqual(prompt.includes(it.explain), false, 'prompt leaked the explanation');
  assert.strictEqual(prompt.includes('distractorRationale'), false, 'prompt leaked the rationales');
  assert.strictEqual(/"key"|\bkey\s*[:=]/.test(prompt), false, 'prompt leaked the key field');
  assert.strictEqual(prompt.includes(p.text), true, 'prompt must carry the passage');
  assert.strictEqual(prompt.includes(it.choices[3]), true, 'prompt must carry every option');
});

check('a complete agreeing ledger validates', () => {
  const p = clone();
  const { errors } = validateLedger(p, ledgerFor(p));
  assert.deepStrictEqual(errors, []);
});

check('a missing record is caught', () => {
  const p = clone();
  const l = ledgerFor(p);
  l.records.pop();
  const { errors } = validateLedger(p, l);
  assert.strictEqual(errors.some(e => /no blind verdict/i.test(e)), true, JSON.stringify(errors));
});

check('a stale hash is caught, so editing an item forces re-verification', () => {
  const p = clone();
  const l = ledgerFor(p);
  p.items[0].choices[2] = 'an edited distractor';
  const { errors } = validateLedger(p, l);
  assert.strictEqual(errors.some(e => /stale/i.test(e)), true, JSON.stringify(errors));
});

check('a disagreement with status agree is caught', () => {
  const p = clone();
  const l = ledgerFor(p, { 'i-mc-1': { blind: 2, authored: 0, status: 'agree' } });
  const { errors } = validateLedger(p, l);
  assert.strictEqual(errors.some(e => /disagree/i.test(e)), true, JSON.stringify(errors));
});

check('an adjudicated disagreement needs a note and an adjudicator', () => {
  const p = clone();
  const bad = ledgerFor(p, { 'i-mc-1': { blind: 2, authored: 0, status: 'adjudicated' } });
  assert.strictEqual(validateLedger(p, bad).errors.some(e => /note/i.test(e)), true);

  const good = ledgerFor(p, { 'i-mc-1': {
    blind: 2, authored: 0, status: 'adjudicated',
    note: 'Key confirmed. The blind pass mistook the leading detail for the central idea, which is exactly the modelled misconception.',
    adjudicatedBy: 'justin', adjudicatedAt: '2026-07-25',
  } });
  assert.deepStrictEqual(validateLedger(p, good).errors, []);
});

check('an unknown status is caught', () => {
  const p = clone();
  const l = ledgerFor(p, { 'i-mc-1': { status: 'probably-fine' } });
  assert.strictEqual(validateLedger(p, l).errors.some(e => /status/i.test(e)), true);
});

check('a packId mismatch is caught', () => {
  const p = clone();
  const l = ledgerFor(p);
  l.packId = 'some-other-pack';
  assert.strictEqual(validateLedger(p, l).errors.some(e => /packId/i.test(e)), true);
});

check('a record for an item that no longer exists is a warning, not an error', () => {
  const p = clone();
  const l = ledgerFor(p);
  l.records.push({ itemId: 'i-deleted', itemHash: 'abc', blind: 0, authored: 0, status: 'agree' });
  const { errors, warnings } = validateLedger(p, l);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(warnings.some(w => w.includes('i-deleted')), true);
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
