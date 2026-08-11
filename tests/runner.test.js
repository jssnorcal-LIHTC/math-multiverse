'use strict';
const assert = require('assert');
const R = require('../engine/runner.js');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

const items = ['a','b','c','d','e','f'].map((id, i) => ({ id, type: 'mc', choices: ['1','2','3','4'], key: i % 4, stem: id }));

// Deterministic rng so shuffling is testable.
function seeded(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

check('pickItems returns exactly level.questions items', () => {
  const level = { questions: 3, itemIds: ['a','b','c','d','e','f'] };
  assert.strictEqual(R.pickItems(level, items, seeded(1)).length, 3);
});

check('pickItems never repeats an item inside one level', () => {
  const level = { questions: 6, itemIds: ['a','b','c','d','e','f'] };
  const got = R.pickItems(level, items, seeded(7)).map(i => i.id);
  assert.strictEqual(new Set(got).size, 6, 'got ' + got.join(','));
});

check('pickItems only draws from the level itemIds', () => {
  const level = { questions: 2, itemIds: ['a','b'] };
  const got = R.pickItems(level, items, seeded(3)).map(i => i.id);
  assert.strictEqual(got.every(id => id === 'a' || id === 'b'), true, 'got ' + got.join(','));
});

check('pickItems shuffles rather than returning source order every time', () => {
  const level = { questions: 6, itemIds: ['a','b','c','d','e','f'] };
  const seen = new Set();
  for (let s = 1; s <= 12; s++) seen.add(R.pickItems(level, items, seeded(s)).map(i => i.id).join(''));
  assert.strictEqual(seen.size > 1, true, 'every seed produced the same order');
});

check('pickItems throws rather than silently shrinking when a level is over-subscribed', () => {
  const level = { questions: 9, itemIds: ['a','b'] };
  assert.throws(() => R.pickItems(level, items, seeded(1)), /questions/i);
});

// ---------- repeatPolicy rotation: pickItems reads a call-time MVFresh for ordering ----------
check('pickItems rotation: unseen-first via MVFresh, "free" policy ignores it, absent MVFresh keeps legacy shuffle+slice', () => {
  // Fix round 1, item 7: the two globalThis.MVFresh installs below used to sit next to a bare
  // `delete globalThis.MVFresh` with no try/finally between them. A failure in the throwing
  // assertion partway through (or in pickItems itself) would skip that delete and leak a fake
  // MVFresh into every check that runs later in this file, none of which expect one.
  const seenLedger = { 'pack.p1.i0': ['id:a', 'id:b'] };
  const fakeFresh = {
    orderPool: (key, ids) => ids.slice().sort((x, y) => {
      const sx = seenLedger[key] && seenLedger[key].includes('id:' + x) ? 1 : 0;
      const sy = seenLedger[key] && seenLedger[key].includes('id:' + y) ? 1 : 0;
      return sx - sy;
    }),
    marked: [],
    markSeenIds(key, ids) { this.marked.push([key, ids.join(',')]); },
  };
  const lvl = { name: 'L', questions: 2, itemIds: ['a', 'b', 'c', 'd'] };
  const items = ['a', 'b', 'c', 'd'].map(id => ({ id }));

  // rotation: with a fake MVFresh, unseen ids are chosen before seen ones
  globalThis.MVFresh = fakeFresh;
  try {
    const picked = MVRunner._test.pickItems(lvl, items, () => 0.5, 'pack.p1.i0');
    if (picked.some(i => i.id === 'a' || i.id === 'b')) throw new Error('seen item chosen while unseen remained');
  } finally {
    delete globalThis.MVFresh;
  }

  // policy 'free': MVFresh present but ignored
  globalThis.MVFresh = fakeFresh;
  try {
    const lvlFree = { name: 'L', questions: 2, itemIds: ['a', 'b', 'c', 'd'], repeatPolicy: 'free' };
    MVRunner._test.pickItems(lvlFree, items, () => 0.5, 'pack.p1.i0'); // must not throw, may pick any
  } finally {
    delete globalThis.MVFresh;
  }

  // absent MVFresh: identical to legacy behavior (deterministic rng -> fixed order)
  const legacy = MVRunner._test.pickItems(lvl, items, () => 0.5, 'pack.p1.i0');
  if (legacy.length !== 2) throw new Error('legacy path broken');
});

check('scoreFor pays full for correct and proportional for partial', () => {
  assert.strictEqual(R.scoreFor({ correct: true, partial: 1 }), 100);
  assert.strictEqual(R.scoreFor({ correct: false, partial: 0.5 }), 50);
  assert.strictEqual(R.scoreFor({ correct: false, partial: 0 }), 0);
});

check('summarize applies the math star ladder', () => {
  const ok = { correct: true, partial: 1 };
  const bad = { correct: false, partial: 0 };
  assert.strictEqual(R.summarize([ok, ok, ok], 3).stars, 3);
  assert.strictEqual(R.summarize([ok, ok, bad], 3).stars, 2);
  assert.strictEqual(R.summarize([ok, bad, bad], 3).stars, 1);
  assert.strictEqual(R.summarize([bad, bad, bad], 3).stars, 0);
});

check('summarize counts a partial answer as a mistake but keeps its score', () => {
  const half = { correct: false, partial: 0.5 };
  const s = R.summarize([{ correct: true, partial: 1 }, half], 4);
  assert.strictEqual(s.mistakes, 1, 'a partially correct answer is still not correct');
  assert.strictEqual(s.score, 150);
  assert.strictEqual(s.stars, 2);
});

check('summarize marks dnf only when mistakes reach the life count', () => {
  const bad = { correct: false, partial: 0 };
  assert.strictEqual(R.summarize([bad, bad, bad], 3).dnf, true);
  assert.strictEqual(R.summarize([bad, bad, bad], 4).dnf, false, 'four lives means a third mistake still finishes');
  assert.strictEqual(R.summarize([bad, bad, bad], 4).stars, 0, 'finishing with three mistakes still earns no stars');
  assert.strictEqual(R.summarize([bad, bad, bad, bad], 4).dnf, true);
});

check('summarize defaults to three lives when a level does not set one', () => {
  const bad = { correct: false, partial: 0 };
  assert.strictEqual(R.summarize([bad, bad, bad], undefined).dnf, true);
});

check('register wires the pack under its own id, not a prefixed one', () => {
  const reg = {};
  R.register({ meta: { id: 'ela-g6-spy' }, levels: [], items: [], passages: [] }, reg);
  assert.strictEqual(typeof reg['ela-g6-spy'].init, 'function');
  assert.strictEqual(reg['pack:ela-g6-spy'], undefined);
});

// ---------- makeRunner: the DOM layer ----------
// These exist because `makeRunner` was never called by any check, and it was broken in every environment:
// the UMD factory referenced `root`, which lives in the wrapper's scope and not the factory's, so the first
// line that reached for a global threw ReferenceError. Eleven green checks did not notice, because the only
// one that touched a `root` line passed a registry and short-circuited before evaluating it. A function no
// test ever calls is a function that can be entirely broken behind a green gate.

const { installDomStub } = require('./dom-stub.js');
const { makeEl } = installDomStub();

// A correct answer advances on a timer. Run scheduled callbacks synchronously so a whole level can be
// driven in one tick, and restore the real timer afterwards so nothing else in the suite is affected.
function withSyncTimers(fn) {
  const realSet = global.setTimeout, realClear = global.clearTimeout;
  global.setTimeout = (f) => { f(); return 0; };
  global.clearTimeout = () => {};
  try { return fn(); } finally { global.setTimeout = realSet; global.clearTimeout = realClear; }
}

function probePack() {
  const items = [0, 1, 2, 3].map((i) => ({
    id: 'i' + i, type: 'mc', passageId: 'p1',
    targets: ['c1-inf-1-key-details'], coachTopic: 'key-details', dok: 2,
    stem: 'Question ' + i, choices: ['a', 'b', 'c', 'd'], key: 1,
    explain: 'The answer is b because the passage says so, and this sentence is long enough to clear the floor.',
    distractorRationale: { 0: 'took a detail for the idea', 2: 'reversed the relationship', 3: 'imported outside knowledge' },
  }));
  return {
    meta: { id: 'probe', title: 'Probe' },
    passages: [{ id: 'p1', genre: 'informational', title: 'P', text: 'Some passage text.' }],
    items,
    levels: [{ name: 'L1', questions: 4, itemIds: ['i0', 'i1', 'i2', 'i3'], targets: ['c1-inf-1-key-details'], lives: 4 }],
  };
}

function spySave() {
  const calls = { recordLevel: [], recordAnswer: [], markCoachShown: [], saveNow: 0 };
  return {
    calls,
    recordLevel(...a) { calls.recordLevel.push(a); },
    recordAnswer(...a) { calls.recordAnswer.push(a); },
    markCoachShown(...a) { calls.markCoachShown.push(a); },
    saveNow() { calls.saveNow++; },
    stateFor: () => ({ levelStars: [0, 0, 0, 0], levelBest: [0, 0, 0, 0] }),
    totalStars: () => 0,
    isUnlocked: () => true,
    state: { analytics: { perTopic: {}, recentMistakes: [] } },
  };
}

// Drive a level by tapping the given choice index on each successive question.
function play(picks) {
  const Items = require('../engine/items.js');
  const pack = probePack(), host = makeEl('div'), Save = spySave();
  const seen = [];
  R.makeRunner(pack, 0, host, { onComplete(score, stars) { seen.push({ score, stars }); }, onExit() {} },
    { Items, Save, rng: () => 0.5 });
  const steps = [];
  for (const pick of picks) {
    const box = host.querySelectorAll('.mv-item')[0];
    if (!box) break;
    const cs = host.querySelectorAll('.mv-choice');
    if (!cs.length) break;
    const step = { lockedBefore: box.dataset.locked };
    cs[pick].onclick();
    const ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    const after = host.querySelectorAll('.mv-item')[0];
    step.lockedAfter = after ? after.dataset.locked : 'gone';
    step.hasNext = host.querySelectorAll('.mv-next').length > 0;
    steps.push(step);
    const nx = host.querySelectorAll('.mv-next')[0];
    if (nx && nx.onclick) nx.onclick();
  }
  return { host, Save, steps, completed: seen };
}

check('makeRunner constructs and renders a first question', () => {
  withSyncTimers(() => {
    const r = play([]);
    assert.ok(r.host.querySelectorAll('.mv-item').length === 1, 'no item box was rendered');
    assert.ok(r.host.querySelectorAll('.mv-choice').length === 4, 'the four choices were not rendered');
  });
});

check('makeRunner locks the item box on grading, not before', () => {
  withSyncTimers(() => {
    const r = play([0]);
    assert.strictEqual(r.steps[0].lockedBefore, '0', 'the box was locked before the child answered');
    assert.strictEqual(r.steps[0].lockedAfter, '1', 'the box was not locked after grading');
  });
});

check('a wrong answer holds the explanation instead of auto-advancing (26-0714)', () => {
  withSyncTimers(() => {
    const r = play([0]);
    assert.ok(r.steps[0].hasNext, 'a wrong answer produced no NEXT button, so it auto-advanced');
  });
});

check('a graded item records exactly one answer however many times it is tapped', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = probePack(), host = makeEl('div'), Save = spySave();
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
    host.querySelectorAll('.mv-choice')[0].onclick();
    const ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    const recorded = Save.calls.recordAnswer.length;
    for (const b of host.querySelectorAll('.mv-choice')) if (!b.classList.contains('sel') && b.onclick) b.onclick();
    const ck2 = host.querySelectorAll('.mv-check')[0];
    if (ck2 && ck2.onclick) ck2.onclick();
    assert.strictEqual(Save.calls.recordAnswer.length, recorded, 'a graded item accepted a second answer');
  });
});

