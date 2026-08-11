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

  const api = { setEnv, resolve, el, FIG_KINDS, DOC_KINDS, TOKENS,
    renderStrip, renderItemFigure: function () {},
    openLightbox: function () {}, closeLightbox: function () {},
    attachReveal: function () { return null; }, renderRevealCard: function () { return false; } };
  return api;
});
