'use strict';
const assert = require('assert');
const MVPack = require('../engine/pack.js');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}
async function acheck(name, fn) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

// A localStorage stand-in. Deliberately records every key written, so a test can prove the math
// save keys were never touched.
function fakeStorage() {
  const m = new Map();
  return {
    _m: m,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    keys() { return [...m.keys()]; },
  };
}

const MANIFEST = {
  version: 1,
  packs: [{ id: 'p-a', subject: 'ela', subjectLabel: 'English', grade: 6, title: 'A', icon: 'x', color: '#111', description: 'd', levels: 2, grandGoal: 'G', unlocked: true }],
};
const PACK_A = {
  meta: { id: 'p-a', subject: 'ela', grade: 6, title: 'A', version: 1 },
  skin: { color: '#111', icon: 'x', grandGoal: 'G' },
  passages: [{ id: 'pg', title: 't', genre: 'informational', source: 'original', text: 'x' }],
  levels: [
    { id: 1, name: 'L1', goal: 'g', questions: 1, lives: 4, targets: ['c1-inf-1-key-details'], itemIds: ['i1'] },
    { id: 2, name: 'L2', goal: 'g', questions: 1, targets: ['c1-inf-1-key-details'], itemIds: ['i1'] },
  ],
  items: [{ id: 'i1', type: 'mc', passageId: 'pg', targets: ['c1-inf-1-key-details'], coachTopic: 'central-idea', stem: 'q', choices: ['a','b','c','d'], key: 0, explain: 'e' }],
};

function envWith(files) {
  let calls = 0;
  const storage = fakeStorage();
  MVPack.setEnv({
    base: '',
    storage,
    fetch: async (url) => {
      calls++;
      const key = String(url).replace(/^\.?\//, '');
      if (!(key in files)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(files[key])) };
    },
  });
  MVPack._resetForTests();
  return { storage, calls: () => calls };
}