check('a completed level calls recordLevel exactly once, with the pack id and the ladder stars', () => {
  withSyncTimers(() => {
    const r = play([0, 1, 1, 1]);          // one wrong, three right
    assert.strictEqual(r.Save.calls.recordLevel.length, 1, 'recordLevel was not called exactly once');
    assert.strictEqual(r.Save.calls.recordAnswer.length, 4, 'one answer per item was not recorded');
    const [packId, levelIndex, stars] = r.Save.calls.recordLevel[0];
    assert.strictEqual(packId, 'probe');
    assert.strictEqual(levelIndex, 0);
    assert.strictEqual(stars, 2, 'one mistake in four should be 2 stars on the math ladder');
  });
});

// ---------- makeRunner write side: levelKey construction + MVFresh.markSeenIds ----------
// Review finding on the first pass of this feature: the rotation check above drives pickItems
// directly and never makeRunner, so the levelKey format, the second call-time MVFresh
// resolution, the markSeenIds call, and the try/catch that must suppress a throwing ledger
// were covered only by uncommitted ad-hoc checks. These two close that gap.

check('makeRunner marks the served items seen via a call-time MVFresh, keyed by pack id + level index', () => {
  const calls = [];
  global.MVFresh = {
    orderPool: (key, ids) => ids,               // identity order: isolates this check from orderPool's own logic
    markSeenIds(key, ids) { calls.push([key, ids]); },
  };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack(), host = makeEl('div'), Save = spySave();
      R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
      assert.strictEqual(calls.length, 1, 'markSeenIds must fire exactly once per makeRunner call');
      const [levelKey, ids] = calls[0];
      assert.strictEqual(levelKey, 'pack.probe.i0', 'levelKey must be pack.<meta.id>.i<levelIndex>, 0-based');
      // probePack's one level asks for all 4 of its items (questions === itemIds.length), so the marked
      // ids must be exactly that set, in the order pickItems actually queued them: deterministic here
      // because both rng and orderPool are fixed above (identity order, then Fisher-Yates at 0.5).
      assert.deepStrictEqual(ids, ['i0', 'i3', 'i1', 'i2'], 'marked ids did not match the queue makeRunner actually served');
    });
  } finally {
    delete global.MVFresh;
  }
});

