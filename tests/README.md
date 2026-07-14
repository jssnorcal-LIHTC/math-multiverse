# Math Multiverse test harness

Two committed gates that protect `Math-Multiverse.html`.  Both run in CI
(`.github/workflows/validate.yml`) and block merges to `main`.

## What runs

| Command | What it proves |
|---|---|
| `npm run fuzz` | Every generated question, both grades, all levels, is mathematically correct. |
| `npm run smoke` | The launcher and all six modules boot at Grade 5 and Grade 6 with zero JS errors. |
| `npm test` | fuzz then smoke. |

## How the fuzz works (the math-correctness gate)

`tests/fuzz.js` drives each module's **real** question dispatch (the same call its `init()` makes:
`genForLevel`, `GEN_BY_TYPE[gen]`, `genQuestion`, `MB_GEN`/`RK_GEN`/`FB_GEN`, etc.) across both
grades and all levels, N times each (default 5000/driver -> ~360k questions), and verifies every
question with three independent oracle layers in `tests/oracles.js`:

1. **check-contract**: every Grade-6 generator (and f1's check-bearing ones) attaches a hidden
   `check:{op, operands, answer}`.  The oracle recomputes the answer by a **different** route than
   the generator (multiply-back for division, reciprocal for fraction division, repeated
   multiplication for exponents, cross-multiplication for ratios, sign logic for quadrants, ...)
   and also confirms the option the kid would tap matches the contract.
2. **fraction arithmetic**: the fraction module has no `check`, so the oracle parses the displayed
   `equation` (a real rational expression evaluator handling `+ - x / of`, mixed numbers, and
   parentheses) and recomputes by exact rationals, comparing to `answer`; "lowest terms" questions
   must additionally render a fully-reduced correct choice.
3. **structural**: every question (both grades) must be well-formed: a prompt, options that are
   distinct and non-blank, exactly one correct, `correctIdx` in range.

It is **non-gameable**: a mutation self-test corrupts each answer (the contract value, the
`correctIdx`, and the fraction answer) and asserts the oracle rejects it.  The run fails if any
oracle never fires, any required op/kind is missing, any mutation slips through, or any question is
wrong, so the gate can never silently pass on a broken or unexercised generator.

`tests/extract.js` slices each module's IIFE out of the HTML **by marker** (never hard-coded line
numbers) and evaluates it in a Node `vm` sandbox, so there is no browser and no build step.

## How the smoke works (the render gate)

`tests/smoke.js` serves the repo over http and boots a real headless Chromium (always
`--disable-gpu`, since this machine's Intel driver TDR-freezes under GPU browser automation).  It boots
the launcher, switches Grade 5 / Grade 6, and enters all six modules at each grade, asserting zero
uncaught exceptions and zero console errors (resource-load noise excluded; external images are
blocked so the run is hermetic).

Locally, point it at an existing browser to skip the download:

```
PLAYWRIGHT_EXECUTABLE_PATH="C:\\Users\\...\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe" node tests/smoke.js
```

In CI the browser is installed with `npx playwright install --with-deps chromium`.
