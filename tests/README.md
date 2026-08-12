# Math Multiverse test harness

The committed gates that protect `Math-Multiverse.html`.  `npm test` runs the ten unit suites
followed by eleven gate scripts;  the same job runs in CI (`.github/workflows/validate.yml`,
job name `fuzz + smoke`, which is the required check) and blocks merges to `main`.

## What runs

| Command | What it proves |
|---|---|
| `npm run fuzz` | Every generated question, both grades, all levels, is mathematically correct. |
| `npm run smoke` | The launcher and all six modules boot at Grade 5 and Grade 6 with zero JS errors. |
| `npm run reading` | The read/respond surfaces are measured as PAINTED, not as authored. |
| `npm test` | units, then validate-pack, figure-derive, freshness x3, shells, fuzz, smoke, figures-offline, reading-surface, tile-overlap. |

Two tools are committed but deliberately **not** in `npm test`, because each needs a network
origin and neither belongs in a hermetic gate:  `build/verify-deploy.js` (byte-compare what
Pages serves against `git show <sha>:<path>`) and `tests/play-level.js` (below).

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

## How the level driver works (`tests/play-level.js`)

```
node tests/play-level.js [--base <url>] [--pack <id>] [--level <n>] [--wrong <n>] [--unlock] [--json]
```

Plays a pack level **to its end** through the real app and asserts the completion-screen reward
card.  With no `--base` it serves the repo on an ephemeral port;  with `--base` it drives a
remote origin, which is how the deploy gets checked.

It exists because finishing a level means operating *every* item type that level serves, and the
ad-hoc drivers written during the visual-engagement program could not operate `match` or `order`,
so they stalled mid-level and the reward card's twelve-tile claim rested on a unit gate plus
byte-identity rather than on a playthrough.  All eight types are driven here through the same
affordances a child has:  real clicks, and a real `<select>` change for cloze.  `match` is a
rowLabels x colLabels **table**, one tap per row, not the tap-source-then-tap-target interaction
an earlier driver assumed;  `order` is tap-to-append from a bank whose tiles carry no `data-idx`,
so a tile is addressed by its exact text.

Three rules it encodes, each of them a lesson this repo paid for:

- **The answer key comes from the pack the app fetched**, never from the local working tree.
  Driving a deployed origin while answering from the checkout would silently produce a nonsense
  run the moment the two differ.
- **The origin is proven with a negative control first.**  A path that cannot exist must not
  answer 200, *and* the app must answer 200 as `text/html`.  A positive-only check once called a
  stray process green when it answered 200 with a 73-byte PNG for every path.
- **Advancing waits on a CHANGED artifact**, the progress counter reading `n+1 / total`, not on
  ".mv-item exists", which is already true of the item still on screen.

`--unlock` is **setup, not an assertion shortcut**.  A pack level card is open only when
`i <= levelsCleared`, and pack levels do *not* honour Preview Mode, which lives in a different save
store.  Without it the driver could only ever reach level 1 of any pack, so the 12-question L6
levels and the `shorttext` items that first appear at L3 would be permanently untestable.  It
seeds `multiverse.packs.v1` through `addInitScript` so the value lands before `PackSave.load()`
reads it;  nothing about the reward card is seeded, only which door is unlocked.

`--wrong <n>` answers the first n items incorrectly on purpose, which is what makes the magnifier
assertion two-sided:  the enlarge chip must appear **only** once every tile has lifted.  Three
states are covered and each is asserted separately:  all correct (12 tiles lifted, magnifier
present, image wrapped in the enlarge button), partial (fewer tiles, no magnifier, bare image),
and zero earned (no card and no `#lc-reveal` host at all).

A **fourth** contract covers levels that declare no `reveal` at all, which is the majority case:
the three ELA packs carry no figures, so their completion screens must show no card and no host.
That absence is asserted, never skipped, and the closing banner names which of the four contracts
was actually checked, so a reveal-less run can never read as if the twelve-tile card had been
verified.
