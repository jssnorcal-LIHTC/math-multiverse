# Shepard 1926 Plates: Provenance (FINAL)

E. H. Shepard's 1926 illustrations for *Winnie-the-Pooh*, Chapter IX ("In Which Piglet Is
Entirely Surrounded by Water"), as shipped in the Floating Bear module.  This supersedes
`.superpowers/sdd/floating-bear/PROVENANCE-shepard-1926-DRAFT.md`, which remains the working
record (13 plates checked, including the two not shipped here) and should be consulted for the
full sourcing-workflow narrative.  This file carries rows for shipped plates only.

**Summary.**  All 13 checked plates now ship (14 files in `art/`: p151.png ships as the source
of record but is not itself mounted; a pixel-crop derivative, `p151-crop.png`, is mounted in
its place, see the fix-round-1 row below).  10 PASS on first pass; 3 (151, 153-2, 160-1) were
flagged SUSPECT on scene-mapping grounds only, art authenticity and Commons provenance clean on
all three.  Cross-verification against the pinned archive.org reference resolved all 3: each
depicts a real, correctly-placed plate from the same flood sequence, just not the plate the
original scene guess expected.  All 3 ship with corrected captions and mounts reflecting the
resolved scene.  Plates 155 and 156 (two small vignettes on the reference's p.128) were held
back in the first round as unused; 156 is now the source of the scene's bank figure and both
are shipped, see **Scene Figure Crops** below.

Seven further files in `art/` are *derivatives*, not plates: `fb-scene-*.png`, the figure crops
the Floating Bear scene mounts inside its own drawn weather.  They carry no independent
provenance and inherit the row of the plate they are cut from; each one's crop box and tonal
processing is recorded in its own row below, and all seven are reproduced by
`art/tools/fb-scene-crops.py`, which is the only supported way to regenerate them.

## R1 Pinning Verdict: UNPINNED, MITIGATED BY CROSS-VERIFICATION

The Commons uploader (Chrisguise) batch-uploaded the source files via UploadWizard with only a
bare work-title citation, no scan or archive link; full detail in `pin-r1-26-0806.md`.  That gap
is mitigated, not closed, by direct cross-verification: every shipped plate has been visually
matched, panel by panel, against a specific leaf of archive.org item `winniepooh0000aami`
(Methuen & Co Ltd, dated 14 October 1926, institutional scan), the pinning report's recommended
fallback.  Same composition at a known leaf of a dated 1926 first edition confirms the plate is a
genuine 1926 Shepard illustration regardless of which physical copy Commons scanned.  Access
pattern and leaf-mapping method are recorded in the DRAFT (`Cross-Verification Against Pinned
Reference` section) and are unchanged here.

## Per-Plate Provenance (shipped only)

| File | Commons Source | Credit / License | Verdict | Scene | Ref Leaf (`winniepooh0000aami`) | Cross-Check | Mount Site |
|---|---|---|---|---|---|---|---|
| [shepard-1926-p146.png](shepard-1926-p146.png) | [File:Winnie-the-Pooh_146.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_146.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS | Exterior view of Piglet's beech-tree home in driving rain, water pooling at the tree's base, Piglet's face at a window beside the TRESPASSERS W sign, the chapter's establishing image. | leaf 137 | MATCH | Beat 1 (`rain-begins`) pick-screen and story-stage anchor. |
| [shepard-1926-p148.png](shepard-1926-p148.png) | [File:Winnie-the-Pooh_148.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_148.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS | Piglet leans out of a squared window-hole; a separate small drawing shows a corked bottle lying on its side (message written and thrown). | leaf 138 | MATCH | Beat 3 (`piglet-bottle`) anchor, pre-completion state. |
| [shepard-1926-p150.png](shepard-1926-p150.png) | [File:Winnie-the-Pooh_150.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_150.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS | Pooh seated on a tree branch, flanked by roughly ten honey pots, diagonal rain streaking the scene. | leaf 141 | MATCH | Beat 2 (`honey-branch`) pick-screen and story-stage anchor. |
| [shepard-1926-p151.png](shepard-1926-p151.png) | [File:Winnie-the-Pooh_151.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_151.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | SUSPECT (resolved) | Pooh retrieving Piglet's corked bottle from the water: a rounded head breaks the surface beside a ribbed cylindrical bottle in one shared ripple ring, under sparse rain.  Not an ear or fin, the bottle, drawn small. | leaf 142 | MATCH; confirmed the bottle-retrieval scene, four days after 148 | Shipped as the source of record; not itself mounted (see `shepard-1926-p151-crop.png` below, fix round 1). |
| [shepard-1926-p151-crop.png](shepard-1926-p151-crop.png) | Derived from `shepard-1926-p151.png` above (pixel crop, box 350,190 to 1060,530 of the byte-identical file; no new Commons source or cross-verification, inherits the row above) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS (derivative) | Same scene as p151.png, cropped to fill more of the frame: the head-and-bottle cluster now occupies most of the image instead of a small fraction of a mostly-blank one. Fix round 1: the full plate read illegible at the story-stage anchor's actual display treatment (55% paper-rect opacity, under the procedural rain/tree layer); confirmed live by screenshot before and after, kept in the SDD workspace (`screens/beat3-postswap-*.png`, gitignored). | leaf 142 (inherited) | MATCH (inherited) | Beat 3 (`piglet-bottle`) anchor, post-completion state (swaps in once story-stage progress reaches 85% correct, mid-level, not only once every question is answered; caption swaps with it, see `FB_BEAT_CAPTIONS_SWAPPED`). |
| [shepard-1926-p152-1.png](shepard-1926-p152-1.png) | [File:Winnie-the-Pooh_152-1.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_152-1.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS | Pooh plunges head-down into rippled water, muzzle at the waterline, spray fanning right, under rain. | leaf 142 | MATCH | Beat 4 (`floating-launch`) pick-screen and story-stage anchor. |
| [shepard-1926-p152-2.png](shepard-1926-p152-2.png) | [File:Winnie-the-Pooh_152-2.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_152-2.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS | The honey jar itself rides the floodwater, ribbed and tilted, rain across the full width. | leaf 143 | MATCH | Beat 4 (`floating-launch`) story-stage secondary inset. |
| [shepard-1926-p153-1.png](shepard-1926-p153-1.png) | [File:Winnie-the-Pooh_153-1.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_153-1.png) | Chrisguise; Winnie-the-Pooh (1926); PD | PASS | Pooh astride his jar-boat, paddling with his feet, the Floating Bear pose, the module's namesake image. | leaf 143 | MATCH | MODULES registry `logoUrl` (launcher card). |
| [shepard-1926-p153-2.png](shepard-1926-p153-2.png) | [File:Winnie-the-Pooh_153-2.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_153-2.png) | Chrisguise; Winnie-the-Pooh (1926); PD | SUSPECT (resolved) | Christopher Robin's daily flood-marker-stick scene: crouched under an open umbrella, poking a marker stick into the ground to track the rising water.  Not digging, not a Pooh/Rabbit conference. | leaf 144 (printed p.126) | MATCH; confirmed the flood-marker-stick scene | Beat 5 (`brain-of-pooh`) story-stage secondary inset (rising-water motif). |
| [shepard-1926-p155.png](shepard-1926-p155.png) | [File:Winnie-the-Pooh_155.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_155.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS (`assets/verify-155.md`) | Pooh on all fours at the edge of the rising floodwater under heavy slanting rain, water splashing around his hind legs.  No other characters in frame. | leaf 146 (printed p.128) | MATCH | Not mounted.  Shipped as the plate-of-record companion to p156, which shares its printed page; kept in `art/` so the pair travels together and 156's crop has its sibling on hand. |
| [shepard-1926-p156.png](shepard-1926-p156.png) | [File:Winnie-the-Pooh_156.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_156.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS (`assets/verify-156.md`) | Pooh sits alone on the ground in heavy slanting rain, one paw raised to his chin, head bowed, thinking.  No other characters in frame. | leaf 146 (printed p.128) | MATCH | Source of `fb-scene-pooh-bank.png` (see below); the whole plate is not itself mounted. |
| [shepard-1926-p158.png](shepard-1926-p158.png) | [File:Winnie-the-Pooh_158.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_158.png) | Chrisguise; Winnie-the-Pooh (1926); PD | PASS | Christopher Robin bends over his upturned umbrella in the rain, Pooh climbing in. | leaf 148 (printed p.130) | MATCH | Beat 5 (`brain-of-pooh`) pick-screen and story-stage anchor. |
| [shepard-1926-p160-1.png](shepard-1926-p160-1.png) | [File:Winnie-the-Pooh_160-1.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_160-1.png) | Chrisguise; Winnie-the-Pooh (1926); PD | SUSPECT (resolved) | Owl perched on Piglet's tree, the setup beat one leaf before the rescue: same gnarled trunk, door/hole, hanging root and dashed shoreline as the 160-2 plate. | leaf 149 (printed p.131) | MATCH; confirmed genuine Owl-on-tree setup panel, one leaf before 160-2 | Beat 6 (`rescue`) anchor, pre-completion state. |
| [shepard-1926-p160-2.png](shepard-1926-p160-2.png) | [File:Winnie-the-Pooh_160-2.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_160-2.png) | Chrisguise; Winnie-the-Pooh (1926); PD (faint warm aging tone noted, not a color wash) | PASS | Christopher Robin in the umbrella-boat, one arm raised waving, Pooh climbing in amid splashes, the closing "Brain of Pooh" rescue vignette. | leaf 150 (printed p.132) | MATCH | Beat 6 (`rescue`) story-stage anchor, post-completion state only (never appears on the pick screen: `renderPick()` always passes progress 0, so the pick screen shows p160-1 instead, see the row above). |

## Scene Figure Crops (`fb-scene-*.png`)

The Floating Bear scene (`sceneSvg` in `Math-Multiverse.html`) draws its own weather, water,
bank and distant wood, and mounts Shepard's figures inside them as `<image>` elements.  Those
figures were procedural SVG paths until 26-0807; they are now the crops below.

Every crop is built by `art/tools/fb-scene-crops.py` from the plate named in its row, which is
left untouched.  Boxes are normalized `(x0, y0, x1, y1)` fractions of the source plate.  The
processing is the same three tonal steps in every case and nothing else.  **No linework is
redrawn, added, retouched, mirrored or reshaped.**

1. **Levels.**  A linear black-point / white-point stretch on the greyscale crop.  The black
   point sits at roughly the crop's own 1st percentile so its darkest existing ink reaches
   true black; the white point sits just under the scan's paper level so paper noise clears
   instead of leaving a grey veil.
2. **LANCZOS downscale** to the output width in the row.
3. **Paper knockout.**  Alpha is taken from the plate's own ink density (`alpha = 255 - L`) and
   the surviving ink is tinted to `#3a2b1c`, the colour the scene draws its own lines in.  A
   crop mounted opaque would sit on the scene as a white rectangle; knocked out, the scene's
   paper reads through it and plate line and drawn line read as one hand.

| File | Source Plate (inherits its row above) | Crop Box | Levels (black/white) | Output | Mount |
|---|---|---|---|---|---|
| [fb-scene-tree.png](fb-scene-tree.png) | `shepard-1926-p160-1.png` | 0.000, 0.000, 0.800, 0.845 | 35 / 238 | 760x631 | The scene's tree: trunk, door-hole, and the sweeping branch with Owl on it.  Replaces the drawn tree and its cloud-puff foliage entirely.  Cut at y 0.845 rather than through the trunk's midriff so the root swell at the base survives; cut at x 0.80 so the branch tip lands where the old drawn branch ended instead of overrunning the frame. |
| [fb-scene-pooh-bank.png](fb-scene-pooh-bank.png) | `shepard-1926-p156.png` | 0.345, 0.145, 0.725, 0.850 | 45 / 236 | 300x474 | The bear on the bank, beats 1-3 (before the jar-boat launches).  Box trimmed inside the plate's rain streaks on both sides, and taken down past his feet to keep the wet ground he sits on. |
| [fb-scene-pooh-boat.png](fb-scene-pooh-boat.png) | `shepard-1926-p153-1.png` | 0.145, 0.450, 0.855, 0.905 | 40 / 236 | 620x272 | The Floating Bear himself, the module's namesake: Pooh riding the honey-jar boat, drifting from launch toward Piglet as the level is answered.  The faintest of the sources (1st percentile luminance 30 inside this box, no true black), so it takes the hardest black-point lift; see the legibility note below. |
| [fb-scene-jar-1.png](fb-scene-jar-1.png) | `shepard-1926-p150.png` | 0.617, 0.388, 0.683, 0.612 | 45 / 236 | 110x212 | One of four honey pots hanging from the branch, cut from the six-pot row of p150.  The cloth-lidded tall pot. |
| [fb-scene-jar-2.png](fb-scene-jar-2.png) | `shepard-1926-p150.png` | 0.728, 0.425, 0.794, 0.612 | 45 / 236 | 110x177 | Honey pot 2: the darkest, most heavily ribbed of the row. |
| [fb-scene-jar-3.png](fb-scene-jar-3.png) | `shepard-1926-p150.png` | 0.553, 0.458, 0.6165, 0.612 | 45 / 236 | 110x152 | Honey pot 3: the wide-rimmed, cleanly outlined one. |
| [fb-scene-jar-4.png](fb-scene-jar-4.png) | `shepard-1926-p150.png` | 0.488, 0.440, 0.556, 0.612 | 45 / 236 | 110x157 | Honey pot 4, from the left of the row.  The pots in p150 touch, so each box is cut on a shared outline rather than in a gap, and each runs a little past the pot's foot into the branch hatching it stands on, which gives the pot a base to read against once it is lifted off the plate. |

**Boat legibility (the p153-1 call).**  p153-1 is faint, so a standby crop of the jar alone
riding the flood was also built, from `shepard-1926-p152-2.png` at box (0.380, 0.280, 0.850,
0.750), levels 60/236.  Measured on the real 304x143 stage at 1024x768, the p153-1 boat box
carries a **0.216** dark-pixel share (luminance < 150) with the scene alone behind it and
0.21-0.30 in live frames with the beat plate behind.  That is not washed out, and the p152-2
crop's heavier 0.390 turns out to be over-inked blot rather than legible line at that size.
**p153-1 ships**; the standby is not built and is not in `art/`, so it cannot rot unnoticed.

## Not Shipped

- Nothing.  All 13 checked plates are in `art/`; 155 is the only one carried without a mount
  of its own (see its row above).

## Notes on Optimization

Four shipped plates exceed the 300KB soft target after grayscale conversion and, where needed,
LANCZOS downscale to a 1200px max dimension: 146 (531,421 bytes), 153-2 (492,351 bytes), 158
(359,110 bytes), 160-1 (497,992 bytes).  Shipped as-is.  Shepard's fine cross-hatching for bark,
rain and shading resists PNG compression at this resolution, and a further downscale to 1000px
was evaluated and rejected: at that size the rain hatching on 146 and 160-1 begins to alias into
solid gray bands, which is a real loss of the linework the plates exist to show, not a neutral
file-size trade.  This is a known, accepted tradeoff carried over from the DRAFT, not an open
item.
