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

// ---------- task 10 added pass: a level may not ask the same item twice ----------
// pickItems draws from itemIds without deduping, so a repeat here queues the same question twice
// inside one level. Verified exact message: levels[0].itemIds: lists ["i-mc-1"] more than once; a
// level may not ask the same item twice.

check('a level whose itemIds repeats an id is caught', () => {
  const p = clone();
  p.levels[0].itemIds = ['i-mc-1', 'i-mc-1', 'i-ebsr-1'];
  expectError(p, 'more than once', 'duplicate itemIds');
});

check('a clean level with no repeated itemIds does not trigger the duplicate check', () => {
  const { errors } = validatePack(clone(), { expectedId: 'pack-good' });
  assert.strictEqual(errors.some(e => /more than once/.test(e)), false,
    'the clean fixture must not trigger the duplicate-itemIds check: ' + JSON.stringify(errors.filter(e => /more than once/.test(e))));
});

// ---------- task 14 added pass: an ebsr partB.key shape must not be learnable by position ----------
// The identity map ({"0":0,"1":1,"2":2,"3":3}) let a child score the evidence half of every ebsr item
// by matching Part B's letter to Part A's, without reading the passage. The fix is not "reject the
// identity" -- a single identity map is a perfectly ordinary way to write one item -- it is "reject any
// single partB.key SHAPE that repeats often enough across the pack's ebsr items to be learnable."
// "Shifted by one" is exactly as exploitable as the identity and must be caught too, or the rule could
// have been written as an identity check and passed its own suite while missing the general case.

// Build one ebsr item quoting the fixture's own p1 passage, so every item stays valid apart from the
// partB.key shape under test. `shape` is a 4-element permutation array: shape[a] = the partB choice
// index that is Part A option a's best evidence.
function ebsrShapeItem(id, shape) {
  const key = {};
  shape.forEach((bIdx, aIdx) => { key[String(aIdx)] = bIdx; });
  return {
    id, type: 'ebsr', passageId: 'p1',
    targets: ['c1-inf-1-key-details', 'c1-inf-4-reasoning'], coachTopic: 'evidence-support', dok: 3,
    partA: {
      stem: 'Why do handlers want a signal that looks dull? (' + id + ')',
      choices: [
        'So it is cheap to leave behind', 'So it does not attract attention',
        'So it can be erased quickly', 'So other couriers can copy it',
      ],
      key: 1,
    },
    partB: {
      stem: 'Which sentence from the passage best supports your answer?',
      choices: [
        'The signal is usually small and dull, because a signal that draws attention defeats the whole method.',
        'A chalk mark on a lamp post is a common choice.',
        'Handlers prefer this method in crowded places.',
        'A busy square gives a courier dozens of ordinary reasons to stop walking.',
      ],
      key,
    },
    explain: 'This explanation is deliberately long enough to clear the twenty-word floor the content ' +
      'checks impose, and it exists only so this synthetic item stays valid apart from the shape rule under test.',
    distractorRationale: {
      '0': 'cost is never mentioned in the passage; this is real-world reasoning substituted for the text',
      '2': 'erasing appears in the passage but as a later step, not as the reason the signal is dull',
      '3': 'confuses copying with concealment; nothing in the passage is about other couriers reading the mark',
    },
  };
}

// Assemble a pack (fixture meta/passages, fresh items/levels) from a list of partB.key shapes, one
// ebsr item per shape, all referenced by a single level so nothing orphans.
function packWithEbsrShapes(shapes) {
  const p = clone();
  p.items = shapes.map((shape, i) => ebsrShapeItem('i-shape-' + i, shape));
  p.levels = [{
    id: 1, name: 'Tradecraft', goal: 'Read what the briefing actually says',
    questions: shapes.length,
    targets: ['c1-inf-1-key-details', 'c1-inf-4-reasoning'],
    itemIds: p.items.map(it => it.id),
  }];
  return p;
}

const IDENTITY  = [0, 1, 2, 3];
const SHIFT_ONE = [1, 2, 3, 0];   // "always one to the right" -- as exploitable as the identity

