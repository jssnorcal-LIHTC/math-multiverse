'use strict';
const assert = require('assert');
const path = require('path');
const { validatePack, loadPackFile, ITEM_TYPES, GENRES } = require('./validate-pack');

const GOOD = path.join(__dirname, 'fixtures', 'pack-good.json');
const clone = () => JSON.parse(JSON.stringify(loadPackFile(GOOD)));

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}
// Assert the fixture fails for a specific reason, so a check cannot pass by accident.
function expectError(pack, fragment, label) {
  const { errors } = validatePack(pack, { expectedId: 'pack-good' });
  const hit = errors.some(e => e.toLowerCase().includes(fragment.toLowerCase()));
  assert.strictEqual(hit, true, `${label}: expected an error containing "${fragment}", got ${JSON.stringify(errors)}`);
}

check('the good fixture validates with zero errors', () => {
  const { errors } = validatePack(clone(), { expectedId: 'pack-good' });
  assert.deepStrictEqual(errors, []);
});

check('missing meta is caught', () => {
  const p = clone(); delete p.meta;
  expectError(p, 'meta', 'no meta');
});

check('meta.id must match the filename', () => {
  const p = clone(); p.meta.id = 'something-else';
  expectError(p, 'does not match filename', 'id mismatch');
});

check('non-integer grade is caught', () => {
  const p = clone(); p.meta.grade = '6';
  expectError(p, 'grade', 'string grade');
});

check('duplicate passage ids are caught', () => {
  const p = clone(); p.passages.push(JSON.parse(JSON.stringify(p.passages[0])));
  expectError(p, 'duplicate passage id', 'dup passage');
});

check('an unknown genre is caught', () => {
  const p = clone(); p.passages[0].genre = 'poetry';
  expectError(p, 'genre', 'bad genre');
});

check('an empty passage text is caught', () => {
  const p = clone(); p.passages[0].text = '   ';
  expectError(p, 'text', 'empty text');
});

check('duplicate item ids are caught', () => {
  const p = clone(); p.items.push(JSON.parse(JSON.stringify(p.items[0])));
  expectError(p, 'duplicate item id', 'dup item');
});

check('an unknown item type is caught', () => {
  const p = clone(); p.items[0].type = 'freeform';
  expectError(p, 'type', 'bad type');
});

check('an unresolvable passageId is caught', () => {
  const p = clone(); p.items[0].passageId = 'p-nope';
  expectError(p, 'passageId', 'dangling passage ref');
});

check('an unresolvable itemId in a level is caught', () => {
  const p = clone(); p.levels[0].itemIds.push('i-nope');
  expectError(p, 'i-nope', 'dangling item ref');
});

check('an invented target id is caught', () => {
  const p = clone(); p.items[0].targets = ['c1-inf-99-telepathy'];
  expectError(p, 'target', 'bad target');
});

check('an item with no targets is caught', () => {
  const p = clone(); p.items[0].targets = [];
  expectError(p, 'target', 'no targets');
});

check('asking more questions than a level has items is caught', () => {
  const p = clone(); p.levels[0].questions = 99;
  expectError(p, 'questions', 'over-subscribed level');
});

check('an item that no level references is a warning, not an error', () => {
  const p = clone();
  p.items.push({
    id: 'i-orphan', type: 'mc', passageId: 'p1', targets: ['c1-inf-1-key-details'],
    coachTopic: 'central-idea', stem: 'Orphan?',
    choices: ['a', 'b', 'c', 'd'], key: 0,
    explain: 'This item is deliberately unreferenced by any level so the orphan warning can be exercised, and it is written long enough to clear the twenty-word explanation floor the content checks impose in task 6.',
    distractorRationale: { '1': 'x', '2': 'y', '3': 'z' },
  });
  const { errors, warnings } = validatePack(p, { expectedId: 'pack-good' });
  assert.deepStrictEqual(errors, [], 'orphan must not be an error: ' + JSON.stringify(errors));
  assert.strictEqual(warnings.some(w => w.includes('i-orphan')), true, 'expected an orphan warning');
});

