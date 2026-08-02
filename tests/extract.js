'use strict';
// extract.js -- pull each module's IIFE body out of Math-Multiverse.html and evaluate it in an
// isolated Node `vm` sandbox (NO browser, NO third-party deps), exposing the exact generators,
// level configs, and dispatch tables the game's init() uses. This lets the fuzz harness drive
// the REAL code path for every question without a DOM.
//
// Module boundaries are found dynamically: the `// MODULE N:` banner, then the first
// `(function() {` after it, then the next `\n})();` (the IIFE closer at column 0). Never
// hard-coded line numbers -- if the file is reshaped, slicing tracks the markers.
//
// HARD RULE (k8s-thinking): a load/extraction failure MUST throw. A harness that silently
// finds nothing must never report "clean".

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, '..', 'Math-Multiverse.html');

// Source order of the six themed modules.
const MODULES = [
  { id: 'fraction-rider',   marker: '// MODULE 1' },
  { id: 'f1-decimals',      marker: '// MODULE 2' },
  { id: 'razor-crest',      marker: '// MODULE 3' },
  { id: 'master-builder',   marker: '// MODULE 4' },
  { id: 'rocky-translator', marker: '// MODULE 5' },
  { id: 'floating-bear',    marker: '// MODULE 6' },
];

// Names the harness wants to capture out of each module's closure scope. Each module yields
// only the subset it actually declares; the rest throw ReferenceError and are skipped.
const CAPTURE_NAMES = [
  // shared prelude
  'MVFresh',
  // fraction-rider
  'FR_LEVELS', 'FR_LEVELS_6', 'genForLevel', 'makeChoices',
  // f1-decimals
  'F1_LEVELS', 'F1_LEVELS_6', 'GEN_BY_TYPE',
  // razor-crest
  'RC_LEVELS', 'RC_LEVELS_6', 'genQuestion',
  // master-builder
  'MB_LEVELS', 'MB_LEVELS_6', 'MB_GEN', 'BUILDERS',
  // rocky-translator
  'RK_LEVELS', 'RK_LEVELS_6', 'RK_GEN',
  // floating-bear
  'FB_LEVELS', 'FB_LEVELS_6', 'FB_GEN',
];

function sliceBody(src, marker) {
  const mIdx = src.indexOf(marker);
  if (mIdx < 0) throw new Error(`extract: marker not found: ${marker}`);
  const OPEN = '(function() {';
  const openIdx = src.indexOf(OPEN, mIdx);
  if (openIdx < 0) throw new Error(`extract: IIFE opener not found after ${marker}`);
  const bodyStart = openIdx + OPEN.length;
  const closeIdx = src.indexOf('\n})();', bodyStart);
  if (closeIdx < 0) throw new Error(`extract: IIFE closer not found after ${marker}`);
  const body = src.slice(bodyStart, closeIdx);
  if (body.length < 1000) throw new Error(`extract: suspiciously small body for ${marker} (${body.length} chars)`);
  return body;
}

// A few helpers (pedDistractors, pedDistractorsFloat) are defined ONCE at shell scope, just
// above MODULE 1, and reused by several module IIFEs. Slice that shared region dynamically and
// prepend it to every module body so the generators run with the REAL distractor logic.
function sharedPrelude(src) {
  const START = 'function pedDistractors(';
  const sIdx = src.indexOf(START);
  if (sIdx < 0) throw new Error('extract: shared prelude (pedDistractors) not found');
  const endIdx = src.indexOf('// MODULE 1', sIdx);
  if (endIdx < 0) throw new Error('extract: end of shared prelude (// MODULE 1) not found');
  const prelude = src.slice(sIdx, endIdx);
  if (!/function pedDistractorsFloat\(/.test(prelude)) {
    throw new Error('extract: shared prelude missing pedDistractorsFloat');
  }
  return prelude;
}

// Evaluate one module body and return its captured exports.
function evalModule(body, id, prelude, opts) {
  const epilogue = `
;globalThis.__MOD_EXPORTS = {};
;{
  const __names = ${JSON.stringify(CAPTURE_NAMES)};
  for (const __n of __names) {
    try { globalThis.__MOD_EXPORTS[__n] = eval(__n); } catch (e) { /* not in this module */ }
  }
}
;globalThis.MVFresh = typeof MVFresh !== 'undefined' ? MVFresh : undefined;
`;
  // Seed only the genuine shell-level free variables the module bodies reference. JS intrinsics
  // (Math, JSON, Array, Date, ...) are already present in a vm context.
  const sandbox = {
    InlineModules: {},
    ACTIVE_GRADE: 5,
    console,
  };
  // Injected sandbox globals (spy localStorage, seeded Math, ...) merge in BEFORE the prelude
  // evaluates, so freshness code that reads them at module-load time sees the injected version.
  Object.assign(sandbox, opts && opts.extraGlobals || {});
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext((prelude || '') + '\n' + body + epilogue, sandbox, { filename: `module:${id}`, timeout: 15000 });
  } catch (e) {
    throw new Error(`extract: module ${id} failed to evaluate: ${(e && e.stack) || e}`);
  }
  const exp = sandbox.__MOD_EXPORTS;
  if (!exp || Object.keys(exp).length === 0) {
    throw new Error(`extract: module ${id} captured nothing (extraction broken)`);
  }
  // Hidden handle back to the raw sandbox so buildDrivers can expose it as driver.sandbox. Gated
  // behind opts so a bare loadModules() return shape stays byte-identical to before this feature.
  if (opts) exp.__sandbox = sandbox;
  return exp;
}

