'use strict';
// gate-common.js -- helpers shared by the Task 7 content gates (freshness-lib.js, freshness-sim.js,
// shells.js). Kept deliberately minimal: only what more than one gate actually uses. driverId() in
// particular is a cross-gate CONTRACT, not just shared code -- freshness-lib.js and freshness-sim.js
// both build allowlist ids from it, so a one-sided edit to the id format in only one file would
// silently break allowlist matching in the other (entries would stop matching, or start matching
// the wrong driver) without either gate raising an error. Living in one place makes that class of
// bug structurally impossible rather than just unlikely.

// mulberry32/seededMath: seeded PRNG for deterministic, reproducible draws. seededMath() wraps
// Object.create(Math) with only `random` overridden, so every other Math method (Math.imul in
// particular, used internally by MVFresh's own hash) falls through to the real, unseeded Math.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededMath(seed) {
  const m = Object.create(Math);
  m.random = mulberry32(seed);
  return m;
}

// The canonical driver-id format: "<moduleId>.g<grade>.i<levelIndex>", 0-based level index. This
// exact shape is what MVFresh's own levelKey convention uses at runtime and what every allowlist
// entry under gate:"lib" or gate:"sim" is keyed by.
function driverId(d) { return d.moduleId + '.g' + d.grade + '.i' + d.levelIndex; }

function padR(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padL(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

module.exports = { mulberry32, seededMath, driverId, padR, padL };