check('makeRunner survives a throwing MVFresh.markSeenIds and still renders the level', () => {
  global.MVFresh = {
    orderPool: (key, ids) => ids,
    markSeenIds() { throw new Error('ledger boom'); },
  };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack(), host = makeEl('div'), Save = spySave();
      R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
      assert.strictEqual(host.querySelectorAll('.mv-item').length, 1, 'a throwing markSeenIds must not stop the level from rendering');
      assert.strictEqual(host.querySelectorAll('.mv-choice').length, 4, 'a throwing markSeenIds must not stop the item from rendering fully');
    });
  } finally {
    delete global.MVFresh;
  }
});

check('runner renders a passage item with NO MVFigures loaded (degrade path)', () => {
  // Pin the precondition itself, matching the discipline already used below for MVItems: a
  // future task that adds a require('../engine/figures.js') to this file would publish
  // globalThis.MVFigures before this check runs, and the check would keep reporting "ok"
  // while no longer testing the degrade path at all, under a name asserting the opposite.
  assert.strictEqual(typeof MVFigures, 'undefined',
    'precondition: this process must have NO MVFigures, or this check is not testing the degrade path');
  // dom-stub environment never requires engine/figures.js, so there is no MVFigures global; a
  // figure-bearing passage must still render text-only rather than throw (optional-layer law).
  const Items = require('../engine/items.js');
  const pack = probePack();
  pack.passages[0].figureIds = ['f1'];
  pack.passages[0].docKind = 'case-file';
  const host = makeEl('div');
  const Save = spySave();
  const cleanup = R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
  assert.strictEqual(host.querySelectorAll('.mv-passage').length, 1, 'passage panel missing');
  assert.strictEqual(host.querySelectorAll('.mv-para').length, 1, 'passage body did not render');
  assert.strictEqual(host.querySelectorAll('.mv-item').length, 1, 'item box did not render');
  assert.strictEqual(host.querySelectorAll('.mv-choice').length, 4, 'item choices did not render fully');
  cleanup();
});

check('makeRunner calls FG.renderStrip exactly once per passage, across two questions, with the passage figureIds and the .mv-passage host', () => {
  // Capture-and-restore, not delete, matching the file's own idiom at the hadPack check below:
  // delete is wrong if anything ever pre-populates the global.
  const had = global.MVFigures;
  const calls = [];
  global.MVFigures = {
    renderStrip(pack, figureIds, hostEl) {
      calls.push({ ids: figureIds.slice(), hostClassName: hostEl.className });
      const strip = makeEl('div');
      strip.className = 'mv-figs';
      hostEl.appendChild(strip);
      return strip;
    },
  };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack();
      pack.passages[0].figureIds = ['f1', 'f2'];
      const host = makeEl('div'), Save = spySave();
      R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
      assert.strictEqual(calls.length, 1, 'renderStrip was not called on the first question');
      const progBefore = host.querySelectorAll('.mv-prog')[0].textContent;
      // Answer correctly (key is 1 on every probePack item) so it auto-advances to the next
      // question, which sits on the SAME passage; renderStrip must not fire a second time.
      host.querySelectorAll('.mv-choice')[1].onclick();
      const ck = host.querySelectorAll('.mv-check')[0];
      if (ck && ck.onclick) ck.onclick();
      const progAfter = host.querySelectorAll('.mv-prog')[0].textContent;
      // Pin the premise itself: a second question was actually reached, so this check would
      // fail if the click did nothing rather than passing vacuously.
      assert.notStrictEqual(progAfter, progBefore, 'the level did not advance to a second question');
      assert.strictEqual(progAfter, '2 / 4', 'the level did not advance to the second question');
      assert.strictEqual(calls.length, 1, 'renderStrip fired again for a second question on the same passage');
      assert.deepStrictEqual(calls[0].ids, ['f1', 'f2'], 'renderStrip did not receive the passage figureIds');
      assert.strictEqual(calls[0].hostClassName, 'mv-passage', 'renderStrip did not receive the .mv-passage host');
    });
  } finally {
    if (had === undefined) delete global.MVFigures; else global.MVFigures = had;
  }
});