function loadModules(opts) {
  const src = fs.readFileSync(HTML_PATH, 'utf8');
  const prelude = sharedPrelude(src);
  const out = {};
  for (const m of MODULES) {
    out[m.id] = evalModule(sliceBody(src, m.marker), m.id, prelude, opts);
  }
  return out;
}

// Build a uniform driver per module: a list of { grade, level, gen, make() } entries, where
// make() invokes the REAL dispatch exactly as the game's init() does.
function buildDrivers(mods, opts) {
  // Only extraGlobals actually requires a reload: it must merge into the vm context BEFORE the
  // prelude evaluates, and the sandboxes behind an already-loaded mods are already fully evaluated
  // by now. Any other/empty opts, and a bare buildDrivers(mods), reuse mods exactly as before.
  const effectiveMods = (opts && opts.extraGlobals) ? loadModules(opts) : mods;
  const drivers = [];

  function add(moduleId, grade, levelsArr, makeFor) {
    if (!Array.isArray(levelsArr)) return;
    levelsArr.forEach((level, idx) => {
      const rec = {
        moduleId, grade, levelIndex: idx,
        gen: level && level.gen, levelName: level && level.name,
        make: () => makeFor(level),
      };
      // Only attach when opts was passed -- a bare buildDrivers(mods) driver keeps the original
      // six-key shape byte-identical: no leaked sandbox handle, still safely JSON-serializable
      // (the vm sandbox is self-referential via sandbox.globalThis === sandbox).
      if (opts) rec.sandbox = effectiveMods[moduleId] && effectiveMods[moduleId].__sandbox;
      drivers.push(rec);
    });
  }

  // fraction-rider: genForLevel(levelObject)
  const fr = effectiveMods['fraction-rider'];
  add('fraction-rider', 5, fr.FR_LEVELS,   (lvl) => fr.genForLevel(lvl));
  add('fraction-rider', 6, fr.FR_LEVELS_6, (lvl) => fr.genForLevel(lvl));

  // f1-decimals: GEN_BY_TYPE[lvl.gen]()
  const f1 = effectiveMods['f1-decimals'];
  add('f1-decimals', 5, f1.F1_LEVELS,   (lvl) => f1.GEN_BY_TYPE[lvl.gen]());
  add('f1-decimals', 6, f1.F1_LEVELS_6, (lvl) => f1.GEN_BY_TYPE[lvl.gen]());

  // razor-crest: genQuestion(levelObject)
  const rc = effectiveMods['razor-crest'];
  add('razor-crest', 5, rc.RC_LEVELS,   (lvl) => rc.genQuestion(lvl));
  add('razor-crest', 6, rc.RC_LEVELS_6, (lvl) => rc.genQuestion(lvl));

  // master-builder: MB_GEN[lvl.gen](builderId)
  const mb = effectiveMods['master-builder'];
  const builderId = (mb.BUILDERS && mb.BUILDERS[0] && mb.BUILDERS[0].id) || 'EMM';
  add('master-builder', 5, mb.MB_LEVELS,   (lvl) => mb.MB_GEN[lvl.gen](builderId));
  add('master-builder', 6, mb.MB_LEVELS_6, (lvl) => mb.MB_GEN[lvl.gen](builderId));

  // rocky-translator: RK_GEN[lvl.gen]()
  const rk = effectiveMods['rocky-translator'];
  add('rocky-translator', 5, rk.RK_LEVELS,   (lvl) => rk.RK_GEN[lvl.gen]());
  add('rocky-translator', 6, rk.RK_LEVELS_6, (lvl) => rk.RK_GEN[lvl.gen]());

  // floating-bear: FB_GEN[lvl.gen]()
  const fb = effectiveMods['floating-bear'];
  add('floating-bear', 5, fb.FB_LEVELS,   (lvl) => fb.FB_GEN[lvl.gen]());
  add('floating-bear', 6, fb.FB_LEVELS_6, (lvl) => fb.FB_GEN[lvl.gen]());

  return drivers;
}

module.exports = { loadModules, buildDrivers, MODULES, CAPTURE_NAMES, HTML_PATH };