check('ITEM_TYPES and GENRES are frozen', () => {
  assert.throws(() => { 'use strict'; ITEM_TYPES.push('nope'); }, TypeError);
  assert.throws(() => { 'use strict'; GENRES.push('nope'); }, TypeError);
});

// ---------- task 5: per-type key and shape ----------

// Replace the fixture's items with a single item of a given shape, wired into level 1. The level's
// targets are narrowed to the item's own targets so the task-6 coverage check does not add an
// unrelated error and muddy what each shape test is actually proving.
function withItem(item) {
  const p = clone();
  p.items = [item];
  p.levels[0].itemIds = [item.id];
  p.levels[0].questions = 1;
  p.levels[0].targets = item.targets.slice();
  return p;
}
const baseFields = {
  id: 'x1', passageId: 'p1', targets: ['c1-inf-1-key-details'], coachTopic: 'central-idea',
  explain: 'A sufficiently long explanation so the length floor in the content checks is satisfied and this fixture exercises only the shape rules under test.',
};

check('mc with an out-of-range key is caught', () => {
  expectError(withItem({ ...baseFields, type: 'mc', stem: 'Q?', choices: ['a','b','c','d'], key: 9,
    distractorRationale: { '0': 'x', '1': 'y', '2': 'z' } }), 'key', 'mc key range');
});

check('mc with too few choices is caught', () => {
  expectError(withItem({ ...baseFields, type: 'mc', stem: 'Q?', choices: ['a','b'], key: 0,
    distractorRationale: { '1': 'y' } }), 'choices', 'mc choice count');
});

check('mc with duplicate choices is caught', () => {
  expectError(withItem({ ...baseFields, type: 'mc', stem: 'Q?', choices: ['a','a','c','d'], key: 0,
    distractorRationale: { '1': 'y', '2': 'z', '3': 'w' } }), 'duplicate', 'mc dup choices');
});

check('ms with a single key is caught', () => {
  expectError(withItem({ ...baseFields, type: 'ms', stem: 'Q?', choices: ['a','b','c','d'], key: [1],
    distractorRationale: { '0': 'x', '2': 'z', '3': 'w' } }), 'key', 'ms single key');
});

check('ms with an unsorted key is caught', () => {
  expectError(withItem({ ...baseFields, type: 'ms', stem: 'Q?', choices: ['a','b','c','d'], key: [2,1],
    distractorRationale: { '0': 'x', '3': 'w' } }), 'ascending', 'ms unsorted key');
});

check('ebsr missing a partA index in the partB key map is caught', () => {
  const p = clone();
  delete p.items[1].partB.key['3'];
  expectError(p, 'partB.key', 'ebsr incomplete key map');
});

check('ebsr with a partB key value out of range is caught', () => {
  const p = clone();
  p.items[1].partB.key['0'] = 7;
  expectError(p, 'partB.key', 'ebsr key value range');
});

check('hottext with an out-of-range key is caught', () => {
  expectError(withItem({ ...baseFields, type: 'hottext', mode: 'sentence', stem: 'Tap it.',
    spans: ['A dead drop is a way to pass a package without two people ever meeting.',
            'A chalk mark on a lamp post is a common choice.'], key: [5] }), 'key', 'hottext key range');
});

check('hottext with an unknown mode is caught', () => {
  expectError(withItem({ ...baseFields, type: 'hottext', mode: 'paragraph', stem: 'Tap it.',
    spans: ['A chalk mark on a lamp post is a common choice.',
            'Handlers prefer this method in crowded places.'], key: [0] }), 'mode', 'hottext mode');
});

check('match with a key cell out of range is caught', () => {
  expectError(withItem({ ...baseFields, type: 'match', stem: 'Sort them.',
    rowLabels: ['r1','r2'], colLabels: ['c1','c2'], key: [[0,0],[2,1]] }), 'key', 'match cell range');
});

