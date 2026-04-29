# Math Multiverse

5th-grade CCSS math practice across six themed worlds.  One self-contained HTML file, no dependencies, runs by double-click.

## Files

- **`Math-Multiverse.html`** — main launcher.  Opens to a section grid; pick a section, pick a level, play.
- **`HARDLINE-Fraction-Rider.html`** — original standalone fractions game.  Module 1 currently routes here while the campaign refactor is in flight.
- **`5th-Grade-Math-Practice-v1-26-0428.html`** — printable mixed-practice worksheet with answer key.
- `sur-ronster.webm`, `sur-ronster.jpg` — Fraction Rider video assets, must stay in the same folder.
- `archive/` — pre-git development history (Fraction Rider v1-v7).

## Sections (CCSS domains)

| # | Section                        | Domain                  | CCSS    | Status            |
|---|--------------------------------|-------------------------|---------|-------------------|
| 1 | HARDLINE Fraction Rider        | Fractions               | 5.NF    | Standalone live; campaign refactor pending |
| 2 | F1: Apex Decimals              | Decimals & Place Value  | 5.NBT   | Live (6 levels)   |
| 3 | Razor Crest Navigator          | Coordinate Plane        | 5.G     | Live (6 levels)   |
| 4 | LEGO Master Builder            | Volume                  | 5.MD.C  | Live (6 levels)   |
| 5 | Rocky's Dictionary             | Measurement Conversion  | 5.MD.A  | Live (6 levels)   |
| 6 | The Floating Bear              | Order of Operations     | 5.OA    | Live (6 levels)   |

Each section is a six-level campaign.  Level N+1 stays locked until Level N is cleared.  Clear all six to claim the section's grand goal.  Stars (1-3 per level) accumulate across the multiverse.

## Save

Progress is held in `localStorage` under `mathMultiverse.save.v1`.  Use the Export button to download a JSON backup; Import restores it on another machine.  Reset wipes everything.

## Roadmap

- [x] Modules 2-6: full 6-level inline campaigns
- [ ] Module 1 refactor: port HARDLINE Fraction Rider into the new shell with 6-level campaign
- [ ] Module-to-module unlock gating restored (currently all unlocked for play-test)
- [ ] Private GitHub Pages deploy after Pro upgrade for iPad / cross-device play
- [ ] Real driver photos / character imagery to swap into avatars (optional polish pass)
