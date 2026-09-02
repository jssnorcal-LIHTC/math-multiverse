'use strict';
// figure-contact-sheet.js -- renders a pack's figures IN THE REAL SHELL and composes a contact sheet
// a human can look at.
//
//   node tests/figure-contact-sheet.js <packId> [--out handoffs/renders-26-0901]
//
// NOT A GATE, and not run by npm test. It produces evidence for the pixel review the plan requires
// before an A-wave merges. Its whole reason for existing is that no automated check in this repo can
// see what a figure LOOKS like: tests/figure-derive.js proves a figure regenerates from its own data,
// tests/figure-fidelity.js proves it says only what its passage says and draws everything it claims,
// and both of those were green on all four of the layout defects found in W0 by opening a PNG.
//
// WHY IT DRIVES THE REAL APP rather than rendering the SVGs on a blank page. The V1 fixture used a
// 604-character passage, and against every REAL passage the figure strip then sat below the fold.
// A figure that reads perfectly in isolation and is never seen is not a figure. So every frame here
// is captured from Math-Multiverse.html at 1024x768, through the real engine and the real CSS, with
// the pack's own passages at their own length.
//
// FRAMES, per pack:
//   passage-Ln   the level's opening screen: a real passage, its figure strip, and the item rail
//   lightbox-<figureId>   every figure as a reader sees it when they tap the strip
// The level REVEAL is deliberately not shot here: it is verified end to end by
// `tests/play-level.js --unlock`, which drives a whole level and reports the tile count, and a
// screenshot of a card this file lifted by hand would be weaker evidence than that.

const fs = require('fs');
const path = require('path');
const http = require('http');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  try { ({ chromium } = require('playwright-core')); }
  catch (e2) {
    console.error('figure-contact-sheet: neither "playwright" nor "playwright-core" is installed.');
    process.exit(2);
  }
}