check('match with a row that has no correct column is caught', () => {
  // A row nobody can answer correctly. The per-cell dedup misses this because it keys on the pair.
  expectError(withItem({ ...baseFields, type: 'match', stem: 'Sort them.',
    rowLabels: ['r1','r2'], colLabels: ['c1','c2'], key: [[0,0]] }), 'no correct column', 'match row uncovered');
});

check('match with a row correct in two columns is caught', () => {
  expectError(withItem({ ...baseFields, type: 'match', stem: 'Sort them.',
    rowLabels: ['r1','r2'], colLabels: ['c1','c2'], key: [[0,0],[0,1],[1,1]] }), 'marked correct in 2 columns', 'match row ambiguous');
});

check('hottext with a duplicate span index is caught', () => {
  // ms already guards this; hottext must too, or "find N spans" overstates the distinct answers.
  expectError(withItem({ ...baseFields, type: 'hottext', mode: 'sentence', stem: 'Tap it.',
    spans: ['A chalk mark on a lamp post is a common choice.',
            'Handlers prefer this method in crowded places.',
            'A dead drop is a way to pass a package without two people ever meeting.'],
    key: [0, 0] }), 'duplicate span index', 'hottext dup key');
});

check('order whose key is not a full permutation is caught', () => {
  expectError(withItem({ ...baseFields, type: 'order', stem: 'Sequence them.',
    tiles: ['a','b','c'], key: [0,0,2] }), 'permutation', 'order permutation');
});

check('cloze with a blank count that does not match its tokens is caught', () => {
  expectError(withItem({ ...baseFields, type: 'cloze', stem: 'The courier {{0}} the mark and {{1}} away.',
    blanks: [{ choices: ['left','leaves'], key: 0 }] }), 'blank', 'cloze token mismatch');
});

check('shorttext with an empty accept list is caught', () => {
  expectError(withItem({ ...baseFields, type: 'shorttext', stem: 'Name it.', accept: [], maxWords: 4 }),
    'accept', 'shorttext accept');
});

check('the good fixture still validates after the shape checks land', () => {
  const { errors } = validatePack(clone(), { expectedId: 'pack-good' });
  assert.deepStrictEqual(errors, []);
});

// ---------- task 6: content checks ----------

check('an EBSR partB choice that is not verbatim in the passage is caught', () => {
  const p = clone();
  p.items[1].partB.choices[1] = 'A chalk mark on a lamppost is a common choice.';  // "lamppost" vs "lamp post"
  expectError(p, 'not found verbatim', 'fabricated quote');
});

check('a hottext span that is not verbatim in the passage is caught', () => {
  const p = clone();
  p.items.push({
    id: 'i-ht', type: 'hottext', mode: 'sentence', passageId: 'p1',
    targets: ['c1-inf-1-key-details'], coachTopic: 'evidence-locate', stem: 'Tap the sentence.',
    spans: ['A dead drop is a way to pass a package without two people ever meeting.',
            'This sentence was never in the passage at all.'],
    key: [0],
    explain: 'This explanation exists only so the item clears the twenty-word floor, leaving the fabricated span below as the single defect this particular check is meant to catch.',
  });
  p.levels[0].itemIds.push('i-ht');
  expectError(p, 'not found verbatim', 'fabricated span');
});

check('a passage above the grade band is caught', () => {
  const p = clone();
  p.passages[0].text = 'Notwithstanding institutional prerogatives, the administrative determination necessitated comprehensive reevaluation of organizational infrastructure methodologies throughout subsequent implementation phases.';
  expectError(p, 'readability', 'too hard');
});

check('a passage below the grade band is caught', () => {
  const p = clone();
  p.passages[0].text = 'The dog ran. The cat sat. We had fun. It was good. He was glad. She ran too.';
  // Part B quotes will also break; assert specifically on the readability error.
  const { errors } = validatePack(p, { expectedId: 'pack-good' });
  assert.strictEqual(errors.some(e => /readability/i.test(e)), true, 'expected a readability error, got ' + JSON.stringify(errors));
});

check('a missing distractor rationale on a choice item is caught', () => {
  const p = clone();
  delete p.items[0].distractorRationale['2'];
  expectError(p, 'distractorRationale', 'missing rationale');
});

