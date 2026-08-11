'use strict';
// figures-offline.js -- the figures-offline gate (Task 8).
//
// Every figure-bearing asset the game references -- a passage's figure strip, a plate's per-view
// image and overlay, a manifest shelf badge -- must actually decode with NO real network available.
// A `fetch()` can succeed on bytes it never parses (this is exactly how the two badge SVGs shipped
// in Task 7 briefly carried an invalid XML comment with no console error and no throw: Chromium's
// <img> decoder silently gave up), so the oracle here is `new Image()` + `naturalWidth > 0`, run
// inside a real Chromium with every non-localhost request aborted at the network layer. That last
// part is what makes "offline" a guarantee rather than an assertion: the browser is handed nothing
// but the local static server below, so a defect that only a real decoder would catch cannot hide
// behind a network fetch that happened to succeed against someone else's CDN.
//
// NOT-ARMED CONTRACT: no real pack declares `figures` yet (Task 8 through the current phase), so the
// real-pack sweep below finds zero targets every time this runs today. A gate that discovers zero
// targets and reports clean anyway is the silent-clean failure this project bans hardest, so this
// gate refuses that shape structurally: finding zero real figure-bearing packs prints the NOT-ARMED
// banner and then runs BOTH fixture controls (tests/fixtures/vis-demo/, never registered in the real
// packs/manifest.json) -- a positive control (every fixture asset loads offline and the real
// MVFigures.renderStrip/openLightbox/showPackLevelComplete render it) and a negative control (one
// fixture src pointed at a file that does not exist, and the gate asserts THAT failure fires). Both
// controls failing is exit 1 even while NOT ARMED; only "both controls green" earns exit 0 on the
// NOT-ARMED path. The moment a real pack ships `figures`, the sweep below picks it up automatically
// and the sampled-render integration exercises the real pack instead of the fixture.
//
// Manifest shelf badges (`badgeUrl`) are checked unconditionally, independent of the ARMED/NOT-ARMED
// figures state above: they are declared on `packs/manifest.json` entries, not inside a pack's own
// `figures` array, so validate-pack's figure rules never see them and this is their only gate.
//
//   node tests/figures-offline.js
//   PLAYWRIGHT_EXECUTABLE_PATH="C:\\...\\chrome.exe" node tests/figures-offline.js
//
// GPU note (this machine): always launches with --disable-gpu to avoid the Intel TDR display freeze.
// Exit 0 clean, 1 on any failure (including a failing control), 2 on a harness error.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e1) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) { console.error('figures-offline: neither "playwright" nor "playwright-core" is installed.'); process.exit(2); }
}

const ROOT = path.join(__dirname, '..');
const VIEWPORT = { width: 1024, height: 768 };
const NOT_ARMED_BANNER = 'figures-offline: NOT ARMED (no real pack declares figures); fixture controls ran';

// Prove-the-prover lever (see task-8-report.md): this is the src the negative control expects to
// FAIL to load. During implementation this constant was temporarily pointed at a real fixture file
// to confirm the gate goes RED when the control's own assertion is violated, then reverted to this
// genuinely nonexistent path. Do not "fix" this path to point at a real file; that is the defect
// this control exists to catch, not a bug in this file.
const NEG_CONTROL_BROKEN_SRC = 'tests/fixtures/vis-demo/does-not-exist.png';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const filePath = path.join(ROOT, urlPath === '/' ? '/Math-Multiverse.html' : urlPath);
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Loads `src` (a repo-relative path, resolved against the page's own origin) as a real <img> inside
// the page. Runs entirely in-browser, not via Node's fs or an out-of-page fetch, so the network
// block on `context` below actually governs it -- an out-of-page check would prove nothing about
// what the child's browser can actually reach.
async function checkImage(page, src) {
  return page.evaluate((s) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ ok: false });
    img.src = s;
  }), src);
}

