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
Remaining:
- [ ] **VERIFY** all the above with independent Node fuzz oracles (50k+ iters each; no tautological tests)
- [ ] P1 rocky conversion distractors — plausible scale-errors (kill guess-by-roundness)
- [ ] P1 shared Save reconcile — unified `default()` deep-merge in `load()` AND `importJSON`; `.bak` on corrupt
- [ ] Commit verified Phase 2

## Phase 3 — High-value P2/P3
- [ ] P2 floating-bear `genSimpleParens` ÷1 degenerate; coach topic-key mismatch (4/8 dead)
- [ ] P2 f1 `genPowerOfTen` cap huge distractors; razor missing coach tips
- [ ] P2 preview-mode sandbox (no permanent skip-granted progress)
- [ ] P3 cheap: dead code, `genWriteWord` wording, Suzuka 404 cleanup

## Phase 4 — 6th-grade content + in-game grade selector
- [ ] Design: per-module grade param; 6th content (6.RP, 6.NS incl. negatives, 6.EE, 6.G, 6.SP); preserve 5th.
- [ ] Grade selector in launcher; per-grade save namespace; keep unlock/star model.
- [ ] Implement + per-generator fuzz verification.

## Phase 5 — Full audit loop (visual + code) until ZERO bugs
- [ ] Code audit (multi-dimension, adversarially verify each finding before fixing).
- [ ] Visual audit: headless screenshots @ iPad 6 (1024×768 landscape + 768×1024 portrait), `--disable-gpu`, INSPECT the images.
- [ ] Fix all confirmed bugs; re-run; LOOP until clean.
- [ ] Commit on branch → merge to main → push → Pages redeploy. Provide Niall URL + cache-bust.

## Test harness (from prior session)
- Headless Chromium executablePath options under `C:\Users\Justin Solomon\AppData\Local\ms-playwright\` (chromium-1223 newest).
- puppeteer-core node_modules at `/tmp/_ppt/node_modules` (survived reboot).
- iPad 6 = 1024×768 CSS px. UA emulation + isMobile/hasTouch to exercise `@media (hover:hover)` gating.
