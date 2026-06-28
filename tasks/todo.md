# Math Multiverse — Complete 6th-Grade Update + Full Audit (full-auto goal)

Branch: `feature/audit-and-grade-selector` · File: `C:\Claude\Math-Game\Math-Multiverse.html`

**Master goal (set 2026-06-27 by Justin — full-auto, NO questions):**
1. Complete the 6th-grade update (finish correctness fixes + add 6th-grade level sets + in-game grade selector; preserve 5th).
2. Audit every element of the deliverable — visual (rendered + inspected) AND code — full auto.
3. LOOP the audit until all bugs are eliminated.
4. Use all available skills, tools, and MCPs. Keep it live for Niall.

**SAFETY (load-bearing):** the 06-27 crash was a browser-automation-triggered Intel GPU TDR. Mitigations
now live (driver 8826 + TdrDelay/TdrDdiDelay=8 + PSR off + Chrome/Edge HW-accel off by policy). EVERY headless
browser launch MUST pass `--disable-gpu --disable-gpu-compositing` to avoid re-triggering the freeze.
**Verification discipline:** independent oracle per generator; NO tautological tests; single-point parity is NOT parity.

## Phase 1 — Audit (DONE)
- [x] Visual + code audit (36 findings: 2 P0, 6 P1, 14 P2, 14 P3; 8 high-sev confirmed). Hosting LIVE on GitHub Pages.

## Phase 2 — Correctness fixes (P0/P1)
Recovered from the crashed session, committed as checkpoint (pending fuzz verification):
- [x] P0 f1 `genRound` — integer-thousandths rounding (no float underflow mis-grade)
- [x] P0 razor `genReflectQ` — four sign-combos (no dup-correct / no collapse)
- [x] P1 fraction `genMixedSub` — proper-fraction borrow (no malformed "4 6/5")
- [x] P1 fraction `genEquiv` — deduped distractor numerators
- [x] P1 LEGO Unikitty — inline minifig (dropped broken `onerror` hotlink)
- [x] P1 floating-bear `genCompareExpr` — positive subtraction (no negatives)
- [x] P1 floating-bear `genCorrespondingTerm` — deduped distractors
- [x] (bonus P2) mixed-number scaled distractors + negative-fraction distractor filter
- [x] **VERIFIED** all the above with independent Node fuzz oracles (240k+ questions, 0 failures; mutation self-test catches 100% of corrupted answers; oracle coverage proven)
- [x] (fuzz-found, fixed) fraction makeChoices negative pad; genSub negative result; genCompareFrac duplicate-correct collapse
- [x] P1 rocky conversion distractors — scaledOpts (all options multiples of factor); RED->GREEN verified
- [x] P1 shared Save reconcile — unified `reconcile()` deep-merge in `load()` AND `importJSON`; `.bak` on corrupt; browser round-trip verified
- [x] Browser smoke: launcher + all 6 modules boot at iPad-6 land/port with 0 console errors (headless --disable-gpu)
- [x] Committed: 2b418ac, ef39346, aa7e981, 52c5a5c

**PHASE 2 COMPLETE + VERIFIED.** Verification infra in scratchpad: extract.js (dynamic module
extraction), fuzz.js (independent oracles + mutation self-test), smoke.js (headless visual + Save round-trip).

## Phase 3 — High-value P2/P3
- [ ] P2 floating-bear `genSimpleParens` ÷1 degenerate; coach topic-key mismatch (4/8 dead)
- [ ] P2 f1 `genPowerOfTen` cap huge distractors; razor missing coach tips
- [ ] P2 preview-mode sandbox (no permanent skip-granted progress)
- [ ] P3 cheap: dead code, `genWriteWord` wording, Suzuka 404 cleanup