// Every asset a figures array declares, flattened with enough identity to name the offender: a
// plate contributes one entry per view's src plus one per view's overlaySrc (when present); every
// other kind contributes its own src.
function figureAssets(figures) {
  const out = [];
  for (const f of (figures || [])) {
    if (!f) continue;
    if (f.kind === 'plate' && Array.isArray(f.views)) {
      f.views.forEach((v, i) => {
        if (v && v.src) out.push({ figureId: f.id, field: `views[${i}].src`, src: v.src });
        if (v && v.overlaySrc) out.push({ figureId: f.id, field: `views[${i}].overlaySrc`, src: v.overlaySrc });
      });
    } else if (f && f.src) {
      out.push({ figureId: f.id, field: 'src', src: f.src });
    }
  }
  return out;
}

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const launchOpts = { headless: true, args: ['--disable-gpu', '--disable-gpu-compositing'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  else if (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')) {
    launchOpts.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }

  const browser = await chromium.launch(launchOpts);
  // One context for the whole run: every page born from it inherits this route, so "offline" is an
  // enforced guarantee (the request is actually aborted) rather than an assumption nothing here
  // happens to violate.
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith('data:')) return route.continue();
    return route.abort();
  });

  const problems = [];
  const note = (m) => console.log('  ' + m);

  const page = await context.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e && e.message)));

  try {
    await page.goto(`${base}/Math-Multiverse.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Lesson 29 (smoke.js): SHELVES is a bare top-level `let`, reachable as an identifier but NOT a
    // window property, and it is only complete once the manifest fetch resolves. Waiting on the
    // registry itself, not a selector, is what makes everything after this deterministic.
    await page.waitForFunction(
      () => typeof SHELVES !== 'undefined' && SHELVES.some((s) => s.subject === 'ela'),
      { timeout: 15000 },
    ).catch(() => problems.push('boot: pack manifest never reached SHELVES (fetch failed or engine did not load)'));
    note('boot: launcher up, SHELVES populated');

    // ---------------------------------------------------------------------------------------------
    // Section A: manifest badgeUrl sweep. Always runs, independent of the figures ARMED state below
    // -- badges live on the manifest entry, not inside a pack's own `figures` array, so nothing else
    // in this suite ever loads them.
    // ---------------------------------------------------------------------------------------------
    const manifest = await page.evaluate(async () => (await (await fetch('packs/manifest.json')).json()));
    const manifestPacks = (manifest && Array.isArray(manifest.packs)) ? manifest.packs : [];
    const badgeEntries = manifestPacks.filter((p) => p && p.badgeUrl);
    for (const p of badgeEntries) {
      const r = await checkImage(page, p.badgeUrl);
      if (!r.ok) problems.push(`badges: pack "${p.id}" badgeUrl "${p.badgeUrl}" failed to decode offline`);
      else note(`badges: pack "${p.id}" badgeUrl ok (${r.w}x${r.h})`);
    }
    if (!badgeEntries.length) note('badges: no manifest pack declares a badgeUrl');

    // ---------------------------------------------------------------------------------------------
    // Section B: real-pack figures sweep. Every manifest pack's own JSON is fetched and checked for
    // a `figures` array; every declared src (and every plate view/overlaySrc) across EVERY such pack
    // is offline-load-checked, not just the first. Zero found is what triggers NOT-ARMED below.
    // ---------------------------------------------------------------------------------------------
    const figureBearingPacks = [];
    for (const entry of manifestPacks) {
      const pack = await page.evaluate(async (id) => (await (await fetch(`packs/${id}.json`)).json()), entry.id);
      if (Array.isArray(pack.figures) && pack.figures.length) figureBearingPacks.push({ entry, pack });
    }
    for (const { entry, pack } of figureBearingPacks) {
      for (const asset of figureAssets(pack.figures)) {
        const r = await checkImage(page, asset.src);
        if (!r.ok) problems.push(`figures: pack "${entry.id}" figure "${asset.figureId}" (${asset.field}) failed to decode offline: ${asset.src}`);
      }
    }

    if (figureBearingPacks.length) {
      // -------------------------------------------------------------------------------------------
      // ARMED: sampled render integration against the FIRST figure-bearing real pack. Unreachable
      // today (no shipped pack declares figures) and therefore unexecuted by this run; written to
      // spec so the moment a pack ships figures this exercises the real code path with no further
      // changes here. See task-8-report.md for the explicit "unverified live" caveat.
      // -------------------------------------------------------------------------------------------
      try {
        await sampledRenderIntegration(page, figureBearingPacks[0], problems, note);
      } catch (e) {
        problems.push('armed sampled-render integration threw: ' + (e && e.message));
      }
    } else {
      // -------------------------------------------------------------------------------------------
      // NOT-ARMED: banner, then both fixture controls. Controls failing is exit 1 even here.
      // -------------------------------------------------------------------------------------------
      console.log('\n' + NOT_ARMED_BANNER + '\n');
      await fixturePositiveControl(page, problems, note);
      await fixtureNegativeControl(page, problems, note);
    }

    await page.evaluate(() => { if (typeof exitToLauncher === 'function') exitToLauncher(); }).catch(() => {});
  } catch (e) {
    problems.push('harness failure inside the page/browser session: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n=== figures-offline: ${problems.length} problem(s), ${jsErrors.length} JS error(s) ===`);
  if (problems.length) { console.log('problems:'); problems.forEach((p) => console.log('  ' + p)); }
  if (jsErrors.length) { console.log('JS errors:'); jsErrors.forEach((e) => console.log('  ' + e)); }

  if (problems.length || jsErrors.length) { console.log('\nRESULT: FAILED'); process.exit(1); }
  console.log('\nRESULT: ALL CLEAN');
  process.exit(0);
})().catch((e) => {
  console.error('figures-offline: harness error:', e && e.stack || e);
  process.exit(2);
});

