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
    explain: 'This item is deliberately unreferenced so the orphan warning can be exercised without tripping an error.',
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

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
