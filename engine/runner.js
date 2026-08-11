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

  // repeatPolicy resolution: a level's own value wins; otherwise the pack-root value threaded
  // in by makeRunner via level._packPolicy; otherwise 'rotate'.  See makeRunner below for how
  // _packPolicy gets attached without mutating the parsed pack JSON's level object.
  function pickItems(level, allItems, rng, levelKey) {
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

    // MVFresh is read AT CALL TIME, never captured at factory/parse time: engine scripts load
    // before the inline script defines it (same bug class documented at makeRunner below for
    // MVItems/MVPack). `typeof root.x` alone does not guard a member access on an undefined
    // base, hence the `root &&` short-circuit.
    const policy = level.repeatPolicy || level._packPolicy || 'rotate';
    const F = (typeof MVFresh !== 'undefined' && MVFresh) || (root && root.MVFresh);
    if (policy === 'rotate' && F && typeof F.orderPool === 'function') {
      const ordered = F.orderPool(levelKey, ids).map(id => byId.get(id)).filter(Boolean);
      const slice = ordered.slice(0, want);
      for (let i = slice.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = slice[i]; slice[i] = slice[j]; slice[j] = t;
      }
      return slice;
    }

    // No MVFresh, or repeatPolicy 'free': today's shuffle+slice, byte-identical.
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

    // Thread the pack-root repeatPolicy onto the level object pickItems reads, via a shallow
    // clone: pack.levels[levelIndex] is the parsed pack JSON and must not be mutated, since the
    // same pack object can be replayed across multiple makeRunner calls (retries, other levels).
    const level = Object.assign({}, pack.levels[levelIndex], { _packPolicy: pack.repeatPolicy });
    const lives = Number.isInteger(level.lives) ? level.lives : DEFAULT_LIVES;
    const levelKey = 'pack.' + pack.meta.id + '.i' + levelIndex;
    const queue = pickItems(level, pack.items, deps && deps.rng, levelKey);
    // Record what was actually served, so a future rotate-policy call can prefer what this one
    // did not.  Best-effort and after selection only: a freshness-ledger failure must never
    // block or alter the level that already started for the child.  Same call-time resolution
    // as pickItems, kept independent because pickItems must stay pure (read-only).
    try {
      const F = (typeof MVFresh !== 'undefined' && MVFresh) || (root && root.MVFresh);
      if (F && typeof F.markSeenIds === 'function') F.markSeenIds(levelKey, queue.map(i => i.id));
    } catch (e) {}
    const passages = new Map(pack.passages.map(p => [p.id, p]));

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
    // Optional layer, same call-time-resolution and try/catch stance as MVFresh and the passage
    // hook below, now threaded through deps.Figures first (Task 6 unifies all three FG
    // resolutions in this file onto this same three-term form). Built once per level, here in
    // the chrome build rather than inside renderQuestion: the strip's `found` cells must persist
    // and accumulate across every question in the level, not be rebuilt each time one renders.
    const FGReveal = (deps && deps.Figures) || (typeof MVFigures !== 'undefined' && MVFigures) || (root && root.MVFigures);
    const reveal = FGReveal ? (function () {
      try { return FGReveal.attachReveal(bar, pack, level, queue.length); }
      catch (e) { return null; }
    })() : null;
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
          // Written only when a kind exists, and removed otherwise, so a text-only passage
          // never carries a stale or empty-string dockind attribute for Task 5's CSS to trip on.
          if (passage.docKind) passageBox.dataset.dockind = passage.docKind;
          else delete passageBox.dataset.dockind;
          // Optional layer, same call-time-resolution and try/catch stance as MVFresh above: a
          // figure bug must never cost the child the level, and a missing figures.js must
          // degrade to today's text-only passage rendering.  A thrown error is still warned
          // once, not swallowed silently, so a malformed figure does not vanish with no
          // diagnostic anywhere.  The warn itself is wrapped in its OWN try/catch: a throw
          // raised inside a catch block is not caught by its own try, so a console lacking a
          // callable warn must not be able to escape this guard and kill the level it protects.
          const FG = (deps && deps.Figures) || (typeof MVFigures !== 'undefined' && MVFigures) || (root && root.MVFigures);
          if (FG && Array.isArray(passage.figureIds)) {
            try { FG.renderStrip(pack, passage.figureIds, passageBox); }
            catch (e) {
              try { if (root && root.console && typeof root.console.warn === 'function') root.console.warn('figures: renderStrip failed', e); } catch (_) {}
            }
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

        // Return submits from a text input, because on the target device the Check button is not
        // reachable while the keyboard is up. Measured live at 1024x768: the shorttext input renders
        // at y=662-706 and Check at y=714-751, while an iPad landscape keyboard covers everything
        // below about y=503. .mv-shell is height:100% and does not scroll, so there is nowhere for
        // Safari to scroll the footer into view. Scoped to inputs on purpose: a keydown listener on
        // the whole item box would also fire for .mv-choice buttons, where Enter already dispatches
        // a click, and the child would submit the instant they selected a choice with the keyboard.
        for (const inp of itemBox.querySelectorAll('.mv-input')) {
          inp.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (itemBox.dataset.locked === '1') return;
            const st = itemBox._mvState || {};
            if (!Items.isComplete(item, st.picked)) return;
            e.preventDefault();
            submit(item, st.picked);
          });
        }
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
        // Never on the wrong branch below: the reveal is not punitive, so nothing here may run
        // outside this one guard on result.correct.
        if (reveal) { try { reveal.onCorrect(qi); } catch (e) {} }
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
      // Only mc, ms and ebsr carry distractorRationale (validate-pack.js CHOICE_TYPES, minus cloze), and
      // each names its picks differently: mc a bare index, ebsr its Part A index, ms an ARRAY of indices.
      // Enumerate the types explicitly rather than testing Array.isArray, because cloze and hottext
      // responses are also arrays whose numbers mean something else entirely -- indexing dr with a cloze
      // blank choice would attach a rationale to the wrong thing.
      const picked = item.type === 'mc' ? [response]
        : item.type === 'ebsr' ? [response && response.a]
          : item.type === 'ms' ? (Array.isArray(response) ? response : [])
            : [];
      // dr only has entries for WRONG options, so correct picks drop out on their own. ms can carry more
      // than one wrong pick, and each is a separate misconception worth naming.
      const owned = picked.filter(Number.isInteger).sort((a, b) => a - b).map(i => dr[String(i)]).filter(Boolean);
      if (owned.length === 1) {
        tile.appendChild(el('div', 'mv-explain-own', 'What that answer assumes: ' + owned[0]));
      } else if (owned.length > 1) {
        tile.appendChild(el('div', 'mv-explain-own', 'What those answers assume:'));
        for (const own of owned) tile.appendChild(el('div', 'mv-explain-own', own));
      }

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
      // Same call-time resolution and try/catch stance as the passage hook above: an open
      // lightbox must not survive past the level that opened it, and a broken or absent
      // MVFigures must never stop cleanup from running the rest of its work.
      const FG = (typeof MVFigures !== 'undefined' && MVFigures) || (root && root.MVFigures);
      if (FG) { try { FG.closeLightbox(); } catch (e) {} }
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

  return {
    pickItems, scoreFor, summarize, starsForMistakes, register, makeRunner, DEFAULT_LIVES, CORRECT_ADVANCE_MS,
    _test: { pickItems },
  };
});