// ===================================================================================================
// ARMED path (Step 2.3 of the brief): boot is already done by the caller. Opens the first
// figure-bearing pack through the real `window.openPack`/`window.playLevel` globals (the same
// call-through-window convention tests/smoke.js already uses for its own pack playthrough), finds a
// level whose passage declares figures, and asserts the strip geometry, the lightbox, the plate tab
// swap, and (when that level declares a reveal) that answering an mc item correctly turns a
// `.mv-reveal-strip` cell `found`.
// ===================================================================================================
async function sampledRenderIntegration(page, armedEntry, problems, note) {
  const { entry, pack } = armedEntry;
  const passagesById = new Map((pack.passages || []).map((p) => [p.id, p]));
  const itemsById = new Map((pack.items || []).map((i) => [i.id, i]));

  let targetLevelIdx = -1;
  (pack.levels || []).forEach((lv, i) => {
    if (targetLevelIdx !== -1) return;
    const hasFigPassage = (lv.itemIds || []).some((id) => {
      const it = itemsById.get(id);
      const ps = it && passagesById.get(it.passageId);
      return ps && Array.isArray(ps.figureIds) && ps.figureIds.length;
    });
    if (hasFigPassage) targetLevelIdx = i;
  });
  if (targetLevelIdx === -1) {
    problems.push(`armed: pack "${entry.id}" declares figures but no level's passage references any figureIds`);
    return;
  }

  await page.evaluate((id) => window.openPack(id), entry.id);
  await page.waitForSelector('#level-grid .level-card', { timeout: 8000 });

  // Pinned so a level whose pool mixes item types draws reproducibly, same discipline tests/smoke.js
  // uses for its own pack playthrough (and for the same reason: an unpinned draw fails for a reason
  // that has nothing to do with the code under test).
  await page.evaluate(() => {
    window.__realRandom = Math.random;
    let s = 7;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  });

  try {
    await page.evaluate((idx) => window.playLevel(idx), targetLevelIdx);
    await page.waitForSelector('.mv-passage, .mv-item', { timeout: 8000 });

    const figs = await page.evaluate(() => {
      const box = document.querySelector('.mv-figs');
      if (!box) return null;
      const r = box.getBoundingClientRect();
      const img = box.querySelector('.mv-fig-img');
      const ir = img ? img.getBoundingClientRect() : null;
      return { h: r.height, imgW: ir && ir.width, imgH: ir && ir.height, count: box.querySelectorAll('.mv-fig').length };
    });
    if (!figs) {
      problems.push(`armed: pack "${entry.id}" level ${targetLevelIdx} rendered with no .mv-figs strip despite its passage declaring figureIds`);
    } else {
      if (figs.h > 104) problems.push(`armed: pack "${entry.id}" .mv-figs rendered ${Math.round(figs.h)}px, over the 104px cap`);
      note(`armed: pack "${entry.id}" .mv-figs rendered ${Math.round(figs.h)}px, ${figs.count} thumb(s), first thumb ${Math.round(figs.imgW)}x${Math.round(figs.imgH)}`);

      await page.evaluate(() => document.querySelectorAll('.mv-fig')[0].click());
      const lb = await page.evaluate(() => !!document.querySelector('.mv-lightbox'));
      if (!lb) problems.push(`armed: pack "${entry.id}" tapping a figure thumb did not open .mv-lightbox`);

      const tabCount = await page.evaluate(() => document.querySelectorAll('.mv-plate-tab').length);
      if (tabCount > 1) {
        const before = await page.evaluate(() => document.querySelector('.mv-lb-img').src);
        await page.evaluate(() => document.querySelectorAll('.mv-plate-tab')[1].click());
        const after = await page.evaluate(() => document.querySelector('.mv-lb-img').src);
        if (before === after) problems.push(`armed: pack "${entry.id}" switching plate tabs did not change .mv-lb-img src`);
      }
      await page.evaluate(() => { const b = document.querySelector('.mv-lightbox'); if (b) b.click(); });
    }

    const lv = pack.levels[targetLevelIdx];
    if (lv.reveal) {
      const before = await page.evaluate(() => document.querySelectorAll('.mv-reveal-strip .mv-rv-cell.found').length);
      let answered = false;
      for (let guard = 0; guard < 10 && !answered; guard++) {
        const onScreen = await page.evaluate(() => {
          const item = document.querySelector('.mv-shell .mv-item');
          const s = item && item.querySelector('.mv-stem');
          return { text: ((s ? s.textContent : (item ? item.textContent : '')) || '').trim() };
        });
        const matched = [...itemsById.values()].find((it) => {
          const stem = it.type === 'ebsr' ? (it.partA && it.partA.stem) : it.stem;
          return stem && onScreen.text && onScreen.text.startsWith(stem.trim().slice(0, 30));
        });
        if (matched && ['mc', 'ms', 'ebsr'].includes(matched.type)) {
          const aKeys = matched.type === 'mc' ? [matched.key]
            : matched.type === 'ms' ? matched.key
              : [matched.partA.key];
          for (const k of aKeys) await page.evaluate((kk) => { const b = document.querySelector(`.mv-choice[data-idx="${kk}"]`); if (b) b.click(); }, k);
          if (matched.type === 'ebsr') {
            await page.waitForTimeout(80);
            const bIdx = matched.partB.key[String(matched.partA.key)];
            await page.evaluate((kk) => { const b = document.querySelectorAll('.mv-choice')[kk]; if (b) b.click(); }, bIdx);
          }
          await page.waitForTimeout(60);
          const check = await page.$('.mv-check');
          if (check) await check.click().catch(() => {});
          answered = true;
        } else {
          // Not a choice-based type this probe can key directly; re-roll the level's draw.
          await page.evaluate((idx) => window.playLevel(idx), targetLevelIdx);
          await page.waitForSelector('.mv-passage, .mv-item', { timeout: 8000 });
        }
      }
      if (!answered) problems.push(`armed: pack "${entry.id}" level ${targetLevelIdx} never drew a choice-based item this probe could answer within its guard`);
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => document.querySelectorAll('.mv-reveal-strip .mv-rv-cell.found').length);
      if (!(after > before)) problems.push(`armed: pack "${entry.id}" a correct answer did not turn a .mv-reveal-strip cell "found" (before=${before}, after=${after})`);
      else note(`armed: pack "${entry.id}" reveal-strip cell turned found after a correct answer (${before} -> ${after})`);
    }
  } finally {
    await page.evaluate(() => { if (window.__realRandom) { Math.random = window.__realRandom; delete window.__realRandom; } }).catch(() => {});
  }
}

