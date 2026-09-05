'use strict';
// runner.js -- plays one level of one pack.
//
// Implements the SAME contract the six math IIFEs implement:
//   InlineModules[id].init(host, levelIndex, { onComplete(score, stars), onExit() }) -> cleanupFn
// so the shell dispatches a pack level through the identical code path, and nothing about the math
// modules has to change. Owner ruling (26-0811, partial reveal) adds a THIRD, pack-only argument
// on top of that shared contract: onComplete(score, stars, foundRatio) -- fraction of this
// attempt's reveal cells actually found, read only by Math-Multiverse.html's showPackLevelComplete
// for a level that declares `reveal`. The math IIFEs' own onComplete(score, stars) calls are
// unaffected; a 2-arg callback simply never reads the 3rd argument this file now also passes.
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

  // Fix round 1 (controller review): pack.meta.subject -> themed correct-answer stamp, named
  // once here instead of an inline ternary chain repeating the 'hist'/'sci' literals. Kept LOCAL
  // to this file, not borrowed from MVFigures's reveal theming (engine/figures.js's attachReveal
  // uses the same two subjects for a different purpose): the stamp must render identically with
  // or without figures.js loaded, since it is not part of that file's optional-layer contract,
  // so it may not read anything off FG. tests/runner.test.js pins these two keys against the
  // shell's real SUBJECT_ORDER (Math-Multiverse.html), so a future subject renamed away from
  // 'hist'/'sci' (e.g. authored as 'history') fails a test instead of silently losing its stamp.
  const STAMP_THEME = {
    hist: { label: 'VERIFIED', cls: 'stamp-verified' },
    sci: { label: 'CONFIRMED', cls: 'stamp-confirmed' },
  };

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

  // THE LADDER IS LIFE-AWARE, and it has to be. Reported by Niall, 26-0904, in his own words:
  // "when I get three questions wrong, not four, which would mean I would get zero stars, I still
  // get zero stars, which means the fourth star is just there to do nothing."
  //
  // He is right, and the bar he is looking at is the reason. paintBar() draws one marker per LIFE,
  // and every reading level in every pack declares `lives: 4` (36 levels across six packs). The
  // ladder underneath was a fixed three-life ladder that never learned about `lives`, so on a
  // four-life level:
  //
  //     0 wrong -> 3 stars, clears     2 wrong -> 1 star,  clears
  //     1 wrong -> 2 stars, clears     3 wrong -> 0 stars, DOES NOT CLEAR
  //                                    4 wrong -> 0 stars, DNF, does not clear
  //
  // The third mistake already cost everything there was to lose. The fourth marker sat on the bar
  // through the rest of the level with nothing behind it -- no star to protect and no level to
  // clear -- which is exactly what he noticed. A life the child can see must be a life that is
  // worth something.
  //
  // RUNNING OUT OF LIVES IS NOW THE ONLY ZERO. Finishing a level earns at least one star, so the
  // last life is the difference between clearing the level and not:
  //
  //     lives 4:  0 -> 3    1 -> 2    2 -> 1    3 -> 1    4 -> 0 (DNF)
  //     lives 3:  0 -> 3    1 -> 2    2 -> 1              3 -> 0 (DNF)
  //
  // The three-life column is UNCHANGED, which matters: every math module (Fraction Rider, Rocket
  // Climb and the rest) runs on three lives and its own copy of this ladder, and none of them
  // moves. Only the four-life reading levels change, and only in the one band that had nothing
  // in it. Reverting is one line: drop the `m >= L` guard and restore `return 0`.
  function starsForMistakes(m, lives) {
    const L = Number.isInteger(lives) ? lives : DEFAULT_LIVES;
    if (m >= L) return 0;   // out of lives: the only way to score nothing
    if (m === 0) return 3;
    if (m <= 1) return 2;
    return 1;               // survived it: the level clears
  }

  function summarize(results, lives) {
    const L = Number.isInteger(lives) ? lives : DEFAULT_LIVES;
    let score = 0, mistakes = 0;
    for (const r of results || []) {
      score += scoreFor(r);
      if (!r || !r.correct) mistakes++;
    }
    const dnf = mistakes >= L;
    // starsForMistakes now returns 0 on its own when the lives are gone, so `dnf ? 0 :` is no
    // longer load-bearing. It stays as the explicit statement of the rule, and the two agree by
    // construction: both read the same L.
    return { score, mistakes, stars: dnf ? 0 : starsForMistakes(mistakes, L), dnf };
  }

  // ---------------- DOM ----------------

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // Phase R, task 2.  The passage scrolls, and its clip edge was invisible: at real passage
  // length the last visible line is sliced mid-sentence with no rule, no fade and no gap before
  // the question begins.  A child scanning down cannot tell whether the article ended, whether
  // the app broke, or whether there is more below, and in the shot that was taken to check
  // Niall's report the clipped half-line was the single most broken-looking thing on screen.
  //
  // `data-clipped` is written ONLY while the box genuinely overflows AND is not scrolled to its
  // end, so a passage that fits, and a passage the child has read to the bottom, both paint
  // nothing.  A permanent fade would dim the last line of every short passage for no reason,
  // which trades one wrong signal for another.
  //
  // Done in JS rather than with the background-attachment:local shadow trick because
  // .mv-passage's background-image layer is already owned by the docKind tint, and composing
  // scroll shadows into it would mean editing all eleven skin rules to keep one affordance.
  //
  // Every property read here is guarded: the unit suite renders through a DOM stub that has no
  // layout, so scrollHeight/clientHeight are absent there, and a passage must never be able to
  // cost the child the level over a decoration.
  function markPassageClipped(box) {
    if (!box) return;
    const update = () => {
      try {
        const sh = box.scrollHeight, ch = box.clientHeight, st = box.scrollTop;
        if (typeof sh !== 'number' || typeof ch !== 'number' || typeof st !== 'number') return;
        // 2px tolerance: sub-pixel line rounding reports a 1px overflow on boxes that fit.
        const more = sh - ch - st > 2;
        if (more) box.dataset.clipped = '1';
        else delete box.dataset.clipped;
      } catch (_) {}
    };
    try {
      if (!box._mvClipBound) {
        box._mvClipBound = true;
        if (typeof box.addEventListener === 'function') box.addEventListener('scroll', update);
      }
      update();
      // Re-check once after layout settles: at render time a figure strip's images may not have
      // been measured yet, and the passage's own height is what this depends on.
      if (typeof setTimeout === 'function') setTimeout(update, 0);
    } catch (_) {}
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
      // Owner ruling (26-0811, partial reveal): the completion card must render whenever ANY
      // cell was found, not only when stars > 0 -- a level's lives can run out after several
      // correct answers, and those earned cells must not vanish. foundRatio (cells found / total
      // questions this attempt served) is the one extra value threaded to the shell's
      // showPackLevelComplete, derived from the SAME `reveal` handle attachReveal returned above
      // rather than recomputed from `results` independently, so the two can never drift. Guarded
      // like every other optional-layer call in this file: a reveal handle from an older or
      // minimal Figures stub with no foundCount() must not crash a level that otherwise finished
      // cleanly, and nothing here is persisted -- the ratio lives only for this one callback.
      let foundRatio = 0;
      if (reveal && typeof reveal.foundCount === 'function' && queue.length) {
        try { foundRatio = reveal.foundCount() / queue.length; } catch (e) { foundRatio = 0; }
      }
      callbacks.onComplete(s.score, s.stars, foundRatio);
    }

    function renderQuestion() {
      if (disposed) return;
      if (qi >= queue.length) return finish();

      // Dryness-fix round 2, minor: a lightbox opened for the PREVIOUS question survives the
      // correct-answer auto-advance and the wrong-answer NEXT button alike (both paths call
      // renderQuestion), so without this it sits over the new question showing the old one's
      // figure. Same call-time-resolution and try/catch stance as every other optional-layer
      // hook in this file: a missing or throwing MVFigures must never cost the child the level.
      // A separate block (not a shared `const FG`) because this file already declares `FG` twice
      // more below, each scoped to its own `if` block; a bare `const FG` here at renderQuestion's
      // top level would collide with the second of those two declarations.
      {
        const FG = (deps && deps.Figures) || (typeof MVFigures !== 'undefined' && MVFigures) || (root && root.MVFigures);
        if (FG) { try { FG.closeLightbox(); } catch (e) {} }
      }

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
          // A new passage is new words, so the lit line's character offset no longer points at
          // anything the child chose. It goes out rather than lighting whatever now sits there.
          rlClear(passageBox);
          passageBox.innerHTML = '';
          passageBox.appendChild(el('div', 'mv-passage-title', passage.title));
          // Written only when a kind exists, and removed otherwise, so a text-only passage
          // never carries a stale or empty-string dockind attribute for Task 5's CSS to trip on.
          if (passage.docKind) passageBox.dataset.dockind = passage.docKind;
          else delete passageBox.dataset.dockind;
          // Phase R: the band's LABEL, separate from the skin that paints it.  Written on the
          // same only-when-present terms as dockind above, so a passage that drops its register
          // falls back to its kind's own literal rather than carrying an empty attribute that
          // CSS's attr() would render as a blank band.
          if (passage.register) passageBox.dataset.register = passage.register;
          else delete passageBox.dataset.register;
          // Dryness-fix round 2: the strip renders HERE, immediately after the title and before
          // the paragraph loop, so renderStrip's own appendChild lands it as the passage box's
          // SECOND child (title first, strip second) -- never after every paragraph. At real
          // passage length (the shipped packs run 1446-3206 chars; the fixture that exposed
          // every earlier pass to this defect ran 604) appending the strip last put it entirely
          // below the fold: SPEC section 3 item 1 promises the strip "inside .mv-passage under
          // the title", and a strip a full scroll away has no on-screen presence at all, which
          // is the exact failure the dryness pass measured (0 of 98 strip pixels visible on
          // arrival). Optional layer, same call-time-resolution and try/catch stance as MVFresh
          // above: a figure bug must never cost the child the level, and a missing figures.js
          // must degrade to today's text-only passage rendering. A thrown error is still warned
          // once, not swallowed silently, so a malformed figure does not vanish with no
          // diagnostic anywhere. The warn itself is wrapped in its OWN try/catch: a throw raised
          // inside a catch block is not caught by its own try, so a console lacking a callable
          // warn must not be able to escape this guard and kill the level it protects.
          const FG = (deps && deps.Figures) || (typeof MVFigures !== 'undefined' && MVFigures) || (root && root.MVFigures);
          if (FG && Array.isArray(passage.figureIds)) {
            try { FG.renderStrip(pack, passage.figureIds, passageBox); }
            catch (e) {
              try { if (root && root.console && typeof root.console.warn === 'function') root.console.warn('figures: renderStrip failed', e); } catch (_) {}
            }
          }
          for (const para of String(passage.text).split(/\n\s*\n/)) {
            passageBox.appendChild(el('p', 'mv-para', para.trim()));
          }
        }
        passageBox.style.display = '';
        markPassageClipped(passageBox);
        // The reading-line tracker is per passage box and attaches once. Its teardown is held on
        // the box so cleanup() below can detach it: a resize listener that outlives its level is
        // exactly the kind of leak that only shows up after an hour of play.
        if (!passageBox._mvReadlineOff) passageBox._mvReadlineOff = attachReadingLine(passageBox);
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

      // Optional layer, same call-time-resolution and try/catch stance as the passage hook and
      // attachReveal above (three-term form, unified per the pre-flight's consistency
      // requirement): a figure bug must never cost the child the level, and a missing
      // figures.js must degrade to today's figure-less item rendering.
      const FG = (deps && deps.Figures) || (typeof MVFigures !== 'undefined' && MVFigures) || (root && root.MVFigures);
      if (FG && item.figureId) { try { FG.renderItemFigure(pack, item.figureId, itemBox); } catch (e) {} }

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
        // Themed correct-answer stamp via STAMP_THEME above: hist reads VERIFIED (case-file
        // register), sci reads CONFIRMED (lab register); any other subject (or none) keeps the
        // plain "Correct" flash unchanged.
        const subj = pack.meta && pack.meta.subject;
        const theme = STAMP_THEME[subj];
        const label = theme ? theme.label : 'Correct';
        const stampCls = theme ? ' ' + theme.cls : '';
        footer.appendChild(el('div', 'mv-flash ok' + stampCls, label));
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

    // ---- LEVEL BRIEFING (WP-P, 26-0822) ----------------------------------------------------
    // Justin's report was that the science module gave a child no context: he opens level 1 and
    // reads a field manual addressed to "every operative in the Outpost Network" with no idea what
    // either of those is. A level may now carry `briefing`, and when it does it is shown once,
    // before the first question, with one tap to begin.
    //
    // Fully additive and fully optional: a level with no briefing renders exactly as it always
    // did, which is every level of the other four packs. Guarded like the figures hook, because a
    // malformed briefing must never cost the child the level.
    function showBriefingThen(go) {
      let b = null;
      try { b = level && level.briefing; } catch (e) { b = null; }
      const lines = b && Array.isArray(b.lines) ? b.lines.filter((x) => typeof x === 'string' && x.trim()) : [];
      if (!lines.length) return go();
      try {
        const wrap = el('div', 'mv-briefing');
        wrap.appendChild(el('div', 'mv-briefing-kicker', 'Briefing'));
        if (typeof b.title === 'string' && b.title.trim()) {
          wrap.appendChild(el('div', 'mv-briefing-title', b.title));
        }
        for (const line of lines) wrap.appendChild(el('p', 'mv-briefing-line', line));
        const begin = el('button', 'mv-briefing-begin', 'Begin →');
        begin.type = 'button';
        begin.addEventListener('click', () => { wrap.remove(); go(); }, { once: true });
        wrap.appendChild(begin);
        shell.insertBefore(wrap, passageBox);
        // The passage and the question belong to the level, not to the briefing; keep them out of
        // the way until he taps Begin rather than layering the briefing over them.
        passageBox.style.display = 'none';
        itemBox.style.display = 'none';
        return;
      } catch (e) {
        try { if (root && root.console && typeof root.console.warn === 'function') root.console.warn('briefing failed to render', e); } catch (_) {}
        return go();
      }
    }

    showBriefingThen(() => {
      passageBox.style.display = '';
      itemBox.style.display = '';
      renderQuestion();
    });

    return function cleanup() {
      disposed = true;
      timeouts.forEach(clearTimeout);
      timeouts = [];
      Save.saveNow();
      // Detach the reading-line tracker with the level that owns it. Guarded the same way as the
      // figures hook below: a tracker fault must never stop the rest of cleanup from running.
      try {
        if (passageBox && passageBox._mvReadlineOff) { passageBox._mvReadlineOff(); passageBox._mvReadlineOff = null; }
      } catch (e) {}
      // Same call-time resolution and try/catch stance as the passage hook above: an open
      // lightbox must not survive past the level that opened it, and a broken or absent
      // MVFigures must never stop cleanup from running the rest of its work. Three-term form
      // (deps.Figures first), unifying this fourth call site onto the same resolution pattern
      // as the passage hook, attachReveal, and the item-figure hook above (Task 7).
      const FG = (deps && deps.Figures) || (typeof MVFigures !== 'undefined' && MVFigures) || (root && root.MVFigures);
      if (FG) { try { FG.closeLightbox(); } catch (e) {} }
    };
  }

  // ---- READING-LINE TRACKER (Justin, 26-0822) ----------------------------------------------
  //
  // "He wants to be able to track his reading progress when he is answering questions ... allow
  //  the user to select a line of the text that they're reading and have it be highlighted. That
  //  allows him then to look at the answer down below and track where he's reading from."
  //
  // Tap a line of the passage and that line stays lit. Look down at the choices, look back up, and
  // the place he was is still marked. Arrow keys walk it a line at a time; Escape, or tapping the
  // lit line again, clears it.
  //
  // A RENDERED VISUAL LINE, not a sentence and not a paragraph, because that is what he asked for
  // and it is what a reading ruler marks. HTML has no element for a visual line, so the line is
  // found geometrically: the tap gives a character, and the line is the maximal run of characters
  // around it whose client rects share that character's top edge. Tops increase monotonically with
  // offset inside a block, so each edge is a binary search rather than a scan.
  //
  // AN OVERLAY, NEVER DOM SURGERY on the passage text. Constraint 4 keeps certified passage text
  // byte-untouched, and tests/reading-surface.js measures this exact surface; wrapping words in
  // <mark> would mutate the text nodes the ledger hashes and move the very geometry that gate
  // sweeps. The overlay is a sibling div positioned over the line, so the text under it is
  // untouched, still selectable, and still measured the same way.
  //
  // The anchor is stored as a CHARACTER OFFSET, not a pixel row, so a resize, an orientation flip
  // or a font swap re-finds the same words rather than lighting whatever now happens to sit at
  // that height. Recomputed on resize and on scroll.
  const READING_LINE = {
    // { blockIndex, offset } into the passage's own blocks, or null when nothing is lit.
    anchor: null,
    passageId: null,
  };

  // Every text node under a block, in document order, and the flat character length across them.
  // A block is one .mv-para or the passage title: bold spans and the like mean a block is usually
  // several text nodes, and a flat offset over all of them is what makes a line boundary
  // expressible as one number.
  function rlTextNodes(block) {
    const out = [];
    const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walk.nextNode())) { if (n.nodeValue && n.nodeValue.length) out.push(n); }
    return out;
  }

  function rlFlatLength(nodes) {
    let n = 0;
    for (const t of nodes) n += t.nodeValue.length;
    return n;
  }

  // Flat offset -> {node, offset}. Clamped, so an offset past the end lands on the last character
  // rather than throwing inside a Range.
  function rlPos(nodes, flat) {
    let left = Math.max(0, flat);
    for (const t of nodes) {
      if (left <= t.nodeValue.length) return { node: t, offset: Math.min(left, t.nodeValue.length) };
      left -= t.nodeValue.length;
    }
    const last = nodes[nodes.length - 1];
    return last ? { node: last, offset: last.nodeValue.length } : null;
  }

  // The client rect of the single character at a flat offset.
  function rlCharRect(nodes, flat, total) {
    if (!nodes.length || flat < 0 || flat >= total) return null;
    const a = rlPos(nodes, flat);
    const b = rlPos(nodes, flat + 1);
    if (!a || !b) return null;
    let r;
    try {
      r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
    } catch (e) { return null; }
    const rects = r.getClientRects();
    return rects.length ? rects[0] : null;
  }

  // The blocks a reader can point at: the paragraphs and the title. The figure strip is not text
  // and is skipped, so a tap on a chart cannot light a "line" that has no words in it.
  function rlBlocks(passageBox) {
    if (!passageBox || typeof passageBox.querySelectorAll !== 'function') return [];
    return [...passageBox.querySelectorAll('.mv-para, .mv-passage-title')];
  }

  // Widen a flat offset to the whole visual line containing it. Tops rise monotonically with
  // offset inside a block, so both edges are binary searches. Tolerance is half a line, because
  // rect tops within one line differ slightly across mixed font sizes and superscripts.
  function rlLineRange(nodes, total, hit) {
    const seed = rlCharRect(nodes, hit, total);
    if (!seed) return null;
    const tol = Math.max(4, seed.height * 0.5);
    const sameLine = (flat) => {
      const r = rlCharRect(nodes, flat, total);
      return !!r && Math.abs(r.top - seed.top) <= tol;
    };
    // First offset on this line: the smallest i in [0, hit] with sameLine(i).
    let lo = 0, hi = hit;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sameLine(mid)) hi = mid; else lo = mid + 1;
    }
    const start = lo;
    // Last offset on this line: the largest i in [hit, total-1] with sameLine(i).
    lo = hit; hi = total - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (sameLine(mid)) lo = mid; else hi = mid - 1;
    }
    return { start, end: lo };
  }

  // Union of the client rects for a flat range, in the passage box's own scrolled coordinates.
  function rlRangeRect(passageBox, nodes, start, end) {
    const a = rlPos(nodes, start);
    const b = rlPos(nodes, end + 1);
    if (!a || !b) return null;
    let r;
    try {
      r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
    } catch (e) { return null; }
    const rects = [...r.getClientRects()].filter((x) => x.width > 0 || x.height > 0);
    if (!rects.length) return null;
    const box = passageBox.getBoundingClientRect();
    const top = Math.min(...rects.map((x) => x.top));
    const bottom = Math.max(...rects.map((x) => x.bottom));
    const left = Math.min(...rects.map((x) => x.left));
    const right = Math.max(...rects.map((x) => x.right));
    return {
      top: top - box.top + passageBox.scrollTop,
      left: left - box.left + passageBox.scrollLeft,
      width: right - left,
      height: bottom - top,
    };
  }

  // The tracker is a browser-only affordance and an OPTIONAL layer, the same stance this file
  // takes for MVFigures. tests/runner.test.js drives makeRunner against tests/dom-stub.js, a
  // minimal DOM that has no querySelector and no TreeWalker; the tracker must be a clean no-op
  // there rather than taking the whole runner down with it. Measured: without this guard, 40
  // runner unit tests fail on `passageBox.querySelector is not a function`.
  function rlSupported(passageBox) {
    return !!(passageBox
      && typeof passageBox.querySelector === 'function'
      && typeof document !== 'undefined'
      && typeof document.createTreeWalker === 'function'
      && typeof document.createRange === 'function');
  }

  function rlOverlay(passageBox) {
    let el = passageBox.querySelector(':scope > .mv-readline');
    if (!el) {
      el = document.createElement('div');
      el.className = 'mv-readline';
      el.setAttribute('aria-hidden', 'true');
      passageBox.appendChild(el);
    }
    return el;
  }

  function rlClear(passageBox) {
    READING_LINE.anchor = null;
    if (!rlSupported(passageBox)) return;
    const el = passageBox.querySelector(':scope > .mv-readline');
    if (el) el.style.display = 'none';
    if (passageBox) passageBox.removeAttribute('data-readline');
  }

  // Paint the stored anchor. Called on tap, on arrow keys, on resize and on scroll, so the line
  // is always recomputed from the offset rather than trusted from the last paint.
  function rlPaint(passageBox) {
    const a = READING_LINE.anchor;
    if (!a || !rlSupported(passageBox)) return false;
    const blocks = rlBlocks(passageBox);
    const block = blocks[a.blockIndex];
    if (!block) { rlClear(passageBox); return false; }
    const nodes = rlTextNodes(block);
    const total = rlFlatLength(nodes);
    if (!total) { rlClear(passageBox); return false; }
    const range = rlLineRange(nodes, total, Math.min(a.offset, total - 1));
    if (!range) { rlClear(passageBox); return false; }
    const rect = rlRangeRect(passageBox, nodes, range.start, range.end);
    if (!rect) { rlClear(passageBox); return false; }
    const el = rlOverlay(passageBox);
    // A couple of pixels of bleed each side so the band reads as a line rather than as a box
    // clipped to the glyphs.
    el.style.display = 'block';
    // Horizontal bleed only. Vertical bleed would push the band into the neighbouring line box,
    // and "this line and no other" is the whole promise the tracker makes.
    el.style.top = rect.top + 'px';
    el.style.left = (rect.left - 4) + 'px';
    el.style.width = (rect.width + 8) + 'px';
    el.style.height = rect.height + 'px';
    passageBox.setAttribute('data-readline', '');
    a.lineStart = range.start;
    a.lineEnd = range.end;
    return true;
  }

  // Move the lit line by one, across block boundaries. Returns false at either end of the passage,
  // so the caller can leave the line where it is rather than clearing it.
  function rlStep(passageBox, dir) {
    const a = READING_LINE.anchor;
    if (!a || !rlSupported(passageBox)) return false;
    const blocks = rlBlocks(passageBox);
    let bi = a.blockIndex;
    let block = blocks[bi];
    if (!block) return false;
    let nodes = rlTextNodes(block);
    let total = rlFlatLength(nodes);
    const range = rlLineRange(nodes, total, Math.min(a.offset, total - 1));
    if (!range) return false;

    let next = dir > 0 ? range.end + 1 : range.start - 1;
    while (next < 0 || next >= total) {
      bi += dir;
      block = blocks[bi];
      if (!block) return false;                 // start or end of the passage: stay put
      nodes = rlTextNodes(block);
      total = rlFlatLength(nodes);
      if (!total) continue;
      next = dir > 0 ? 0 : total - 1;
    }
    READING_LINE.anchor = { blockIndex: bi, offset: next };
    const painted = rlPaint(passageBox);
    if (painted) {
      const el = passageBox.querySelector(':scope > .mv-readline');
      // Keep the lit line on screen when the arrows walk it past the fold.
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
    return painted;
  }

  // Flat offset of a point, via the browser's own caret hit-testing. Two spellings because the
  // standard one and the widely-shipped one disagree; neither is universal.
  function rlOffsetFromPoint(block, nodes, x, y) {
    let node = null, offset = 0;
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    } else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    }
    if (!node) return null;
    if (node.nodeType !== 3) {
      // A hit on the element rather than a text node: fall back to the nearest text node's start.
      const t = nodes.find((n) => node.contains(n));
      if (!t) return null;
      node = t; offset = 0;
    }
    let flat = 0;
    for (const t of nodes) {
      if (t === node) return flat + Math.min(offset, t.nodeValue.length);
      flat += t.nodeValue.length;
    }
    return null;
  }

  // Wire the tracker onto one passage box. Returns a teardown so the runner's own cleanup can
  // detach it: an orphaned resize listener outlives the level it belongs to.
  function attachReadingLine(passageBox) {
    if (!rlSupported(passageBox) || typeof passageBox.addEventListener !== 'function') return function () {};
    let downAt = null;

    const onDown = (e) => { downAt = { x: e.clientX, y: e.clientY, t: Date.now() }; };
    const onUp = (e) => {
      const from = downAt; downAt = null;
      // A scroll drag, a long press or a text selection is not a tap, and must not move the line.
      if (!from) return;
      if (Math.abs(e.clientX - from.x) > 8 || Math.abs(e.clientY - from.y) > 8) return;
      const sel = root.getSelection && root.getSelection();
      if (sel && !sel.isCollapsed) return;
      // A tap on the figure strip is not a tap on a line of prose.
      const block = e.target && e.target.closest && e.target.closest('.mv-para, .mv-passage-title');
      if (!block || !passageBox.contains(block)) return;
      const blocks = rlBlocks(passageBox);
      const bi = blocks.indexOf(block);
      if (bi < 0) return;
      const nodes = rlTextNodes(block);
      const total = rlFlatLength(nodes);
      if (!total) return;
      const flat = rlOffsetFromPoint(block, nodes, e.clientX, e.clientY);
      if (flat == null) return;
      const a = READING_LINE.anchor;
      // Tapping the lit line again puts it out, so there is always a way to turn it off by hand.
      if (a && a.blockIndex === bi && a.lineStart != null && flat >= a.lineStart && flat <= a.lineEnd) {
        rlClear(passageBox);
        return;
      }
      READING_LINE.anchor = { blockIndex: bi, offset: flat };
      rlPaint(passageBox);
    };

    const onKey = (e) => {
      if (!READING_LINE.anchor) return;
      if (e.key === 'Escape') { rlClear(passageBox); return; }
      if (e.key === 'ArrowDown') { if (rlStep(passageBox, 1)) e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { if (rlStep(passageBox, -1)) e.preventDefault(); return; }
    };

    // Reflow moves the words; the anchor is a character, so re-finding the line is the whole point
    // of storing it that way.
    const onReflow = () => { if (READING_LINE.anchor) rlPaint(passageBox); };

    passageBox.addEventListener('pointerdown', onDown);
    passageBox.addEventListener('pointerup', onUp);
    document.addEventListener('keydown', onKey);
    root.addEventListener('resize', onReflow);
    passageBox.addEventListener('scroll', onReflow);

    return function detachReadingLine() {
      passageBox.removeEventListener('pointerdown', onDown);
      passageBox.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey);
      root.removeEventListener('resize', onReflow);
      passageBox.removeEventListener('scroll', onReflow);
      rlClear(passageBox);
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
    // markPassageClipped is exported so tests/reading-surface.js can drive the REAL marker
    // against a real, overflowing passage in a real browser, rather than reimplementing the
    // overflow arithmetic in the gate and proving only that the gate agrees with itself.
    pickItems, scoreFor, summarize, starsForMistakes, register, makeRunner, markPassageClipped,
    DEFAULT_LIVES, CORRECT_ADVANCE_MS,
    STAMP_THEME,
    // The reading-line tracker is exported for the same reason markPassageClipped is:
    // tests/reading-line.js drives the REAL widener and the REAL anchor against real rendered
    // text in a real browser, rather than reimplementing the line geometry in the gate and
    // proving only that the gate agrees with itself.
    readingLine: {
      state: READING_LINE,
      attach: attachReadingLine,
      paint: rlPaint,
      clear: rlClear,
      step: rlStep,
      lineRange: rlLineRange,
      blocks: rlBlocks,
      textNodes: rlTextNodes,
      flatLength: rlFlatLength,
    },
    _test: { pickItems },
  };
});
