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
//    phrasing template.
//
//    ENFORCEMENT IS SCOPED TO CHECK-LESS GENERATORS ONLY (controller ruling on this task). The
//    ban's entire purpose is signature hygiene: for check-less/prose-signature topics,
//    MVFresh.sigOf's fallback path extracts every digit out of text/prompt into the dedup
//    signature's number-set, so a hardcoded digit is a real (if narrow) false-collision-risk
//    surface. But sigOf NEVER reads text/prompt for a check-carrying item (it hashes the check
//    object instead), so a hardcoded digit inside a check-carrying generator's shell is
//    structurally inert -- it cannot affect any signature, ever. Enforcing the ban there would be
//    punishing a violation with no mechanism, not signature hygiene. So: every shell array is
//    scanned, but a hit inside a check-carrying generator prints as an INFO line and never fails
//    the gate; a hit inside a check-less generator is a real enforcement failure. This is
//    spec-faithful narrowing to where the rule has effect, not a weakening of the rule itself --
//    no digit pattern (ordinals, proper nouns, etc.) is exempted within check-less generators.
//
//    Each shell array's enclosing generator function is found via a small brace-matching scanner
//    (codeOnly/findMatchingBrace/findFunctionSpans below), and classified check-carrying iff its
//    own function body contains a `check: {` object-literal key. Verified directly against source
//    for every one of the 11 shell arrays this scanner currently flags (see task-7-report.md):
//    9 are check-less (enforced), 2 are check-carrying (info-only) -- f1-decimals's
//    genG6DecDivide and genG6UnitRate, both of which hardcode "(2 dp)" in a shell that sigOf never
//    reads because both carry a `check: { op: 'div', ... }` object.
//
// 2. BEHAVIORAL CHECK: proves sigOf is actually shell-invariant on REAL production question
//    shapes (not just the toy objects freshness.js's own unit test constructs) -- one
//    check-carrying driver and one prose/check-less driver, each cloned with only its
//    shell-selected field (text/prompt) swapped for different text, asserting one identical
//    signature both times.
//
// Ratchet against tests/freshness-allowlist.json ({driver, gate:"shells", reason} entries), one
// entry per OFFENDING CHECK-LESS ARRAY. STABLE id = "<moduleId>.<generatorFunctionName>" (never a
// line number -- line numbers shift every time the file is edited, which would silently orphan
// allowlist entries or misattribute new ones). An array with several bad elements is still one
// finding, at the granularity of "this template family needs a pass." Same ratchet semantics as
// freshness-lib.js/freshness-sim.js: unlisted array with a hit -> FAILURE; listed array now clean
// -> FAILURE (stale, delete it); listed array still dirty -> OK, EXPECTED-FAIL; empty allowlist ->
// full enforcement. Zero shell arrays found at all -> FAIL LOUDLY (no-packs-must-fail house rule).

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

// Same-length blank-out of string/template literals and `//` line comments: every character
// inside quoted or commented content becomes a space, every real-code character (including
// braces and keywords) stays at its ORIGINAL index. This lets findMatchingBrace and the
// check-carrying regex both operate as if the text had no quotes or comments at all, without
// losing position-correspondence back to the real source (needed for accurate line numbers and
// for slicing the real body text). Verified against all six modules: zero regex literals and zero
// block comments in the generator-function region (grepped directly before relying on this), so
// the only two constructs that needed handling here -- strings/templates and `//` comments -- are
// the only two this function handles.
function codeOnly(text) {
  const chars = text.split('');
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') { chars[i] = ' '; i++; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      chars[i] = ' '; i++;
      while (i < chars.length && chars[i] !== quote) {
        if (chars[i] === '\\' && i + 1 < chars.length) { chars[i] = ' '; i++; }
        chars[i] = ' '; i++;
      }
      if (i < chars.length) { chars[i] = ' '; i++; }
      continue;
    }
    i++;
  }
  return chars.join('');
}

// codeText[openIdx] must be '{'. Returns the index of the matching '}'.
function findMatchingBrace(codeText, openIdx) {
  let depth = 0, i = openIdx;
  while (i < codeText.length) {
    const c = codeText[i];
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; if (depth === 0) return i - 1; continue; }
    i++;
  }
  throw new Error('shells: unmatched brace starting at ' + openIdx);
}

