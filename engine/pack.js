'use strict';
// pack.js -- content pack loading and pack progress.
//
// Two jobs, both deliberately independent of the math game:
//   1. Fetch packs/manifest.json (small, at boot) and packs/<id>.json (large, on demand).
//   2. Keep pack progress in its OWN localStorage key.
//
// The separate key is the important part. The math save lives in mathMultiverse.save.v1 and
// mathMultiverse.save.g6.v1 and holds real progress Niall earned. Migrating it to hold subjects
// would risk that progress for no gain, so packs get multiverse.packs.v1 and the math keys are
// never opened. Phase 5 reconciles analytics across both; nothing before then needs to.
//
// fetch, localStorage and document are resolved LAZILY so Node can require this file and inject
// fakes through setEnv().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MVPack = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : null), function () {

  let _fetch = null, _storage = null, _base = '';

  function setEnv(env) {
    if (!env) return;
    if (env.fetch) _fetch = env.fetch;
    if (env.storage) _storage = env.storage;
    if (typeof env.base === 'string') _base = env.base;
  }
  function fetchFn() {
    if (_fetch) return _fetch;
    if (typeof fetch === 'function') return fetch;
    throw new Error('pack: no fetch available; call MVPack.setEnv({ fetch })');
  }
  function storage() {
    if (_storage) return _storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    // A browser with storage disabled must not brick the game.
    return { getItem() { return null; }, setItem() {}, removeItem() {} };
  }

  const cache = new Map();
  let manifest = null;

  function _resetForTests() { cache.clear(); manifest = null; }

  // Guard against a truncated or wrong-path fetch. CI runs the full validator
  // (tests/validate-pack.js); this is only the runtime shape guard, so it stays cheap.
  function assertPackShape(pack, expectedId) {
    if (!pack || typeof pack !== 'object') throw new Error(`pack ${expectedId}: not an object`);
    if (!pack.meta || pack.meta.id !== expectedId) {
      throw new Error(`pack ${expectedId}: meta.id is ${JSON.stringify(pack.meta && pack.meta.id)}, expected ${JSON.stringify(expectedId)}`);
    }
    for (const k of ['passages', 'levels', 'items']) {
      if (!Array.isArray(pack[k]) || pack[k].length === 0) throw new Error(`pack ${expectedId}: ${k} missing or empty`);
    }
    const itemIds = new Set(pack.items.map(i => i && i.id));
    const passageIds = new Set(pack.passages.map(p => p && p.id));
    for (const lv of pack.levels) {
      if (!Array.isArray(lv.itemIds) || !lv.itemIds.length) throw new Error(`pack ${expectedId}: level ${lv && lv.name} has no itemIds`);
      for (const id of lv.itemIds) {
        if (!itemIds.has(id)) throw new Error(`pack ${expectedId}: level ${lv.name} references missing item "${id}"`);
      }
    }
    for (const it of pack.items) {
      if (it.passageId !== undefined && !passageIds.has(it.passageId)) {
        throw new Error(`pack ${expectedId}: item ${it.id} references missing passage "${it.passageId}"`);
      }
    }
  }

  async function getJson(url, label) {
    const res = await fetchFn()(url);
    if (!res || !res.ok) throw new Error(`${label}: fetch failed (${res && res.status}) for ${url}`);
    return res.json();
  }

  async function loadManifest() {
    if (manifest) return manifest;
    const m = await getJson(_base + 'packs/manifest.json', 'manifest');
    if (!m || !Array.isArray(m.packs)) throw new Error('manifest: packs array missing');
    manifest = m;
    return manifest;
  }

  async function loadPack(packId) {
    if (cache.has(packId)) return cache.get(packId);
    const pack = await getJson(`${_base}packs/${packId}.json`, `pack ${packId}`);
    assertPackShape(pack, packId);
    cache.set(packId, pack);
    return pack;
  }

  function get(packId) { return cache.get(packId) || null; }

  // ---------------- progress ----------------

  const KEY = 'multiverse.packs.v1';
  const VERSION = 1;
  const RECENT_MAX = 50;

  // Identical ladder to Math-Multiverse.html:5027. Absolute mistakes, not percentage, so the
  // meaning holds across levels of different length.
  function STARS_FOR(mistakes) {
    if (mistakes === 0) return 3;
    if (mistakes <= 1) return 2;
    if (mistakes <= 2) return 1;
    return 0;
  }

  const PackSave = {
    KEY, VERSION, STARS_FOR,
    state: null,

    default() {
      return {
        version: VERSION,
        packs: {},
        analytics: { perTopic: {}, recentMistakes: [], coachShown: {}, totalAttempted: 0, totalCorrect: 0 },
        lastSaved: 0,
      };
    },

    load() {
      const raw = storage().getItem(KEY);
      const out = this.default();
      if (raw) {
        let obj = null;
        try { obj = JSON.parse(raw); } catch (e) { obj = null; }   // corrupt save must not brick the game
        if (obj && typeof obj === 'object') {
          if (obj.packs && typeof obj.packs === 'object') out.packs = obj.packs;
          if (obj.analytics && typeof obj.analytics === 'object') {
            const a = out.analytics, oa = obj.analytics;
            if (oa.perTopic && typeof oa.perTopic === 'object') a.perTopic = oa.perTopic;
            if (Array.isArray(oa.recentMistakes)) a.recentMistakes = oa.recentMistakes.slice(-RECENT_MAX);
            if (oa.coachShown && typeof oa.coachShown === 'object') a.coachShown = oa.coachShown;
            if (typeof oa.totalAttempted === 'number') a.totalAttempted = oa.totalAttempted;
            if (typeof oa.totalCorrect === 'number') a.totalCorrect = oa.totalCorrect;
          }
        }
      }
      this.state = out;
      return out;
    },

    saveNow() {
      if (!this.state) return;
      this.state.lastSaved = Date.now();
      try { storage().setItem(KEY, JSON.stringify(this.state)); } catch (e) { /* quota or private mode */ }
    },

    // Always returns a state object with level arrays sized to the pack's CURRENT level count, so a
    // pack that gains levels does not read undefined.
    stateFor(packId, levelCount) {
      if (!this.state) this.load();
      let st = this.state.packs[packId];
      if (!st || typeof st !== 'object') {
        st = { levelsCleared: 0, levelStars: [], levelBest: [] };
        this.state.packs[packId] = st;
      }
      const n = Math.max(0, levelCount | 0);
      if (!Array.isArray(st.levelStars)) st.levelStars = [];
      if (!Array.isArray(st.levelBest)) st.levelBest = [];
      while (st.levelStars.length < n) st.levelStars.push(0);
      while (st.levelBest.length < n) st.levelBest.push(null);
      // GROW ONLY. This used to also SHRINK to n and clamp levelsCleared to n, which made the level
      // count a caller passes in able to destroy saved progress. packCardNode calls this on every
      // launcher render with the count out of packs/manifest.json, and cpm-cc1-g6's entry still said
      // one level after the pack had grown to six: measured through the real save layer, a child
      // five levels in came back as levelsCleared 1 with a single star left, and correcting the
      // manifest afterwards restored neither -- the stars came back as zeros. A wrong number
      // somewhere else must not be able to delete what a child has already done, so the arrays are
      // only ever extended and levelsCleared is clamped to what is actually stored.
      st.levelsCleared = Math.max(0, Math.min(st.levelsCleared | 0, st.levelStars.length));
      return st;
    },

    recordLevel(packId, levelIndex, stars, score) {
      if (!this.state) this.load();
      const st = this.stateFor(packId, levelIndex + 1);
      st.levelStars[levelIndex] = Math.max(st.levelStars[levelIndex] | 0, stars | 0);   // never downgrade
      if (st.levelBest[levelIndex] == null || score > st.levelBest[levelIndex]) st.levelBest[levelIndex] = score;
      if (stars > 0 && st.levelsCleared <= levelIndex) st.levelsCleared = levelIndex + 1;
      this.saveNow();
    },

    recordAnswer(rec) {
      if (!this.state) this.load();
      const a = this.state.analytics;
      const topic = String((rec && rec.topic) || 'unknown');
      const t = a.perTopic[topic] || (a.perTopic[topic] = { attempted: 0, correct: 0, lastWrongAt: 0 });
      t.attempted++;
      a.totalAttempted++;
      if (rec.correct) { t.correct++; a.totalCorrect++; }
      else {
        t.lastWrongAt = Date.now();
        a.recentMistakes.push({
          topic, packId: rec.packId || null, itemId: rec.itemId || null,
          qText: rec.qText || null, picked: rec.picked === undefined ? null : rec.picked,
          ts: Date.now(),
        });
        while (a.recentMistakes.length > RECENT_MAX) a.recentMistakes.shift();
      }
    },

    markCoachShown(topic) {
      if (!this.state) this.load();
      this.state.analytics.coachShown[String(topic)] = Date.now();
      this.saveNow();
    },

    totalStars() {
      if (!this.state) this.load();
      let n = 0;
      for (const st of Object.values(this.state.packs)) {
        if (st && Array.isArray(st.levelStars)) n += st.levelStars.reduce((x, y) => x + (y | 0), 0);
      }
      return n;
    },

    // A pack is playable if the manifest ships it unlocked, or if there is already progress on it
    // (which means it was unlocked at some earlier point).
    isUnlocked(entry) {
      if (!entry) return false;
      if (entry.unlocked) return true;
      if (!this.state) this.load();
      const st = this.state.packs[entry.id];
      if (!st) return false;
      if ((st.levelsCleared | 0) > 0) return true;
      return Array.isArray(st.levelStars) && st.levelStars.some(s => (s | 0) > 0);
    },
  };

  return { setEnv, loadManifest, loadPack, get, assertPackShape, PackSave, _resetForTests };
});
