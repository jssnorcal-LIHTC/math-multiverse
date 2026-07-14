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

## 2026-06-28 — When a test flags the code, suspect the test first; probe before editing

The fuzz oracle reported `genG6Reflect`'s correctIdx was wrong on every y-axis case.  The
generator was CORRECT; the ORACLE was wrong.  I checked the axis with `/x/.test(axis)`, and
"y-axis" contains the x of "a**x**is", so the regex matched and the oracle wrongly negated y for
y-axis reflections.  I nearly "fixed" a correct generator on the strength of a broken test.
Instead I probed the real generator output (point, axis, answer, the four options) before
touching code, which proved the generator right and the oracle wrong.

How to apply (durable):
1. Substring/regex membership on labels is a trap.  Match exactly (`=== 'y-axis'`) or anchor;
   never `/x/.test(s)` when another valid value also contains x.
2. When a verifier flags a finding and the code looks obviously correct, suspect the verifier.
   Reproduce the raw inputs and outputs first, then edit.  Related: [[feedback_verify_subagent_research]].

## 2026-06-28 — Parallel module builds via isolated git worktrees

Built three independent modules concurrently by dispatching builder subagents with worktree
isolation (each on its own checkout from the same base commit), then merged the branches one at a
time.  Because each module's edits were confined to disjoint file regions (its own IIFE plus its
own MODULES entry), all three merges were conflict-free.  Verify after EACH merge, not just at the
end.  Reach for this when several independent edits would otherwise serialize behind one big file.

## 2026-07-08: External image hotlinks silently fail offline; embed assets locally

**What happened:** Justin reported the Floating Bear cover "looked really bad."  The cover
was not crude art, it was MISSING art: `POOH_MAP` hotlinked the E. H. Shepard map straight
from Wikipedia, with a crude SVG blob-tree as the `onerror` fallback.  On the hard-cached,
sometimes-offline iPad the hotlink fails, so Niall kept seeing the fallback.  The
"improvement" was in the code but never rendered.  Fix: download the image, embed it
locally in `art/`, and point the constant at the local path.  Verified by rendering with
ALL external requests blocked in the harness (`page.route` abort of non-localhost).

**Why it matters:** the game is a single-file offline-first iPad app; any external
dependency is a latent failure that only shows up off the dev network, exactly where it is
hardest to notice.  My screenshot harness ALSO blocks external images, so a hotlinked asset
looks broken in test too, which is the tell.

**How to apply (durable):**
1. For a single-file offline-first app, treat every `https://` asset URL as a bug.  Embed
   locally in `art/` (matches the working assets: `razor-crest.png`, `mando.png`,
   `lego-emmet-lucy.jpg`) or as a data URI.  Never hotlink.
2. STILL LATENT in `Math-Multiverse.html`: F1 driver photos and Ferrari badge (Wikimedia),
   Grogu (Wikimedia), the Rocky logo (Gutenberg).  Same bug; localize them next.
3. To prove an embedded asset actually loads offline, render with external requests blocked
   and assert `img.naturalWidth > 0`, do not just eyeball it on the dev network.

Related: [[feedback_visual_inspection_required]], [[feedback_verify_before_claiming]].
