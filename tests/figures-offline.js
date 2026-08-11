'use strict';
// figures-offline.js -- the figures-offline gate (Task 8, fix round 1).
//
// Every figure-bearing asset the game references -- a passage's figure strip, an item's figure
// rail, a plate's per-view image and overlay, a manifest shelf badge, a level's completion-screen
// reveal -- must actually decode and render with NO real network available. A `fetch()` can succeed
// on bytes it never parses (this is exactly how the two badge SVGs shipped in Task 7 briefly carried
// an invalid XML comment with no console error and no throw: Chromium's <img> decoder silently gave
// up), so the oracle here is `new Image()` + `naturalWidth > 0`, run inside a real Chromium with
// every non-localhost request aborted at the network layer and proven aborted, not merely assumed.
//
// FIX ROUND 1 (this file): the first version of this gate put BOTH fixture controls inside the
// NOT-ARMED `else` branch. The moment a real pack shipped `figures`, the banner would stop printing
// (reading as progress) while the negative control -- the gate's ONLY proof its own decode oracle
// can still report `ok: false` -- and the composed-geometry oracle went dark with it. That is a
// coverage DOWNGRADE disguised as an upgrade, and it is exactly the silent-clean shape this project
// bans. Both controls now run on EVERY invocation; only the banner is conditional. The armed path
// additionally exercises the real pack, with the SAME firable oracles the controls use (composed
// height equality, not the cap that CSS makes structurally unfirable), and is now proven to work end
// to end against scratch armed packs (see task-8-report.md for every mutation re-run and its exit
// code), not merely written to spec.
//
// NOT-ARMED CONTRACT: no real pack declares `figures` yet, so the real-pack sweep below finds zero
// targets most days. A gate that discovers zero targets and reports clean anyway is banned, so the
// banner fires whenever no real pack is figure-bearing. It changes nothing about which controls run.
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

// outpost-protocol-g6 and firsthand-g6 as of this writing. A count BELOW this is a regression (a
// badge silently dropped from the manifest); raise it deliberately, in the same commit that ships a
// third badge, never as a side effect of an unrelated change.
const EXPECTED_MIN_REAL_BADGES = 2;

// RFC 2606 reserved TLD: guaranteed never to resolve, so this proves the route handler's abort, not
// an incidental DNS failure that would have happened with no block in place at all.
const OFFLINE_PROOF_SRC = 'https://example.invalid/figures-offline-proof.png';

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

// The three reference routes validate-pack's checkFigureReferences permits: a passage's figureIds
// (renders as the passage strip, .mv-figs), an item's own figureId (renders as the item rail,
// .mv-item-fig), and a level's reveal.figureId (renders as the .mv-reveal-strip cell / completion
// card). Returns which route (the first one found) claims each figure id, and the list of figure
// ids claimed by NONE of the three -- an orphan figure declared in `figures` but wired to nothing a
// player could ever see, which validate-pack's own rules do not catch (it only checks that a
// reference resolves TO a figure, never that every figure has a reference).
function figureRoutes(pack) {
  const passagesById = new Map((pack.passages || []).map((p) => [p.id, p]));
  const itemsById = new Map((pack.items || []).map((i) => [i.id, i]));
  const routeOf = new Map();
  for (const p of passagesById.values()) {
    for (const fid of (p.figureIds || [])) if (!routeOf.has(fid)) routeOf.set(fid, 'strip');
  }
  for (const it of itemsById.values()) {
    if (it.figureId && !routeOf.has(it.figureId)) routeOf.set(it.figureId, 'rail');
  }
  for (const lv of (pack.levels || [])) {
    if (lv.reveal && lv.reveal.figureId && !routeOf.has(lv.reveal.figureId)) routeOf.set(lv.reveal.figureId, 'reveal');
  }
  const orphans = (pack.figures || []).map((f) => f.id).filter((fid) => !routeOf.has(fid));
  return { routeOf, orphans, passagesById, itemsById };
}

