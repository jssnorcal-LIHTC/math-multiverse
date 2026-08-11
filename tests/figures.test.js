'use strict';
const assert = require('assert');
const MVFigures = require('../engine/figures.js');
const { installDomStub } = require('./dom-stub.js');
installDomStub();

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

const PACK = { meta: { id: 'demo', subject: 'sci' }, figures: [
  { id: 'f1', kind: 'photo', src: 'art/demo/f1.jpg', caption: 'c', credit: 'cr', alt: 'a' },
] };

check('resolve finds a figure by id', () => {
  assert.strictEqual(MVFigures.resolve(PACK, 'f1').src, 'art/demo/f1.jpg');
});
check('resolve returns null for unknown id and figureless pack', () => {
  assert.strictEqual(MVFigures.resolve(PACK, 'nope'), null);
  assert.strictEqual(MVFigures.resolve({ meta: { id: 'x' } }, 'f1'), null);
});
check('enums are locked', () => {
  assert.deepStrictEqual(MVFigures.FIG_KINDS, ['photo','plate','map','diagram','chart']);
  assert.strictEqual(MVFigures.DOC_KINDS.length, 11);
});
check('loading the module touched no DOM', () => {
  assert.strictEqual(typeof MVFigures.renderStrip, 'function');
});

console.log(failures ? `figures.test: ${failures} FAILURE(S)` : 'figures.test: all clean');
process.exit(failures ? 1 : 0);
