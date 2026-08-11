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

// ---------- Task 4: openLightbox / closeLightbox ----------
// lbs()/find() below are the brief's helpers, adapted to this stub's real API: no
// dispatchEvent (fire handlers via node.onclick(...) instead) and document.body is a real
// node the stub now provides.
const PLATE_PACK = { meta: { id: 'demo', subject: 'sci' }, figures: [
  { id: 'pl', kind: 'plate', caption: 'c', credit: 'cr', alt: 'a', views: [
    { label: 'Skeletal', src: 'art/demo/a.png' },
    { label: 'Nervous', src: 'art/demo/b.png', overlaySrc: 'art/demo/b-ov.svg' } ] } ] };
const NOALT_PACK = { meta: { id: 'demo2', subject: 'sci' }, figures: [
  { id: 'p2', kind: 'photo', src: 'art/demo/x.jpg', caption: 'c2', credit: 'cr2' } ] };

function lbs() {
  return Array.from(document.body.children).filter(c => c.className === 'mv-lightbox');
}
function find(node, cls, out) {
  out = out || [];
  for (const c of Array.from(node.children || [])) {
    if (String(c.className).split(' ').indexOf(cls) !== -1) out.push(c);
    find(c, cls, out);
  }
  return out;
}
function tap(node) { node.onclick({ stopPropagation() {} }); }

check('openLightbox builds one dialog; a second open replaces the first', () => {
  MVFigures.openLightbox(PLATE_PACK, 'pl');
  MVFigures.openLightbox(PLATE_PACK, 'pl');
  assert.strictEqual(lbs().length, 1);
});

check('plate renders a tab per view; switching swaps src and overlay presence', () => {
  MVFigures.openLightbox(PLATE_PACK, 'pl');
  const box = lbs()[0];
  const tabs = find(box, 'mv-plate-tab');
  assert.strictEqual(tabs.length, 2);
  tap(tabs[1]);
  assert.strictEqual(find(box, 'mv-lb-img')[0].getAttribute('src'), 'art/demo/b.png');
  assert.strictEqual(find(box, 'mv-lb-overlay').length, 1);
  tap(tabs[0]);
  assert.strictEqual(find(box, 'mv-lb-overlay').length, 0);
});

check('tab .active moves with the selected view, via closure not a frame query', () => {
  MVFigures.openLightbox(PLATE_PACK, 'pl');
  const box = lbs()[0];
  const tabs = find(box, 'mv-plate-tab');
  assert.strictEqual(tabs[0].classList.contains('active'), true, 'first tab is not active on open');
  assert.strictEqual(tabs[1].classList.contains('active'), false);
  tap(tabs[1]);
  assert.strictEqual(tabs[0].classList.contains('active'), false, 'active did not leave the first tab');
  assert.strictEqual(tabs[1].classList.contains('active'), true, 'active did not move to the second tab');
});

check('closeLightbox removes the dialog and is safe to call twice, and when nothing is open', () => {
  MVFigures.openLightbox(PLATE_PACK, 'pl');
  MVFigures.closeLightbox();
  MVFigures.closeLightbox();
  assert.strictEqual(lbs().length, 0);
  MVFigures.closeLightbox();
  assert.strictEqual(lbs().length, 0, 'closeLightbox with nothing open must be a no-op, not a throw');
});

check('dom-stub removeChild only clears the parent link on an ACTUAL removal', () => {
  // A regression guard for shared test infrastructure (nine suites use this stub): removeChild
  // must behave like the real DOM's NotFoundError case for a node that is not the caller's
  // child, not silently corrupt the link. closeLightbox itself is guarded by
  // `if (_lb.parentNode)`, so a parentNode that lies here is exactly the masking failure the
  // stub's own comment above parentNode was written to prevent.
  const parent = MVFigures.el('div');
  const stranger = MVFigures.el('div');
  const child = MVFigures.el('span');
  parent.appendChild(child);
  stranger.removeChild(child);
  assert.strictEqual(parent.children.indexOf(child) !== -1, true,
    'child was spliced out of its REAL parent by an unrelated removeChild call');
  assert.strictEqual(child.parentNode, parent,
    'parentNode was cleared even though child was never removed from its real parent');
});