// Shared strip oracle: asserts the COMPOSED geometry (98px strip height, 128x96 image box -- never
// the 104px cap, which CSS makes structurally unable to fail), the lightbox, and -- for a plate --
// every declared tab's own view src and overlay, selected by KIND rather than a hardcoded index.
// Used by BOTH the fixture positive control and the armed sampled-render integration, so "the armed
// path gets the same firable oracle" is one function, not two numbers that happen to agree today.
async function assertFigureStrip(page, scopeSel, figures, problems, note, label) {
  const before = problems.length;
  const geo = await page.evaluate((sel) => {
    const box = document.querySelector(sel + ' .mv-figs');
    if (!box) return null;
    const r = box.getBoundingClientRect();
    const img = box.querySelector('.mv-fig-img');
    const ir = img ? img.getBoundingClientRect() : null;
    return { h: r.height, imgW: ir && ir.width, imgH: ir && ir.height, count: box.querySelectorAll('.mv-fig').length };
  }, scopeSel);
  if (!geo) { problems.push(`${label}: no .mv-figs strip rendered under "${scopeSel}"`); return; }
  if (geo.count !== figures.length) problems.push(`${label}: strip rendered ${geo.count} .mv-fig, expected ${figures.length}`);
  // Composed, not the declared cap: 96px image height + 1px border top/bottom = 98. An assertion
  // against the 104px cap alone cannot fail when the composed height grows past what the cap was
  // meant to bound, which is exactly the shape of defect this check exists to catch.
  if (Math.round(geo.h) !== 98) problems.push(`${label}: .mv-figs composed height is ${Math.round(geo.h)}px, expected 98px (96px image + 1px border top/bottom)`);
  if (Math.round(geo.imgW) !== 128 || Math.round(geo.imgH) !== 96) problems.push(`${label}: .mv-fig-img box is ${Math.round(geo.imgW)}x${Math.round(geo.imgH)}, expected 128x96`);
  if (problems.length === before) note(`${label}: strip rendered ${geo.count} thumb(s), composed height ${Math.round(geo.h)}px, image box ${Math.round(geo.imgW)}x${Math.round(geo.imgH)}`);

  const photoIdx = figures.findIndex((f) => f.kind !== 'plate');
  const plateIdx = figures.findIndex((f) => f.kind === 'plate');

  if (photoIdx !== -1) {
    await page.evaluate(([sel, i]) => document.querySelectorAll(sel + ' .mv-fig')[i].click(), [scopeSel, photoIdx]);
    const lbInfo = await page.evaluate(() => {
      const lb = document.querySelector('.mv-lightbox');
      const img = lb && lb.querySelector('.mv-lb-img');
      return { present: !!lb, src: img ? img.src : null };
    });
    const f0 = figures[photoIdx];
    const wantSuffix = (f0.kind === 'plate' ? f0.views[0].src : f0.src).split('/').pop();
    if (!lbInfo.present) problems.push(`${label}: tapping thumb ${photoIdx} (kind "${f0.kind}") did not open .mv-lightbox`);
    else if (!lbInfo.src || !lbInfo.src.endsWith(wantSuffix)) problems.push(`${label}: lightbox opened "${lbInfo.src}" for thumb ${photoIdx}, expected it to end with "${wantSuffix}"`);
    await page.evaluate(() => { const b = document.querySelector('.mv-lightbox'); if (b) b.click(); });
    const closed = await page.evaluate(() => !document.querySelector('.mv-lightbox'));
    if (!closed) problems.push(`${label}: clicking the lightbox background did not close it`);
  }

  if (plateIdx !== -1) {
    const plateFig = figures[plateIdx];
    await page.evaluate(([sel, i]) => document.querySelectorAll(sel + ' .mv-fig')[i].click(), [scopeSel, plateIdx]);
    const tabCount = await page.evaluate(() => document.querySelectorAll('.mv-plate-tab').length);
    if (tabCount < 2) {
      problems.push(`${label}: plate "${plateFig.id}" lightbox shows ${tabCount} tab(s), expected at least 2`);
    } else if (tabCount !== plateFig.views.length) {
      problems.push(`${label}: plate "${plateFig.id}" lightbox shows ${tabCount} tab(s), expected exactly ${plateFig.views.length} (one per declared view)`);
    } else {
      const beforeTabs = problems.length;
      for (let i = 0; i < plateFig.views.length; i++) {
        await page.evaluate((idx) => document.querySelectorAll('.mv-plate-tab')[idx].click(), i);
        const st = await page.evaluate(() => ({
          src: document.querySelector('.mv-lb-img').src,
          overlaySrc: (document.querySelector('.mv-lb-overlay') || {}).src || null,
          activeIdx: [...document.querySelectorAll('.mv-plate-tab')].findIndex((t) => t.classList.contains('active')),
        }));
        const view = plateFig.views[i];
        const wantV = view.src.split('/').pop();
        if (!st.src.endsWith(wantV)) problems.push(`${label}: plate "${plateFig.id}" tab ${i} shows "${st.src}", expected to end with "${wantV}"`);
        if (view.overlaySrc) {
          const wantO = view.overlaySrc.split('/').pop();
          if (!st.overlaySrc || !st.overlaySrc.endsWith(wantO)) problems.push(`${label}: plate "${plateFig.id}" tab ${i} overlay missing/wrong, expected to end with "${wantO}", got "${st.overlaySrc}"`);
        } else if (st.overlaySrc) {
          problems.push(`${label}: plate "${plateFig.id}" tab ${i} declares no overlaySrc but .mv-lb-overlay is present ("${st.overlaySrc}")`);
        }
        if (st.activeIdx !== i) problems.push(`${label}: plate "${plateFig.id}" after clicking tab ${i}, .active landed on tab ${st.activeIdx}`);
      }
      if (problems.length === beforeTabs) note(`${label}: plate "${plateFig.id}" all ${plateFig.views.length} tab(s) verified (src + overlay + active class)`);
    }
    await page.evaluate(() => { const b = document.querySelector('.mv-lightbox'); if (b) b.click(); });
  }
}