const ROOT = path.resolve(__dirname, '..');
const VIEWPORT = { width: 1024, height: 768 };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(String(req.url).split('?')[0]);
      const p = path.join(ROOT, rel);
      if (!p.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(p, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const args = process.argv.slice(2);
const packId = args[0];
const outIdx = args.indexOf('--out');
const OUT_DIR = path.join(ROOT, outIdx !== -1 ? args[outIdx + 1] : 'handoffs/renders-26-0901');
if (!packId) { console.error('usage: node tests/figure-contact-sheet.js <packId> [--out <dir>]'); process.exit(2); }

const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', packId + '.json'), 'utf8'));
const figures = (pack.figures || []).filter((f) => f && f.gen === true);
if (!figures.length) { console.error(`figure-contact-sheet: ${packId} declares no generated figures`); process.exit(2); }

const note = (m) => console.log('  ' + m);

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const dir = path.join(OUT_DIR, packId);
  fs.mkdirSync(dir, { recursive: true });

  const launchOpts = { headless: true, args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOpts);
  const frames = [];
  const jsErrors = [];

  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('pageerror', (e) => jsErrors.push(String(e.message)));

    // Every level open, so each level's first screen is reachable.
    await page.addInitScript(([id, cleared]) => {
      try {
        localStorage.setItem('multiverse.packs.v1', JSON.stringify({
          version: 1,
          packs: { [id]: { levelsCleared: cleared, levelStars: [], levelBest: [] } },
          analytics: { perTopic: {}, recentMistakes: [], coachShown: {}, totalAttempted: 0, totalCorrect: 0 },
          lastSaved: 0,
        }));
      } catch (e) { /* private mode: levels read as locked and the run fails loudly below */ }
    }, [packId, (pack.levels || []).length]);

    const title = (pack.meta && pack.meta.title) || packId;

    async function openLevel(i) {
      await page.goto(`${base}/Math-Multiverse.html`, { waitUntil: 'networkidle' });
      await page.locator('#btn-grade-6').click();
      const card = page.locator('.module-card', { hasText: title }).first();
      await card.waitFor({ state: 'visible', timeout: 15000 });
      await card.click();
      const levelCard = page.locator('#level-grid .level-card').nth(i);
      await levelCard.waitFor({ state: 'visible', timeout: 15000 });
      await levelCard.click();
      await page.locator('.mv-shell').waitFor({ state: 'visible', timeout: 15000 });
      const begin = await page.$('.mv-briefing-begin');
      if (begin) { await begin.click(); await page.waitForTimeout(200); }
      await page.locator('.mv-item').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(250);
    }

    // ---- one in-situ frame per level: a real passage at its real length, with strip and rail ----
    for (let i = 0; i < (pack.levels || []).length; i++) {
      await openLevel(i);
      const seen = await page.evaluate(() => {
        const strip = document.querySelector('.mv-figs');   // engine/figures.js:64 names it mv-figs
        const p = document.querySelector('.mv-passage');
        return {
          hasStrip: !!strip,
          thumbs: strip ? strip.querySelectorAll('img').length : 0,
          passageChars: p ? (p.textContent || '').length : 0,
          // Does the strip sit ABOVE the fold, which is the thing the V1 fixture got wrong?
          stripTop: strip ? Math.round(strip.getBoundingClientRect().top) : null,
          stripBottom: strip ? Math.round(strip.getBoundingClientRect().bottom) : null,
        };
      });
      const file = path.join(dir, `passage-L${i + 1}.png`);
      await page.screenshot({ path: file });
      frames.push({ label: `L${i + 1} passage + strip + rail`, file });
      note(`L${i + 1}: passage ${seen.passageChars} chars, strip ${seen.hasStrip ? 'present' : 'ABSENT'}`
        + `${seen.hasStrip ? ` (${seen.thumbs} thumb, y ${seen.stripTop}..${seen.stripBottom}` : ''}`
        + `${seen.hasStrip ? (seen.stripBottom <= VIEWPORT.height ? ', above the fold)' : ', BELOW THE FOLD)') : ''}`);
    }

    // ---- every figure in the lightbox, which is where a reader actually reads it ----
    await openLevel(0);
    await page.evaluate((p) => { window.__MV_CONTACT_PACK__ = p; }, pack);
    for (const f of figures) {
      // Opened through the engine's own openLightbox with the real pack, which is the same call the
      // strip button is bound to (engine/figures.js:78). Every figure gets a frame this way, including
      // the ones whose passage the level did not happen to serve.
      const ok = await page.evaluate((id) => {
        const api = window.MVFigures;
        if (!api || !api.openLightbox) return 'no MVFigures.openLightbox';
        const pk = window.__MV_CONTACT_PACK__;
        if (!pk) return 'pack not staged';
        try { api.openLightbox(pk, id); } catch (e) { return String(e.message); }
        return document.querySelector('.mv-lb-frame') ? 'ok' : 'no lightbox opened';
      }, f.id);
      if (ok !== 'ok') { note(`lightbox ${f.id}: ${ok}`); continue; }
      await page.waitForTimeout(180);
      const file = path.join(dir, `lightbox-${f.id}.png`);
      await page.screenshot({ path: file });
      frames.push({ label: `lightbox ${f.id}`, file });
      await page.evaluate(() => { try { window.MVFigures.closeLightbox(); } catch (e) { /* already closed */ } });
      await page.waitForTimeout(80);
    }

    // ---- compose in the browser: node_modules holds playwright only, no image library ----
    const cells = frames.map((fr) => {
      const b64 = fs.readFileSync(fr.file).toString('base64');
      return '<figure style="margin:0"><figcaption style="font:13px system-ui;color:#e8eef7;padding:6px 2px">'
        + fr.label.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        + '</figcaption><img src="data:image/png;base64,' + b64 + '" style="width:100%;display:block;border:1px solid #333"></figure>';
    }).join('');
    await page.setViewportSize({ width: 2140, height: 1200 });
    await page.setContent('<body style="margin:0;background:#05070a"><div style="display:grid;'
      + 'grid-template-columns:1fr 1fr;gap:12px;padding:12px">' + cells + '</div></body>');
    const sheet = path.join(OUT_DIR, `${packId}-contact.png`);
    await page.screenshot({ path: sheet, fullPage: true });
    note(`contact sheet: ${sheet}`);
    console.log(`\nfigure-contact-sheet: ${frames.length} frame(s) for ${packId}, ${jsErrors.length} JS error(s)`);
    jsErrors.forEach((e) => console.log('  JS ERROR: ' + e));
    process.exitCode = jsErrors.length ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(2); });
