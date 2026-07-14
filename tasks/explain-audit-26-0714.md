# Explanation-robustness audit, Math Multiverse (26-0714)

Scope: every per-question `explain:` template in all six modules (grade 5 and grade 6)
plus the COACH_TIPS worked-example cards.  Method: one audit subagent per module
(five completed, Razor Crest delivered a substantial partial before an API drop),
independent spot-verification of every C-grade claim against the source, a scripted
topic-coverage audit, and a live six-module Playwright sweep.  Grades: A teaches the
why with the question's real numbers; B is correct but partially generic or skips a
step; C restates the answer, omits its own method, or states an inapplicable rule.

## Bottom line

The explains are mostly strong: roughly three quarters walk the actual numbers step
by step.  The weakness is systemic rather than scattered, and it concentrates exactly
where a struggling kid needs help most.  Three patterns account for nearly every
non-A grade:

1. **Right path shown, wrong path never named.**  The distractors encode specific
   misconceptions (forgot to invert, added the denominators, took the complement),
   yet the explain almost never says why the kid's actual pick was wrong.  The kid
   learns the recipe without learning their mistake.
2. **Unbridged simplification.**  Several fraction explains compute an intermediate
   (3/6) and then box a reduced answer (1/2) with no connecting step, which reads as
   a contradiction to a kid who does not yet reduce instinctively.
3. **Hardest skills got the thinnest explains.**  The borrow generator, the
   full-PEMDAS generator, and the multi-step conversion chain assert their answers
   with the least work shown of any generators in their modules.

## Per-module verdicts