check('a too-short explanation is caught', () => {
  const p = clone();
  p.items[0].explain = 'Wrong.';
  expectError(p, 'explain', 'stub explanation');
});

check('a coach topic outside the known families is caught', () => {
  const p = clone();
  p.items[0].coachTopic = 'telepathy-basics';
  expectError(p, 'coachTopic', 'unresolvable coach topic');
});

check('a level target that no item exercises is caught', () => {
  const p = clone();
  p.levels[0].targets.push('c4-3-analyze-sources');
  expectError(p, 'c4-3-analyze-sources', 'uncovered level target');
});

check('two items sharing a stem are caught', () => {
  const p = clone();
  p.items[1].partA.stem = p.items[0].stem;
  p.items[1].partB.stem = p.items[0].stem;
  expectError(p, 'duplicate stem', 'dup stem');
});

check('a pack that tries to WIDEN its own readability band is caught', () => {
  // Without the clamp the author sets the thresholds their own content is judged against, so the
  // brief's own too-hard passage passes clean. The band may be tightened, never loosened.
  const p = clone();
  p.passages[0].text = 'Notwithstanding institutional prerogatives, the administrative determination necessitated comprehensive reevaluation of organizational infrastructure methodologies throughout subsequent implementation phases.';
  p.meta.readability = { fkMin: 0, fkMax: 100, clMin: 0, clMax: 100 };
  expectError(p, 'would widen the default band', 'self-widened band');
});

check('a pack may TIGHTEN its readability band, and a non-numeric override is caught', () => {
  const tight = clone();
  tight.meta.readability = { fkMin: 5.9, fkMax: 6.1 };     // p1 measures FK 5.95, so this still passes
  assert.deepStrictEqual(validatePack(tight, { expectedId: 'pack-good' }).errors, [],
    'tightening to a band the passage still satisfies must be allowed');
  const junk = clone();
  junk.meta.readability = { fkMax: 'loose' };
  expectError(junk, 'must be a finite number', 'non-numeric override');
});

check('two EBSR items sharing the Part B boilerplate stem is NOT a duplicate', () => {
  // partB.stem is template text describing the item type's mechanism and is expected to repeat
  // across every EBSR in a pack. Counting it as a duplicate stem would reject a legitimate pack.
  const p = clone();
  const second = JSON.parse(JSON.stringify(p.items[1]));
  second.id = 'i-ebsr-2';
  second.partA.stem = 'Where does the second person erase the mark?';   // genuinely different question
  // partB.stem deliberately left identical to the first item's boilerplate.
  p.items.push(second);
  p.levels[0].itemIds.push('i-ebsr-2');
  const { errors } = validatePack(p, { expectedId: 'pack-good' });
  assert.strictEqual(errors.some(e => /duplicate stem/.test(e)), false,
    'shared Part B boilerplate must not collide: ' + JSON.stringify(errors.filter(e => /duplicate stem/.test(e))));
});

check('a numeral-dense explanation of twenty-plus words is accepted', () => {
  // textStats counts only letter-led tokens because the readability formulas need that, so digits
  // scored zero and this 24-word sentence was rejected as "19 words" before the floor got its own counter.
  const p = clone();
  p.items[0].explain = 'Distractor 3 confuses the 1st clue with the 2nd, and swaps 4 for 40 percent, missing why 5 of 7 signals fail the test.';
  const { errors } = validatePack(p, { expectedId: 'pack-good' });
  assert.strictEqual(errors.some(e => /explain/.test(e)), false,
    'numeral-dense explanation must clear the floor: ' + JSON.stringify(errors.filter(e => /explain/.test(e))));
});

check('the good fixture still validates after the content checks land', () => {
  const { errors, warnings } = validatePack(clone(), { expectedId: 'pack-good' });
  assert.deepStrictEqual(errors, [], 'errors: ' + JSON.stringify(errors));
  assert.deepStrictEqual(warnings, [], 'warnings: ' + JSON.stringify(warnings));
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
