'use strict';
// shells.js -- Task 7 shell/template hygiene gate (gate:"shells" in freshness-allowlist.json).
//
// Two checks:
//
// 1. STATIC SCAN: every `text: pick([...])` / `prompt: pick([...])` shell/template array in each
//    of the six module source slices is walked with a small state-machine tokenizer (quote/
//    backtick/${...} depth aware -- these are multi-line template literals that can nest ${...}
//    interpolation, which a single regex cannot safely parse) looking for a literal digit OUTSIDE
//    any interpolation. A digit inside ${...} references a real variable (allowed); a bare digit
//    in the surrounding prose is a constant baked into what is supposed to be a purely-cosmetic
//    phrasing template. For check-less/prose-signature topics (MVFresh.sigOf's fallback path),
//    that constant gets swept into the dedup signature's number-set on every render -- a real,
//    if narrow, false-collision-risk surface, not just a style nit. Verified empirically against
//    every hit this scanner currently finds (see task-7-report.md).
//
// 2. BEHAVIORAL CHECK: proves sigOf is actually shell-invariant on REAL production question
//    shapes (not just the toy objects freshness.js's own unit test constructs) -- one
//    check-carrying driver and one prose/check-less driver, each cloned with only its
//    shell-selected field (text/prompt) swapped for different text, asserting one identical
//    signature both times.
//
// Ratchet against tests/freshness-allowlist.json ({driver, gate:"shells", reason} entries), one
// entry per OFFENDING ARRAY (id = "<moduleId>.L<sourceLine>", not per offending element inside
// it -- an array with several bad elements is one finding, at the granularity of "this template
// family needs a pass," matching the other two gates' "one entry per unit of content" shape).
// Same ratchet semantics as freshness-lib.js/freshness-sim.js: unlisted array with a hit ->
// FAILURE; listed array now clean -> FAILURE (stale, delete it); listed array still dirty -> OK,
// EXPECTED-FAIL; empty allowlist -> full enforcement. Zero shell arrays found at all -> FAIL
// LOUDLY (no-packs-must-fail house rule).

const fs = require('fs');
const path = require('path');
const { loadModules, buildDrivers, MODULES, HTML_PATH } = require('./extract.js');

const ALLOWLIST_PATH = path.join(__dirname, 'freshness-allowlist.json');

function loadAllowlistFor(gateName) {
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('freshness-allowlist.json must be a JSON array');
  return raw.filter((e) => e.gate === gateName);
}

// Re-slices one module's IIFE body the same way extract.js's own (unexported) sliceBody does.
// Deliberately duplicated rather than exporting extract.js's internal for this one caller --
// Task 7's file scope is Create-only for this file; extract.js is not on the modify list.
function sliceBody(src, marker) {
  const mIdx = src.indexOf(marker);
  if (mIdx < 0) throw new Error('shells: marker not found: ' + marker);
  const OPEN = '(function() {';
  const openIdx = src.indexOf(OPEN, mIdx);
  if (openIdx < 0) throw new Error('shells: IIFE opener not found after ' + marker);
  const bodyStart = openIdx + OPEN.length;
  const closeIdx = src.indexOf('\n})();', bodyStart);
  if (closeIdx < 0) throw new Error('shells: IIFE closer not found after ' + marker);
  return { body: src.slice(bodyStart, closeIdx), bodyStart };
}