| Module | Verdict | Weakest spots |
|---|---|---|
| Fraction Rider | 15 A / 3 B / 1 C (19 generators) | `genMixedSub` (line approx 4217) is the only C: the borrow generator shows no borrow step, just restates the problem and answer.  `genAdd`/`genSub`/`genMultFrac` B: unbridged simplification. |
| F1 Apex Decimals | 7 A / 5 B / 2 C (14 generators) | `genDivide` C (verified): tells the kid to "move the decimal in dividend and divisor together" although its divisor is always a whole number, so the advice applies to zero questions it generates.  `genCompareOrder` C (verified): says "compare digits left to right" but never shows the deciding digit.  `genMultiply`/`genG6DecOps` B: "same total decimal places" never states the actual count. |
| Razor Crest | Live generators mostly A; `genG6Distance` C, `genG6RectArea` B (partial report) | `genG6Distance` never names the modeled "forgot a negative" mistake and renders a confusing double-minus glyph (`|3 − -6|`).  Bigger structural find below (dead code). |
| Master Builder | Counts confirmed unrecoverable (coordinator never received its subagents' outputs); qualitative findings captured | `genCompareVol` is the one grade-5 generator that bypasses the shared misconception-distractor helper; its explain is the thinnest in the module. |
| Rocky's Dictionary | 7 A / 3 B / 0 C (10 generators) | `genMultistep` gal-to-cups variant asserts the 16x shortcut without deriving the chain; the percent generators code complement-error distractors (answered "what is left" instead of "the part") that the explains never address. |
| Floating Bear | Counts confirmed unrecoverable (coordinator never received its subagents' outputs); qualitative findings captured | `pemdas-multi` and `pemdas-full` explains say "step by step gives X" while showing zero steps (verified).  `genParensMulti`'s comment claims modeled misconceptions but its distractors are generic plus/minus noise. |

## Fixed this session (already committed, 8517e61)

- **19 dead coach topics.**  Nineteen topics emitted by live generators had no
  COACH_TIPS entry, so `showCoach` silently returned false and the repeated-miss
  coach NEVER fired for them: frac-sub-like, frac-of-whole, frac-mixed-add,
  frac-mixed-sub, dec-div, dec-write-word, dec-expand (60 percent of F1 L1),
  coord-reflect, coord-shape, coord-translate, coord-path, coord-identify,
  coord-real-world, vol-compare, unit-eridian, pemdas-multi, pemdas-nested,
  pemdas-full, pemdas-compare.  All nineteen tips authored in the established style.
- **Family fallback in showCoach.**  An unmapped topic now degrades to its family's
  coarse tip (frac-, dec-, coord-, vol-, unit-, pemdas-) instead of silently skipping,
  so future topic/tip drift can no longer kill the coach.
- Coverage re-audit after the fix: zero dead topics; TOPIC_LABELS already covered
  everything (99 keys).
- **COACH_TIPS arithmetic hand-verified across every entry** (audit coordinator,
  independent of the module subagents): none mathematically wrong.  Three
  pedagogically weak entries found and fixed in the same pass: `ns-div-multi` and
  `g6-stats` had example fields with no worked numbers (both now work a real example),
  and `pemdas-write-expr` stated a parens rule its own example contradicted, teaching
  the exact misconception the module targets (tip rewritten, example now shows the
  evaluated result and the wrong reading side by side).

## Structural findings (not fixed, Justin's call)

1. **Razor Crest dead code.**  Four of nine grade-5 generators are unreachable via
   any level mix: `genPlotQ` (also structurally broken, returns no answers array and
   would crash the renderer if wired), `genShapeQ`, `genTranslateQ`, `genRealWorldQ`.
   Either wire them into level mixes or delete them.
2. **Grade-6 tag granularity.**  `g6-dec-ops` collapses add, subtract, and multiply
   into one coaching bucket (grade 5 separates them); `g6-stats` collapses mean,
   median, and range.  Grade-6 kids cannot get skill-specific coaching there.
3. **Floating Bear level dispatch mixes topics.**  A "nested" level can emit four
   different topic tags, so per-level accuracy reporting is blurred.
4. **Distractor gaps.**  `genFracOfWhole` uses the word "of" in its equation, so it
   falls outside all four operator checks in `pedFracMistakes` and gets only generic
   numeric-noise distractors.  Rocky's `genMultistep` never offers the intermediate
   value (stopped after one step) as a distractor, the single most natural mistake.
5. **Razor Crest cosmetic nit.**  The flight-screen status pill overlaps the explain
   tile's header line by approx 18px when the tile scrolls into view (pre-existing;
   content and NEXT button fully legible).

## Rewrites IMPLEMENTED 26-0714 (12 generators)

All priority rewrites shipped on branch `explain-quality-26-0714`:
- F1 `genDivide`: dropped the inapplicable "move both decimals" rule (its divisor is
  always a whole number); now teaches dividing then placing the decimal above.
- F1 `genCompareOrder`: was empty on method; now names the first decimal place where
  the two times differ (computed at generation time).
- F1 `genMultiply`: now states the actual decimal-place count and shows the
  whole-number multiply then the decimal slide.
- FR `genMixedSub`: was a bare restatement; now shows the improper-fraction conversion
  and the subtraction step by step.
- FR `genAdd`/`genSub`/`genMultFrac`: added the simplification bridge (shows the raw
  fraction, then "which simplifies to" the reduced answer, only when it actually
  reduces).
- FB `genParensMulti` (pemdas-multi) and `genFullPemdas` (pemdas-full): were "step by
  step gives X" with no steps; each variant now carries a real `steps` string the
  explain walks.
- Rocky `genG6Percent`/`genG6PercentFind`: now name the complement mistake ("that's the
  amount itself, not what's left over") that their own distractors model.
- RC `genG6Distance`: parenthesized the negative subtrahend (killed the `|3 − -6|`
  double-minus glyph) and named the "forgot a negative" mistake.

Verification: a render harness drove all 72 level-drivers 4,000x each (288,000
questions) with 0 empty / undefined / NaN / unresolved-template explains and every
edited topic exercised; `npm test` (independent-oracle fuzz + both-grade smoke) clean.
Not touched (acceptable B's, left as-is): F1 `genAddSub` (shows the real sum),
Master Builder `genCompareVol`.  Structural findings (RC dead code, grade-6 tag
granularity) remain open, tracked above.