check('makeRunner survives a throwing MVFigures.renderStrip and still renders the level', () => {
  const had = global.MVFigures;
  // Captured and restored in the SAME finally as global.MVFigures, on every path including a
  // mid-check assertion failure, and scoped to this one check only: a global console.warn
  // silenced for the whole file would swallow a genuine warning from a later test.  Capturing
  // it also turns the round-1 diagnostic's console noise into its only test coverage; nothing
  // else in the suite ever asserted the warn fires at all.
  const hadWarn = global.console.warn;
  const warnCalls = [];
  global.console.warn = (...args) => { warnCalls.push(args); };
  // The fake builds on a DETACHED node (never appended to hostEl) before throwing, so the
  // zero-strip assertion below actually pins the append-last, detached-build property the real
  // renderStrip relies on, rather than passing merely because the fake never did any work.
  global.MVFigures = {
    renderStrip() {
      const strip = makeEl('div');
      strip.className = 'mv-figs';
      strip.appendChild(makeEl('button'));
      throw new Error('figures boom');
    },
  };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack();
      pack.passages[0].figureIds = ['f1'];
      const host = makeEl('div'), Save = spySave();
      R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
      assert.strictEqual(host.querySelectorAll('.mv-passage').length, 1, 'a throwing renderStrip must not stop the passage from rendering');
      assert.strictEqual(host.querySelectorAll('.mv-para').length, 1, 'a throwing renderStrip must not stop the paragraph from rendering');
      assert.strictEqual(host.querySelectorAll('.mv-item').length, 1, 'a throwing renderStrip must not stop the item from rendering');
      assert.strictEqual(host.querySelectorAll('.mv-choice').length, 4, 'a throwing renderStrip must not stop the item from rendering fully');
      assert.strictEqual(host.querySelectorAll('.mv-figs').length, 0, 'a throwing renderStrip must not leave a partial strip');
      assert.strictEqual(warnCalls.length, 1, 'the guard did not warn exactly once for the throwing renderStrip');
      assert.ok(/figures.*renderStrip failed/i.test(String(warnCalls[0][0])), 'the warn did not name the failure');
      assert.ok(warnCalls[0][1] instanceof Error && warnCalls[0][1].message === 'figures boom',
        'the warn did not pass along the thrown Error');
    });
  } finally {
    if (had === undefined) delete global.MVFigures; else global.MVFigures = had;
    global.console.warn = hadWarn;
  }
});

// ---------- Task 4: cleanup calls FG.closeLightbox() ----------
check('cleanup calls a call-time-resolved MVFigures.closeLightbox exactly once', () => {
  const had = global.MVFigures;
  const calls = [];
  global.MVFigures = { closeLightbox() { calls.push(1); } };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack(), host = makeEl('div'), Save = spySave();
      const cleanup = R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
      assert.strictEqual(calls.length, 0, 'closeLightbox fired before cleanup ran');
      cleanup();
      assert.strictEqual(calls.length, 1, 'cleanup did not call closeLightbox exactly once');
    });
  } finally {
    if (had === undefined) delete global.MVFigures; else global.MVFigures = had;
  }
});

check('cleanup survives a throwing MVFigures.closeLightbox and still saves', () => {
  const had = global.MVFigures;
  global.MVFigures = { closeLightbox() { throw new Error('lightbox boom'); } };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack(), host = makeEl('div'), Save = spySave();
      const cleanup = R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
      assert.doesNotThrow(() => cleanup(), 'cleanup must not throw when closeLightbox throws');
      assert.strictEqual(Save.calls.saveNow, 1, 'a throwing closeLightbox must not stop cleanup from saving');
    });
  } finally {
    if (had === undefined) delete global.MVFigures; else global.MVFigures = had;
  }
});

check('cleanup with NO MVFigures loaded does not throw (degrade path)', () => {
  assert.strictEqual(typeof MVFigures, 'undefined',
    'precondition: this process must have NO MVFigures, or this check is not testing the degrade path');
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = probePack(), host = makeEl('div'), Save = spySave();
    const cleanup = R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
    assert.doesNotThrow(() => cleanup());
  });
});

check('the factory can reach the globals the browser gives it', () => {
  // The bug this replaces: the UMD factory referenced `root`, which is the WRAPPER's parameter, so it was
  // out of scope inside the factory and every global lookup threw ReferenceError. The wrapper now passes
  // root in. Under Node root is globalThis, and requiring engine/items.js sets globalThis.MVItems, so this
  // exercises exactly the resolution path the browser takes when the script tags are in dependency order.
  require('../engine/items.js');
  assert.ok(typeof MVItems !== 'undefined', 'precondition: requiring items.js should publish MVItems');
  withSyncTimers(() => {
    const pack = probePack(), host = makeEl('div'), Save = spySave();
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Save, rng: () => 0.5 });   // no deps.Items
    assert.strictEqual(host.querySelectorAll('.mv-choice').length, 4, 'the global MVItems was not used to render');
  });
});

