# Badge SVGs: Provenance

Two flat-emblem SVG badges for the pack launcher shelf (`packCardNode`, `Math-Multiverse.html`),
mirroring `mathCardNode`'s existing `logoUrl`/`mc-icon` pattern (a manifest-level `badgeUrl`, with
the shell's `onerror` falling back to the same emoji `mc-icon` every pack already renders today).

| File | Author | Date | Licence basis |
|---|---|---|---|
| [outpost-protocol.svg](outpost-protocol.svg) | Original work for this project (Claude, Task 7 of the Multiverse visual-engine V1 plan) | 26-0810 | Original work; no third-party source, no Commons/archive reference to pin. |
| [provenance-office.svg](provenance-office.svg) | Original work for this project (Claude, Task 7 of the Multiverse visual-engine V1 plan) | 26-0810 | Original work; no third-party source, no Commons/archive reference to pin. |

Both are built, geometric flat emblems, authored directly as SVG markup: a circular seal (dark
disc, pack-accent ring) and one bold central glyph. Neither traces, derives from, or reuses any
drawing from `art/PROVENANCE-shepard-1926.md`'s Shepard plates or any other file under `art/`.

- `outpost-protocol.svg` carries the `#1a8f5e` accent of `outpost-protocol-g6` (Science, "Outpost
  Protocol") and a beacon/signal-arc glyph.
- `provenance-office.svg` carries the `#8b5e34` accent of `firsthand-g6` (History, "Firsthand")
  and a magnifying-glass glyph.

**No text, by design, fixed round 1.** The first version of both files set a top-arc pack title at
`font-size="15"`, matching `MVFigures.TOKENS.minFont`, the engine's 15px floor for figure chrome --
correct for a full-size plate, wrong here. `packCardNode` renders these through `.mc-logo`, which
is `height: 26px; width: auto` (`Math-Multiverse.html:375-376`) against this file's `120x120`
viewBox, a `26/120 = 0.2167` scale factor; a device pixel ratio only adds physical pixels per CSS
pixel and does not change that scale factor. 15 viewBox units therefore render at `15 * 0.2167 =
3.25px`, an illegible smudge, not a word. Both files were redrawn with no text at all -- the pack
title already sits next to the badge in the card -- and every remaining stroke was re-sized against
the SAME 0.2167 factor rather than its own viewBox width: the accent ring and glyph strokes are all
10-11 viewBox units, rendering at 2.17-2.38 CSS px, comfortably clear of the ~1px point where a
stroke anti-aliases into grey mush. Confirmed live (Chromium, 1024x768, DPR 1/2/3): see
`task-7-report.md`'s rendered-evidence section for the actual measured `getBoundingClientRect`
numbers.
