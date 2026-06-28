# Lessons — Math Multiverse

## 2026-06-27 — A test harness that can silently pass is worse than no harness

**What happened:** The fuzz harness extracted each module from the HTML by HARD-CODED line
ranges.  After I edited the fraction module (adding ~16 lines), every later module's range
was stale, so extraction sliced broken JavaScript.  Every module failed to load, the runner
caught the crashes, and the report printed "ALL CLEAN -- 0 failures."  A false green.

**Why it matters:** I almost trusted a passing result that proved nothing.  This is the
single-point-parity / tautological-test failure mode in a new disguise: the test infrastructure
itself was vacuous.

**How to apply (durable):**
1. Locate code regions DYNAMICALLY (search for stable markers like `(function() {` /
   `InlineModules['id']`), never by hard-coded line numbers, in any extract/patch tool.
2. A load/compile failure in a harness must be a HARD FAILURE surfaced in the report,
   never swallowed by a try/catch that lets the run report clean.
3. Prove a clean run is non-vacuous before trusting it: (a) coverage counters showing each
   semantic check actually fired, and (b) a mutation self-test showing the oracle REJECTS a
   deliberately corrupted answer.  Both shipped in fuzz.js this session.

Related: [[feedback_tautological_test_ban]], [[feedback_single_point_parity_is_not_parity]],
[[feedback_verify_before_claiming]].

## 2026-06-27 — Top-level `const` is not on `window`

In Math-Multiverse.html, `InlineModules`, `Save`, `MODULES` are top-level `const` in a
classic script, so they are reachable as lexical globals from `page.evaluate(() => Save...)`
but are NOT properties of `window`.  `window.InlineModules` is undefined.  Reference them
bare in injected/evaluated code.

## 2026-06-27 — Browser automation is GPU-safe only headless + --disable-gpu

The 06-27 display freeze was a browser-automation-triggered Intel GPU TDR.  Headless Chromium
launched with `--disable-gpu --disable-gpu-compositing` renders via SwiftShader (CPU) and never
touches the display driver.  Ran the full smoke (8 page loads + screenshots) twice with no
freeze.  Always pass those flags for any browser automation on this machine.