## Phase 4 — 6th-grade content + in-game grade selector
- [x] Grade 5/6 toggle in launcher; per-grade save namespace; gradeView overlay; modules without g6 show "coming soon". VERIFIED (commit 21561e1).
- [ ] Per-module grade-6 content (g6 metadata + X_LEVELS_6 + generators + genForLevel branch), fuzz-verified:
  - [x] fraction-rider -> 6.NS (fraction division)  [see ## Verification: fraction-rider g6, below]
  - [ ] f1-decimals -> 6.NS/6.RP (decimal ops, division, percent) [+ 6.SP stretch: lap-time stats]
  - [ ] razor-crest -> 6.NS.6/8 + 6.G.3 (four-quadrant plane, rational coords, distance, polygons)
  - [ ] master-builder -> 6.G (area, volume w/ fractional edges, surface area/nets)
  - [ ] rocky-translator -> 6.RP (ratios, unit rates, ratio tables, percent)
  - [ ] floating-bear -> 6.EE (exponents, expressions w/ variables, evaluate, one-step equations)
- Wiring pattern: module reads top-level ACTIVE_GRADE; init picks X_LEVELS_6 when grade 6; genForLevel branches on grade-6 gen types. g6 block added to the module's MODULES entry.

## Phase 5 — Full audit loop (visual + code) until ZERO bugs
- [ ] Code audit (multi-dimension, adversarially verify each finding before fixing).
- [ ] Visual audit: headless screenshots @ iPad 6 (1024×768 landscape + 768×1024 portrait), `--disable-gpu`, INSPECT the images.
- [ ] Fix all confirmed bugs; re-run; LOOP until clean.
- [ ] Commit on branch → merge to main → push → Pages redeploy. Provide Niall URL + cache-bust.

## Test harness (from prior session)
- Headless Chromium executablePath options under `C:\Users\Justin Solomon\AppData\Local\ms-playwright\` (chromium-1223 newest).
- puppeteer-core node_modules at `/tmp/_ppt/node_modules` (survived reboot).
- iPad 6 = 1024×768 CSS px. UA emulation + isMobile/hasTouch to exercise `@media (hover:hover)` gating.

## Verification: fraction-rider g6 (6.NS.1, added 2026-06-27)
Additive edits only; grade-5 untouched. (Per task: no tests run; verified by static inspection.)

Line ranges (post-edit):
- MODULES `g6` block (fraction-rider): lines 2946-2960 (sibling key after `grandGoal: 'Hardline Champion'`).
- `FR_LEVELS_6` (6 entries): lines 3733-3742 (immediately after `FR_LEVELS`, before `FR_QPL`).
- `frDivChoices` helper: lines 4194-4213.
- Generators: genNsDivIntro 4215-4270, genNsDivFrac 4272-4297, genNsDivMixed 4299-4353,
  genNsDivMulti 4355-4413, genNsDivWord 4415-4468, genNsDivAllMix 4470-4472.
- `genForLevel` new branches at top: lines 4476-4482 (grade-5 branches 4483+ unchanged).
- init level-pick ternary: line 4640.

Grade-5 untouched (confirmed):
- `FR_LEVELS` (3711-3718), `FR_QPL` (3743), all grade-5 generators, all grade-5 `genForLevel`
  branches (like-denom/unlike-easy/unlike-mixed/multiply/divide/mixed-all), `makeChoices`,
  `pedFracMistakes`: none modified.  New branches sit ABOVE grade-5 branches and only fire on
  the new gen ids.  init line still falls back to `FR_LEVELS[levelIndex]` unless ACTIVE_GRADE===6.

`_customChoices` = exactly 4 distinct, non-negative, one correct (by construction of frDivChoices):
- Correct text = fracToString(ansNum, ansDen); answer.{num,den} match → grader finds the one
  `correct:true`. makeChoices returns `_customChoices` early, so pedFracMistakes never runs.
- Candidate loop breaks as soon as size hits 4, so Set size never exceeds 4; fallback
  fracToString(ansNum+k, ansDen) (k from 2) fills any shortfall with strictly-increasing,
  guaranteed-new reduced strings.  slice(0,4) keeps the correct (added first).
- All candidate numerators/denominators are positive products (no 0, no negative); the
  negative-sign regex filter is belt-and-suspenders.  den always > 0, so no zero denominator.
- Distractor model per problem: forgot-to-invert (a·c)/(b·d), inverted-the-dividend (b·d)/(a·c),
  off-by-one (ansNum+1)/ansDen, did-not-simplify (a·d)/(b·c) [collapses to correct via
  fracToString, so fallback fills, per spec].  Mixed converts to improper before computing.
  Multi adds "stopped after dividing" and the times-m variants.
- Straight-across never collides with correct (divisor proper c&lt;d, or improper c&gt;d ⇒ c≠d);
  inverted-dividend never collides with correct (dividend a≠b in every form).