check('12 of 12 ebsr items sharing the identity partB.key shape is caught', () => {
  const p = packWithEbsrShapes(Array(12).fill(IDENTITY));
  expectError(p, '0>0,1>1,2>2,3>3', 'identity shape shared by all 12');
});

check('12 of 12 ebsr items sharing a shifted-by-one partB.key shape is caught (not an identity check)', () => {
  const p = packWithEbsrShapes(Array(12).fill(SHIFT_ONE));
  expectError(p, '0>1,1>2,2>3,3>0', 'shifted-by-one shape shared by all 12');
});

check('5 of 12 ebsr items sharing one shape is clean: a minority is not learnable', () => {
  // One shape five times, seven other items each carrying its own distinct shape -- the most any
  // single shape repeats is 5, and 5*2 = 10 does not exceed 12, so the rule must stay quiet.
  const majority = [1, 3, 0, 2];
  const singles = [
    [2, 0, 3, 1], [3, 2, 1, 0], [0, 2, 3, 1], [0, 1, 2, 3],
    [1, 0, 3, 2], [2, 3, 0, 1], [3, 1, 2, 0],
  ];
  const p = packWithEbsrShapes([...Array(5).fill(majority), ...singles]);
  const { errors } = validatePack(p);
  assert.strictEqual(errors.some(e => /share the partB\.key shape/.test(e)), false,
    '5 of 12 sharing a shape must not be flagged as learnable: ' + JSON.stringify(errors.filter(e => /share the partB\.key shape/.test(e))));
});

check('a properly permuted 12-item pack (four shapes, three items each) is clean', () => {
  // Mirrors the actual task-14 fix: four non-identity shapes, each used three times across twelve
  // items -- the most any single shape repeats is 3, well under the learnable threshold.
  const perms = [[1, 3, 0, 2], [2, 0, 3, 1], [3, 2, 1, 0], [0, 2, 3, 1]];
  const shapes = Array.from({ length: 12 }, (_, i) => perms[i % perms.length]);
  const p = packWithEbsrShapes(shapes);
  const { errors, warnings } = validatePack(p);
  assert.deepStrictEqual(errors, [], 'the permuted pack must validate clean: ' + JSON.stringify(errors));
  assert.deepStrictEqual(warnings, [], 'the permuted pack must carry no warnings: ' + JSON.stringify(warnings));
});

// ---------- interleave retrofit added pass: a fresh profile's first run must mix item types ----------
// MVFresh.orderPool is a stable sort with every unseen id tied, and pickItems shuffles presentation
// order only, so a fresh profile is served itemIds[0..questions-1] verbatim. A type-blocked front
// (four ebsr in a row) hides whole item types until replays. Under the effective rotate policy the
// first `questions` ids must cover min(questions, distinct types in the pool) item types.

// A second valid mc item so a level can carry a type-blocked front: [mc, mc, ebsr].
function secondMcItem() {
  return {
    id: 'i-mc-2', type: 'mc', passageId: 'p1', targets: ['c1-inf-1-key-details'],
    coachTopic: 'central-idea', stem: 'Second mc item so the front of the list can block?',
    choices: ['a', 'b', 'c', 'd'], key: 0,
    explain: 'This item exists so the interleave tests can put two same-type items ahead of a third type, and it is written long enough to clear the twenty-word explanation floor the content checks impose.',
    distractorRationale: { '1': 'x', '2': 'y', '3': 'z' },
  };
}
function blockedFrontPack() {
  const p = clone();
  p.items.push(secondMcItem());
  p.levels[0].itemIds = ['i-mc-1', 'i-mc-2', 'i-ebsr-1'];
  p.levels[0].questions = 2;      // first 2 served = mc, mc; the pool carries ebsr too
  return p;
}

check('a type-blocked first slice under rotate policy is caught', () => {
  expectError(blockedFrontPack(), 'item types', 'blocked front');
});

check('an interleaved first slice passes', () => {
  const p = blockedFrontPack();
  p.levels[0].itemIds = ['i-mc-1', 'i-ebsr-1', 'i-mc-2'];
  const { errors } = validatePack(p, { expectedId: 'pack-good' });
  assert.strictEqual(errors.some(e => /item types/.test(e)), false,
    'an interleaved front must not be flagged: ' + JSON.stringify(errors.filter(e => /item types/.test(e))));
});

