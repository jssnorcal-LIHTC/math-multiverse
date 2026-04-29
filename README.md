# Math Multiverse

5th-grade CCSS math practice across six themed worlds.  Single HTML file, runs by double-click locally, or hosted on your home network for cross-device play.

## Quick start (single device)

Double-click `Math-Multiverse.html`.  It opens in your default browser.  Pick a section, pick a level, play.

## Cross-device play (iPad, phone, other laptop)

The Pages-with-private-auth path I originally suggested doesn't work on GitHub Pro -- private Pages requires GitHub Enterprise Cloud.  The clean alternative is **Tailscale + local server**, which gives full IP cover and works on every device in the household.

1. Install Tailscale on the Windows machine that hosts the game: https://tailscale.com/download/windows.  Sign in with Google or GitHub.  (Free for personal use.)
2. Install Tailscale on the iPad: App Store -> "Tailscale".  Sign in with the same account.
3. Double-click `start-server.bat`.  It launches a local HTTP server on port 8765 and opens the game in your browser.  Leave the window open while the kid is playing.
4. On the iPad, find the Windows machine's Tailscale IP (Tailscale tray menu on Windows, looks like `100.x.x.x`).
5. iPad Safari -> `http://100.x.x.x:8765/Math-Multiverse.html` -> bookmark.
6. Done.  Game runs from your house, only Tailnet-authed devices on your account can reach it.

## Files

- **`Math-Multiverse.html`** -- main launcher and all six modules.
- **`HARDLINE-Fraction-Rider.html`** -- original standalone fractions game (legacy; the inline port in the launcher supersedes it).
- **`5th-Grade-Math-Practice-v1-26-0428.html`** -- printable mixed-practice worksheet with answer key.
- `sur-ronster.webm`, `sur-ronster.jpg` -- Fraction Rider video assets.
- `start-server.bat` -- one-click local HTTP server.
- `archive/` -- pre-git development history.

## Sections (CCSS domains)

| # | Section                        | Domain                  | CCSS    | Levels |
|---|--------------------------------|-------------------------|---------|--------|
| 1 | HARDLINE Fraction Rider        | Fractions               | 5.NF    | 6      |
| 2 | F1: Apex Decimals              | Decimals & Place Value  | 5.NBT   | 6      |
| 3 | Razor Crest Navigator          | Coordinate Plane        | 5.G     | 6      |
| 4 | LEGO Master Builder            | Volume                  | 5.MD.C  | 6      |
| 5 | Rocky's Dictionary             | Measurement Conversion  | 5.MD.A  | 6      |
| 6 | The Floating Bear              | Order of Operations     | 5.OA    | 6      |

Each section is a six-level campaign.  Level N+1 stays locked until Level N is cleared.  Completing all six levels of a section unlocks the next section and claims the section's grand goal.  Section 1 (Fraction Rider) is unlocked by default; Sections 2-6 unlock progressively.

## Save

Progress lives in browser localStorage under `mathMultiverse.save.v1`.  Use the **Export** button to download a JSON backup; **Import** restores it on another machine; **Reset** wipes everything.  Saves are per-browser, so playing on the iPad keeps a separate save unless you Export/Import between devices.

## Dev notes

- Module 1 (Fraction Rider) inline port preserves the Sur Ronster video, danger meter, and crash overlay from the standalone.
- Authentic logos (F1, Red Bull, Ferrari, Mercedes, McLaren, Star Wars, The Mandalorian, LEGO, NASA, Shepard's 1926 Hundred Acre Wood map) load from Wikipedia/Wikimedia hotlinks; each has an `onerror` fallback to inline SVG.
- Save reconcile honors metadata `unlocked: true` as a forcing override (lets you re-flip a default-unlock without wiping existing saves) but leaves saves marked unlocked-through-play untouched when metadata says locked.
