# Math Multiverse test harness

The committed gates that protect `Math-Multiverse.html`.  `npm test` runs the ten unit suites
followed by thirteen gate scripts;  the same job runs in CI (`.github/workflows/validate.yml`,
job name `fuzz + smoke`, which is the required check) and blocks merges to `main`.

## What runs

| Command | What it proves |
|---|---|
| `npm run fuzz` | Every generated question, both grades, all levels, is mathematically correct. |
| `npm run smoke` | The launcher and all six modules boot at Grade 5 and Grade 6 with zero JS errors. |
| `npm run reading` | The read/respond surfaces are measured as PAINTED, not as authored. |
| `npm run touch-targets` | Every header control is reachable by a 44px finger, measured by HIT-TESTING rather than by geometry. |
| `npm run reduced-motion` | No SVG under `art/` uses SMIL, and every animated asset actually stops under `prefers-reduced-motion`. |
| `npm test` | units, then validate-pack, figure-derive, freshness x3, shells, fuzz, smoke, figures-offline, reading-surface, tile-overlap, touch-targets, reduced-motion. |

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

The same pass also gates **coaching coverage**: every distinct `topic` any generator actually emits
must reach a tip, either its own `COACH_TIPS` entry or its family's coarse fallback, resolved
exactly the way `showCoach` resolves it.  The emitted set comes from the fuzz run rather than from a
static scan, because topics are built at runtime (`'g6-dec-' + mode`, `'g6-stats-' + op`) and a scan
for string literals would miss precisely those.  `COACH_TIPS` and `COACH_FAMILY_FALLBACK` are parsed
out of the shell as text, so the parse is checked rather than trusted: too few keys, a fallback
pointing at a key that does not exist, or a negative-control topic that resolves, all fail here.

It reports own-entry against fallback-only, because that is the quantity ticket 2.2 was about: a
silent slide from a precise tip to a coarse family tip is a regression no count of "uncoached"
would ever show.  Currently 83 emitted topics, 83 with their own tip, none relying on a fallback.

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

## How the tile-overlap gate works, in both directions (`tests/tile-overlap.js`)

The original scan asks "does a point inside a sibling resolve to the tile", which catches the
explain tile painting **over** chrome.  The 26-0714 Razor Crest report was the opposite sentence:
"the flight-screen status pill overlaps the explain tile's header line by approx 18px".  Both
readings were true at once.  `.rc-explain` carries `animation: fadein 0.2s`, and while that
animation runs the tile has an opacity below 1 plus a transform, which gives it a stacking context
and paints it **above** its in-flow siblings;  once the animation ends, the later sibling
`.rc-foot` paints above the tile.  Same boxes, two paint orders, 200ms apart.  The forward scan's
red on the unfixed build depended on sampling inside that window, and the direction a human
actually saw was never asserted at all.

A settled reverse scan now covers it:  after the fadein finishes, 25 points inside the tile's own
**visible** box must all resolve to the tile or one of its descendants.  Visible is the whole
difficulty:  since `59c95cb` the tile lives in a bounded scroll container, so its box can
legitimately extend past what is painted, and sampling those pixels would report the container as
an occluder on a healthy build.  Every sample is intersected with the client box of every clipping
ancestor first.

Each reverse scan carries its own **positive control** in the same pass: a box is painted over the
tile's visible area and the scan must find it, then it is removed.  Without that, "nothing is over
the tile" is indistinguishable from "this scan cannot see anything over the tile", which is exactly
the hole the forward scan had for this ticket.

Verified against the build the ticket was filed on.  With `96e05c5`'s shell in the tree, the
reverse scan reports `.rc-foot`, `.rc-radio` and `.rc-hull-pips` painting over the tile at 5 of 25
points on the wrong path and 15 of 25 on the correct one, at both grades;  on `main` it reports
zero across all twelve module-grade pairs with the control caught every time.

## How the touch-target gate works (`tests/touch-targets.js`)

