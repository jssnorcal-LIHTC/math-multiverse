'use strict';
// runner.js -- plays one level of one pack.
//
// Implements the SAME contract the six math IIFEs implement:
//   InlineModules[id].init(host, levelIndex, { onComplete(score, stars), onExit() }) -> cleanupFn
// so the shell dispatches a pack level through the identical code path, and nothing about the math
// modules has to change.
//
// Learning-UX rules carried forward from 26-0714 and NOT to be relaxed:
//   - a WRONG answer never auto-advances; the explanation stays until he taps NEXT
//   - a CORRECT answer auto-advances in about 1.4s
//   - the explanation tile scrolls itself into view, because a tall passage clips it
//   - the explanation names the misconception he picked, which is why distractorRationale is
//     rendered above the general explanation rather than instead of it
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MVRunner = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : null), function (root) {

  const CORRECT_ADVANCE_MS = 1400;
  const DEFAULT_LIVES = 3;
  const COACH_WRONG_THRESHOLD = 2;   // wrongs on one topic inside a level before the coach fires

  // ---------------- pure ----------------

  function pickItems(level, allItems, rng) {
    const want = level.questions | 0;
    const ids = Array.isArray(level.itemIds) ? level.itemIds : [];
    if (want > ids.length) {
      throw new Error(`level "${level.name}": questions is ${want} but only ${ids.length} item(s) are available; a level must never silently shrink`);
    }
    const byId = new Map(allItems.map(i => [i.id, i]));
    const pool = ids.map(id => byId.get(id)).filter(Boolean);
    if (pool.length !== ids.length) {
      throw new Error(`level "${level.name}": one or more itemIds did not resolve`);
    }
    const r = rng || Math.random;
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, want);
  }

  function scoreFor(result) {
    if (!result) return 0;
    if (result.correct) return 100;
    return Math.round(100 * Math.max(0, Math.min(1, result.partial || 0)));
  }

  function starsForMistakes(m) {
    if (m === 0) return 3;
    if (m <= 1) return 2;
    if (m <= 2) return 1;
    return 0;
  }

  function summarize(results, lives) {
    const L = Number.isInteger(lives) ? lives : DEFAULT_LIVES;
    let score = 0, mistakes = 0;
    for (const r of results || []) {
      score += scoreFor(r);
      if (!r || !r.correct) mistakes++;
    }
    const dnf = mistakes >= L;
    return { score, mistakes, stars: dnf ? 0 : starsForMistakes(mistakes), dnf };
  }

  // ---------------- DOM ----------------

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function makeRunner(pack, levelIndex, host, callbacks, deps) {
    // root is null under Node, so every lookup through it must be guarded.  `typeof root.x` does NOT
    // guard: typeof only suppresses the error for a bare identifier, not for a member access on an
    // undefined base. That distinction is what broke this function in every environment.
    const Items = (deps && deps.Items) || (typeof MVItems !== 'undefined' ? MVItems : (root && root.MVItems));
    const Save = (deps && deps.Save) || (root && root.MVPack && root.MVPack.PackSave);
    const coach = (deps && deps.showCoach) || (root && typeof root.showCoach === 'function' ? root.showCoach : null);
    // Fail here, naming what is missing, rather than throwing deep inside the first grade.
    if (!Items) throw new Error('MVRunner: no Items implementation (pass deps.Items or load engine/items.js first)');
    if (!Save) throw new Error('MVRunner: no PackSave (pass deps.Save or load engine/pack.js first)');
    // onComplete is called from inside a setTimeout at the end of a level. A missing one therefore throws
    // where nothing can catch it: the browser logs an unhandled error and the level simply never finishes,
    // after the child has answered every question. Check it here, where the failure is attributable.
    if (!callbacks || typeof callbacks.onComplete !== 'function') {
      throw new Error('MVRunner: callbacks.onComplete(score, stars) is required by the InlineModules contract');
    }

    const level = pack.levels[levelIndex];
    const lives = Number.isInteger(level.lives) ? level.lives : DEFAULT_LIVES;
    const queue = pickItems(level, pack.items, deps && deps.rng);
    const passages = new Map(pack.packPassages || pack.passages.map(p => [p.id, p]));

    let timeouts = [];
    const later = (fn, ms) => { timeouts.push(setTimeout(fn, ms)); };
    const results = [];
    const wrongByTopic = Object.create(null);
    let qi = 0, disposed = false;

    // ---- chrome ----
    host.innerHTML = '';
    const shell = el('div', 'mv-shell');
    shell.style.setProperty('--mv-color', (pack.skin && pack.skin.color) || '#7aa8ff');
    const bar = el('div', 'mv-bar');
    const prog = el('div', 'mv-prog');
    const hearts = el('div', 'mv-hearts');
    bar.appendChild(prog);
    bar.appendChild(hearts);
    const passageBox = el('div', 'mv-passage');
    const itemBox = el('div', 'mv-item');
    const footer = el('div', 'mv-footer');
    shell.appendChild(bar);
    shell.appendChild(passageBox);
    shell.appendChild(itemBox);
    shell.appendChild(footer);
    host.appendChild(shell);

    function paintBar() {
      prog.textContent = `${Math.min(qi + 1, queue.length)} / ${queue.length}`;
      const used = results.filter(r => !r.correct).length;
      hearts.innerHTML = '';
      for (let i = 0; i < lives; i++) {
        hearts.appendChild(el('span', 'mv-heart' + (i < used ? ' spent' : ''), '\u2666'));
      }
    }

    function finish() {
      const s = summarize(results, lives);
      Save.recordLevel(pack.meta.id, levelIndex, s.stars, s.score);
      callbacks.onComplete(s.score, s.stars);
    }

    function renderQuestion() {
      if (disposed) return;
      if (qi >= queue.length) return finish();

      const item = queue[qi];
      paintBar();
      footer.innerHTML = '';
      itemBox.innerHTML = '';
      itemBox.dataset.locked = '0';
      delete itemBox._mvState;

      // Passage panel. Reused across consecutive items on the same passage so he is not made to
      // re-read it, which is also how the real test presents a passage set.
      const passage = item.passageId ? passages.get(item.passageId) : null;
      if (passage) {
        if (passageBox.dataset.pid !== passage.id) {
          passageBox.dataset.pid = passage.id;
          passageBox.innerHTML = '';
          passageBox.appendChild(el('div', 'mv-passage-title', passage.title));
          for (const para of String(passage.text).split(/\n\s*\n/)) {
            passageBox.appendChild(el('p', 'mv-para', para.trim()));
          }
        }
        passageBox.style.display = '';
      } else {
        passageBox.style.display = 'none';
        passageBox.dataset.pid = '';
      }

      const ctx = {
        passage,
        onAnswer(response) { if (!Items.needsCheck(item)) submit(item, response); else refreshCheck(item); },
        onProgress() { refreshCheck(item); },
      };
      Items.render(item, itemBox, ctx);

      if (Items.needsCheck(item)) {
        const btn = el('button', 'mv-check', 'Check');
        btn.type = 'button';
        btn.disabled = true;
        btn.addEventListener('click', () => {
          const st = itemBox._mvState || {};
          submit(item, st.picked);
        });
        footer.appendChild(btn);
        host._mvCheck = btn;
      } else {
        host._mvCheck = null;
      }
    }

    function refreshCheck(item) {
      const btn = host._mvCheck;
      if (!btn) return;
      const st = itemBox._mvState || {};
      btn.disabled = !Items.isComplete(item, st.picked);
    }

    function submit(item, response) {
      if (disposed || itemBox.dataset.locked === '1') return;
      itemBox.dataset.locked = '1';
      const btn = host._mvCheck;
      if (btn) btn.disabled = true;

      const result = Items.grade(item, response);
      results.push(result);
      Items.reveal(item, itemBox, response, result);

      Save.recordAnswer({
        packId: pack.meta.id, topic: item.coachTopic, correct: !!result.correct,
        itemId: item.id, qText: item.stem || (item.partA && item.partA.stem) || '',
        picked: response,
      });
      paintBar();

      if (result.correct) {
        footer.innerHTML = '';
        footer.appendChild(el('div', 'mv-flash ok', 'Correct'));
        later(() => { qi++; renderQuestion(); }, CORRECT_ADVANCE_MS);
        return;
      }

      // Wrong: never auto-advance. Show the explanation and require NEXT (26-0714).
      showExplain(item, response, result);

      const topic = String(item.coachTopic || '');
      wrongByTopic[topic] = (wrongByTopic[topic] || 0) + 1;
      if (coach && wrongByTopic[topic] >= COACH_WRONG_THRESHOLD) {
        wrongByTopic[topic] = 0;
        later(() => { try { coach(topic); } catch (e) {} }, 350);
      }
    }

    function showExplain(item, response, result) {
      footer.innerHTML = '';
      const tile = el('div', 'mv-explain');
      tile.appendChild(el('div', 'mv-explain-head', 'Not quite'));

      // The rationale for the option he actually picked comes FIRST, because naming his own
      // misconception is what the 26-0714 audit found missing.
      const dr = item.distractorRationale || {};
      const pickedIdx = (item.type === 'ebsr') ? (response && response.a) : response;
      const own = (typeof pickedIdx === 'number') ? dr[String(pickedIdx)] : null;
      if (own) tile.appendChild(el('div', 'mv-explain-own', 'What that answer assumes: ' + own));

      for (const n of (result.notes || [])) tile.appendChild(el('div', 'mv-explain-note', n));
      if (item.explain) tile.appendChild(el('div', 'mv-explain-body', item.explain));

      const next = el('button', 'mv-next', qi + 1 >= queue.length ? 'Finish \u2192' : 'Next \u2192');
      next.type = 'button';
      next.addEventListener('click', () => { qi++; renderQuestion(); });
      tile.appendChild(next);
      footer.appendChild(tile);

      // A tall passage clips the tile; scroll it in so NEXT is reachable on a 768px screen.
      if (tile.scrollIntoView) tile.scrollIntoView({ block: 'nearest' });
    }

    renderQuestion();

    return function cleanup() {
      disposed = true;
      timeouts.forEach(clearTimeout);
      timeouts = [];
      Save.saveNow();
    };
  }

  // A pack registers under its own id, so the shell's InlineModules[m.id] lookup needs no change.
  function register(pack, registry) {
    const reg = registry || (root && root.InlineModules);
    if (!reg) throw new Error('MVRunner.register: no registry (pass one, or load the shell first)');
    reg[pack.meta.id] = {
      init(host, levelIndex, callbacks) { return makeRunner(pack, levelIndex, host, callbacks, null); },
    };
    return reg[pack.meta.id];
  }

  return { pickItems, scoreFor, summarize, starsForMistakes, register, makeRunner, DEFAULT_LIVES, CORRECT_ADVANCE_MS };
});