check("dom-stub insertBefore splices at the ref node's index, appends for null or a non-child ref", () => {
  const parent = MVFigures.el('div');
  const a = MVFigures.el('span'), b = MVFigures.el('span'), c = MVFigures.el('span');
  parent.appendChild(a); parent.appendChild(b);
  parent.insertBefore(c, b);                        // insert c between a and b
  assert.strictEqual(parent.children.length, 3);
  assert.strictEqual(parent.children[0], a);
  assert.strictEqual(parent.children[1], c, "insertBefore did not splice at the ref node's index");
  assert.strictEqual(parent.children[2], b);
  assert.strictEqual(c.parentNode, parent, "insertBefore did not set the new node's parent link");

  const d = MVFigures.el('span');
  parent.insertBefore(d, null);                     // refNode null: append
  assert.strictEqual(parent.children.length, 4);
  assert.strictEqual(parent.children[3], d, 'insertBefore(node, null) did not append');

  const stranger = MVFigures.el('div');
  const e = MVFigures.el('span');
  parent.insertBefore(e, stranger);                 // stranger is not parent's child: append, not corrupt
  assert.strictEqual(parent.children.length, 5,
    "insertBefore with a refNode that is not this node's child must append safely, not splice at a bogus index");
  assert.strictEqual(parent.children[4], e);
  assert.strictEqual(parent.children[0], a, 'earlier children must be undisturbed');
});

check('dom-stub firstChild returns children[0], or null on an empty node', () => {
  const empty = MVFigures.el('div');
  assert.strictEqual(empty.firstChild, null);
  const parent = MVFigures.el('div');
  const a = MVFigures.el('span'), b = MVFigures.el('span');
  parent.appendChild(a); parent.appendChild(b);
  assert.strictEqual(parent.firstChild, a);
});

check('tapping the backdrop closes the lightbox', () => {
  MVFigures.openLightbox(PLATE_PACK, 'pl');
  const box = lbs()[0];
  tap(box);
  assert.strictEqual(lbs().length, 0);
});

check('a figure missing alt renders alt="", never alt="undefined" (matches the strip convention)', () => {
  MVFigures.openLightbox(NOALT_PACK, 'p2');
  const box = lbs()[0];
  assert.strictEqual(find(box, 'mv-lb-img')[0].getAttribute('alt'), '');
});

check('a non-plate figure renders no tab rail and no overlay', () => {
  MVFigures.openLightbox(NOALT_PACK, 'p2');
  const box = lbs()[0];
  assert.strictEqual(find(box, 'mv-plate-tab').length, 0);
  assert.strictEqual(find(box, 'mv-lb-overlay').length, 0);
  assert.strictEqual(find(box, 'mv-lb-img')[0].getAttribute('src'), 'art/demo/x.jpg');
});

check('double-tap zooms a wrapper holding both image and overlay, so they scale together', () => {
  MVFigures.openLightbox(PLATE_PACK, 'pl');
  const box = lbs()[0];
  tap(find(box, 'mv-plate-tab')[1]);              // select the view with an overlay
  const img = find(box, 'mv-lb-img')[0];
  const overlay = find(box, 'mv-lb-overlay')[0];
  const wrap = img.parentNode;
  assert.strictEqual(wrap.className, 'mv-lb-zoom', 'the image does not sit in a dedicated zoom wrapper');
  assert.strictEqual(overlay.parentNode, wrap, 'the overlay is not inside the same wrapper as the image');
  tap(img);                                        // first tap: outside the double-tap window, no zoom
  assert.strictEqual(wrap.classList.contains('zoomed'), false);
  tap(img);                                        // second tap: inside the window, zoom toggles on
  assert.strictEqual(wrap.classList.contains('zoomed'), true);
  assert.strictEqual(img.classList.contains('zoomed'), false,
    '.zoomed must live on the wrapper, not the image, or the overlay would not scale with it');
});

// ---------- Task 6: attachReveal / renderRevealCard ----------
const REVEAL_PACK = { meta: { id: 'demo-reveal', subject: 'sci' },
  figures: [{ id: 'rf1', kind: 'photo', src: 'art/demo/r1.jpg', caption: 'cap', credit: 'cred', alt: 'a' }],
  levels: [
    { id: 1, name: 'L1', reveal: { figureId: 'rf1' } },     // resolvable
    { id: 2, name: 'L2', reveal: { figureId: 'missing' } }, // unresolvable figureId
    { id: 3, name: 'L3' },                                  // no reveal field at all
  ] };
