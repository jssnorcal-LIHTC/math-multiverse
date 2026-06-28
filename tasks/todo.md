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
  - [x] f1-decimals -> 6.NS/6.RP/6.SP (decimal ops, division, unit rate, percent, lap-time stats)  [see ## Verification: f1-decimals g6, below]
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

## Verification: f1-decimals g6 (6.NS / 6.RP / 6.SP, added 2026-06-27)
Additive edits only; grade-5 F1 paths untouched. Inline script parses clean (`node --check`, parse-only).

Line ranges (post-edit):
- MODULES `g6` block (f1-decimals): lines 2981-2994 (sibling key after `grandGoal: 'World Champion'`;
  ccss '6.NS / 6.RP', domain 'Decimals, Rates & Data', grandGoal 'Data & Decimals Champion';
  6 levels id 1..6, questions 15,18,18,20,20,20).
- `F1_LEVELS_6` (6 entries): lines 5188-5198 (immediately after `F1_LEVELS`, before `QPL`).
  gen ids g6-dec-divide / g6-dec-ops / g6-unit-rate / g6-percent / g6-stats / g6-allmix.
- `g6Options` helper: lines 5566-5599.
- Generators: genG6DecDivide 5601-5630, genG6DecOps 5632-5713 (mul/add/sub branches),
  genG6UnitRate 5715-5744, genG6Percent 5746-5775, genG6Stats 5777-5825, genG6AllMix 5827-5829.
- `GEN_BY_TYPE` six new keys at TOP: lines 5833-5838 (grade-5 keys 5839-5844 unchanged).
- f1 init level-pick ternary: line 5907 (`ACTIVE_GRADE === 6 ? F1_LEVELS_6[i] : F1_LEVELS[i]`).

Grade-5 untouched (confirmed):
- `F1_LEVELS` (5179-5186), `QPL` (5200), grade-5 generators (genPlaceValue..genMixed),
  grade-5 `GEN_BY_TYPE` keys (place-value/compare-order/add-sub/multiply/divide/mixed-all): none modified.
  New keys sit ABOVE grade-5 keys and only fire on the new gen ids. init falls back to
  `F1_LEVELS[levelIndex]` unless ACTIVE_GRADE===6. Shared QPL gives both grades 15,18,18,20,20,20.

`check:{op,operands,answer}` attached on every grade-6 return (7 sites; genG6DecOps has 3 paths):
- div  5627 [a,b]→q ; mul 5659 [dec,whole]→ans ; add 5686 [x,y]→ans ; sub 5710 [x,y]→ans ;
  div(unit-rate) 5741 [d,t]→r ; percent 5772 [rate,base]→rate*base/100 ; stats 5822 [5 vals]→mean|median|range.
  genG6AllMix delegates to these, so it always carries a check too.

Exactly 4 distinct, one correct, non-negative (by construction of g6Options):
- correctV added first; mistakes deduped on the value rounded to `decimals`; negatives/non-finite skipped;
  short lists padded with correct+0.1*k (then +integers), all distinct + non-negative ⇒ array length exactly 4.
- clean() is a bijection on rounded values (toFixed then strip trailing zeros), so 4 distinct values ⇒
  4 distinct strings; correctStr appears once ⇒ exactly one correctIdx.
- answers[correctIdx] parseFloats to check.answer: each answer value is already at the generator's display
  precision (div/ops/rate/percent 2 dp, stats 1 dp), so round==value and parseFloat(correctStr)===answer.
- Exact-termination by design: div/rate built from a 2-dp quotient × integer divisor; mul = (k/100)×int;
  add/sub of 2-dp operands with x>y for sub; percent rate(mult-5)×base(mult-20)/100 is integral; stats sum
  forced ≡0 (mod 5) so mean is exact 1 dp; median is a list value; range is a difference of list values.
- Distractor models are decimal/percent/stat mistakes (misplaced decimal ×10 / ÷10, off by 0.1, op swap,
  percent-as-rate, used-whole-base, mean-vs-median swap, forgot-to-divide-by-count sum, divided-by-4), never
  the correct value (deduped), never negative (filtered). F1 race voice kept in prompt/explain.
