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