// ===================================================================================================
// NOT-ARMED fixture controls (Step 2.4). Both are asserted against tests/fixtures/vis-demo/, served
// from disk by the same local server as everything else -- never added to the real
// packs/manifest.json.
// ===================================================================================================

async function loadFixture(page) {
  return page.evaluate(async () => ({
    pack: await (await fetch('tests/fixtures/vis-demo/pack.json')).json(),
    manifest: await (await fetch('tests/fixtures/vis-demo/manifest.json')).json(),
  }));
}

async function fixturePositiveControl(page, problems, note) {
  const { pack, manifest } = await loadFixture(page);
  const badgeUrl = manifest.packs[0].badgeUrl;

  // ---- every figure src + the manifest badgeUrl loads offline ----
  const assets = figureAssets(pack.figures).concat([{ figureId: 'manifest', field: 'badgeUrl', src: badgeUrl }]);
  for (const a of assets) {
    const r = await checkImage(page, a.src);
    if (!r.ok) problems.push(`positive control: fixture asset "${a.figureId}" (${a.field}) failed to decode offline: ${a.src}`);
    else note(`positive control: ${a.figureId}/${a.field} ok (${r.w}x${r.h}) -- ${a.src}`);
  }

  // ---- MVFigures.renderStrip, called directly, renders the real strip geometry ----
  await page.evaluate(() => {
    const o = document.createElement('div');
    o.id = 'fo-probe';
    o.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;overflow:auto;padding:14px;background:#0f1218;';
    document.body.appendChild(o);
  });
  try {
    const strip = await page.evaluate((pk) => {
      const host = document.querySelector('#fo-probe');
      const el = window.MVFigures.renderStrip(pk, ['fig-photo', 'fig-chart', 'fig-plate'], host);
      if (!el) return null;
      const figsEl = host.querySelector('.mv-figs');
      const r = figsEl.getBoundingClientRect();
      const img0 = figsEl.querySelectorAll('.mv-fig-img')[0].getBoundingClientRect();
      return { figsH: r.height, figCount: figsEl.querySelectorAll('.mv-fig').length, imgW: img0.width, imgH: img0.height };
    }, pack);
    if (!strip) {
      problems.push('positive control: MVFigures.renderStrip returned null/no element for the fixture pack');
    } else {
      if (strip.figCount !== 3) problems.push(`positive control: strip rendered ${strip.figCount} .mv-fig, expected 3`);
      // Asserted as the COMPOSED height (96px image + 1px border top/bottom = 98), not the
      // declared cap (104): a cap-only assertion cannot fail when the composed height quietly
      // grows past what the cap was meant to bound, which is exactly the shape of defect this
      // check exists to catch.
      if (Math.round(strip.figsH) !== 98) problems.push(`positive control: .mv-figs composed height is ${Math.round(strip.figsH)}px, expected 98px (96px image + 1px border top/bottom)`);
      if (strip.figsH > 104) problems.push(`positive control: .mv-figs rendered ${Math.round(strip.figsH)}px, over its own declared 104px cap`);
      if (Math.round(strip.imgW) !== 128 || Math.round(strip.imgH) !== 96) problems.push(`positive control: .mv-fig-img box is ${Math.round(strip.imgW)}x${Math.round(strip.imgH)}, expected 128x96`);
      note(`positive control: strip rendered ${strip.figCount} thumb(s), composed height ${Math.round(strip.figsH)}px, image box ${Math.round(strip.imgW)}x${Math.round(strip.imgH)}`);

      // ---- lightbox opens from a photo thumb ----
      await page.evaluate(() => document.querySelectorAll('#fo-probe .mv-fig')[0].click());
      const photoLb = await page.evaluate(() => {
        const lb = document.querySelector('.mv-lightbox');
        const img = lb && lb.querySelector('.mv-lb-img');
        return { present: !!lb, src: img ? img.src : null };
      });
      if (!photoLb.present) problems.push('positive control: tapping the photo thumb did not open .mv-lightbox');
      else if (!/f-photo\.png$/.test(photoLb.src)) problems.push(`positive control: lightbox opened the wrong image for the photo thumb: ${photoLb.src}`);
      await page.evaluate(() => { const b = document.querySelector('.mv-lightbox'); if (b) b.click(); });
      const closed = await page.evaluate(() => !document.querySelector('.mv-lightbox'));
      if (!closed) problems.push('positive control: clicking the lightbox background did not close it');

      // ---- plate thumb: two tabs, tab switch swaps the image and shows the overlay ----
      await page.evaluate(() => document.querySelectorAll('#fo-probe .mv-fig')[2].click());
      const plateBefore = await page.evaluate(() => ({
        tabs: document.querySelectorAll('.mv-plate-tab').length,
        src: document.querySelector('.mv-lb-img').src,
        overlay: !!document.querySelector('.mv-lb-overlay'),
      }));
      if (plateBefore.tabs !== 2) problems.push(`positive control: plate lightbox shows ${plateBefore.tabs} tab(s), expected 2`);
      if (!/plate-a\.png$/.test(plateBefore.src)) problems.push(`positive control: plate lightbox opened on the wrong view: ${plateBefore.src}`);
      if (plateBefore.overlay) problems.push('positive control: view A should carry no overlay, but .mv-lb-overlay is present');

      await page.evaluate(() => document.querySelectorAll('.mv-plate-tab')[1].click());
      const plateAfter = await page.evaluate(() => ({
        src: document.querySelector('.mv-lb-img').src,
        overlaySrc: (document.querySelector('.mv-lb-overlay') || {}).src,
        activeIdx: [...document.querySelectorAll('.mv-plate-tab')].findIndex((t) => t.classList.contains('active')),
      }));
      if (!/plate-b\.png$/.test(plateAfter.src)) problems.push(`positive control: tab switch did not swap .mv-lb-img to view B: ${plateAfter.src}`);
      if (!plateAfter.overlaySrc || !/plate-b-overlay\.svg$/.test(plateAfter.overlaySrc)) problems.push(`positive control: view B's overlay did not appear after the tab switch (got "${plateAfter.overlaySrc}")`);
      if (plateAfter.activeIdx !== 1) problems.push(`positive control: .active landed on tab index ${plateAfter.activeIdx}, expected 1`);
      note(`positive control: plate tab switch ok (view A -> view B, overlay appeared, active class on tab 1)`);
      await page.evaluate(() => { const b = document.querySelector('.mv-lightbox'); if (b) b.click(); });
    }
  } finally {
    await page.evaluate(() => { const o = document.querySelector('#fo-probe'); if (o) o.remove(); }).catch(() => {});
  }

  // ---- showPackLevelComplete, called directly: reveal card at 3 stars, none at 0 stars ----
  // Hand-off (Task 6): the `stars > 0 && lv.reveal` gate and the conditional #lc-reveal host div
  // had zero repo-resident coverage; this is that coverage's home.
  const hi = await page.evaluate((pk) => {
    window.showPackLevelComplete({ color: '#7aa8ff' }, pk, 0, 2, 3);
    return {
      cards: document.querySelectorAll('#lc-reveal .mv-rv-card').length,
      tiles: document.querySelectorAll('#lc-reveal .mv-rv-tile').length,
    };
  }, pack);
  if (hi.cards !== 1) problems.push(`positive control: showPackLevelComplete at 3 stars rendered ${hi.cards} .mv-rv-card, expected 1`);
  if (hi.tiles !== 12) problems.push(`positive control: showPackLevelComplete at 3 stars rendered ${hi.tiles} .mv-rv-tile, expected 12`);

  const lo = await page.evaluate((pk) => {
    window.showPackLevelComplete({ color: '#7aa8ff' }, pk, 0, 2, 0);
    return { cards: document.querySelectorAll('#lc-reveal .mv-rv-card').length };
  }, pack);
  if (lo.cards !== 0) problems.push(`positive control: showPackLevelComplete at 0 stars rendered ${lo.cards} .mv-rv-card, expected 0 (the reveal must not show on a level not cleared)`);

  note(`positive control: showPackLevelComplete reveal card: 3 stars -> ${hi.cards} card/${hi.tiles} tiles, 0 stars -> ${lo.cards} card`);
}