check('a missing dependency or callback is named, not a ReferenceError', () => {
  const Items = require('../engine/items.js');
  const pack = probePack();
  const host = makeEl('div');
  // No PackSave anywhere: neither injected nor published on the global by engine/pack.js.
  const hadPack = typeof MVPack !== 'undefined' ? MVPack : undefined;
  try {
    if (hadPack !== undefined) delete global.MVPack;
    assert.throws(() => R.makeRunner(pack, 0, host, { onComplete() {} }, { Items }), /no PackSave/);
  } finally {
    if (hadPack !== undefined) global.MVPack = hadPack;
  }
  assert.throws(() => R.makeRunner(pack, 0, host, {}, { Items, Save: spySave() }), /onComplete/);
  assert.throws(() => R.register({ meta: { id: 'y' } }, null), /no registry/);
});

check('the runner never reaches a math save key or localStorage', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../engine/runner.js'), 'utf8');
  assert.ok(!/mathMultiverse/.test(src), 'runner.js names a mathMultiverse key');
  assert.ok(!/localStorage/.test(src), 'runner.js touches localStorage directly');
});

// ---------- the explain tile names the misconception, for every type that authors one ----------
// validate-pack.js requires distractorRationale on mc, ms and ebsr. showExplain originally selected it
// with `typeof pickedIdx === 'number'`, which is true for mc and for ebsr's Part A index but false for
// ms, whose response is an array of indices. So every ms item shipped an authored rationale the child
// never saw, falling back to the generic hit/miss note. Six items in the first pack, and the authored
// content is the whole pedagogical point.

function explainTextFor(item, response) {
  const Items = require('../engine/items.js');
  const host = makeEl('div');
  const Save = spySave();
  return withSyncTimers(() => {
    R.makeRunner(pack1(item), 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
    const box = host.querySelectorAll('.mv-item')[0];
    // Answer by driving the item's own handlers, then grade.
    if (item.type === 'ms') {
      const cs = host.querySelectorAll('.mv-choice');
      for (const i of response) cs[i].onclick();
    } else {
      host.querySelectorAll('.mv-choice')[response].onclick();
    }
    const ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    return host.querySelectorAll('.mv-explain-own').map(n => n.textContent);
  });
}

function pack1(item) {
  return {
    meta: { id: 'probe', title: 'Probe' },
    passages: [{ id: 'p1', genre: 'informational', title: 'P', text: 'Some passage text.' }],
    items: [item],
    levels: [{ name: 'L1', questions: 1, itemIds: [item.id], targets: ['c1-inf-1-key-details'], lives: 4 }],
  };
}

const MS_ITEM = {
  id: 'ms1', type: 'ms', passageId: 'p1',
  targets: ['c1-inf-1-key-details'], coachTopic: 'key-details', dok: 2,
  stem: 'Choose every true statement.', choices: ['a', 'b', 'c', 'd'], key: [1, 2],
  explain: 'Both b and c are supported by the passage, and this sentence is long enough to clear the floor.',
  distractorRationale: { 0: 'stopped after the first step', 3: 'imported outside knowledge' },
};

check('ms shows the authored rationale for the wrong option picked', () => {
  const lines = explainTextFor(MS_ITEM, [0, 1]);      // 0 is wrong, 1 is right
  assert.ok(lines.some(t => /stopped after the first step/.test(t)),
    'the ms rationale was never rendered; got ' + JSON.stringify(lines));
});

check('ms names each wrong option when the child picks more than one', () => {
  const lines = explainTextFor(MS_ITEM, [0, 3]);      // both wrong
  const joined = lines.join(' | ');
  assert.ok(/stopped after the first step/.test(joined), 'first wrong pick unnamed: ' + joined);
  assert.ok(/imported outside knowledge/.test(joined), 'second wrong pick unnamed: ' + joined);
});

check('ms shows no rationale when every pick was correct but one was missed', () => {
  const lines = explainTextFor(MS_ITEM, [1]);         // right but incomplete: no wrong pick to name
  assert.strictEqual(lines.length, 0,
    'an under-selection was blamed on a misconception it did not make: ' + JSON.stringify(lines));
});

check('mc still names its single wrong pick', () => {
  const MC = {
    id: 'mc1', type: 'mc', passageId: 'p1',
    targets: ['c1-inf-1-key-details'], coachTopic: 'key-details', dok: 2,
    stem: 'Which one?', choices: ['a', 'b', 'c', 'd'], key: 1,
    explain: 'b is the answer, and this sentence is long enough to clear the twenty word floor easily.',
    distractorRationale: { 0: 'took a detail for the idea', 2: 'reversed it', 3: 'outside knowledge' },
  };
  const lines = explainTextFor(MC, 2);
  assert.ok(lines.some(t => /reversed it/.test(t)), 'mc regressed: ' + JSON.stringify(lines));
});

// ---------- Task 6: reveal mechanic (deps.Figures.attachReveal + onCorrect) ----------
// Injected via deps.Figures rather than a captured global, per the pre-flight's consistency
// requirement: Task 6 introduces deps.Figures as the threading pattern this file's Items/Save
// already use, and unifies the passage hook onto the same three-term resolution rather than
// leaving two different patterns for one optional layer.

function revealPack() {
  const pack = probePack();
  pack.figures = [{ id: 'rf1', kind: 'photo', src: 'x.jpg', caption: 'c', credit: 'cr', alt: 'a' }];
  pack.levels[0].reveal = { figureId: 'rf1' };
  return pack;
}

check('makeRunner calls deps.Figures.attachReveal exactly once per level, with the .mv-bar host and the served queue length', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = revealPack();
    const host = makeEl('div'), Save = spySave();
    const attachCalls = [];
    const Figures = {
      attachReveal(barEl, pk, lvl, total) {
        attachCalls.push({ barClassName: barEl.className, packId: pk.meta.id, total, hasReveal: !!(lvl && lvl.reveal) });
        return { onCorrect() {} };
      },
    };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    assert.strictEqual(attachCalls.length, 1, 'attachReveal was not called exactly once for the level');
    assert.strictEqual(attachCalls[0].barClassName, 'mv-bar', 'attachReveal was not called with the .mv-bar host');
    assert.strictEqual(attachCalls[0].packId, 'probe');
    assert.strictEqual(attachCalls[0].total, 4, 'attachReveal did not receive the served queue length');
    assert.strictEqual(attachCalls[0].hasReveal, true, 'attachReveal did not receive the level carrying .reveal');
  });
});