// Walk one module body for `text:`/`prompt: pick([...])` shell arrays. Returns
// [{ key, start, elements: [{ raw, hasDigitOutsideInterp }] }]. Hand-rolled rather than
// regex-only: verified against every current shell array in the file (57 across the six
// modules, 249 elements total), including confirming no shell interpolation in this codebase
// currently nests brackets inside ${...} -- but the walk tracks interpolation brace-depth
// explicitly rather than assuming that stays true forever.
function scanShells(body) {
  const shellStartRe = /\b(text|prompt)\s*:\s*pick\(\s*\[/g;
  const results = [];
  let m;
  while ((m = shellStartRe.exec(body))) {
    const key = m[1];
    let i = m.index + m[0].length; // just past the '['
    let depth = 1;
    const elements = [];
    let cur = null;       // { quote, raw, hasDigitOutsideInterp }
    let interpDepth = 0;  // brace depth while inside a backtick's ${...}
    while (i < body.length && depth > 0) {
      const c = body[i];
      if (cur === null) {
        if (c === '[') { depth++; i++; continue; }
        if (c === ']') { depth--; i++; continue; }
        if (c === "'" || c === '"' || c === '`') { cur = { quote: c, raw: '', hasDigitOutsideInterp: false }; i++; continue; }
        i++; // whitespace / commas between elements
        continue;
      }
      if (cur.quote === '`') {
        if (interpDepth === 0) {
          if (c === '\\') { cur.raw += c + (body[i + 1] || ''); i += 2; continue; }
          if (c === '`') { elements.push(cur); cur = null; i++; continue; }
          if (c === '$' && body[i + 1] === '{') { interpDepth = 1; cur.raw += '${'; i += 2; continue; }
          if (/[0-9]/.test(c)) cur.hasDigitOutsideInterp = true;
          cur.raw += c; i++; continue;
        }
        if (c === '{') { interpDepth++; cur.raw += c; i++; continue; }
        if (c === '}') { interpDepth--; cur.raw += c; i++; continue; }
        cur.raw += c; i++; continue; // digits inside ${...} are allowed
      } else {
        if (c === '\\') { cur.raw += c + (body[i + 1] || ''); i += 2; continue; }
        if (c === cur.quote) { elements.push(cur); cur = null; i++; continue; }
        if (/[0-9]/.test(c)) cur.hasDigitOutsideInterp = true;
        cur.raw += c; i++; continue;
      }
    }
    results.push({ key, start: m.index, elements });
  }
  return results;
}

function padR(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

// ---- 1. static scan ----
const src = fs.readFileSync(HTML_PATH, 'utf8');
let totalArrays = 0;
const findings = []; // { id, module, line, key, offenders: [raw, ...] }
for (const mod of MODULES) {
  const { body, bodyStart } = sliceBody(src, mod.marker);
  const shells = scanShells(body);
  totalArrays += shells.length;
  for (const sh of shells) {
    const offenders = sh.elements.filter((el) => el.hasDigitOutsideInterp).map((el) => el.raw);
    if (offenders.length) {
      const absPos = bodyStart + sh.start;
      const line = src.slice(0, absPos).split('\n').length;
      findings.push({ id: mod.id + '.L' + line, module: mod.id, line, key: sh.key, offenders });
    }
  }
}
if (totalArrays === 0) {
  console.log('FAIL: zero shell/template arrays found across all six modules (extraction broken -- refusing to report a clean gate on nothing)');
  process.exit(1);
}

console.log('=== shells: static literal-digit scan (' + totalArrays + ' shell arrays across 6 modules) ===');

const allowlist = loadAllowlistFor('shells');
const allowlistByDriver = new Map(allowlist.map((e) => [e.driver, e]));
const seenAllowlistDrivers = new Set();
let gateFail = false;

if (!findings.length) {
  console.log('  no literal-digit-outside-interpolation hits in any shell array.');
} else {
  for (const f of findings) {
    const entry = allowlistByDriver.get(f.id);
    let verdict;
    if (entry) {
      seenAllowlistDrivers.add(f.id);
      verdict = 'EXPECTED-FAIL (' + entry.reason + ')';
    } else {
      verdict = 'FAIL (unlisted)';
      gateFail = true;
    }
    console.log('  ' + padR(f.id, 26) + padR(f.key, 8) + verdict);
    for (const o of f.offenders.slice(0, 3)) console.log('      ' + JSON.stringify(o.length > 100 ? o.slice(0, 100) + '...' : o));
    if (f.offenders.length > 3) console.log('      ... and ' + (f.offenders.length - 3) + ' more element(s) in this array');
  }
}

// An allowlisted array that is now CLEAN (digits fixed) or whose id no longer matches anything is
// a stale entry -- same ratchet obligation as the other two gates: delete it.
for (const e of allowlist) {
  if (!seenAllowlistDrivers.has(e.driver)) {
    console.log('FAIL: allowlist entry "' + e.driver + '" (gate:shells) is stale -- no current finding matches it. Delete the entry.');
    gateFail = true;
  }
}

// ---- 2. behavioral check: sigOf is shell-invariant on real production question shapes ----
console.log('=== shells: behavioral check (MVFresh.sigOf shell-invariance via real drivers) ===');
// extraGlobals: {} (truthy opts, nothing to actually inject) is enough to make buildDrivers
// attach driver.sandbox so .sigOf is reachable. Math is left real: this check never calls
// drawRun, only the pure sigOf(), so no seeding is needed.
const behaviorDrivers = buildDrivers(loadModules(), { extraGlobals: {} });
const checkCarrying = behaviorDrivers.find((d) => d.moduleId === 'master-builder' && d.grade === 6 && d.levelIndex === 0);
const prose = behaviorDrivers.find((d) => d.moduleId === 'fraction-rider' && d.grade === 5 && d.levelIndex === 0);
if (!checkCarrying || !prose) throw new Error('shells: could not locate the expected check-carrying/prose drivers for the behavioral check');

// Draws up to `attempts` times looking for a question matching expectCheck's shape. Both chosen
// drivers are empirically 100% consistent (master-builder.g6.i0 is check.op:'mul' on every one of
// 7500 sampled draws in freshness-lib.js's own table; fraction-rider.g5.i0's whole 'like-denom'
// dispatch family is check-less by source inspection), so this should always resolve on the first
// try -- the retry loop is defensive against a future content change silently making either
// driver's dispatch a mixed/catch-all, rather than a signal this is expected to be flaky today.
function drawMatching(driver, expectCheck, attempts) {
  for (let i = 0; i < attempts; i++) {
    const q = driver.make();
    const hasCheck = !!(q && q.check && typeof q.check === 'object');
    if (hasCheck === expectCheck) return q;
  }
  return null;
}

function assertShellInvariant(driver, label, expectCheck) {
  const F = driver.sandbox.MVFresh;
  const q = drawMatching(driver, expectCheck, 25);
  if (!q) {
    throw new Error('shells: could not find a ' + (expectCheck ? 'check-carrying' : 'check-less') + ' draw from ' + label +
      ' (' + driver.moduleId + '.g' + driver.grade + '.i' + driver.levelIndex + ') in 25 attempts -- pick a different driver');
  }
  const shellField = 'text' in q ? 'text' : 'prompt';
  const q2 = Object.assign({}, q, { [shellField]: (q[shellField] || '') + ' -- a completely different shell rendering of the exact same item' });
  const sigA = F.sigOf(q);
  const sigB = F.sigOf(q2);
  if (sigA !== sigB) {
    console.log('  FAIL ' + label + ' (' + driver.moduleId + '.g' + driver.grade + '.i' + driver.levelIndex + '): two renders of one item with different shells produced DIFFERENT signatures');
    return false;
  }
  console.log('  ok ' + label + ' (' + driver.moduleId + '.g' + driver.grade + '.i' + driver.levelIndex + ', ' + shellField + '): shell-invariant');
  return true;
}

if (!assertShellInvariant(checkCarrying, 'check-carrying generator', true)) gateFail = true;
if (!assertShellInvariant(prose, 'prose generator', false)) gateFail = true;

if (gateFail) { console.log('RESULT: FAIL'); process.exit(1); }
console.log('RESULT: ALL CLEAN (' + totalArrays + ' shell arrays scanned, ' + findings.length + ' with findings, ' + allowlist.length + ' allowlisted)');