async function fixtureNegativeControl(page, problems, note) {
  const { pack } = await loadFixture(page);
  const broken = JSON.parse(JSON.stringify(pack));
  const brokenFig = broken.figures.find((f) => f.id === 'fig-photo');
  brokenFig.src = NEG_CONTROL_BROKEN_SRC;

  const negResult = await checkImage(page, NEG_CONTROL_BROKEN_SRC);
  if (negResult.ok) {
    problems.push(`negative control: expected "${NEG_CONTROL_BROKEN_SRC}" to fail to decode, but it loaded (naturalWidth=${negResult.w}); the offline-load detector cannot be trusted`);
  } else {
    note(`negative control: "${NEG_CONTROL_BROKEN_SRC}" correctly failed to decode -- the detector fired`);
  }

  // Sanity half: the OTHER assets in this same broken copy must still pass, proving the detector
  // failed on the one mutated src and not wholesale.
  const others = figureAssets(broken.figures).filter((a) => a.figureId !== 'fig-photo');
  for (const a of others) {
    const r = await checkImage(page, a.src);
    if (!r.ok) problems.push(`negative control sanity: unrelated fixture asset "${a.figureId}" (${a.field}) unexpectedly failed to decode too: ${a.src}`);
  }
  note(`negative control sanity: ${others.length} unrelated fixture asset(s) still decoded fine`);
}
