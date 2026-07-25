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

// Genuinely reorder every object's keys, recursively. NOT JSON.stringify with a replacer array:
// that FILTERS keys rather than reordering them, and silently drops nested content, which made an
// earlier version of the reorder test pass for the wrong reason.
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
  // Prove the harness itself is meaningful BEFORE testing the thing under test: the helper must have
  // actually reordered, and must not have altered content.
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

check('match, order and cloze now get a verdict instead of being silently exempt', () => {
  // They were exempt on the grounds of being 'checked structurally instead'. Structural checks prove a
  // key is well FORMED, not that it is UNAMBIGUOUS: two definitions can fit one row, two orderings can
  // both be defensible, and 'left' versus 'leaves' is a real judgement. Same risk as mc, so same gate.
  const MATCH = { type: 'match', stem: 'Sort them.', rowLabels: ['r0','r1','r2'], colLabels: ['c0','c1'], key: [[0,0],[1,1],[2,0]] };
  const ORDER = { type: 'order', stem: 'Sequence them.', tiles: ['t0','t1','t2'], key: [2,0,1] };
  const CLOZE = { type: 'cloze', stem: 'She {{0}} it and {{1}} away.', blanks: [{ choices: ['erase','erased'], key: 1 }, { choices: ['walk','walked'], key: 1 }] };
  assert.deepStrictEqual(authoredKeyOf(MATCH), [0,1,0], 'match key must flatten to one column per row, in row order');
  assert.deepStrictEqual(authoredKeyOf(ORDER), [2,0,1]);
  assert.deepStrictEqual(authoredKeyOf(CLOZE), [1,1], 'cloze key must be one choice index per blank');
  // An incomplete match key is a SHAPE defect for checkItemShape, not a verdict question.
  assert.strictEqual(authoredKeyOf({ type: 'match', rowLabels: ['a','b'], colLabels: ['x','y'], key: [[0,0]] }), null);
  // shorttext stays exempt: free text has no lettered form to blind-answer.
  assert.strictEqual(authoredKeyOf({ type: 'shorttext', accept: ['x'], maxWords: 3 }), null);
});

check('authoredKeyOf returns null, not a garbage array, for a malformed cloze or match key', () => {
  // A blank with no key (or key: null) previously produced [undefined] / [null] instead of null,
  // inconsistent with match's own "incomplete key is a shape defect, return null" discipline stated
  // two lines above it. checkItemShape already reports the real defect; comparing garbage here only
  // hides it behind a verdict question that was never well formed to begin with.
  assert.strictEqual(authoredKeyOf({ type: 'cloze', stem: 'a {{0}}', blanks: [{ choices: ['x', 'y'] }] }), null,
    'a blank missing its key must return null, not [undefined]');
  // A match key naming a row beyond rowLabels.length, or naming the same row twice, was silently
  // dropped or resolved last-write-wins by the old Map/.map construction instead of surfacing as a
  // defect.
  assert.strictEqual(authoredKeyOf({ type: 'match', rowLabels: ['a', 'b'], colLabels: ['x', 'y'], key: [[0, 0], [5, 1]] }), null,
    'a row index beyond rowLabels.length must return null');
  assert.strictEqual(authoredKeyOf({ type: 'match', rowLabels: ['a', 'b'], colLabels: ['x', 'y'], key: [[0, 0], [0, 1]] }), null,
    'the same row named twice must return null, not last-write-wins');
  // Control: a genuinely valid match key must still flatten correctly, unaffected by the fix.
  assert.deepStrictEqual(authoredKeyOf({ type: 'match', rowLabels: ['a', 'b', 'c'], colLabels: ['x', 'y'], key: [[2, 0], [0, 0], [1, 1]] }), [0, 1, 0]);
});

check('blindQuestion builds a non-leaking lettered prompt for match, order and cloze', () => {
  const p = clone();
  const passage = p.passages[0];
  const MATCH = { type: 'match', stem: 'Sort them.', rowLabels: ['r0','r1'], colLabels: ['c0','c1'], key: [[0,0],[1,1]] };
  const CLOZE = { type: 'cloze', stem: 'She {{0}} it and {{1}} away.', blanks: [{ choices: ['erase','erased'], key: 1 }, { choices: ['walk','walked'], key: 1 }] };
  const mq = blindQuestion(MATCH, passage);
  assert.strictEqual(mq.prompt.includes('COLUMNS:'), true, 'match must letter its columns');
  assert.strictEqual(/0\. r0/.test(mq.prompt), true, 'match must number its rows so the answer order is unambiguous');
  assert.strictEqual(mq.optionCount, 2);
  const cq = blindQuestion(CLOZE, passage);
  assert.strictEqual(/Blank 0:/.test(cq.prompt) && /Blank 1:/.test(cq.prompt), true, 'cloze must letter each blank separately');
  for (const q of [mq, cq]) {
    assert.strictEqual(q.prompt.includes(passage.text), true, 'the passage must be present');
    assert.strictEqual(/"key"/.test(q.prompt), false, 'the key field must never appear');
  }
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

check('ms states its answer count but hottext does not, matching what each renderer shows the student', () => {
  // types.ms.render shows a literal "Choose N." hint, so the blind pass must see N too: fidelity,
  // not a leak. types.hottext.render shows no count at all, so stating one there hands the blind
  // pass an advantage the child never has and makes agreement artificially easy, the dangerous
  // direction for a check whose whole job is to catch genuine ambiguity. Pinned here so the two
  // cases are never "tidied" into agreement.
  const p = clone();
  const passage = p.passages[0];
  const MS = { type: 'ms', stem: 'Pick two.', choices: ['a', 'b', 'c', 'd'], key: [1, 3] };
  const HOTTEXT = { type: 'hottext', mode: 'sentence', stem: 'Tap them.', spans: ['s0', 's1', 's2'], key: [0, 2] };
  const msPrompt = blindQuestion(MS, passage).prompt;
  const htPrompt = blindQuestion(HOTTEXT, passage).prompt;
  assert.strictEqual(/an array of the 2 letters/.test(msPrompt), true, 'ms must state the count, matching the "Choose 2." hint the student sees');
  assert.strictEqual(/[0-9]+ letters/.test(htPrompt), false, 'hottext must not state a count; the renderer never shows the student one');
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