check('reveal.onCorrect fires with the just-answered question index on a correct submit, and never on a wrong one (the reveal is never punitive)', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = revealPack();
    const host = makeEl('div'), Save = spySave();
    const onCorrectCalls = [];
    const Figures = { attachReveal() { return { onCorrect(i) { onCorrectCalls.push(i); } }; } };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    assert.strictEqual(onCorrectCalls.length, 0, 'onCorrect fired before any answer was submitted');

    host.querySelectorAll('.mv-choice')[1].onclick();   // key is 1 on every probePack item: correct
    let ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    assert.deepStrictEqual(onCorrectCalls, [0], 'onCorrect did not fire exactly once with question index 0');

    host.querySelectorAll('.mv-choice')[0].onclick();   // next question, key is 1: index 0 is wrong
    ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    assert.deepStrictEqual(onCorrectCalls, [0],
      'onCorrect fired on a wrong answer -- a miss must never touch the reveal, earned or otherwise');
  });
});

check('makeRunner tolerates FG.attachReveal returning null (the ordinary no-reveal case) with no crash and a normal correct flash', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = probePack();       // no .reveal on this level
    const host = makeEl('div'), Save = spySave();
    let attachCalls = 0;
    const Figures = { attachReveal() { attachCalls++; return null; } };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    assert.strictEqual(attachCalls, 1, 'attachReveal must still be called; it alone decides reveal vs no-reveal');
    host.querySelectorAll('.mv-choice')[1].onclick();
    const ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    // Under withSyncTimers, submit()'s own later() advance runs synchronously and clears the
    // flash before this line, so grading must be read off Save.recordAnswer rather than the
    // (already-cleared) .mv-flash node -- the same reason no earlier check in this file asserts
    // on .mv-flash.ok after a synchronous-advance click.
    assert.strictEqual(Save.calls.recordAnswer.length, 1, 'no answer was recorded');
    assert.strictEqual(Save.calls.recordAnswer[0][0].correct, true, 'a correct answer must still grade correctly with no reveal attached');
  });
});

check('makeRunner survives a throwing deps.Figures.attachReveal and still renders the level', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = revealPack();
    const host = makeEl('div'), Save = spySave();
    const Figures = { attachReveal() { throw new Error('reveal boom'); } };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    assert.strictEqual(host.querySelectorAll('.mv-item').length, 1, 'a throwing attachReveal must not stop the item from rendering');
    assert.strictEqual(host.querySelectorAll('.mv-choice').length, 4, 'a throwing attachReveal must not stop choices from rendering');
  });
});

check('makeRunner survives a throwing reveal.onCorrect and still advances on a correct answer', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = revealPack();
    const host = makeEl('div'), Save = spySave();
    const Figures = { attachReveal() { return { onCorrect() { throw new Error('onCorrect boom'); } }; } };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    host.querySelectorAll('.mv-choice')[1].onclick();
    const ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    // See the sync-timer note in the check above: grading is read off Save.recordAnswer, not
    // .mv-flash, which the synchronous advance has already cleared by this point.
    assert.strictEqual(Save.calls.recordAnswer.length, 1, 'no answer was recorded');
    assert.strictEqual(Save.calls.recordAnswer[0][0].correct, true, 'a throwing onCorrect must not stop the item from grading correct');
  });
});

// ---------- Task 6 consistency requirement: the passage hook now honors deps.Figures too ----------
// Task 3 shipped the passage hook on the two-term (no deps.Figures) resolution; Task 6 unifies it
// onto the same three-term form attachReveal uses. The EXISTING global-MVFigures passage-hook
// tests above are left untouched (they deliberately pin the browser's real resolution path);
// these are new checks for the newly-added injection path.

check('the passage hook honors deps.Figures ahead of the global (three-term resolution, Task 6 unification)', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = probePack();
    pack.passages[0].figureIds = ['f1'];
    const host = makeEl('div'), Save = spySave();
    const calls = [];
    const Figures = {
      renderStrip(pk, ids, hostEl) {
        calls.push(ids.slice());
        const s = makeEl('div'); s.className = 'mv-figs'; hostEl.appendChild(s); return s;
      },
      attachReveal() { return null; },
    };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    assert.strictEqual(calls.length, 1, 'deps.Figures.renderStrip was not called via the passage hook');
    assert.deepStrictEqual(calls[0], ['f1']);
  });
});

check('deps.Figures takes precedence over a global MVFigures when both are present', () => {
  const had = global.MVFigures;
  global.MVFigures = { renderStrip() { throw new Error('the GLOBAL renderStrip must not be reached when deps.Figures is supplied'); } };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack();
      pack.passages[0].figureIds = ['f1'];
      const host = makeEl('div'), Save = spySave();
      const calls = [];
      const Figures = {
        renderStrip(pk, ids, hostEl) {
          calls.push(1);
          const s = makeEl('div'); s.className = 'mv-figs'; hostEl.appendChild(s);
        },
        attachReveal() { return null; },
      };
      R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
      assert.strictEqual(calls.length, 1, 'deps.Figures.renderStrip was not used ahead of the global');
    });
  } finally {
    if (had === undefined) delete global.MVFigures; else global.MVFigures = had;
  }
});

