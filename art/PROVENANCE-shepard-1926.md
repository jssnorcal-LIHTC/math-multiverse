# Shepard 1926 Plates: Provenance (FINAL)

E. H. Shepard's 1926 illustrations for *Winnie-the-Pooh*, Chapter IX ("In Which Piglet Is
Entirely Surrounded by Water"), as shipped in the Floating Bear module.  This supersedes
`.superpowers/sdd/floating-bear/PROVENANCE-shepard-1926-DRAFT.md`, which remains the working
record (13 plates checked, including the two not shipped here) and should be consulted for the
full sourcing-workflow narrative.  This file carries rows for shipped plates only.

**Summary.**  11 of 13 checked plates ship (12 files in `art/`: p151.png ships as the source
of record but is not itself mounted; a pixel-crop derivative, `p151-crop.png`, is mounted in
its place, see the fix-round-1 row below).  10 PASS on first pass; 3 (151, 153-2, 160-1) were
flagged SUSPECT on scene-mapping grounds only, art authenticity and Commons provenance clean on
all three.  Cross-verification against the pinned archive.org reference resolved all 3: each
depicts a real, correctly-placed plate from the same flood sequence, just not the plate the
original scene guess expected.  All 3 ship with corrected captions and mounts reflecting the
resolved scene.  Plates 155 and 156 (two small vignettes on the reference's p.128) are not
referenced by `FB_BEATS` and have no meaningful mount distinct from plates already shipped for
adjacent beats; per the governing task instructions, unused files are not copied into `art/`.

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
| [shepard-1926-p151-crop.png](shepard-1926-p151-crop.png) | Derived from `shepard-1926-p151.png` above (pixel crop, box 350,190 to 1060,530 of the byte-identical file; no new Commons source or cross-verification, inherits the row above) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS (derivative) | Same scene as p151.png, cropped to fill more of the frame: the head-and-bottle cluster now occupies most of the image instead of a small fraction of a mostly-blank one. Fix round 1: the full plate read illegible at the story-stage anchor's actual display treatment (55% paper-rect opacity, under the procedural rain/tree layer); confirmed live by screenshot before and after, kept in the SDD workspace (`screens/beat3-postswap-*.png`, gitignored). | leaf 142 (inherited) | MATCH (inherited) | Beat 3 (`piglet-bottle`) anchor, post-completion state (swaps in once the level's questions are answered; caption swaps with it, see `FB_BEAT_CAPTIONS_SWAPPED`). |
| [shepard-1926-p152-1.png](shepard-1926-p152-1.png) | [File:Winnie-the-Pooh_152-1.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_152-1.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS | Pooh plunges head-down into rippled water, muzzle at the waterline, spray fanning right, under rain. | leaf 142 | MATCH | Beat 4 (`floating-launch`) pick-screen and story-stage anchor. |
| [shepard-1926-p152-2.png](shepard-1926-p152-2.png) | [File:Winnie-the-Pooh_152-2.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_152-2.png) | Chrisguise; Winnie-the-Pooh (1926); PD (PD-old-auto-expired) | PASS | The honey jar itself rides the floodwater, ribbed and tilted, rain across the full width. | leaf 143 | MATCH | Beat 4 (`floating-launch`) story-stage secondary inset. |
| [shepard-1926-p153-1.png](shepard-1926-p153-1.png) | [File:Winnie-the-Pooh_153-1.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_153-1.png) | Chrisguise; Winnie-the-Pooh (1926); PD | PASS | Pooh astride his jar-boat, paddling with his feet, the Floating Bear pose, the module's namesake image. | leaf 143 | MATCH | MODULES registry `logoUrl` (launcher card). |
| [shepard-1926-p153-2.png](shepard-1926-p153-2.png) | [File:Winnie-the-Pooh_153-2.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_153-2.png) | Chrisguise; Winnie-the-Pooh (1926); PD | SUSPECT (resolved) | Christopher Robin's daily flood-marker-stick scene: crouched under an open umbrella, poking a marker stick into the ground to track the rising water.  Not digging, not a Pooh/Rabbit conference. | leaf 144 (printed p.126) | MATCH; confirmed the flood-marker-stick scene | Beat 5 (`brain-of-pooh`) story-stage secondary inset (rising-water motif). |
| [shepard-1926-p158.png](shepard-1926-p158.png) | [File:Winnie-the-Pooh_158.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_158.png) | Chrisguise; Winnie-the-Pooh (1926); PD | PASS | Christopher Robin bends over his upturned umbrella in the rain, Pooh climbing in. | leaf 148 (printed p.130) | MATCH | Beat 5 (`brain-of-pooh`) pick-screen and story-stage anchor. |
| [shepard-1926-p160-1.png](shepard-1926-p160-1.png) | [File:Winnie-the-Pooh_160-1.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_160-1.png) | Chrisguise; Winnie-the-Pooh (1926); PD | SUSPECT (resolved) | Owl perched on Piglet's tree, the setup beat one leaf before the rescue: same gnarled trunk, door/hole, hanging root and dashed shoreline as the 160-2 plate. | leaf 149 (printed p.131) | MATCH; confirmed genuine Owl-on-tree setup panel, one leaf before 160-2 | Beat 6 (`rescue`) anchor, pre-completion state. |
| [shepard-1926-p160-2.png](shepard-1926-p160-2.png) | [File:Winnie-the-Pooh_160-2.png](https://commons.wikimedia.org/wiki/File:Winnie-the-Pooh_160-2.png) | Chrisguise; Winnie-the-Pooh (1926); PD (faint warm aging tone noted, not a color wash) | PASS | Christopher Robin in the umbrella-boat, one arm raised waving, Pooh climbing in amid splashes, the closing "Brain of Pooh" rescue vignette. | leaf 150 (printed p.132) | MATCH | Beat 6 (`rescue`) pick-screen and story-stage anchor, post-completion state. |

## Not Shipped

- **155, 156** (two small vignettes sharing the reference's leaf 146 / printed p.128: Pooh
  wading at the water's edge; Pooh seated in a pondering pose).  Both PASS on sourcing and
  cross-verification (see DRAFT), but neither is referenced by `FB_BEATS` and neither adds a
  scene distinct from the plates already mounted for the adjacent beats (152-1 and 152-2 cover
  the jump-in-the-water beat, 158 covers the reunion).  Left in `assets/opt/`, not copied into
  `art/`, per the no-unused-files rule.

## Notes on Optimization

Four shipped plates exceed the 300KB soft target after grayscale conversion and, where needed,
LANCZOS downscale to a 1200px max dimension: 146 (531,421 bytes), 153-2 (492,351 bytes), 158
(359,110 bytes), 160-1 (497,992 bytes).  Shipped as-is.  Shepard's fine cross-hatching for bark,
rain and shading resists PNG compression at this resolution, and a further downscale to 1000px
was evaluated and rejected: at that size the rain hatching on 146 and 160-1 begins to alias into
solid gray bands, which is a real loss of the linework the plates exist to show, not a neutral
file-size trade.  This is a known, accepted tradeoff carried over from the DRAFT, not an open
item.