(async () => {

  await acheck('loadManifest fetches and parses', async () => {
    envWith({ 'packs/manifest.json': MANIFEST });
    const m = await MVPack.loadManifest();
    assert.strictEqual(m.packs.length, 1);
    assert.strictEqual(m.packs[0].id, 'p-a');
  });

  await acheck('a missing manifest rejects rather than resolving empty', async () => {
    envWith({});
    let threw = false;
    try { await MVPack.loadManifest(); } catch (e) { threw = true; }
    assert.strictEqual(threw, true, 'a 404 manifest must reject, never resolve to an empty list');
  });

  await acheck('loadPack caches so a second open does not refetch', async () => {
    const env = envWith({ 'packs/manifest.json': MANIFEST, 'packs/p-a.json': PACK_A });
    await MVPack.loadPack('p-a');
    const after1 = env.calls();
    await MVPack.loadPack('p-a');
    assert.strictEqual(env.calls(), after1, 'second loadPack must be served from cache');
    assert.strictEqual(MVPack.get('p-a').meta.id, 'p-a');
  });

  await acheck('a pack whose meta.id does not match the request is rejected', async () => {
    const bad = JSON.parse(JSON.stringify(PACK_A)); bad.meta.id = 'other';
    envWith({ 'packs/p-a.json': bad });
    let msg = '';
    try { await MVPack.loadPack('p-a'); } catch (e) { msg = e.message; }
    assert.strictEqual(/meta\.id/.test(msg), true, 'got: ' + msg);
  });

  await acheck('a pack with a dangling itemId is rejected at load', async () => {
    const bad = JSON.parse(JSON.stringify(PACK_A)); bad.levels[0].itemIds = ['nope'];
    envWith({ 'packs/p-a.json': bad });
    let msg = '';
    try { await MVPack.loadPack('p-a'); } catch (e) { msg = e.message; }
    assert.strictEqual(/nope/.test(msg), true, 'got: ' + msg);
  });

  check('STARS_FOR matches the math ladder exactly', () => {
    assert.strictEqual(MVPack.PackSave.STARS_FOR(0), 3);
    assert.strictEqual(MVPack.PackSave.STARS_FOR(1), 2);
    assert.strictEqual(MVPack.PackSave.STARS_FOR(2), 1);
    assert.strictEqual(MVPack.PackSave.STARS_FOR(3), 0);
    assert.strictEqual(MVPack.PackSave.STARS_FOR(9), 0);
  });

  check('PackSave writes only its own key and never the math save keys', () => {
    const { storage } = envWith({});
    const S = MVPack.PackSave;
    S.load();
    S.recordLevel('p-a', 0, 3, 500);
    S.saveNow();
    assert.deepStrictEqual(storage.keys(), [S.KEY]);
    assert.strictEqual(S.KEY, 'multiverse.packs.v1');
    for (const k of storage.keys()) {
      assert.strictEqual(/^mathMultiverse\./.test(k), false, 'must never write ' + k);
    }
  });

  check('PackSave round-trips through storage', () => {
    const { storage } = envWith({});
    const S = MVPack.PackSave;
    S.load();
    S.recordLevel('p-a', 1, 2, 250);
    S.saveNow();
    MVPack._resetForTests();
    MVPack.setEnv({ storage });
    S.load();
    assert.strictEqual(S.stateFor('p-a', 2).levelStars[1], 2);
    assert.strictEqual(S.stateFor('p-a', 2).levelBest[1], 250);
  });

  check('recordLevel keeps the best result and never downgrades stars', () => {
    envWith({});
    const S = MVPack.PackSave; S.load();
    S.recordLevel('p-a', 0, 3, 500);
    S.recordLevel('p-a', 0, 1, 100);
    const st = S.stateFor('p-a', 2);
    assert.strictEqual(st.levelStars[0], 3, 'a worse replay must not take stars away');
    assert.strictEqual(st.levelBest[0], 500);
  });

  check('stateFor grows the level arrays when a pack gains levels', () => {
    envWith({});
    const S = MVPack.PackSave; S.load();
    S.recordLevel('p-a', 0, 3, 500);
    const st = S.stateFor('p-a', 5);
    assert.strictEqual(st.levelStars.length, 5);
    assert.strictEqual(st.levelStars[0], 3);
    assert.strictEqual(st.levelStars[4], 0);
  });

  check('stateFor NEVER shrinks: a wrong level count cannot delete progress', () => {
    // packCardNode calls stateFor on every launcher render with the count out of
    // packs/manifest.json. cpm-cc1-g6's entry still said one level after the pack had grown to six,
    // and stateFor used to shrink the arrays and clamp levelsCleared to whatever it was handed: a
    // child five levels in came back as levelsCleared 1 with a single star, and correcting the
    // manifest afterwards restored neither. A number that is wrong somewhere else must not be able
    // to delete what a child has already done.
    envWith({});
    const S = MVPack.PackSave; S.load();
    for (let i = 0; i < 5; i++) S.recordLevel('p-six', i, 3, 400 + i);
    const full = S.stateFor('p-six', 6);
    assert.strictEqual(full.levelsCleared, 5, 'setup: five levels cleared');
    assert.strictEqual(full.levelStars.length, 6);

    const stale = S.stateFor('p-six', 1);          // the launcher, with a stale manifest count
    assert.strictEqual(stale.levelsCleared, 5, 'a stale count of 1 must not clamp cleared progress');
    assert.strictEqual(stale.levelStars.length, 6, 'a stale count of 1 must not truncate the stars');
    assert.strictEqual(stale.levelStars[4], 3, 'the fifth level keeps its stars');

    const back = S.stateFor('p-six', 6);           // and nothing was lost on the way
    assert.strictEqual(back.levelsCleared, 5);
    assert.deepStrictEqual(back.levelStars, [3, 3, 3, 3, 3, 0]);
  });

  check('recordAnswer accumulates per-topic accuracy', () => {
    envWith({});
    const S = MVPack.PackSave; S.load();
    S.recordAnswer({ packId: 'p-a', topic: 'central-idea', correct: true,  itemId: 'i1' });
    S.recordAnswer({ packId: 'p-a', topic: 'central-idea', correct: false, itemId: 'i2' });
    const t = S.state.analytics.perTopic['central-idea'];
    assert.strictEqual(t.attempted, 2);
    assert.strictEqual(t.correct, 1);
    assert.strictEqual(typeof t.lastWrongAt, 'number');
  });

  check('recentMistakes is a ring buffer capped at 50', () => {
    envWith({});
    const S = MVPack.PackSave; S.load();
    for (let i = 0; i < 60; i++) {
      S.recordAnswer({ packId: 'p-a', topic: 'central-idea', correct: false, itemId: 'i' + i });
    }
    const rm = S.state.analytics.recentMistakes;
    assert.strictEqual(rm.length, 50);
    assert.strictEqual(rm[rm.length - 1].itemId, 'i59', 'newest entry must be last');
  });

  check('a corrupt save falls back to defaults instead of throwing', () => {
    const { storage } = envWith({});
    storage.setItem(MVPack.PackSave.KEY, '{not json at all');
    MVPack.PackSave.load();
    assert.strictEqual(typeof MVPack.PackSave.state.packs, 'object');
    assert.strictEqual(MVPack.PackSave.totalStars(), 0);
  });

  check('isUnlocked honours the manifest flag and a prior unlock', () => {
    envWith({});
    const S = MVPack.PackSave; S.load();
    assert.strictEqual(S.isUnlocked({ id: 'p-a', unlocked: true }), true);
    assert.strictEqual(S.isUnlocked({ id: 'p-b', unlocked: false }), false);
    S.recordLevel('p-b', 0, 1, 10);
    assert.strictEqual(S.isUnlocked({ id: 'p-b', unlocked: false }), true, 'progress implies it was unlocked');
  });

  console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
  process.exit(failures ? 1 : 0);
})();