const REVEAL_PACK_HIST = { meta: { id: 'demo-reveal-hist', subject: 'hist' }, figures: REVEAL_PACK.figures,
  levels: [{ id: 1, name: 'L1', reveal: { figureId: 'rf1' } }] };
const REVEAL_PLATE_PACK = { meta: { id: 'demo-reveal-plate', subject: 'sci' },
  figures: [{ id: 'pf1', kind: 'plate', caption: 'pcap', credit: 'pcred', alt: 'pa',
    views: [{ src: 'art/demo/p1.jpg', label: 'v1' }] }],
  levels: [{ id: 1, name: 'L1', reveal: { figureId: 'pf1' } }] };

function barWithTwoChildren() {
  const bar = MVFigures.el('div', 'mv-bar');
  bar.appendChild(MVFigures.el('div', 'mv-prog'));
  bar.appendChild(MVFigures.el('div', 'mv-hearts'));
  return bar;
}

check('attachReveal inserts a themed strip of `total` cells between prog and hearts', () => {
  const bar = barWithTwoChildren();
  const reveal = MVFigures.attachReveal(bar, REVEAL_PACK, REVEAL_PACK.levels[0], 5);
  assert.ok(reveal && typeof reveal.onCorrect === 'function', 'attachReveal did not return an onCorrect handle');
  assert.strictEqual(bar.children.length, 3, 'strip was not inserted into the bar');
  const strip = bar.children[1];
  assert.strictEqual(bar.children[0].className, 'mv-prog', 'strip did not land between prog and hearts');
  assert.strictEqual(bar.children[2].className, 'mv-hearts', 'strip did not land between prog and hearts');
  const classes = String(strip.className).split(' ');
  assert.ok(classes.includes('mv-reveal-strip'), 'strip is missing its own class');
  assert.ok(classes.includes('rv-sci'), 'a sci pack did not get the rv-sci theme');
  assert.strictEqual(strip.children.length, 5, 'cell count did not match `total`');
  for (const c of strip.children) assert.strictEqual(c.className, 'mv-rv-cell');
});

check('attachReveal themes a hist pack rv-hist', () => {
  const bar = barWithTwoChildren();
  const reveal = MVFigures.attachReveal(bar, REVEAL_PACK_HIST, REVEAL_PACK_HIST.levels[0], 3);
  assert.ok(reveal);
  const classes = String(bar.children[1].className).split(' ');
  assert.ok(classes.includes('rv-hist'), 'a hist pack did not get the rv-hist theme');
});

check('attachReveal.onCorrect marks the right cell found, and is idempotent', () => {
  const bar = barWithTwoChildren();
  const reveal = MVFigures.attachReveal(bar, REVEAL_PACK, REVEAL_PACK.levels[0], 4);
  const strip = bar.children[1];
  reveal.onCorrect(2);
  assert.strictEqual(strip.children[2].classList.contains('found'), true, 'onCorrect(2) did not mark cell 2');
  assert.strictEqual(strip.children[0].classList.contains('found'), false, 'onCorrect(2) marked a cell it should not have');
  reveal.onCorrect(2);   // idempotent
  assert.strictEqual(strip.children[2].classList.contains('found'), true);
  assert.doesNotThrow(() => reveal.onCorrect(99), 'an out-of-range index must not throw');
});

check('attachReveal.onCorrect never un-finds an earlier found cell when a later question is answered correctly', () => {
  // Fix round 1, item 5: this is the task's headline invariant (never punitive) and, before
  // this check, only the RUNNER side pinned it (a wrong answer never calls onCorrect). Nothing
  // pinned that onCorrect itself is additive: a handle that un-found a previous cell on every
  // new call would still pass every other check in this file.
  const bar = barWithTwoChildren();
  const reveal = MVFigures.attachReveal(bar, REVEAL_PACK, REVEAL_PACK.levels[0], 4);
  const strip = bar.children[1];
  reveal.onCorrect(0);
  reveal.onCorrect(2);
  assert.strictEqual(strip.children[0].classList.contains('found'), true,
    'an earlier found cell must never be un-found by a later correct answer');
  assert.strictEqual(strip.children[2].classList.contains('found'), true,
    'the later correct answer did not mark its own cell found');
  assert.strictEqual(strip.children[1].classList.contains('found'), false, 'an unanswered cell must not read found');
  assert.strictEqual(strip.children[3].classList.contains('found'), false, 'an unanswered cell must not read found');
});