// Reward-screen geometry (dryness-fix round 2, item 1). The whole-branch review deferred this to V2,
// reasoning the fixture's launcher-call path yields vacuous 0x0 geometry -- FALSE. Math-Multiverse.html
// hides every screen but the active one (`.screen { display: none }` / `.screen.active { display:
// block }`), so `.host-frame` (nested inside #screen-module) measures 0x0 whenever the module screen is
// not the active one, which it never was on the launcher-call path this file used before. Calling the
// shell's own showScreen('module') first makes the geometry real. Swept at the two real device heights
// this project targets (654, 694) plus the harness's own 768 default; the original viewport is restored
// in a `finally` so nothing downstream inherits a short one.
async function assertRewardGeometry(page, pack, problems, note) {
  const original = page.viewportSize() || VIEWPORT;
  const heights = [654, 694, 768];
  try {
    for (const h of heights) {
      const before = problems.length;
      await page.setViewportSize({ width: original.width, height: h });
      await page.evaluate((pk) => {
        if (typeof showScreen === 'function') showScreen('module');
        window.showPackLevelComplete({ color: '#7aa8ff' }, pk, 0, 2, 3);
      }, pack);

      // Load-bearing trap: an undecoded .mv-rv-img has naturalWidth 0, which makes the
      // shrink-wrapped frame 0 wide too, so a box-only geometry check would pass vacuously (grid
      // and image "agree" at 0x0). Hit exactly this on the first in-gate run ("reward 0x131")
      // before this wait was added. Wait for the REAL decode before measuring anything.
      const decoded = await page.waitForFunction(() => {
        const img = document.querySelector('#lc-reveal .mv-rv-img');
        return !!(img && img.complete && img.naturalWidth > 0);
      }, { timeout: 5000 }).then(() => true).catch(() => false);
      if (!decoded) { problems.push(`reward geometry at 1024x${h}: .mv-rv-img never decoded (naturalWidth stayed 0)`); continue; }

      const geo = await page.evaluate(() => {
        // Painted rect from naturalWidth/naturalHeight + object-fit, NOT the element's own box: a
        // box-only version passes an un-shrink-wrapped mutation (a fixed-width frame with
        // object-fit:contain) that letterboxes the real image well inside its own element box.
        // .mv-rv-img currently declares no object-fit at all (the default, 'fill'), which is a
        // no-op here because the box's own width:auto sizing already resolves from the image's
        // natural ratio before object-fit is even consulted -- but this function must catch a
        // FUTURE regression that reintroduces a fixed box with a real object-fit value, not just
        // describe today's declaration.
        function paintedRect(img) {
          const r = img.getBoundingClientRect();
          const nw = img.naturalWidth, nh = img.naturalHeight;
          if (!nw || !nh) return { left: r.left, top: r.top, width: 0, height: 0 };
          const fit = getComputedStyle(img).objectFit || 'fill';
          const boxRatio = r.width / r.height, natRatio = nw / nh;
          let w, h;
          if (fit === 'contain' || fit === 'scale-down') {
            if (natRatio > boxRatio) { w = r.width; h = r.width / natRatio; } else { h = r.height; w = r.height * natRatio; }
            if (fit === 'scale-down' && (w > nw || h > nh)) { w = nw; h = nh; }
          } else if (fit === 'cover') {
            if (natRatio > boxRatio) { h = r.height; w = r.height * natRatio; } else { w = r.width; h = r.width / natRatio; }
          } else if (fit === 'none') {
            w = Math.min(nw, r.width); h = Math.min(nh, r.height);
          } else {
            // 'fill', the only value this codebase declares: stretches to the box.
            w = r.width; h = r.height;
          }
          return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
        }
        const frame = document.querySelector('.host-frame');
        const img = document.querySelector('#lc-reveal .mv-rv-img');
        const grid = document.querySelector('#lc-reveal .mv-rv-grid');
        const headline = document.querySelector('.lc-headline');
        const level = document.querySelector('.lc-level');
        const stars = document.querySelector('.lc-stars');
        const score = document.querySelector('.lc-score');
        const card = document.querySelector('.mv-rv-card');
        const buttons = Array.from(document.querySelectorAll('.lc-actions button'));
        if (!frame || !img || !grid || !headline || !level || !stars || !score || !card) return null;
        const rect = (n) => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return {
          frame: rect(frame), paintedImg: paintedRect(img), grid: rect(grid),
          headline: rect(headline), level: rect(level), stars: rect(stars), score: rect(score), card: rect(card),
          buttons: buttons.map(rect),
          pageOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        };
      });
      if (!geo) {
        problems.push(`reward geometry at 1024x${h}: one or more expected nodes (.host-frame, #lc-reveal .mv-rv-img/.mv-rv-grid, .lc-headline/.lc-level/.lc-stars/.lc-score, .mv-rv-card) did not render`);
        continue;
      }

      const within = (r, outer, label) => {
        if (r.left < outer.left - 0.5 || r.top < outer.top - 0.5 || r.right > outer.right + 0.5 || r.bottom > outer.bottom + 0.5) {
          problems.push(`reward geometry at 1024x${h}: ${label} (${Math.round(r.left)}..${Math.round(r.right)}, ${Math.round(r.top)}..${Math.round(r.bottom)}) falls outside .host-frame (${Math.round(outer.left)}..${Math.round(outer.right)}, ${Math.round(outer.top)}..${Math.round(outer.bottom)})`);
        }
      };
      within(geo.headline, geo.frame, 'headline');
      within(geo.level, geo.frame, 'level name');
      within(geo.stars, geo.frame, 'stars row');
      within(geo.score, geo.frame, 'score');
      within(geo.card, geo.frame, 'reveal card');
      geo.buttons.forEach((b, i) => within(b, geo.frame, `action button ${i}`));

      if (geo.paintedImg.width <= 0 || geo.paintedImg.height <= 0) {
        problems.push(`reward geometry at 1024x${h}: reward image painted rect is ${Math.round(geo.paintedImg.width)}x${Math.round(geo.paintedImg.height)} (zero), not a real reward`);
      } else if (geo.paintedImg.height < 120) {
        problems.push(`reward geometry at 1024x${h}: reward image is ${Math.round(geo.paintedImg.width)}x${Math.round(geo.paintedImg.height)}, under the 120px floor`);
      }
      if (Math.abs(geo.grid.width - geo.paintedImg.width) > 2 || Math.abs(geo.grid.height - geo.paintedImg.height) > 2) {
        problems.push(`reward geometry at 1024x${h}: tile grid ${Math.round(geo.grid.width)}x${Math.round(geo.grid.height)} does not cover the drawn image ${Math.round(geo.paintedImg.width)}x${Math.round(geo.paintedImg.height)}`);
      }
      if (geo.pageOverflow > 1) {
        problems.push(`reward geometry at 1024x${h}: the page has ${geo.pageOverflow}px of overflow (expected 0; .host-frame is overflow:hidden with no page scroll)`);
      }

      if (problems.length === before) {
        note(`reward geometry at 1024x${h}: reward ${Math.round(geo.paintedImg.width)}x${Math.round(geo.paintedImg.height)}, grid ${Math.round(geo.grid.width)}x${Math.round(geo.grid.height)}, headline/card/actions inside .host-frame, page overflow ${geo.pageOverflow}px`);
      }
    }
  } finally {
    await page.setViewportSize(original);
  }
}

