'use strict';
const assert = require('assert');
const MVFigures = require('../engine/figures.js');
// LOAD-BEARING: this capture must happen BEFORE installDomStub; if someone moves installDomStub above the require, the no-DOM check must go red.
const HAD_DOC_AT_LOAD = (typeof document !== 'undefined');
const { installDomStub } = require('./dom-stub.js');
installDomStub();

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

const PACK = { meta: { id: 'demo', subject: 'sci' }, figures: [
  { id: 'f1', kind: 'photo', src: 'art/demo/f1.jpg', caption: 'c', credit: 'cr', alt: 'a' },
  { id: 'f2', kind: 'map', src: 'art/demo/f2.jpg', caption: 'c2', credit: 'cr2', alt: 'b' },
  { id: 'f3', kind: 'plate', caption: 'c3', credit: 'cr3', alt: 'c',
    views: [{ src: 'art/demo/f3-1.jpg', label: 'v1' }, { src: 'art/demo/f3-2.jpg', label: 'v2' }] },
  // Deliberately NOT a FIG_KINDS entry: exercises the BADGE fallback for a kind that never
  // should reach here through a validated pack, but must still render visibly, not silently.
  { id: 'f4', kind: 'sketch', src: 'art/demo/f4.jpg', caption: 'c4', credit: 'cr4', alt: 'd' },
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
  assert.deepStrictEqual(MVFigures.DOC_KINDS, ['case-file','recovered-entry','source-desk','addendum',
    'field-manual','status-log','weather-log','field-report','procedure','memo','minutes']);
});
check('loading the module touched no DOM (required before dom-stub install)', () => {
  assert.strictEqual(HAD_DOC_AT_LOAD, false);
  assert.strictEqual(typeof MVFigures.renderStrip, 'function');
  assert.strictEqual(typeof MVFigures.renderItemFigure, 'function');
  assert.strictEqual(typeof MVFigures.openLightbox, 'function');
  assert.strictEqual(typeof MVFigures.closeLightbox, 'function');
  assert.strictEqual(typeof MVFigures.attachReveal, 'function');
  assert.strictEqual(typeof MVFigures.renderRevealCard, 'function');
});

check('validate-pack enum twins match engine enums', () => {
  const vp = require('./validate-pack.js');
  assert.deepStrictEqual(vp.FIG_KINDS, MVFigures.FIG_KINDS);
  assert.deepStrictEqual(vp.DOC_KINDS, MVFigures.DOC_KINDS);
});

check('renderStrip appends a capped strip with one button per resolvable id', () => {
  const host = MVFigures.el('div');
  const strip = MVFigures.renderStrip(PACK, ['f1', 'f2', 'f3', 'missing'], host);
  assert.ok(strip && strip.className === 'mv-figs');
  // The runner discards renderStrip's return value (engine/runner.js), so appendChild onto
  // hostEl is the ONLY channel a figure has to reach the screen; assert on hostEl too, not
  // only on the returned node.
  assert.strictEqual(host.children.length, 1, 'renderStrip did not append the strip to hostEl');
  assert.strictEqual(host.children[0], strip, 'the appended node is not the returned strip');
  const buttons = strip.children.filter ? strip.children.filter(c => c.className === 'mv-fig')
    : Array.from(strip.children).filter(c => c.className === 'mv-fig');
  assert.strictEqual(buttons.length, 3);
  const img = buttons[0].children[0];
  assert.strictEqual(img.getAttribute('alt'), 'a');
  assert.strictEqual(img.getAttribute('loading'), 'lazy');
  const badges = buttons.map(b => b.children[1].textContent);
  assert.deepStrictEqual(badges, ['PHOTO', 'MAP', 'PLATE'], 'badge labels did not match figure kind');
  const plateImg = buttons[2].children[0];
  assert.strictEqual(plateImg.getAttribute('src'), 'art/demo/f3-1.jpg',
    "plate thumb did not use its first view's src");
});
check('renderStrip with zero resolvable ids appends nothing and returns null', () => {
  const host = MVFigures.el('div');
  assert.strictEqual(MVFigures.renderStrip(PACK, ['missing'], host), null);
  assert.strictEqual(host.children.length, 0);
});
check('renderStrip thumb click reaches the LIVE openLightbox, not a captured stub', () => {
  // Task 4 replaces openLightbox next; if the click handler captured Task 1's stub at
  // renderStrip-build time instead of resolving api.openLightbox live, the lightbox would
  // never open from a thumb and this would stay green for the wrong reason.
  const host = MVFigures.el('div');
  const strip = MVFigures.renderStrip(PACK, ['f1'], host);
  const button = strip.children[0];
  const orig = MVFigures.openLightbox;
  const calls = [];
  MVFigures.openLightbox = (packArg, figId) => { calls.push([packArg, figId]); };
  try {
    button.onclick({ stopPropagation() {} });
    assert.strictEqual(calls.length, 1, 'thumb click did not reach openLightbox');
    assert.strictEqual(calls[0][0], PACK, 'openLightbox was not called with the pack');
    assert.strictEqual(calls[0][1], 'f1', 'openLightbox was not called with the figure id');
  } finally {
    MVFigures.openLightbox = orig;
  }
});
check('renderStrip renders a visibly-wrong badge for a kind absent from BADGE, not a silent empty pill', () => {
  const host = MVFigures.el('div');
  const strip = MVFigures.renderStrip(PACK, ['f4'], host);
  const badge = strip.children[0].children[1];
  assert.strictEqual(badge.textContent, '?sketch',
    'an unmapped kind must render a visibly-wrong badge, not an empty pill or a silent uppercase guess');
});

console.log(failures ? `figures.test: ${failures} FAILURE(S)` : 'figures.test: all clean');
process.exit(failures ? 1 : 0);