check('questions below the type count only needs that many distinct types', () => {
  const p = blockedFrontPack();
  p.levels[0].questions = 1;      // min(1, 2 types) = 1; a single mc up front is fine
  const { errors } = validatePack(p, { expectedId: 'pack-good' });
  assert.strictEqual(errors.some(e => /item types/.test(e)), false,
    'a first slice shorter than the type count must be capped at questions: ' + JSON.stringify(errors.filter(e => /item types/.test(e))));
});

check('a free-policy level is exempt from the first-slice rule', () => {
  const p = blockedFrontPack();
  p.levels[0].repeatPolicy = 'free';
  const { errors } = validatePack(p, { expectedId: 'pack-good' });
  assert.strictEqual(errors.some(e => /item types/.test(e)), false,
    'free policy serves by rng, not list order; the rule must stay quiet: ' + JSON.stringify(errors.filter(e => /item types/.test(e))));
});

check('a rotate level under a free pack root is still caught (level policy wins)', () => {
  const p = blockedFrontPack();
  p.repeatPolicy = 'free';
  p.levels[0].repeatPolicy = 'rotate';
  expectError(p, 'item types', 'level rotate under pack free');
});

// ---------- task 2: figure rules ----------
// pack.figures is a brand-new envelope: none of the 5 shipped packs declares one yet (verified
// before this change landed), so every fixture here is built fresh off figurePack() rather than
// mutating pack-good's existing items/passages/levels. Figures point at real files under
// art/pack-good/ (fixture-a.svg, fixture-b.svg) so the src/existsSync checks run against the real
// filesystem instead of a mock -- this validator gates real files for real packs, so the test for
// it should too.

function figurePack() {
  const p = clone();
  p.figures = [
    {
      id: 'fig-photo', kind: 'photo', src: 'art/pack-good/fixture-a.svg',
      caption: 'A courier crosses the square at dusk.', credit: 'Field photography unit',
      alt: 'A person walking alone across an open plaza.',
    },
    {
      id: 'fig-chart', kind: 'chart', src: 'art/pack-good/fixture-b.svg',
      caption: 'Reported signals by district, one month.', credit: 'Case file archive',
      alt: 'Bar chart of signal counts across four districts.',
      dataTable: { columns: ['District', 'Signals'], rows: [['North', 4], ['South', 7], ['East', 2], ['West', 5]] },
    },
    {
      id: 'fig-diagram', kind: 'diagram', src: 'art/pack-good/fixture-a.svg',
      caption: 'How a dead drop passes without a meeting.', credit: 'Training desk',
      alt: 'Diagram of two couriers using a signal and a hidden package.',
      dataTable: { columns: ['Step', 'Actor'], rows: [['Hide', 'Courier A'], ['Signal', 'Courier A'], ['Collect', 'Courier B']] },
    },
    {
      id: 'fig-plate', kind: 'plate',
      caption: 'The lamp post signal, two views.', credit: 'Field photography unit',
      alt: 'Two photographs of the same lamp post from different angles.',
      views: [
        { label: 'Street level', src: 'art/pack-good/fixture-a.svg' },
        { label: 'Overhead', src: 'art/pack-good/fixture-b.svg', overlaySrc: 'art/pack-good/fixture-a.svg' },
      ],
    },
  ];
  p.passages[0].docKind = 'case-file';
  p.passages[0].figureIds = ['fig-photo'];
  p.levels[0].reveal = { figureId: 'fig-chart' };
  p.items[0].figureId = 'fig-diagram';   // i-mc-1; diagram kind, non-photo, carries a dataTable
  return p;
}

check('a fully valid figure-bearing pack produces zero errors', () => {
  const { errors } = validatePack(figurePack(), { expectedId: 'pack-good' });
  assert.deepStrictEqual(errors, [], 'errors: ' + JSON.stringify(errors));
});

// ---- rule 1: figures array shape and per-figure fields ----

check('figures present but not an array is caught', () => {
  const p = figurePack(); p.figures = 'nope';
  expectError(p, 'not an array', 'figures not array');
});