// Shared rail oracle (the .mv-item-fig surface an item.figureId route renders): --mv-fig-h is
// re-scoped to 72px there (engine/engine.css), so the composed height is 74 (72 + 1px border top/
// bottom) and the image box is 128x72, distinct constants from the strip's 98/128x96 on purpose.
async function assertItemFigureRail(page, scopeSel, figure, problems, note, label) {
  const before = problems.length;
  const geo = await page.evaluate((sel) => {
    const rail = document.querySelector(sel + ' .mv-item-fig');
    if (!rail) return null;
    const figEl = rail.querySelector('.mv-fig');
    const img = rail.querySelector('.mv-fig-img');
    const r = figEl ? figEl.getBoundingClientRect() : null;
    const ir = img ? img.getBoundingClientRect() : null;
    return { h: r && r.height, imgW: ir && ir.width, imgH: ir && ir.height, src: img ? img.src : null };
  }, scopeSel);
  if (!geo) { problems.push(`${label}: no .mv-item-fig rail rendered under "${scopeSel}"`); return; }
  if (Math.round(geo.h) !== 74) problems.push(`${label}: .mv-item-fig composed height is ${Math.round(geo.h)}px, expected 74px (72px image + 1px border top/bottom)`);
  if (Math.round(geo.imgW) !== 128 || Math.round(geo.imgH) !== 72) problems.push(`${label}: rail image box is ${Math.round(geo.imgW)}x${Math.round(geo.imgH)}, expected 128x72`);
  const wantSuffix = (figure.kind === 'plate' ? figure.views[0].src : figure.src).split('/').pop();
  if (!geo.src || !geo.src.endsWith(wantSuffix)) problems.push(`${label}: rail image src "${geo.src}" does not end with expected "${wantSuffix}"`);
  if (problems.length === before) note(`${label}: rail rendered, composed height ${Math.round(geo.h)}px, image box ${Math.round(geo.imgW)}x${Math.round(geo.imgH)}`);
}

