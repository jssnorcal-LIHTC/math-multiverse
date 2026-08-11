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

  return { setEnv, resolve, el, FIG_KINDS, DOC_KINDS, TOKENS,
    renderStrip: function () {}, renderItemFigure: function () {},
    openLightbox: function () {}, closeLightbox: function () {},
    attachReveal: function () { return null; }, renderRevealCard: function () { return false; } };
});