check('a figure missing alt is caught', () => {
  const p = figurePack(); delete p.figures[0].alt;
  expectError(p, 'alt', 'missing alt');
});

check('a figure with an unknown kind is caught', () => {
  const p = figurePack(); p.figures[0].kind = 'painting';
  expectError(p, 'kind', 'bad kind');
});

check('a duplicate figure id is caught', () => {
  const p = figurePack(); p.figures.push(JSON.parse(JSON.stringify(p.figures[0])));
  expectError(p, 'duplicate figure id', 'dup figure');
});

// ---- rule 2: src / views existence and prefix ----

check('a non-plate figure with no src at all is caught', () => {
  const p = figurePack(); delete p.figures[0].src;
  expectError(p, 'missing or empty', 'missing src field');
});

check('a src outside art/<packId>/ is caught', () => {
  const p = figurePack(); p.figures[0].src = 'art/mando.png';   // real file, wrong pack prefix
  expectError(p, 'must live under', 'src outside prefix');
});

check('a src that does not exist on disk is caught', () => {
  const p = figurePack(); p.figures[0].src = 'art/pack-good/does-not-exist.svg';
  expectError(p, 'file not found', 'missing file');
});

check('a plate figure with only one view is caught', () => {
  const p = figurePack();
  const plate = p.figures.find(f => f.id === 'fig-plate');
  plate.views = [plate.views[0]];
  expectError(p, 'at least two views', 'plate one view');
});

check('a plate view missing its label is caught', () => {
  const p = figurePack();
  p.figures.find(f => f.id === 'fig-plate').views[0].label = '';
  expectError(p, 'label', 'plate view no label');
});

check('a plate view overlaySrc that does not exist is caught', () => {
  const p = figurePack();
  p.figures.find(f => f.id === 'fig-plate').views[1].overlaySrc = 'art/pack-good/nope.svg';
  expectError(p, 'overlaySrc', 'plate overlay missing file');
});

// ---- rule 3: chart dataTable, and any assessed figure needs one (photos banned outright) ----

check('a chart figure with no dataTable is caught', () => {
  const p = figurePack();
  delete p.figures.find(f => f.id === 'fig-chart').dataTable;
  expectError(p, 'dataTable', 'chart no dataTable');
});

check('an item.figureId pointing at a photo is caught: photographs are never assessed', () => {
  const p = figurePack();
  p.items[0].figureId = 'fig-photo';
  expectError(p, 'never assessed', 'assessed photo');
});

check('an item.figureId pointing at a non-chart figure with no dataTable is caught', () => {
  const p = figurePack();
  delete p.figures.find(f => f.id === 'fig-diagram').dataTable;   // item i-mc-1 points here
  expectError(p, 'dataTable', 'assessed diagram no dataTable');
});

// ---- rule 4: passage.figureIds / level.reveal.figureId / item.figureId all resolve ----

check('a dangling passage.figureIds entry is caught', () => {
  const p = figurePack(); p.passages[0].figureIds = ['fig-nope'];
  expectError(p, 'figureIds', 'dangling passage figureId');
});

check('a dangling level.reveal.figureId is caught', () => {
  const p = figurePack(); p.levels[0].reveal.figureId = 'fig-nope';
  expectError(p, 'reveal.figureId', 'dangling reveal figureId');
});

check('a dangling item.figureId is caught', () => {
  const p = figurePack(); p.items[0].figureId = 'fig-nope';
  expectError(p, 'figureId', 'dangling item figureId');
});

// ---- rule 5: passage.docKind ----

check('an unknown passage.docKind is caught', () => {
  const p = figurePack(); p.passages[0].docKind = 'diary';
  expectError(p, 'docKind', 'bad docKind');
});

// ---- rule 6: no raw http(s) URL anywhere in the pack text ----

check('an embedded https:// anywhere in the pack is caught', () => {
  const p = figurePack();
  p.figures[0].credit = 'Source: https://example.com/photo';
  expectError(p, 'https://', 'embedded url');
});

// ---- rule 7: a declared-but-empty figures array is an error ----

check('an empty figures array is caught', () => {
  const p = figurePack(); p.figures = [];
  expectError(p, 'empty', 'empty figures array');
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