(async () => {
  const problems = [];
  const note = (m) => console.log('  ' + m);

  // ---------------------------------------------------------------------------------------------
  // Step 1's own requirement: the fixture must PASS validate-pack rules when validated standalone.
  // Pure Node, no browser needed -- run it first.
  // ---------------------------------------------------------------------------------------------
  {
    const abs = path.join(ROOT, 'tests', 'fixtures', 'vis-demo', 'pack.json');
    try {
      const raw = fs.readFileSync(abs, 'utf8');
      const fixtureForValidation = JSON.parse(raw);
      const { validatePack } = require('./validate-pack');
      const { errors } = validatePack(fixtureForValidation, { expectedId: 'vis-demo', assetBase: 'tests/fixtures', rawText: raw });
      if (errors.length) problems.push(`fixture: tests/fixtures/vis-demo/pack.json failed validate-pack standalone (${errors.length} error(s)), first: ${errors[0]}`);
      else note('fixture: tests/fixtures/vis-demo/pack.json validates clean standalone (expectedId=vis-demo, assetBase=tests/fixtures)');
    } catch (e) {
      problems.push(`fixture: tests/fixtures/vis-demo/pack.json failed to read/parse for standalone validation: ${e && e.message}`);
    }
  }

  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const launchOpts = { headless: true, args: ['--disable-gpu', '--disable-gpu-compositing'] };
  // PLAYWRIGHT_EXECUTABLE_PATH only -- no hardcoded fallback to whatever Chrome happens to be
  // installed on this machine. All four browser-driving gates (smoke, reading-surface, tile-overlap,
  // this one) now resolve the browser the same way: Playwright's own pinned/installed engine, or the
  // env override. A machine-local auto-updating Chrome is not the engine CI runs.
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

  const browser = await chromium.launch(launchOpts);
  // One context for the whole run: every page born from it inherits this route, so "offline" is an
  // enforced guarantee (the request is actually aborted, counted below) rather than an assumption
  // nothing here happens to violate.
  const context = await browser.newContext({ viewport: VIEWPORT });
  let externalAborts = 0;
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith('data:')) return route.continue();
    externalAborts++;
    return route.abort();
  });

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
    // Offline-abort proof: the header prose promises "the browser is handed nothing but the local
    // static server," and nothing verified that promise until now. Requires BOTH the decode to fail
    // AND the route handler's own counter to move, so a lucky/incidental failure (e.g. a resolver
    // quirk) cannot be mistaken for proof the block fired.
    // ---------------------------------------------------------------------------------------------
    {
      const abortsBefore = externalAborts;
      const proof = await checkImage(page, OFFLINE_PROOF_SRC);
      if (proof.ok) {
        problems.push(`offline proof: external src "${OFFLINE_PROOF_SRC}" unexpectedly decoded; the network block is not in force`);
      } else if (externalAborts <= abortsBefore) {
        problems.push(`offline proof: external src "${OFFLINE_PROOF_SRC}" failed to decode, but the route handler recorded no abort; the failure may be incidental rather than proof the block fired`);
      } else {
        note(`offline proof: external request was intercepted and aborted (${externalAborts - abortsBefore} abort(s) recorded); the network block is genuinely in force`);
      }
    }

    // ---------------------------------------------------------------------------------------------
    // Section A: manifest badgeUrl sweep. Always runs, independent of the figures ARMED state below
    // -- badges live on the manifest entry, not inside a pack's own `figures` array, so nothing else
    // in this suite ever loads them. An expected-count floor catches a badge silently dropped from
    // the manifest, which a bare "found zero, note it" would otherwise wave through as "no badges to
    // check" rather than "a badge went missing."
    // ---------------------------------------------------------------------------------------------
    const manifest = await page.evaluate(async () => (await (await fetch('packs/manifest.json')).json()));
    const manifestPacks = (manifest && Array.isArray(manifest.packs)) ? manifest.packs : [];
    const badgeEntries = manifestPacks.filter((p) => p && p.badgeUrl);
    for (const p of badgeEntries) {
      const r = await checkImage(page, p.badgeUrl);
      if (!r.ok) problems.push(`badges: pack "${p.id}" badgeUrl "${p.badgeUrl}" failed to decode offline`);
      else note(`badges: pack "${p.id}" badgeUrl ok (${r.w}x${r.h})`);
    }
    if (badgeEntries.length < EXPECTED_MIN_REAL_BADGES) {
      problems.push(`badges: manifest declares ${badgeEntries.length} badgeUrl(s), expected at least ${EXPECTED_MIN_REAL_BADGES}; a badge silently dropped from the manifest is exactly the regression this floor exists to catch`);
    }

    // ---------------------------------------------------------------------------------------------
    // Section B: real-pack figures sweep. Every manifest pack's own JSON is fetched and checked for
    // a `figures` array; every declared src (and every plate view/overlaySrc) across EVERY such pack
    // is offline-load-checked, not just the first, and every figure referenced by NONE of the three
    // routes validate-pack permits (passage.figureIds, item.figureId, level.reveal.figureId) is a
    // hard failure -- validate-pack checks a reference resolves TO a figure, never that every figure
    // HAS a reference, so an orphan figure has no other gate.
    // ---------------------------------------------------------------------------------------------
    const figureBearingPacks = [];
    for (const entry of manifestPacks) {
      let pack;
      try {
        pack = await page.evaluate(async (id) => {
          const res = await fetch(`packs/${id}.json`);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return await res.json();
        }, entry.id);
      } catch (e) {
        problems.push(`figures: pack "${entry.id}" JSON failed to fetch or parse: ${e && e.message}`);
        continue;
      }
      if (Array.isArray(pack.figures) && pack.figures.length) figureBearingPacks.push({ entry, pack });
    }
    for (const { entry, pack } of figureBearingPacks) {
      for (const asset of figureAssets(pack.figures)) {
        const r = await checkImage(page, asset.src);
        if (!r.ok) problems.push(`figures: pack "${entry.id}" figure "${asset.figureId}" (${asset.field}) failed to decode offline: ${asset.src}`);
      }
      const { orphans } = figureRoutes(pack);
      for (const fid of orphans) {
        problems.push(`figures: pack "${entry.id}" figure "${fid}" is referenced by no route (no passage.figureIds, item.figureId, or level.reveal.figureId) and cannot be render-exercised`);
      }
    }

    const armed = figureBearingPacks.length > 0;
    if (!armed) {
      console.log('\n' + NOT_ARMED_BANNER + '\n');
    } else {
      note(`figures: ${figureBearingPacks.length} real pack(s) declare figures (${figureBearingPacks.map((x) => x.entry.id).join(', ')}) -- ARMED; fixture controls still run as the permanent regression floor, plus the real-pack integration below`);
    }

    // ---------------------------------------------------------------------------------------------
    // BOTH fixture controls run on EVERY invocation, armed or not. This is the fix for the
    // coverage-downgrade finding: the negative control is the gate's only proof its own decode
    // oracle can still return ok:false, and the composed-geometry oracle is what actually catches a
    // shrunk strip -- neither may go dark just because a real pack shipped figures.
    // ---------------------------------------------------------------------------------------------
    await fixturePositiveControl(page, problems, note);
    await fixtureNegativeControl(page, problems, note);

    // ---------------------------------------------------------------------------------------------
    // ARMED addition: sampled render integration against the FIRST figure-bearing real pack, using
    // the SAME firable oracles (assertFigureStrip / assertItemFigureRail) the fixture controls use.
    // ---------------------------------------------------------------------------------------------
    if (armed) {
      try {
        await sampledRenderIntegration(page, figureBearingPacks[0], problems, note);
      } catch (e) {
        problems.push('armed sampled-render integration threw: ' + (e && e.stack || e));
      }
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
// ARMED path (Step 2.3 of the brief, fix round 1): boot is already done by the caller. Opens the
// first figure-bearing pack through the real `window.openPack`/`window.playLevel` globals (the same
// call-through-window convention tests/smoke.js already uses). Recognises all three reference routes
// validate-pack permits, asserts whichever surface belongs to whichever route the drawn item/passage
// actually exercises, and reads the on-screen `.mv-passage` dataset.pid before requiring a strip --
// a valid pack whose pinned draw lands on a passage with no figures is not a defect, so that draw is
// rerolled rather than failed.
// ===================================================================================================
async function sampledRenderIntegration(page, armedEntry, problems, note) {
  const { entry, pack } = armedEntry;
  const { routeOf, passagesById, itemsById } = figureRoutes(pack);
  const figuresById = new Map((pack.figures || []).map((f) => [f.id, f]));

  let targetLevelIdx = -1, needStrip = false, needRail = false, needReveal = false;
  (pack.levels || []).forEach((lv, i) => {
    if (targetLevelIdx !== -1) return;
    const itemsInLevel = (lv.itemIds || []).map((id) => itemsById.get(id)).filter(Boolean);
    const s = itemsInLevel.some((it) => { const ps = passagesById.get(it.passageId); return ps && Array.isArray(ps.figureIds) && ps.figureIds.length; });
    const r = itemsInLevel.some((it) => !!it.figureId);
    const v = !!(lv.reveal && lv.reveal.figureId);
    if (s || r || v) { targetLevelIdx = i; needStrip = s; needRail = r; needReveal = v; }
  });
  if (targetLevelIdx === -1) {
    problems.push(`armed: pack "${entry.id}" declares figures but no level exercises any of the three reference routes (passage.figureIds, item.figureId, level.reveal.figureId)`);
    return;
  }
  note(`armed: pack "${entry.id}" level ${targetLevelIdx} selected (routes needed: ${[needStrip && 'strip', needRail && 'rail', needReveal && 'reveal'].filter(Boolean).join(', ') || 'none'})`);

  await page.evaluate((id) => window.openPack(id), entry.id);
  await page.waitForSelector('#level-grid .level-card', { timeout: 8000 });

  // Pinned so a level whose pool mixes item types draws reproducibly, same discipline tests/smoke.js
  // uses for its own pack playthrough. State advances across calls, so re-rolling below (calling
  // playLevel again) genuinely produces a different draw each time, not the same one repeated.
  await page.evaluate(() => {
    window.__realRandom = Math.random;
    let s = 7;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  });

  try {
    await page.evaluate((idx) => window.playLevel(idx), targetLevelIdx);
    await page.waitForSelector('.mv-passage, .mv-item', { timeout: 8000 });

    // ---- Phase 1: strip / rail, by whichever route the CURRENT draw actually exercises ----
    let stripDone = !needStrip, railDone = !needRail;
    for (let guard = 0; guard < 24 && (!stripDone || !railDone); guard++) {
      const onScreen = await page.evaluate(() => {
        const passageEl = document.querySelector('.mv-passage');
        const item = document.querySelector('.mv-shell .mv-item');
        const s = item && item.querySelector('.mv-stem');
        return {
          pid: passageEl ? passageEl.dataset.pid : null,
          text: ((s ? s.textContent : (item ? item.textContent : '')) || '').trim(),
        };
      });
      const matched = [...itemsById.values()].find((it) => {
        const stem = it.type === 'ebsr' ? (it.partA && it.partA.stem) : it.stem;
        return stem && onScreen.text && onScreen.text.startsWith(stem.trim().slice(0, 30));
      });
      const ps = onScreen.pid ? passagesById.get(onScreen.pid) : null;
      const drawHasStrip = ps && Array.isArray(ps.figureIds) && ps.figureIds.length > 0;
      const drawHasRail = matched && !!matched.figureId;

      if (needStrip && !stripDone && drawHasStrip) {
        const stripFigs = ps.figureIds.map((fid) => figuresById.get(fid)).filter(Boolean);
        await assertFigureStrip(page, '.mv-passage', stripFigs, problems, note, `armed: pack "${entry.id}" passage "${ps.id}"`);
        stripDone = true;
      }
      if (needRail && !railDone && drawHasRail) {
        const fig = figuresById.get(matched.figureId);
        if (fig) await assertItemFigureRail(page, '.mv-item', fig, problems, note, `armed: pack "${entry.id}" item "${matched.id}"`);
        railDone = true;
      }
      if (!stripDone || !railDone) {
        // This draw did not satisfy an outstanding route. Not a defect -- advance rather than fail.
        await page.evaluate((idx) => window.playLevel(idx), targetLevelIdx);
        await page.waitForSelector('.mv-passage, .mv-item', { timeout: 8000 });
      }
    }
    if (needStrip && !stripDone) note(`armed: pack "${entry.id}" level ${targetLevelIdx} never drew an item whose passage carries figureIds within the guard; strip assertion skipped this run (sampling, not a defect)`);
    if (needRail && !railDone) note(`armed: pack "${entry.id}" level ${targetLevelIdx} never drew an item with its own figureId within the guard; rail assertion skipped this run (sampling, not a defect)`);

    // ---- Phase 2: reveal-strip cell flip, only if this level's reveal route selected it ----
    if (needReveal) {
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
            // Scoped to .mv-part-b: Part A and Part B each number their OWN buttons data-idx="0",
            // "1", ... independently, so an unscoped query at this point (both parts' buttons now
            // exist in the DOM) matches Part A's already-disabled button whenever bIdx falls inside
            // Part A's own choice count, leaving Part B unanswered and the Check button permanently
            // disabled.
            await page.evaluate((kk) => { const b = document.querySelector(`.mv-part-b .mv-choice[data-idx="${kk}"]`); if (b) b.click(); }, bIdx);
          }
          await page.waitForTimeout(60);
          // Raw DOM click via evaluate, not Playwright's actionability-checked ElementHandle.click():
          // the latter waits (up to its full default timeout) for the target to become enabled,
          // which never happens if the answer above did not actually land, turning a genuine defect
          // into a 30-second hang instead of a fast, named failure. Read `.disabled` first instead.
          await page.evaluate(() => { const btn = document.querySelector('.mv-check'); if (btn && !btn.disabled) btn.click(); });
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
// NOT-ARMED fixture controls (Step 2.4, fix round 1). Both run on EVERY invocation now (see the fix
// note at the top of this file). Asserted against tests/fixtures/vis-demo/, served from disk by the
// same local server as everything else -- never added to the real packs/manifest.json.
// ===================================================================================================

async function loadFixture(page) {
  return page.evaluate(async () => ({
    pack: await (await fetch('tests/fixtures/vis-demo/pack.json')).json(),
    manifest: await (await fetch('tests/fixtures/vis-demo/manifest.json')).json(),
  }));
}

async function fixturePositiveControl(page, problems, note) {
  const { pack, manifest } = await loadFixture(page);
  const figuresById = new Map((pack.figures || []).map((f) => [f.id, f]));
  const badgeUrl = manifest.packs[0].badgeUrl;

  // ---- every figure src + the manifest badgeUrl loads offline ----
  const assets = figureAssets(pack.figures).concat([{ figureId: 'manifest', field: 'badgeUrl', src: badgeUrl }]);
  for (const a of assets) {
    const r = await checkImage(page, a.src);
    if (!r.ok) problems.push(`positive control: fixture asset "${a.figureId}" (${a.field}) failed to decode offline: ${a.src}`);
    else note(`positive control: ${a.figureId}/${a.field} ok (${r.w}x${r.h}) -- ${a.src}`);
  }

  // ---- MVFigures.renderStrip + renderItemFigure, called directly, render the real geometry ----
  await page.evaluate(() => {
    const o = document.createElement('div');
    o.id = 'fo-probe';
    o.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;overflow:auto;padding:14px;background:#0f1218;';
    document.body.appendChild(o);
    const o2 = document.createElement('div');
    o2.id = 'fo-probe-rail';
    o2.className = 'mv-item';
    o2.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;overflow:visible;opacity:0;pointer-events:none;';
    document.body.appendChild(o2);
  });
  try {
    const strip = await page.evaluate((pk) => {
      const host = document.querySelector('#fo-probe');
      const el = window.MVFigures.renderStrip(pk, ['fig-photo', 'fig-chart', 'fig-plate'], host);
      return !!el;
    }, pack);
    if (!strip) {
      problems.push('positive control: MVFigures.renderStrip returned null/no element for the fixture pack');
    } else {
      await assertFigureStrip(page, '#fo-probe', [figuresById.get('fig-photo'), figuresById.get('fig-chart'), figuresById.get('fig-plate')], problems, note, 'positive control');
    }

    const railOk = await page.evaluate((pk) => {
      const host = document.querySelector('#fo-probe-rail');
      window.MVFigures.renderItemFigure(pk, 'fig-chart', host);
      return true;
    }, pack);
    if (railOk) await assertItemFigureRail(page, '#fo-probe-rail', figuresById.get('fig-chart'), problems, note, 'positive control');
  } finally {
    await page.evaluate(() => {
      const o = document.querySelector('#fo-probe'); if (o) o.remove();
      const o2 = document.querySelector('#fo-probe-rail'); if (o2) o2.remove();
    }).catch(() => {});
  }

  // ---- showPackLevelComplete, called directly: reveal card at 3 stars (with the RIGHT figure),
  //      none at 0 stars, and no #lc-reveal host at all on a reveal-less level ----
  // Hand-off (Task 6): the `stars > 0 && lv.reveal` gate and the conditional #lc-reveal host div
  // had zero repo-resident coverage; this is that coverage's home. Fix round 1: a card/tile COUNT
  // match alone cannot tell a right figure from a wrong one, so the rendered image src is checked
  // against level 0's actual reveal.figureId too, and a third call proves a reveal-less level
  // (level 1 in this fixture) never even builds the host div.
  const revealFig = figuresById.get(pack.levels[0].reveal.figureId);
  const wantRevealSuffix = (revealFig.kind === 'plate' ? revealFig.views[0].src : revealFig.src).split('/').pop();
  const revealBefore = problems.length;

  const hi = await page.evaluate((pk) => {
    window.showPackLevelComplete({ color: '#7aa8ff' }, pk, 0, 2, 3);
    const img = document.querySelector('#lc-reveal .mv-rv-img');
    return {
      cards: document.querySelectorAll('#lc-reveal .mv-rv-card').length,
      tiles: document.querySelectorAll('#lc-reveal .mv-rv-tile').length,
      imgSrc: img ? img.src : null,
    };
  }, pack);
  if (hi.cards !== 1) problems.push(`positive control: showPackLevelComplete at 3 stars rendered ${hi.cards} .mv-rv-card, expected 1`);
  if (hi.tiles !== 12) problems.push(`positive control: showPackLevelComplete at 3 stars rendered ${hi.tiles} .mv-rv-tile, expected 12`);
  if (!hi.imgSrc || !hi.imgSrc.endsWith(wantRevealSuffix)) problems.push(`positive control: reveal card image src "${hi.imgSrc}" does not match level 0's reveal figure (expected to end with "${wantRevealSuffix}")`);

  const lo = await page.evaluate((pk) => {
    window.showPackLevelComplete({ color: '#7aa8ff' }, pk, 0, 2, 0);
    return {
      cards: document.querySelectorAll('#lc-reveal .mv-rv-card').length,
      hostPresent: !!document.querySelector('#lc-reveal'),
    };
  }, pack);
  if (lo.cards !== 0) problems.push(`positive control: showPackLevelComplete at 0 stars rendered ${lo.cards} .mv-rv-card, expected 0 (the reveal must not show on a level not cleared)`);
  // Fix wave (final review): the host div's own gate used to be `lv.reveal` alone, so a reveal
  // level cleared at 0 stars still emitted an empty #lc-reveal host and paid its 18px flex gap
  // even though no card would ever fill it. The host's condition must match the render's.
  if (lo.hostPresent) problems.push('positive control: showPackLevelComplete at 0 stars still emitted an #lc-reveal host with nothing to fill it (host gate must match the render gate)');

  const none = await page.evaluate((pk) => {
    window.showPackLevelComplete({ color: '#7aa8ff' }, pk, 1, 2, 3);
    return { hostPresent: !!document.querySelector('#lc-reveal') };
  }, pack);
  if (none.hostPresent) problems.push('positive control: showPackLevelComplete on a reveal-less level (level 1) still emitted an #lc-reveal host');

  if (problems.length === revealBefore) note(`positive control: showPackLevelComplete reveal card: 3 stars -> ${hi.cards} card/${hi.tiles} tiles (correct figure), 0 stars -> ${lo.cards} card, reveal-less level -> no host`);

  // ---- reward-screen geometry, at real device heights, via the shell's own showScreen('module')
  //      (dryness-fix round 2, item 1) ----
  await assertRewardGeometry(page, pack, problems, note);
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