// ---------- Task 7: item-figure rail (deps.Figures.renderItemFigure) ----------

check('makeRunner calls deps.Figures.renderItemFigure once per item carrying a figureId, with the .mv-item host, inserted before the stem', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = probePack();
    pack.items[0].figureId = 'f1';   // i0 only; i1-i3 carry none
    const host = makeEl('div'), Save = spySave();
    const calls = [];
    const Figures = {
      renderItemFigure(pk, figureId, itemBox) {
        calls.push({ packId: pk.meta.id, figureId, hostClassName: itemBox.className });
        const wrap = makeEl('div'); wrap.className = 'mv-item-fig';
        itemBox.insertBefore(wrap, itemBox.firstChild || null);
      },
    };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    assert.strictEqual(calls.length, 1, 'renderItemFigure was not called for an item with a figureId');
    assert.strictEqual(calls[0].packId, 'probe');
    assert.strictEqual(calls[0].figureId, 'f1');
    assert.strictEqual(calls[0].hostClassName, 'mv-item', 'renderItemFigure did not receive the .mv-item host');
    const itemBox = host.querySelectorAll('.mv-item')[0];
    assert.strictEqual(itemBox.children[0].className, 'mv-item-fig', 'the figure was not inserted before the stem');

    // Advance to the next question (i0's key is 1 on every probePack item: correct). Whichever
    // item is served next may or may not carry a figureId depending on pickItems' shuffle, so
    // pin the call count against the pack's OWN itemIds rather than assuming order: exactly one
    // of the four probePack items (i0) was given a figureId above.
    host.querySelectorAll('.mv-choice')[1].onclick();
    const ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    assert.strictEqual(calls.length, 1, 'renderItemFigure fired for an item with no figureId');
  });
});

check('makeRunner survives a throwing deps.Figures.renderItemFigure and still renders the item fully', () => {
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = probePack();
    pack.items[0].figureId = 'f1';
    const host = makeEl('div'), Save = spySave();
    const Figures = { renderItemFigure() { throw new Error('item-figure boom'); } };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    assert.strictEqual(host.querySelectorAll('.mv-item').length, 1, 'a throwing renderItemFigure must not stop the item box from rendering');
    assert.strictEqual(host.querySelectorAll('.mv-choice').length, 4, 'a throwing renderItemFigure must not stop choices from rendering fully');
    assert.strictEqual(host.querySelectorAll('.mv-item-fig').length, 0, 'a throwing renderItemFigure must not leave a partial rail');
  });
});

check('runner renders an item with a figureId with NO MVFigures loaded (degrade path)', () => {
  assert.strictEqual(typeof MVFigures, 'undefined',
    'precondition: this process must have NO MVFigures, or this check is not testing the degrade path');
  withSyncTimers(() => {
    const Items = require('../engine/items.js');
    const pack = probePack();
    pack.items[0].figureId = 'f1';
    const host = makeEl('div'), Save = spySave();
    const cleanup = R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
    assert.strictEqual(host.querySelectorAll('.mv-item').length, 1, 'item box did not render');
    assert.strictEqual(host.querySelectorAll('.mv-choice').length, 4, 'item choices did not render fully');
    cleanup();
  });
});

check('deps.Figures.renderItemFigure takes precedence over a global MVFigures when both are present', () => {
  const had = global.MVFigures;
  global.MVFigures = { renderItemFigure() { throw new Error('the GLOBAL renderItemFigure must not be reached when deps.Figures is supplied'); } };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack();
      pack.items[0].figureId = 'f1';
      const host = makeEl('div'), Save = spySave();
      const calls = [];
      const Figures = { renderItemFigure() { calls.push(1); } };
      R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
      assert.strictEqual(calls.length, 1, 'deps.Figures.renderItemFigure was not used ahead of the global');
    });
  } finally {
    if (had === undefined) delete global.MVFigures; else global.MVFigures = had;
  }
});

// Fix round 1 (controller review): every check above drives the hook through the DOM (asserting
// itemBox.children[0].className), which only pins the hook's RESULT, not that it runs after
// Items.render. Moving the call above Items.render in renderQuestion would still leave every one
// of those checks green (the figure would simply become itemBox's only child a moment before
// Items.render populates the rest, ending in the same final DOM shape). This check pins ORDER
// directly via a call log shared by both spies, so hoisting the hook fails this loudly.
check('the item-figure hook runs strictly AFTER Items.render, never before (call-order pin)', () => {
  withSyncTimers(() => {
    const order = [];
    const Items = {
      render(item, box) { order.push('items.render'); box.appendChild(makeEl('div')); },
      needsCheck() { return false; },
    };
    const pack = probePack();
    pack.items[0].figureId = 'f1';
    const host = makeEl('div'), Save = spySave();
    const Figures = { renderItemFigure() { order.push('figures.renderItemFigure'); } };
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
    assert.deepStrictEqual(order, ['items.render', 'figures.renderItemFigure'],
      'the item-figure hook must run strictly after Items.render, not before');
  });
});

// ---------- Task 7: cleanup's closeLightbox resolution unified onto the three-term form ----------
// The pre-flight's consistency requirement named the passage hook, attachReveal, and this
// task's new item-figure hook as the three sites to unify; Task 6's report flagged the cleanup
// site as a pre-existing fourth two-term holdout. Unified here since Task 7 touches this file
// anyway; this pins that deps.Figures now also short-circuits the global at the cleanup site.

