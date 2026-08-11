'use strict';
// figures.js -- all figure DOM for the pack engine: strip, lightbox, plate viewer, reveal.
// OPTIONAL LAYER: runner resolves MVFigures at call time and degrades to text-only rendering
// when this file is absent (same contract as MVFresh).  Nothing here may throw at load time.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MVFigures = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : null), function (root) {

  let _document = null;
  function setEnv(env) { if (env && env.document) _document = env.document; }
  function doc() {
    if (_document) return _document;
    if (typeof document !== 'undefined') return document;
    throw new Error('figures: no document; call MVFigures.setEnv({ document })');
  }

  const FIG_KINDS = ['photo', 'plate', 'map', 'diagram', 'chart'];
  const DOC_KINDS = ['case-file', 'recovered-entry', 'source-desk', 'addendum',
    'field-manual', 'status-log', 'weather-log', 'field-report', 'procedure', 'memo', 'minutes'];
  const TOKENS = { ink: '#e8eef7', grid: 'rgba(255,255,255,0.12)', minFont: 15 };

  const _maps = new WeakMap();   // pack -> Map(id -> figure)
  function resolve(pack, id) {
    if (!pack || !Array.isArray(pack.figures) || !id) return null;
    let m = _maps.get(pack);
    if (!m) { m = new Map(pack.figures.map(f => [f && f.id, f])); _maps.set(pack, m); }
    return m.get(id) || null;
  }

  function el(tag, cls, text) {
    const n = doc().createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // Explicit, not a ternary-with-a-fallback: every FIG_KINDS entry gets its correct label, and
  // a kind missing from this map renders a visibly-wrong "?kind" pill rather than silently
  // uppercasing a guessed identifier.  It must NOT rely on el() alone for that visibility: el()
  // sets textContent only when the text is neither undefined nor null, so an unguarded
  // `BADGE[f.kind]` lookup on an unmapped kind would render an EMPTY pill with no text at all,
  // which is quieter than the missing-label failure this map exists to surface.
  const BADGE = { photo: 'PHOTO', plate: 'PLATE', map: 'MAP', diagram: 'DIAGRAM', chart: 'CHART' };

  // Fix wave (final review): attachReveal's theme used to be a bare ternary,
  // `subject === 'hist' ? 'rv-hist' : 'rv-sci'`, so every non-history subject -- sci correctly,
  // but also ela, math, or none -- fell through to sci's green. engine/runner.js's STAMP_THEME
  // (a different mechanic on a different theming axis, so not shared with this map) already
  // solved this exact class for the correct-answer stamp with an explicit map plus a neutral
  // fallback; this is that same shape for the reveal strip. REVEAL_THEME_NEUTRAL gets its own
  // CSS rule beside .rv-hist/.rv-sci in engine.css, in a hue neither subject uses, so an ELA
  // pack's reveal cells still visibly mark "found" without borrowing either subject's color.
  const REVEAL_THEME = { hist: 'rv-hist', sci: 'rv-sci' };
  const REVEAL_THEME_NEUTRAL = 'rv-neutral';

  // Capped horizontal strip of figure thumbnails, appended to hostEl (the passage panel).  A
  // click opens the lightbox via api.openLightbox, resolved at call time so this keeps working
  // once that stub is replaced by its own task without renderStrip needing to change.
  function renderStrip(pack, figureIds, hostEl) {
    const figs = (figureIds || []).map(id => resolve(pack, id)).filter(Boolean);
    if (!figs.length || !hostEl) return null;
    const strip = el('div', 'mv-figs');
    for (const f of figs) {
      const b = el('button', 'mv-fig');
      b.type = 'button';
      if (f.caption) b.setAttribute('aria-label', f.caption);
      const img = el('img', 'mv-fig-img');
      img.setAttribute('alt', f.alt || '');
      img.setAttribute('loading', 'lazy');
      // A malformed plate (no views) falls back to f.src rather than throwing and dropping the
      // whole strip, matching the optional-layer stance the runner takes around this call.
      const src = f.kind === 'plate' ? ((f.views && f.views[0]) ? f.views[0].src : f.src) : f.src;
      img.setAttribute('src', src);
      b.appendChild(img);
      b.appendChild(el('span', 'mv-fig-badge', BADGE[f.kind] || ('?' + String(f.kind))));
      b.addEventListener('click', () => api.openLightbox(pack, f.id));
      strip.appendChild(b);
    }
    hostEl.appendChild(strip);
    return strip;
  }

  // Single figure rail above an item's stem. Unlike renderStrip's multi-figure horizontal strip,
  // an item carries at most one figureId, but that one figure is never decorative: validate-pack
  // rejects a photo here and requires a dataTable (checkFigureReferences), so every item figure
  // IS an assessed data figure the child must read, not just look at. Fix round 1 (controller
  // review): the rail was rendering that figure with no kind signal at all; it now carries the
  // SAME .mv-fig-badge pill renderStrip does (already styled, already tested there), so a chart
  // reads as CHART rather than as an unlabeled image. insertBefore-firstChild puts the whole rail
  // visually first without assuming how Items.render builds the stem/choices beneath it -- same
  // reasoning as the runner's own call-site comment. Click reaches api.openLightbox, resolved at
  // call time, same as renderStrip's thumb, so this keeps working once a later task replaces
  // that stub. loading="lazy" matches renderStrip's thumb too (fix round 1: the first version of
  // this function omitted it with no comment explaining why, which read as an oversight rather
  // than a choice -- there is no reason for this one thumb to fetch eagerly ahead of the item's
  // own text, so it is set explicitly rather than left an unstated divergence).
  function renderItemFigure(pack, figureId, itemBox) {
    const f = resolve(pack, figureId);
    if (!f || !itemBox) return;
    const wrap = el('div', 'mv-item-fig');
    const b = el('button', 'mv-fig');
    b.type = 'button';
    if (f.caption) b.setAttribute('aria-label', f.caption);
    const img = el('img', 'mv-fig-img');
    // Default matches the strip/lightbox/reveal-card convention: a figure missing alt renders
    // alt="", never the literal string "undefined".
    img.setAttribute('alt', f.alt || '');
    img.setAttribute('loading', 'lazy');
    // Same malformed-plate fallback as renderStrip: a plate with no views falls back to f.src
    // rather than throwing and dropping the whole rail.
    img.setAttribute('src', f.kind === 'plate' ? ((f.views && f.views[0]) ? f.views[0].src : f.src) : f.src);
    b.appendChild(img);
    b.appendChild(el('span', 'mv-fig-badge', BADGE[f.kind] || ('?' + String(f.kind))));
    b.addEventListener('click', () => api.openLightbox(pack, f.id));
    wrap.appendChild(b);
    itemBox.insertBefore(wrap, itemBox.firstChild || null);
  }

  // ---- lightbox + plate viewer ----
  // One dialog at a time: _lb is the currently-open node (or null), tracked here rather than
  // discovered by querying document.body, so a second open can unconditionally close the first.
  let _lb = null;
  function closeLightbox() {
    if (_lb && _lb.parentNode) _lb.parentNode.removeChild(_lb);
    _lb = null;
  }

  function openLightbox(pack, figureId) {
    const f = resolve(pack, figureId);
    if (!f) return;
    // Fix wave (final review): a malformed plate (kind:'plate' with no views) reached
    // `f.views.forEach` below unguarded and threw, unlike renderStrip/renderItemFigure/
    // renderRevealCard, which all fall back to f.src for the same shape. There is no single
    // f.src fallback here that would also produce a sensible tab-less viewer (the tab rail and
    // paint() both index into f.views), so this is a no-op tap -- closeLightbox() is not called
    // either, matching the `if (!f) return;` guard immediately above, which leaves a previously
    // open lightbox exactly as it was rather than closing it on a bad tap.
    if (f.kind === 'plate' && !(Array.isArray(f.views) && f.views.length)) return;
    closeLightbox();
    const d = doc();
    const box = el('div', 'mv-lightbox');
    const frame = el('div', 'mv-lb-frame');
    // The zoom target is this wrapper, not the image: the overlay is absolutely positioned
    // over it (see paint()), so scaling the wrapper scales the plate and its overlay as one
    // unit instead of leaving the overlay behind at frame size.
    const zoom = el('div', 'mv-lb-zoom');
    const img = el('img', 'mv-lb-img');
    img.setAttribute('alt', f.alt || '');

    const isPlate = f.kind === 'plate';
    let viewIdx = 0;
    // Held directly rather than discovered by querying the DOM: the tab rail is a sibling of
    // frame under box, not a descendant of frame, so a query scoped to frame would always
    // return empty and .active would never move.
    const tabNodes = [];
    // Same reasoning for the overlay: tracked here and swapped directly on view change,
    // rather than looked up by class each time.
    let overlayNode = null;

    function paint() {
      const v = isPlate ? f.views[viewIdx] : f;
      img.setAttribute('src', v.src);
      if (overlayNode) {
        if (overlayNode.parentNode) overlayNode.parentNode.removeChild(overlayNode);
        overlayNode = null;
      }
      if (isPlate && v.overlaySrc) {
        overlayNode = el('img', 'mv-lb-overlay');
        overlayNode.setAttribute('src', v.overlaySrc);
        overlayNode.setAttribute('alt', '');
        zoom.appendChild(overlayNode);
      }
      for (let i = 0; i < tabNodes.length; i++) tabNodes[i].classList.toggle('active', i === viewIdx);
    }

    if (isPlate) {
      const rail = el('div', 'mv-plate-tabs');
      f.views.forEach((v, i) => {
        const t = el('button', 'mv-plate-tab', v.label);
        t.type = 'button';
        t.addEventListener('click', (e) => { e.stopPropagation(); viewIdx = i; paint(); });
        tabNodes.push(t);
        rail.appendChild(t);
      });
      box.appendChild(rail);
    }

    zoom.appendChild(img);
    frame.appendChild(zoom);
    box.appendChild(frame);
    box.appendChild(el('div', 'mv-lb-cap', f.caption));
    box.appendChild(el('div', 'mv-lb-credit', f.credit));

    // Double-tap toggles zoom; a single tap on the image must not also close the lightbox, so
    // it stops propagation the same as a tab tap does.
    let lastTap = 0;
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      const now = Date.now();
      if (now - lastTap < 350) zoom.classList.toggle('zoomed');
      lastTap = now;
    });
    box.addEventListener('click', closeLightbox);

    d.body.appendChild(box);
    _lb = box;
    paint();
  }

  // ---- reveal: per-question bar cells + completion-screen cover reveal ----

  // Called once per level, from the chrome build (not per question): the strip must persist
  // and accumulate `found` cells across every question in the level, not be rebuilt each time.
  // `level.reveal` alone deciding null vs. a strip -- not the caller -- is deliberate: the
  // runner calls this unconditionally whenever MVFigures resolves, exactly like renderStrip and
  // closeLightbox, so a reveal-less level's call is a normal no-op rather than a branch the
  // runner has to know about.
  function attachReveal(barEl, pack, level, total) {
    if (!barEl || !level || !level.reveal) return null;
    const f = resolve(pack, level.reveal.figureId);
    if (!f) return null;
    const theme = (REVEAL_THEME[pack.meta && pack.meta.subject]) || REVEAL_THEME_NEUTRAL;
    const strip = el('span', 'mv-reveal-strip ' + theme);
    const cells = [];
    for (let i = 0; i < total; i++) {
      const c = el('span', 'mv-rv-cell');
      cells.push(c);
      strip.appendChild(c);
    }
    // Between prog and hearts, not after both: .mv-bar is justify-content: space-between, so
    // three children spread evenly instead of the strip crowding against the hearts.
    barEl.insertBefore(strip, barEl.children[1] || null);
    // Owner ruling (26-0811, partial reveal): `found` is a count, not just a class, because the
    // completion card needs to know HOW MUCH of the artifact this attempt earned, not merely
    // whether it earned anything. Tracked here rather than recomputed by a caller counting
    // `.found` cells after the fact, since this closure already owns `cells` and is the single
    // place a cell ever becomes found. The classList check makes both the DOM state and the
    // counter idempotent together: calling onCorrect(i) twice for the same i (should never
    // happen -- the runner grades each question index once -- but is cheap to guard) neither
    // re-adds the class nor double-counts it.
    let found = 0;
    return {
      // A wrong answer must never call this: no branch here removes or dims a `found` cell, and
      // the ONLY caller (engine/runner.js submit(), the result.correct branch) enforces that a
      // miss never reaches onCorrect at all. The reveal is not punitive; a retry after three
      // wrong answers can still earn every cell.
      onCorrect(i) {
        if (cells[i] && !cells[i].classList.contains('found')) { cells[i].classList.add('found'); found++; }
      },
      foundCount() { return found; },
    };
  }

  // Renders the completion-screen cover reveal: the figure under a 12-tile grid that lifts away.
  // Returns false (and appends nothing) for a reveal-less level, an unresolvable figureId, a
  // missing host, or (owner ruling, 26-0811) a foundRatio of exactly 0, matching the boolean
  // contract Task 1's stub already established for this function -- callers
  // (Math-Multiverse.html's showPackLevelComplete) branch on the return value the same way
  // renderStrip's callers branch on null.
  //
  // Owner ruling (26-0811, partial reveal): a level can clear zero stars (lives ran out) after
  // still earning some cells, and those earned cells must not simply vanish -- the old behaviour
  // gated this whole card on `stars > 0`, which is the defect being fixed. `foundRatio` is how
  // much of THIS attempt's reveal was actually earned (cells found / total questions, computed
  // by the caller from the same reveal handle attachReveal returned -- see engine/runner.js
  // finish()), not persisted anywhere and not re-derived from save state.
  function renderRevealCard(pack, levelIndex, hostEl, foundRatio) {
    const level = pack && pack.levels && pack.levels[levelIndex];
    if (!level || !level.reveal || !hostEl) return false;
    const f = resolve(pack, level.reveal.figureId);
    if (!f) return false;
    // Defaults to 1 ("all") when omitted, matching every call site written before this ruling
    // (this file's own unit tests included) so they keep today's full-lift behaviour with no
    // change on their part -- the seam is additive, not a breaking change to the function's
    // existing contract.
    const ratio = (foundRatio === undefined || foundRatio === null) ? 1 : Math.max(0, Math.min(1, foundRatio));
    if (ratio <= 0) return false;   // nothing earned: no artifact, no card -- never premature
    const card = el('div', 'mv-rv-card');
    const frame = el('div', 'mv-rv-frame');
    const img = el('img', 'mv-rv-img');
    // Fix round 1, item 7: matches renderStrip's and renderItemFigure's identical guard. A
    // malformed plate (no views) falls back to f.src rather than dereferencing `f.views[0]`
    // unguarded and throwing before the guard function around this call even gets a chance to
    // catch it (renderRevealCard is called directly from Math-Multiverse.html, not through the
    // runner's own try/catch wrapper).
    img.setAttribute('src', f.kind === 'plate' ? ((f.views && f.views[0]) ? f.views[0].src : f.src) : f.src);
    // Default matches the strip/lightbox convention: a figure missing alt renders alt="",
    // never the literal string "undefined".
    img.setAttribute('alt', f.alt || '');

    // Stable and deterministic, not random: lifting the FIRST N tiles in grid order means a
    // child who retries sees the SAME region already open rather than a reshuffled cover, which
    // matches the reveal bar's own additive, never-punitive cells (attachReveal above). A ratio
    // that rounds down to zero (a tiny nonzero fraction on a long level) still lifts one tile --
    // "any cell found" must never look identical to "none found" once the caller has already
    // decided this card renders at all.
    const tilesToLift = ratio >= 1 ? 12 : Math.max(1, Math.round(ratio * 12));
    const fullyRevealed = tilesToLift >= 12;

    // Owner ruling (26-0811, enlargeable reward): tap-to-enlarge is wired ONLY once every tile
    // has lifted. openLightbox shows the whole, uncovered figure with no cover grid of its own --
    // wiring the tap while tiles still cover part of the card would let a single tap skip past
    // the "earn the rest on retry" incentive this whole mechanic exists for, before the child has
    // actually earned it. A partial card's image stays a plain, inert <img>, same as before this
    // ruling landed.
    if (fullyRevealed) {
      const btn = el('button', 'mv-rv-img-btn');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Enlarge ' + (f.caption || 'the revealed figure'));
      btn.appendChild(img);
      // Resolved at call time via api, same as renderStrip's and renderItemFigure's thumb click:
      // keeps working once openLightbox is replaced again, with no capture-time coupling.
      btn.addEventListener('click', () => api.openLightbox(pack, f.id));
      frame.appendChild(btn);
    } else {
      frame.appendChild(img);
    }

    const grid = el('div', 'mv-rv-grid');
    for (let i = 0; i < 12; i++) grid.appendChild(el('span', 'mv-rv-tile'));
    frame.appendChild(grid);
    card.appendChild(frame);
    card.appendChild(el('div', 'mv-rv-cap', f.caption));
    card.appendChild(el('div', 'mv-lb-credit', f.credit));
    hostEl.appendChild(card);
    // These timers are deliberately NOT collected or cancelled. A child can tap Retry/Levels
    // mid-animation, which replaces hostEl's innerHTML (Math-Multiverse.html's completion-card
    // branch) and detaches grid's tiles while these still fire; adding a class to a detached node
    // is harmless, so nothing breaks. Unlike engine/runner.js, which collects its own timeouts
    // (runner.js:134-136) because it must clear() a still-mounted level on cleanup, this card has
    // no cleanup hook to run a disposer from and no caller ever holds a reference to cancel one,
    // so a disposer here would be dead code the harness cannot exercise honestly.
    //
    // Only the first `tilesToLift` tiles ever get a timer at all -- a tile beyond that count is
    // simply never touched, so it stays covering the artifact rather than being lifted and never
    // un-lifted (there is no "punitive" branch to write here; the never-earned tiles just never
    // enter the loop).
    const tiles = grid.children;
    for (let i = 0; i < tilesToLift; i++) {
      (function (t, i) { setTimeout(() => t.classList.add('away'), 120 + i * 90); })(tiles[i], i);
    }
    return true;
  }

  const api = { setEnv, resolve, el, FIG_KINDS, DOC_KINDS, TOKENS,
    renderStrip, renderItemFigure,
    openLightbox, closeLightbox,
    attachReveal, renderRevealCard };
  return api;
});
