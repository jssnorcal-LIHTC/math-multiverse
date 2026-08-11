# Outpost Protocol (G6, Science): Provenance

Scaffold only.  No figure has been sourced yet for this pack; this file exists so the sourcing
rule below is binding before the first asset lands, not written after the fact to explain one.

**Sourcing rule for this phase.**  CC0, US-federal-PD (NASA, NOAA, USGS, and similar), or
verified-PD-by-edition only.  No British Museum photography and no Louvre photography, regardless
of the underlying work's public-domain status, because both institutions assert their own
photographic copyright over PD originals.  Every candidate asset gets verified and logged in the
table below BEFORE any pack file references it; a figure entering `packs/outpost-protocol-g6.json`
without a row here first is itself the defect, not a formatting gap to fix later.

## Per-Figure Provenance

| Figure ID | File | Institution | Accession / Image ID | Licence Basis | Source URL | Retrieved | Evidence Note |
|---|---|---|---|---|---|---|---|
| fig-body-systems (Nervous view) | gray-nervous.png | Internet Archive (scan of Henry Gray, *Anatomy of the Human Body*, Philadelphia: Lea & Febiger, 1918) | IA identifier `anatomyofhumanbo00grayrich`, leaf 918 (Fig. 797) | Verified-PD-by-edition (published 1918, author Henry Gray d. 1861, illustrator Henry Vandyke Carter d. 1897): public domain | https://archive.org/details/anatomyofhumanbo00grayrich (page 918) | 2026-08-11 | IA's own catalog metadata records `date: 1918`, `publisher: Lea & Febiger`.  The plate itself is captioned in print, "FIG. 797. Distribution of cutaneous nerves. Ventral aspect."  (the original typesets a dash after the figure number, rendered here as a period).  Cross-checked against Wikimedia's independent Bartleby digitization (File:Gray797.png, extmetadata Credit: "Henry Gray (1918) Anatomy of the Human Body" / Bartleby.com Plate 797), which carries the same caption, the same plate number, and the same 1918 credit, corroborating the edition.  Sourced from IA's raw page scan rather than Wikimedia's copy because Wikimedia's is only 418x850px, below the 1600px floor; IA's native page scan is 2254x3840, cropped to the figure and downsized to 1058x1900 (long edge 1900) for the pack asset. |
| fig-body-systems (Skeletal view) | outpost-skeleton-diagram.svg | This pack (original) | n/a | Original work created for this task: no licence question | n/a | 2026-08-11 | No genuinely whole-body, single-plate, front-view skeleton chart exists in the public-domain sources checked for this task (see Rejected Candidates below).  Built as a labeled line diagram in the pack's own V1 visual language (ink `#e8eef7`, accent `#1a8f5e`, matches `engine/figures.js` TOKENS) instead of misattributing a regional antique plate as "whole body." |
| fig-body-systems (Muscular view) | outpost-muscle-diagram.svg | This pack (original) | n/a | Original work created for this task: no licence question | n/a | 2026-08-11 | Same finding as the Skeletal view: no whole-body, single-plate, front-view muscle chart exists in the sources checked.  Built as a labeled line diagram in the same visual language, so the carousel reads as one figure with three comparable system views. |

## Rejected Candidates

Logged here, not silently swapped out.  A candidate that fails the sourcing rule, fails a scene
match, or fails on image quality gets a row instead of a quiet substitution, so the next task
inherits the miss rather than repeating the search.

| Candidate | Institution | Source URL | Rejected Because |
|---|---|---|---|
| Gray's Anatomy, 1918, Osteology chapter (whole-skeleton plate) | Internet Archive / Bartleby-Wikimedia | https://archive.org/details/anatomyofhumanbo00grayrich | Checked the chapter opener and the "Development of the Skeleton" pages directly (leaves 79-82): no whole-body composite plate exists.  The whole book, verified across the Bartleby-derived Wikimedia numbering too, treats bones region by region (skull, vertebrae, ribs, limbs as separate plates); no single "anterior, whole skeleton" figure. |
| Gray's Anatomy, 1918, Myology and Surface Anatomy chapters (whole-muscle plate) | Internet Archive | https://archive.org/details/anatomyofhumanbo00grayrich | Checked the Surface Anatomy chapter opener (leaves 1284-1290): regional only (head and neck shown as its own plate, "FIG. 1194/1195").  No whole-body anterior muscular figure anywhere in the edition. |
| Sobotta & McMurrich, *Atlas and Text-Book of Human Anatomy* (Saunders, 1904/1914) | Internet Archive | https://archive.org/details/atlastextbookofh01sobouoft | Checked the first 40 leaves of the Osteology volume directly (contact sheet reviewed): individual vertebrae, ribs, and skull-bone plates only, same regional pattern as Gray's.  No whole-skeleton orientation plate. |
| Martin, *The Human Body* (Holt, 1898, a school-level physiology text, a different genre from the two above) | Internet Archive | https://archive.org/details/cu31924003689886 | Full-text search of the entire book found "Fig. 17, The skeleton of the arm and leg" and "Fig. 18, The skeleton of the trunk and the limb arches, front view" as two SEPARATE regional figures, and "Fig. 29/30, Back/Front view of the muscles of the trunk" (trunk only).  Even a lay/school text of the era splits the body into regions rather than showing one whole standing figure. |