check('cleanup honors deps.Figures.closeLightbox ahead of a global MVFigures', () => {
  const had = global.MVFigures;
  global.MVFigures = { closeLightbox() { throw new Error('the GLOBAL closeLightbox must not be reached when deps.Figures is supplied'); } };
  try {
    withSyncTimers(() => {
      const Items = require('../engine/items.js');
      const pack = probePack(), host = makeEl('div'), Save = spySave();
      const calls = [];
      const Figures = { closeLightbox() { calls.push(1); } };
      const cleanup = R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, Figures, rng: () => 0.5 });
      cleanup();
      assert.strictEqual(calls.length, 1, 'deps.Figures.closeLightbox was not used ahead of the global at cleanup');
    });
  } finally {
    if (had === undefined) delete global.MVFigures; else global.MVFigures = had;
  }
});

// ---------- Task 7: themed correct-answer stamps ----------
// Run WITHOUT withSyncTimers on purpose: submit()'s later() schedules a REAL 1400ms timer here,
// which never fires before this synchronous check finishes reading the footer, so the flash can
// be inspected directly instead of via the Save.recordAnswer workaround the sync-timer checks
// above must use (their own synchronous advance clears the flash before the assertion runs).

check('a correct answer stamps CONFIRMED for a sci pack, VERIFIED for a hist pack, and the plain Correct flash otherwise', () => {
  const Items = require('../engine/items.js');
  function correctFlashFor(subject) {
    const pack = probePack();
    if (subject) pack.meta.subject = subject;
    const host = makeEl('div'), Save = spySave();
    R.makeRunner(pack, 0, host, { onComplete() {}, onExit() {} }, { Items, Save, rng: () => 0.5 });
    host.querySelectorAll('.mv-choice')[1].onclick();   // key is 1 on every probePack item
    const ck = host.querySelectorAll('.mv-check')[0];
    if (ck && ck.onclick) ck.onclick();
    return host.querySelectorAll('.mv-flash')[0];
  }

  const sci = correctFlashFor('sci');
  assert.ok(sci, 'no flash rendered for a sci pack');
  assert.strictEqual(sci.classList.contains('ok'), true);
  assert.strictEqual(sci.classList.contains('stamp-confirmed'), true, 'sci pack did not get stamp-confirmed');
  assert.strictEqual(sci.classList.contains('stamp-verified'), false);
  assert.strictEqual(sci.textContent, 'CONFIRMED');

  const hist = correctFlashFor('hist');
  assert.strictEqual(hist.classList.contains('ok'), true);
  assert.strictEqual(hist.classList.contains('stamp-verified'), true, 'hist pack did not get stamp-verified');
  assert.strictEqual(hist.classList.contains('stamp-confirmed'), false);
  assert.strictEqual(hist.textContent, 'VERIFIED');

  const ela = correctFlashFor(undefined);
  assert.strictEqual(ela.classList.contains('ok'), true);
  assert.strictEqual(ela.classList.contains('stamp-verified'), false, 'a pack with no subject must not get a themed stamp');
  assert.strictEqual(ela.classList.contains('stamp-confirmed'), false);
  assert.strictEqual(ela.textContent, 'Correct');
});

// Fix round 1 (controller review): 'hist' and 'sci' were bare literals with nothing pinning them
// to the repo's actual subject universe (validate-pack.js constrains meta.subject only to
// /^[a-z]+$/, so a pack authored with 'history' instead of 'hist' would silently get no stamp,
// with no diagnostic anywhere). STAMP_THEME (engine/runner.js) names that universe once; this
// pins its keys against the shell's own SUBJECT_ORDER (Math-Multiverse.html), read from source
// the same way the file's own "no math save key or localStorage" check already reads runner.js
// -- not required to equal SUBJECT_ORDER (STAMP_THEME rightly omits 'math' and 'ela', which get
// no themed stamp), only required to be a SUBSET of it, so every themed subject is real.
check("STAMP_THEME's subjects ('hist', 'sci') are members of the shell's real subject universe (SUBJECT_ORDER)", () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '../Math-Multiverse.html'), 'utf8');
  const m = html.match(/SUBJECT_ORDER\s*=\s*(\[[^\]]*\])/);
  assert.ok(m, 'could not find SUBJECT_ORDER in Math-Multiverse.html; this check would otherwise pass vacuously');
  const order = JSON.parse(m[1].replace(/'/g, '"'));
  const themed = Object.keys(R.STAMP_THEME);
  assert.deepStrictEqual(themed.sort(), ['hist', 'sci'], 'STAMP_THEME no longer has the two subjects this test was written to pin');
  for (const s of themed) {
    assert.ok(order.includes(s), `STAMP_THEME stamps subject "${s}", which is not in the shell's SUBJECT_ORDER (${order.join(', ')})`);
  }
});

// ---------- the two star ladders must not drift apart ----------
// The brief states "if either changes, both change" as a hard invariant, but nothing enforced it:
// pack.test.js checks STARS_FOR against literal numbers and runner.test.js never required pack.js, so a
// future edit to one would pass every suite. That is the invisible-drift shape that produced task 9's
// escaped defects.
check('starsForMistakes and PackSave.STARS_FOR are the same ladder', () => {
  const P = require('../engine/pack.js');
  for (let m = 0; m <= 12; m++) {
    assert.strictEqual(R.starsForMistakes(m), P.PackSave.STARS_FOR(m),
      'ladders disagree at ' + m + ' mistakes: runner ' + R.starsForMistakes(m) + ' vs pack ' + P.PackSave.STARS_FOR(m));
  }
  assert.deepStrictEqual([0, 1, 2, 3].map(R.starsForMistakes), [3, 2, 1, 0],
    'the ladder itself moved off the math modules 0/1/2/3+ -> 3/2/1/0');
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