// Finds every NAMED `function name(...) { ... }` in a module body (arrow functions and anonymous
// function expressions are deliberately excluded -- shell-bearing generators in this codebase are
// always named top-level declarations, and excluding anonymous ones avoids misattributing a shell
// to an unrelated inline callback). Returns [{ name, start, bodyStart, bodyEnd }], bodyEnd being
// the matching closing brace. Operates on codeOnly(body) so string/comment content can never be
// mistaken for a brace or for the `function` keyword itself.
function findFunctionSpans(body) {
  const code = codeOnly(body);
  const fnRe = /\bfunction\s+(\w+)\s*\(/g;
  const spans = [];
  let m;
  while ((m = fnRe.exec(code))) {
    const parenClose = code.indexOf(')', m.index);
    const braceOpen = code.indexOf('{', parenClose);
    if (braceOpen < 0) continue;
    const braceClose = findMatchingBrace(code, braceOpen);
    spans.push({ name: m[1], start: m.index, bodyStart: braceOpen, bodyEnd: braceClose });
  }
  return spans;
}

// Innermost function whose span contains `pos` (smallest span wins if more than one contains it;
// in practice these generator functions do not nest, but this stays correct if that ever changes).
function enclosingFunction(spans, pos) {
  let best = null;
  for (const s of spans) {
    if (pos >= s.start && pos <= s.bodyEnd) {
      if (!best || (s.bodyEnd - s.start) < (best.bodyEnd - best.start)) best = s;
    }
  }
  return best;
}

// A function is check-carrying iff its own body contains a `check: {` object-literal key, checked
// against codeOnly(body) so a shell string that happened to contain the word "check" can never
// cause a false positive.
function isCheckCarrying(body, span) {
  const code = codeOnly(body);
  return /\bcheck\s*:\s*\{/.test(code.slice(span.bodyStart, span.bodyEnd));
}

// Walk one module body for `text:`/`prompt: pick([...])` shell arrays. Returns
// [{ key, start, elements: [{ raw, hasDigitOutsideInterp }] }]. Hand-rolled rather than
// regex-only: verified against every current shell array in the file (57 across the six
// modules, 249 elements total), including confirming no shell interpolation in this codebase
// currently nests brackets inside ${...} -- but the walk tracks interpolation brace-depth
// explicitly rather than assuming that stays true forever. Operates on the ORIGINAL body text
// (not codeOnly), since it needs the real string contents to find the digits themselves.
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

// ---- 1. static scan, classified by enclosing generator ----
const src = fs.readFileSync(HTML_PATH, 'utf8');
let totalArrays = 0, totalFunctions = 0;
const enforced = [];   // check-less hits: { id, module, fn, line, key, offenders }
const infoOnly = [];   // check-carrying hits: same shape, never fails the gate
for (const mod of MODULES) {
  const { body, bodyStart } = sliceBody(src, mod.marker);
  const spans = findFunctionSpans(body);
  totalFunctions += spans.length;
  const shells = scanShells(body);
  totalArrays += shells.length;
  for (const sh of shells) {
    const offenders = sh.elements.filter((el) => el.hasDigitOutsideInterp).map((el) => el.raw);
    if (!offenders.length) continue;
    const fn = enclosingFunction(spans, sh.start);
    const line = src.slice(0, bodyStart + sh.start).split('\n').length;
    if (!fn) {
      // A shell array with no enclosing named function is an analysis failure, not a clean bill
      // of health -- fail loudly rather than silently skip it.
      console.log('FAIL: could not determine the enclosing generator for a shell array at ' + mod.id + ' line ' + line + ' -- function-span detection is broken or this array lives outside any named function');
      totalArrays = -1; // force the zero-arrays FAIL path below to also catch this
      break;
    }
    const record = { id: mod.id + '.' + fn.name, module: mod.id, fn: fn.name, line, key: sh.key, offenders };
    if (isCheckCarrying(body, fn)) infoOnly.push(record);
    else enforced.push(record);
  }
}
if (totalArrays <= 0 || totalFunctions === 0) {
  console.log('FAIL: zero shell/template arrays or zero generator functions found across all six modules (extraction broken -- refusing to report a clean gate on nothing)');
  process.exit(1);
}

console.log('=== shells: static literal-digit scan (' + totalArrays + ' shell arrays, ' + totalFunctions + ' generator functions, across 6 modules) ===');

const allowlist = loadAllowlistFor('shells');
const allowlistByDriver = new Map(allowlist.map((e) => [e.driver, e]));
const seenAllowlistDrivers = new Set();
let gateFail = false;

function printFinding(f, verdict) {
  console.log('  ' + padR(f.id, 38) + padR(f.key, 8) + verdict);
  for (const o of f.offenders.slice(0, 3)) console.log('      ' + JSON.stringify(o.length > 100 ? o.slice(0, 100) + '...' : o));
  if (f.offenders.length > 3) console.log('      ... and ' + (f.offenders.length - 3) + ' more element(s) in this array');
}

if (!enforced.length && !infoOnly.length) {
  console.log('  no literal-digit-outside-interpolation hits in any shell array.');
} else {
  for (const f of enforced) {
    const entry = allowlistByDriver.get(f.id);
    let verdict;
    if (entry) {
      seenAllowlistDrivers.add(f.id);
      verdict = 'EXPECTED-FAIL (' + entry.reason + ')';
    } else {
      verdict = 'FAIL (unlisted)';
      gateFail = true;
    }
    printFinding(f, verdict);
  }
  for (const f of infoOnly) {
    printFinding(f, 'INFO (check-carrying generator; sigOf never reads this shell, so the digit cannot pollute any signature; not enforced)');
  }
}

// An allowlisted array that is now CLEAN (digits fixed), was reclassified check-carrying, or
// whose id no longer matches anything is a stale entry -- same ratchet obligation as the other
// two gates: delete it.
for (const e of allowlist) {
  if (!seenAllowlistDrivers.has(e.driver)) {
    console.log('FAIL: allowlist entry "' + e.driver + '" (gate:shells) is stale -- no current check-less finding matches it (fixed, or reclassified check-carrying). Delete the entry.');
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
console.log('RESULT: ALL CLEAN (' + totalArrays + ' shell arrays scanned, ' + enforced.length + ' check-less findings, ' + infoOnly.length + ' check-carrying info-only, ' + allowlist.length + ' allowlisted)');