check('attachReveal returns null and touches the bar not at all for a reveal-less or unresolvable level', () => {
  const bar1 = barWithTwoChildren();
  assert.strictEqual(MVFigures.attachReveal(bar1, REVEAL_PACK, REVEAL_PACK.levels[2], 4), null,
    'a level with no reveal field must return null');
  assert.strictEqual(bar1.children.length, 2, 'a reveal-less level must not insert anything into the bar');

  const bar2 = barWithTwoChildren();
  assert.strictEqual(MVFigures.attachReveal(bar2, REVEAL_PACK, REVEAL_PACK.levels[1], 4), null,
    'an unresolvable figureId must return null');
  assert.strictEqual(bar2.children.length, 2, 'an unresolvable figureId must not insert anything into the bar');
});

check("renderRevealCard builds a card with the figure image, a 12-tile cover grid, caption and credit", () => {
  const host = MVFigures.el('div');
  const ok = MVFigures.renderRevealCard(REVEAL_PACK, 0, host);
  assert.strictEqual(ok, true);
  assert.strictEqual(host.children.length, 1, 'renderRevealCard did not append the card to hostEl');
  const card = host.children[0];
  assert.strictEqual(card.className, 'mv-rv-card');
  const frame = card.children[0];
  assert.strictEqual(frame.className, 'mv-rv-frame');
  const img = frame.children[0];
  assert.strictEqual(img.getAttribute('src'), 'art/demo/r1.jpg');
  assert.strictEqual(img.getAttribute('alt'), 'a');
  const grid = frame.children[1];
  assert.strictEqual(grid.className, 'mv-rv-grid');
  assert.strictEqual(grid.children.length, 12, 'the cover grid must be exactly 12 tiles');
  for (const t of grid.children) assert.strictEqual(t.className, 'mv-rv-tile');
  assert.strictEqual(card.children[1].className, 'mv-rv-cap');
  assert.strictEqual(card.children[1].textContent, 'cap');
  assert.strictEqual(card.children[2].className, 'mv-lb-credit');
  assert.strictEqual(card.children[2].textContent, 'cred');
});

check("renderRevealCard uses a plate figure's first view src", () => {
  const host = MVFigures.el('div');
  assert.strictEqual(MVFigures.renderRevealCard(REVEAL_PLATE_PACK, 0, host), true);
  const img = host.children[0].children[0].children[0];
  assert.strictEqual(img.getAttribute('src'), 'art/demo/p1.jpg');
  assert.strictEqual(img.getAttribute('alt'), 'pa');
});

check('renderRevealCard renders alt="" for a figure with no alt, never alt="undefined" (matches the strip/lightbox convention)', () => {
  const noAltPack = { meta: { id: 'demo-reveal-noalt', subject: 'sci' },
    figures: [{ id: 'na1', kind: 'photo', src: 'art/demo/na.jpg', caption: 'c', credit: 'cr' }],
    levels: [{ id: 1, name: 'L1', reveal: { figureId: 'na1' } }] };
  const host = MVFigures.el('div');
  MVFigures.renderRevealCard(noAltPack, 0, host);
  const img = host.children[0].children[0].children[0];
  assert.strictEqual(img.getAttribute('alt'), '');
});

check('renderRevealCard returns false and appends nothing for a reveal-less level, an unresolvable one, or a missing host', () => {
  const host = MVFigures.el('div');
  assert.strictEqual(MVFigures.renderRevealCard(REVEAL_PACK, 2, host), false, 'reveal-less level must return false');
  assert.strictEqual(MVFigures.renderRevealCard(REVEAL_PACK, 1, host), false, 'unresolvable figureId must return false');
  assert.strictEqual(MVFigures.renderRevealCard(REVEAL_PACK, 0, null), false, 'a missing host must return false');
  assert.strictEqual(host.children.length, 0, 'a false-returning call must not append anything');
});

const REVEAL_PLATE_NOVIEWS_PACK = { meta: { id: 'demo-reveal-plate-noviews', subject: 'sci' },
  // Deliberately missing `views`, which validate-pack.js's plate rule would reject on a real
  // pack; kept anyway as defense-in-depth, matching the identical guard already proven for
  // renderStrip and renderItemFigure against the same malformed shape.
  figures: [{ id: 'pf2', kind: 'plate', src: 'art/demo/fallback.jpg', caption: 'c', credit: 'cr', alt: 'a' }],
  levels: [{ id: 1, name: 'L1', reveal: { figureId: 'pf2' } }] };

