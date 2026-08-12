'use strict';
const assert = require('assert');
const path = require('path');
const { itemHash, stableStringify, blindQuestion, authoredKeyOf, validateLedger, sameAnswer } = require('./verdicts');
const { loadPackFile } = require('./validate-pack');
const { parseAnswer } = require('./blind-reanswer');

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
  // PASSAGE-AWARE (N4 fix): stored hashes must be computed the same way validateLedger() computes
  // its comparison hash, itemHash(item, passage), or every fixture item with a passageId reads as
  // stale before any of these tests get to exercise what they actually target.
  const passagesById = new Map((pack.passages || []).map(p => [p.id, p]));
  return {
    packId: pack.meta.id,
    model: 'test-model',
    records: pack.items.map(it => Object.assign({
      itemId: it.id, itemHash: itemHash(it, it.passageId ? passagesById.get(it.passageId) : null),
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

check('itemHash(item) alone is byte-identical to itemHash(item) before the N4 passage-aware fix', () => {
  // Backward compatibility for any caller that has not been updated to pass a passage: the single-
  // argument form must never change, or every existing ledger record for every item without a
  // resolvable passage silently goes stale the moment this file is edited.
  const it = clone().items[0];
  const withoutPassage = itemHash(it);
  const withNullPassage = itemHash(it, null);
  const withUndefinedPassage = itemHash(it, undefined);
  assert.strictEqual(withoutPassage, withNullPassage, 'passing null must match omitting the argument');
  assert.strictEqual(withoutPassage, withUndefinedPassage, 'passing undefined must match omitting the argument');
});

check('itemHash changes when the PASSAGE changes, even if the item itself does not (N4 fix)', () => {
  // This is the actual defect: an item whose own text never moved kept a "verified" hash even after
  // the passage it quotes was rewritten underneath it. Pin the fix directly, independent of any pack
  // fixture, so a future change to itemHash cannot silently regress this without failing here first.
  const item = { id: 'i-x', type: 'mc', passageId: 'p-x', stem: 's', choices: ['a','b'], key: 0 };
  const passageV1 = { id: 'p-x', text: 'Original passage text.' };
  const passageV2 = { id: 'p-x', text: 'Rewritten passage text, same item untouched.' };
  const h1 = itemHash(item, passageV1);
  const h2 = itemHash(item, passageV2);
  assert.notStrictEqual(h1, h2, 'the same item against two different passages must hash differently');
  // Control: the SAME passage object hashed twice must be stable, or this is noise, not a real check.
  assert.strictEqual(itemHash(item, passageV1), itemHash(item, { id: 'p-x', text: passageV1.text }));
});

check('blind-reanswer.js resolvedItemHash matches the real N4 passage-aware itemHash (26-0807 fix-round pin)', () => {
  // This is the pin the escape needed. The committed tests/blind-reanswer.js shipped in fae21e7
  // still calling the LEGACY itemHash(item) at both its call sites, even though verdicts.js itself
  // had the N4 fix and every OTHER caller (validateLedger, the workspace build copy) had been
  // updated. It escaped review because this file's own N4 tests above construct their ledger
  // fixtures by hand-computing itemHash(item, passage) directly (see ledgerFor()), which proves
  // itemHash() is correct but never actually calls INTO blind-reanswer.js, so a stale call site
  // there was invisible to every test in this file. Import the REAL exported function under test,
  // not a re-implementation of "resolve the passage, then hash" written fresh in this fixture --
  // a reimplementation here would just be the same bypass with extra steps.
  const { resolvedItemHash } = require('./blind-reanswer');
  const p = clone();
  const passages = new Map(p.passages.map((pg) => [pg.id, pg]));
  const item = p.items.find((it) => it.passageId); // any item with a resolvable passage
  assert.ok(item, 'fixture must contain at least one passage-linked item for this pin to mean anything');

  const want = itemHash(item, passages.get(item.passageId));
  assert.strictEqual(resolvedItemHash(item, passages), want,
    'blind-reanswer.js must resolve and pass the passage, exactly like validateLedger() does');

  // Negative control, both directions, or this pin proves nothing:
  //   1) it must NOT just happen to match itemHash(item) with no passage at all (that is exactly the
  //      stale, pre-fix call the escape shipped).
  assert.notStrictEqual(resolvedItemHash(item, passages), itemHash(item),
    'a match against the no-passage form would mean this call site regressed to the legacy hash');
  //   2) rewriting the passage text underneath the SAME unchanged item must move the resolved hash,
  //      proving the passage argument is genuinely threaded through rather than a coincidental match.
  const rewritten = new Map(passages);
  rewritten.set(item.passageId, Object.assign({}, passages.get(item.passageId), { text: 'a rewritten passage, same item untouched' }));
  assert.notStrictEqual(resolvedItemHash(item, rewritten), want,
    'resolvedItemHash must move when the passage moves, or this pin is not testing passage-awareness at all');
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

// ---------- set versus sequence: the comparison that decides whether an item was checked at all ----------

// This block pins the fix for a defect where BOTH sides of the comparison were sorted. parseAnswer
// sorted the model's reply on the way in, and sameAnswer sorted the authored key again on the way
// out, so an order, cloze or match item compared equal no matter what the model actually answered.
// The ledger logged "agree" on items nothing had verified: "not checked" presented as "checked and
// fine", which is worse than an outright failure because it looks like coverage.

check('sameAnswer treats ms and hottext as SETS, matching how engine/items.js grades them', () => {
  // Verified by grading, not by reading: both types grade through sameSet(), which compares
  // uniqSorted arrays, so a reordered response still grades correct. Order carries no information.
  assert.strictEqual(sameAnswer([2, 0, 1], [0, 1, 2], 'ms'), true, 'ms is a set; a reordered answer is the same answer');
  assert.strictEqual(sameAnswer([2, 0, 1], [0, 1, 2], 'hottext'), true, 'hottext is a set; a reordered answer is the same answer');
  // Still discriminating: a set comparison must not bless a genuinely different set.
  assert.strictEqual(sameAnswer([0, 1, 3], [0, 1, 2], 'ms'), false);
  assert.strictEqual(sameAnswer([0, 1], [0, 1, 2], 'hottext'), false, 'a subset is not the same answer');
});

check('sameAnswer treats order, cloze and match as SEQUENCES, so a reordering is a real disagreement', () => {
  // order: key[i] is the tile belonging in position i, and grade() compares arr[i] === key[i].
  assert.strictEqual(sameAnswer([0, 1, 2, 3], [1, 3, 0, 2], 'order'), false,
    'an order answer in the wrong sequence is NOT agreement; this is the exact false "agree" that shipped');
  // cloze: key[i] is blank i's choice, and grade() compares arr[i] === blanks[i].key.
  assert.strictEqual(sameAnswer([1, 2], [2, 1], 'cloze'), false,
    'two blanks answered the other way round is NOT agreement');
  // match: authoredKeyOf flattens to one column per ROW in row order, so the index IS the row.
  assert.strictEqual(sameAnswer([0, 1, 2], [2, 1, 0], 'match'), false,
    'rows matched to the wrong columns is NOT agreement');
  // Control: the same sequence in the same order must still agree, or the test proves nothing.
  assert.strictEqual(sameAnswer([1, 3, 0, 2], [1, 3, 0, 2], 'order'), true);
  assert.strictEqual(sameAnswer([2, 1], [2, 1], 'cloze'), true);
  assert.strictEqual(sameAnswer([2, 1, 0], [2, 1, 0], 'match'), true);
});

check('an unknown type defaults to the STRICT comparison, so a new type fails loudly rather than silently', () => {
  // The safe default: a new type that is genuinely a set will fail here and be added to
  // UNORDERED_TYPES deliberately. Defaulting to sorted would under-check it in silence, which is
  // the failure mode being fixed.
  assert.strictEqual(sameAnswer([2, 0, 1], [0, 1, 2], 'some-new-type'), false);
  assert.strictEqual(sameAnswer([2, 0, 1], [0, 1, 2], undefined), false, 'a missing type must not fall into set semantics');
  // Scalars are unaffected by any of this.
  assert.strictEqual(sameAnswer(2, 2, 'mc'), true);
  assert.strictEqual(sameAnswer(2, 0, 'mc'), false);
  assert.strictEqual(sameAnswer(1, 1, 'ebsr'), true);
});

check('parseAnswer records the letters the model actually sent, in the order it sent them', () => {
  // THE regression guard. ["B","D","A","E","C"] is a correct answer to l2-order-article-parts and
  // maps to [1,3,0,4,2]. The old sort turned it into [0,1,2,3,4] -- the authored key -- so the
  // ledger recorded agreement with an answer the model never gave. If someone re-adds a sort for
  // tidiness, this fails.
  const r = parseAnswer('{"answer": ["B","D","A","E","C"], "confidence": "high"}', 5);
  assert.deepStrictEqual(r.answer, [1, 3, 0, 4, 2], 'the recorded answer is evidence and must not be normalised');
  assert.notDeepStrictEqual(r.answer, [0, 1, 2, 3, 4], 'a sorted answer is the authored key, not the model reply');
  assert.strictEqual(r.confidence, 'high');
  // A genuinely wrong order must also survive intact, or a disagreement cannot be adjudicated.
  assert.deepStrictEqual(parseAnswer('{"answer": ["A","B","C"]}', 3).answer, [0, 1, 2]);
  // Scalar replies are unchanged.
  assert.strictEqual(parseAnswer('{"answer": "C", "confidence": "low"}', 4).answer, 2);
});

check('validateLedger now catches an order item whose blind answer was merely a permutation', () => {
  // End to end through the real gate, not just the comparison in isolation: before the fix this
  // ledger validated clean, which is how five unverified items reached the pack.
  const pack = {
    meta: { id: 'p-seq' },
    items: [
      { id: 'i-order', type: 'order', stem: 'Sequence them.', tiles: ['t0', 't1', 't2', 't3'], key: [1, 3, 0, 2] },
      { id: 'i-ms', type: 'ms', stem: 'Pick some.', choices: ['a', 'b', 'c', 'd'], key: [0, 1, 2] },
    ],
  };
  const ledger = {
    packId: 'p-seq',
    model: 'test-model',
    records: [
      { itemId: 'i-order', itemHash: itemHash(pack.items[0]), blind: [0, 1, 2, 3], authored: [1, 3, 0, 2], status: 'agree' },
      { itemId: 'i-ms', itemHash: itemHash(pack.items[1]), blind: [2, 0, 1], authored: [0, 1, 2], status: 'agree' },
    ],
  };
  const { errors } = validateLedger(pack, ledger);
  assert.strictEqual(errors.some(e => e.includes('i-order') && /disagree/i.test(e)), true,
    'the permuted order answer must be reported as a disagreement: ' + JSON.stringify(errors));
  assert.strictEqual(errors.some(e => e.includes('i-ms')), false,
    'the reordered ms answer is genuinely the same set and must NOT be flagged: ' + JSON.stringify(errors));
});


// ---- V3 task 0: the figure-data blind surface and its hash pin ----
//
// A figure-bearing item's stimulus is the FIGURE, so the blind pass has to see the figure's data
// or it is answering a different question from the one the child answers.  Two consequences, and
// the second is the load-bearing one: the blind prompt gains a FIGURE DATA block, and the item's
// certification hash has to pin that data, or a chart could be regenerated from different numbers
// while its certified item kept a hash that says nothing changed.
//
// The regression pin comes first.  Every item shipped so far has no figureId, and their hashes are
// recorded in five committed ledgers; if this change moves any of them, every ledger goes stale at
// once and the packs stop validating.
check('hash without figureId is unchanged by the third argument', () => {
  const item = { id: 'i', type: 'mc', key: 1 }, pass = { text: 't' };
  assert.strictEqual(itemHash(item, pass), itemHash(item, pass, null));
  assert.strictEqual(itemHash(item, pass), itemHash(item, pass, { dataTable: { a: 1 } }));
});

check('figure-bearing item hash pins the dataTable', () => {
  const item = { id: 'i', type: 'mc', key: 1, figureId: 'f' }, pass = { text: 't' };
  const f1 = { dataTable: { type: 'line', series: [] } };
  const f2 = { dataTable: { type: 'line', series: [{ label: 'x', points: [[1, 2]] }] } };
  assert.notStrictEqual(itemHash(item, pass, f1), itemHash(item, pass, f2));
  // and it must actually differ from the unpinned form, or the pin is decorative
  assert.notStrictEqual(itemHash(item, pass, f1), itemHash(item, pass));
});

check('every committed ledger record still verifies -- no existing hash moved', () => {
  const fs = require('fs');
  const packsDir = path.join(__dirname, '..', 'packs');
  let checked = 0, ledgers = 0, pinned = 0;
  for (const f of fs.readdirSync(packsDir)) {
    if (!f.endsWith('.verdicts.json')) continue;
    const pack = JSON.parse(fs.readFileSync(path.join(packsDir, f.replace('.verdicts', '')), 'utf8'));
    const led = JSON.parse(fs.readFileSync(path.join(packsDir, f), 'utf8'));
    const passages = new Map(pack.passages.map((p) => [p.id, p]));
    const figures = new Map((pack.figures || []).map((g) => [g.id, g]));
    const items = new Map(pack.items.map((i) => [i.id, i]));
    ledgers++;
    for (const r of led.records || []) {
      const it = items.get(r.itemId);
      assert.ok(it, `${f}: ledger names missing item ${r.itemId}`);
      // Resolved exactly the way validateLedger resolves it: passage always, figure only when the
      // item declares one. Hashing figure-bearing items WITHOUT the figure is what this check did
      // first, and it failed the moment real figure-bearing items entered a ledger -- the test's
      // own assumption breaking, not a hash moving.
      const fig = it.figureId ? figures.get(it.figureId) : null;
      assert.strictEqual(itemHash(it, passages.get(it.passageId), fig), r.itemHash,
        `${f}: hash moved for ${r.itemId}`);
      if (!it.figureId) {
        // THE REGRESSION PIN, which is the point of this check: an item with no figureId must hash
        // byte-identically to the pre-V3 two-argument form, so five committed ledgers stay valid.
        assert.strictEqual(itemHash(it, passages.get(it.passageId)), r.itemHash,
          `${f}: a figure-less item's hash moved for ${r.itemId}`);
        pinned++;
      }
      checked++;
    }
  }
  // A check that silently finds nothing is the failure mode this program bans outright.
  assert.ok(ledgers >= 5, `expected at least 5 committed ledgers, saw ${ledgers}`);
  assert.ok(checked >= 500, `expected 500+ ledger records to verify, saw ${checked}`);
  assert.ok(pinned >= 500, `expected 500+ figure-less records to be regression-pinned, saw ${pinned}`);
});

check('blindQuestion shows the figure data for a figure-bearing item, and nothing extra otherwise', () => {
  const passage = { text: 'Some passage text.' };
  const item = { id: 'i', type: 'mc', stem: 'Which?', choices: ['a', 'b', 'c', 'd'], key: 1 };
  const plain = blindQuestion(item, passage).prompt;
  assert.ok(!/FIGURE DATA/.test(plain), 'a figure-less item must not carry a FIGURE DATA block');

  const fig = { id: 'f', kind: 'chart', caption: 'A caption.', dataTable: { type: 'line', series: [{ label: 'x', points: [[1, 2]] }] } };
  const withFig = blindQuestion({ ...item, figureId: 'f' }, passage, fig).prompt;
  assert.ok(/FIGURE \(chart\): A caption\./.test(withFig), 'the figure caption is missing from the prompt');
  assert.ok(/FIGURE DATA/.test(withFig), 'the FIGURE DATA block is missing');
  assert.ok(withFig.includes('"points"'), 'the dataTable itself is not in the prompt');
  // The blind pass must never be handed the answer.
  assert.ok(!/"key"/.test(withFig), 'the prompt leaks the key');
});

check('blindQuestion REFUSES a figure-bearing item whose figure has no dataTable', () => {
  // Silently answering from the passage alone would produce a verdict about a different question
  // than the child sees, and it would look exactly like a clean agreement.
  const passage = { text: 't' };
  const item = { id: 'i9', type: 'mc', stem: 's', choices: ['a', 'b', 'c', 'd'], key: 0, figureId: 'f' };
  let threw = null;
  try { blindQuestion(item, passage, { id: 'f', kind: 'photo' }); } catch (e) { threw = e; }
  assert.ok(threw, 'a dataTable-less figure was accepted');
  assert.ok(/i9/.test(String(threw.message)), 'the refusal does not name the offending item');
});

check('validateLedger and the blind pass hash a figure-bearing item THE SAME WAY', () => {
  // The two paths are siblings: blind-reanswer writes the record's hash, validateLedger checks it.
  // If only one is figure-aware they disagree by construction, every figure-bearing record reads
  // as stale the instant it is written, and the failure looks like an authoring problem rather
  // than a harness one.  This pins them together rather than trusting that both got the port.
  const { resolvedItemHash } = require('./blind-reanswer');
  const fig = { id: 'f1', kind: 'chart', caption: 'c', dataTable: { type: 'line', series: [{ label: 'a', points: [[1, 2]] }] } };
  const passage = { id: 'p1', text: 'text' };
  const item = { id: 'i1', type: 'mc', stem: 's', choices: ['a', 'b', 'c', 'd'], key: 2, passageId: 'p1', figureId: 'f1' };
  const pack = { meta: { id: 'demo' }, passages: [passage], figures: [fig], items: [item] };

  const writeSide = resolvedItemHash(item, new Map([[passage.id, passage]]), new Map([[fig.id, fig]]));
  const ledger = { packId: 'demo', records: [{ itemId: 'i1', itemHash: writeSide, status: 'agree', blindAnswer: 2 }] };
  const { errors } = validateLedger(pack, ledger);
  const stale = errors.filter((e) => /stale blind verdict/.test(e));
  assert.deepStrictEqual(stale, [],
    'the check side hashes a figure-bearing item differently from the write side');

  // Negative control: change the figure's data and the SAME record must now read as stale, or the
  // agreement above proves only that both sides ignore the figure.
  const moved = { ...pack, figures: [{ ...fig, dataTable: { type: 'line', series: [{ label: 'a', points: [[1, 99]] }] } }] };
  const after = validateLedger(moved, ledger).errors.filter((e) => /stale blind verdict/.test(e));
  assert.strictEqual(after.length, 1, 'editing the figure data did not stale the record');
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