Constraint 6 puts the minimum touch target at 44px.  This gate measures the header controls with
`document.elementFromPoint`, **never** with `getBoundingClientRect`, because a tap target is the
region in which a tap reaches the control and not the box the control paints.  The two are only
the same when nothing extends the hit region, and the fix this gate holds in place does exactly
that:  a 44px-tall pseudo-element that contributes no layout and paints nothing, so the bar keeps
the 35px height the 26-0708 one-row compaction bought and the play area pays nothing for the
target.  A geometry probe would read that fix as unapplied;  a stylesheet probe would read it as
applied whether or not the browser agreed.

It probes a 5x5 grid over the required 44x44 box centred on each control, inset half a pixel so no
probe sits on a boundary, and requires the control itself to be what comes back.  That one
formulation catches all three failures at once:  too short, too narrow, and two expanded targets
overlapping so a tap near an edge reaches the neighbour.

Every run injects **both** fixture controls, per constraint 12.  A 35px button with no extension
must FAIL the check (if it passes, the measurement cannot see a short target and the run is void)
and a 60px button must PASS it (if it fails, the probe is not reaching the DOM).  Discovering zero
controls is a failure, never a clean run.  The roster comes from a selector, not an id list, so a
control added to that bar is covered the day it lands.

**Pitch, and the one case this does not fully reach.**  The bar holds ONE row at 1024px on the
device's font stack, which is what the 26-0708 compaction bought, and a single row has the whole
header band to itself.  It does not hold one row on every font stack: on the ubuntu CI runner the
controls paint 33px and Reset wraps to a second row, leaving a 40px pitch, and 44px of target needs
44px of pitch.  Buying the difference with `row-gap` costs header height, which comes straight out
of the play area on the one device that matters, and on a 33px control it would still not reach 44,
so the pitch is not bought.  Where the bar wraps, each control is held to its full row pitch and
the shortfall is PRINTED, never tolerated silently;  where it does not wrap, every control is held
to the full 44px.

`node tests/touch-targets.js --width 480` puts the bar into two rows on any machine, which is how
the wrapped case is read locally.  The gate itself always runs at the device size;  the flags exist
so a limitation nobody can re-run does not become a limitation nobody can check.
## How the reduced-motion gate works (`tests/reduced-motion.js`)

Constraint 7 promises that `prefers-reduced-motion` collapses motion to end states.  `engine.css`
has carried a `@media (prefers-reduced-motion: reduce)` block since V1 and it lists
`.mv-lb-overlay`, and **that rule could never do what it said**.  `.mv-lb-overlay` is an `<img>`
whose `src` is an SVG, and no rule in the parent document reaches inside an `<img>`-referenced SVG.

Measured before the fix, four variants of the same stroked path in `<img>` tags, screenshotted
twice 800ms apart at both browser-level motion preferences:

| variant | under `reduce` | under `no-preference` |
|---|---|---|
| SMIL `<animate>` | MOVED | MOVED |
| SMIL plus the parent's `animation: none !important` | MOVED | MOVED |
| CSS `@keyframes` inside the SVG's own `<style>` | MOVED | MOVED |
| the same, gated by `@media reduce` inside the SVG | **STILL** | MOVED |

SMIL is therefore not governed by `prefers-reduced-motion` by any route, and the only mechanism
that works is a media query inside the asset.  The gate holds both halves:  no SVG under `art/` may use SMIL
(static scan, with a fixture that carries SMIL as the scanner's own negative control), and every
animated asset must MOVE with motion allowed and be STILL under `reduce`, plus a fixture that never
animates and one that animates ungated.

**The trap it exists to remember:** Playwright's `newContext({ reducedMotion })` does not reach an
image document.  The parent page reports what was asked for while the SVG inside the `<img>` keeps
reporting the real browser value, so on a machine whose OS has reduced motion ON, a probe using the
context option measures `reduce` in both of its two "conditions" and a gated animation reads STILL
in both, which looks like a pass and proves nothing.  The preference is forced with Chromium's own
`--force-prefers-reduced-motion` / `--force-prefers-no-reduced-motion` switches instead.

It also separates a genuine end state from a frozen frame:  a stopped animation and a collapsed one
both read STILL, so the reduced rendering must differ from the animated one's first frame.  The
overlay's dash period equals its full travel, so freezing it would leave one 152-unit dash at the
wrist;  under `reduce` it drops the dash pattern and paints the whole traced corridor instead.

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