check("renderRevealCard falls back to f.src for a malformed plate with no views, matching renderStrip/renderItemFigure's guard", () => {
  // Fix round 1, item 7: renderRevealCard dereferenced f.views[0].src with no guard, unlike its
  // two siblings, which would throw on exactly this shape instead of degrading gracefully.
  const host = MVFigures.el('div');
  assert.doesNotThrow(() => MVFigures.renderRevealCard(REVEAL_PLATE_NOVIEWS_PACK, 0, host));
  const img = host.children[0].children[0].children[0];
  assert.strictEqual(img.getAttribute('src'), 'art/demo/fallback.jpg');
});

check('renderRevealCard eventually marks all twelve tiles .away (the tile-lift loop actually runs, for every tile)', () => {
  // Fix round 1, item 4: before this check, the entire twelve-setTimeout loop that reveals the
  // figure was pinned by NO test. A future task collecting or cancelling those timers (the
  // pre-flight floated a disposer, and Task 6's own report invited revisiting it) could leave
  // every tile covering the artifact forever and every existing suite would stay green.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };
  try {
    const host = MVFigures.el('div');
    MVFigures.renderRevealCard(REVEAL_PACK, 0, host);
    const frame = host.children[0].children[0];
    const grid = frame.children[1];
    assert.strictEqual(grid.className, 'mv-rv-grid', 'grid was not frame.children[1] as expected');
    assert.strictEqual(grid.children.length, 12);
    for (let i = 0; i < grid.children.length; i++) {
      assert.strictEqual(grid.children[i].classList.contains('away'), true,
        `tile ${i} never received .away -- the lift loop did not run for it`);
    }
  } finally {
    global.setTimeout = realSetTimeout;
  }
});

check("dom-stub insertBefore detaches the moved node from its PREVIOUS parent, not just the new one", () => {
  // Fix round 1, item 7: the same "state lies about itself" corruption removeChild's fix
  // already guards against, reachable from the insert side. Without the detach, `mover` would
  // be listed in BOTH oldParent.children and newParent.children at once.
  const oldParent = MVFigures.el('div');
  const newParent = MVFigures.el('div');
  const mover = MVFigures.el('span');
  oldParent.appendChild(mover);
  assert.strictEqual(oldParent.children.length, 1);
  newParent.insertBefore(mover, null);
  assert.strictEqual(oldParent.children.length, 0,
    "the moved node is still listed in its old parent's children -- duplicated across two parents");
  assert.strictEqual(newParent.children.length, 1);
  assert.strictEqual(newParent.children[0], mover);
  assert.strictEqual(mover.parentNode, newParent, "parentNode did not move to the new parent");
});

// ---------- Task 7: renderItemFigure ----------
// One figure rail per item (item.figureId, cross-referenced by validate-pack.js), inserted
// BEFORE whatever Items.render already built in itemBox, unlike renderStrip's multi-figure
// horizontal strip which only ever appends into an empty passage host.

check('renderItemFigure inserts a .mv-item-fig as itemBox.firstChild, before existing content', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  const stem = MVFigures.el('div', 'mv-stem', 'Question text');
  itemBox.appendChild(stem);   // simulate Items.render already having built the stem
  MVFigures.renderItemFigure(PACK, 'f1', itemBox);
  assert.strictEqual(itemBox.children.length, 2, 'renderItemFigure did not insert into itemBox');
  assert.strictEqual(itemBox.children[0].className, 'mv-item-fig', 'the figure did not land as firstChild');
  assert.strictEqual(itemBox.children[1], stem, 'the figure did not land BEFORE the existing stem');
  const wrap = itemBox.children[0];
  const btn = wrap.children[0];
  assert.strictEqual(btn.className, 'mv-fig');
  const img = btn.children[0];
  assert.strictEqual(img.getAttribute('alt'), 'a');
  assert.strictEqual(img.getAttribute('src'), 'art/demo/f1.jpg');
});

check('renderItemFigure on an EMPTY itemBox still inserts as the only child', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  MVFigures.renderItemFigure(PACK, 'f1', itemBox);
  assert.strictEqual(itemBox.children.length, 1);
  assert.strictEqual(itemBox.children[0].className, 'mv-item-fig');
});

check('renderItemFigure uses a plate figure\'s first view src', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  MVFigures.renderItemFigure(PACK, 'f3', itemBox);
  const img = itemBox.children[0].children[0].children[0];
  assert.strictEqual(img.getAttribute('src'), 'art/demo/f3-1.jpg', "plate rail did not use its first view's src");
});

check('renderItemFigure renders alt="" for a figure with no alt, never alt="undefined"', () => {
  const noAltPack = { meta: { id: 'demo3', subject: 'sci' },
    figures: [{ id: 'na1', kind: 'photo', src: 'art/demo/na.jpg', caption: 'c', credit: 'cr' }] };
  const itemBox = MVFigures.el('div', 'mv-item');
  MVFigures.renderItemFigure(noAltPack, 'na1', itemBox);
  const img = itemBox.children[0].children[0].children[0];
  assert.strictEqual(img.getAttribute('alt'), '');
});

check('renderItemFigure with an unknown figureId inserts nothing and does not throw', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  const stem = MVFigures.el('div', 'mv-stem', 'Question text');
  itemBox.appendChild(stem);
  assert.doesNotThrow(() => MVFigures.renderItemFigure(PACK, 'missing', itemBox));
  assert.strictEqual(itemBox.children.length, 1, 'an unresolvable figureId must not insert anything');
  assert.strictEqual(itemBox.children[0], stem);
});

check('renderItemFigure with no itemBox does not throw', () => {
  assert.doesNotThrow(() => MVFigures.renderItemFigure(PACK, 'f1', null));
});

check('renderItemFigure thumb click reaches the LIVE openLightbox, not a captured stub', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  MVFigures.renderItemFigure(PACK, 'f1', itemBox);
  const button = itemBox.children[0].children[0];
  const orig = MVFigures.openLightbox;
  const calls = [];
  MVFigures.openLightbox = (packArg, figId) => { calls.push([packArg, figId]); };
  try {
    button.onclick({ stopPropagation() {} });
    assert.strictEqual(calls.length, 1, 'thumb click did not reach openLightbox');
    assert.strictEqual(calls[0][0], PACK);
    assert.strictEqual(calls[0][1], 'f1');
  } finally {
    MVFigures.openLightbox = orig;
  }
});

// ---------- Task 7 fix round 1: kind badge + loading="lazy" on the item-figure rail ----------
// Restores the signal a bare 128x72 image gave no clue about: validate-pack guarantees an item
// figure is an assessed data figure (never a photo, always carrying a dataTable), so the child
// needs the same kind pill renderStrip already shows, not just a picture with no label.

check('renderItemFigure appends the SAME kind badge renderStrip uses, after the image, in the same button', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  MVFigures.renderItemFigure(PACK, 'f1', itemBox);   // f1 is kind 'photo' in this fixture
  const btn = itemBox.children[0].children[0];
  assert.strictEqual(btn.children.length, 2, 'the button must carry exactly the image and one badge span');
  assert.strictEqual(btn.children[0].tagName, 'img', 'the image must stay first, before the badge');
  const badge = btn.children[1];
  assert.strictEqual(badge.className, 'mv-fig-badge');
  assert.strictEqual(badge.textContent, 'PHOTO');
});

check('renderItemFigure badges a plate rail PLATE, matching its resolved kind', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  MVFigures.renderItemFigure(PACK, 'f3', itemBox);
  const badge = itemBox.children[0].children[0].children[1];
  assert.strictEqual(badge.textContent, 'PLATE');
});

check('renderItemFigure renders a visibly-wrong badge for a kind absent from BADGE, matching renderStrip, not a silent empty pill', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  MVFigures.renderItemFigure(PACK, 'f4', itemBox);   // f4 is kind 'sketch', deliberately unmapped
  const badge = itemBox.children[0].children[0].children[1];
  assert.strictEqual(badge.textContent, '?sketch',
    'an unmapped kind must render a visibly-wrong badge, not an empty pill or a silent uppercase guess');
});

check('renderItemFigure sets loading="lazy" on its thumb image, matching renderStrip\'s convention', () => {
  const itemBox = MVFigures.el('div', 'mv-item');
  MVFigures.renderItemFigure(PACK, 'f1', itemBox);
  const img = itemBox.children[0].children[0].children[0];
  assert.strictEqual(img.getAttribute('loading'), 'lazy');
});

console.log(failures ? `figures.test: ${failures} FAILURE(S)` : 'figures.test: all clean');
process.exit(failures ? 1 : 0);
