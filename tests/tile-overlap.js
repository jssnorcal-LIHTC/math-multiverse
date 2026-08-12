'use strict';
// tile-overlap.js -- occlusion-corrected explain-tile overlap gate.
//
// The reading-surface gate (tests/reading-surface.js) proved a passage can be squeezed to a
// slit. This gate proves something different: even when an explain tile has PLENTY of room to
// exist, a badly-sized grid track can let it render past its own cell and paint over sibling
// chrome -- the footer caption, a status pill, life/hull pips, the answer choices, or the
// question text itself. A raw getBoundingClientRect overlap sweep over-reports this: two boxes
// can intersect on paper while one of them is clipped/scrolled so nothing is actually painted
// on top of the other (Cold Signal's .mv-explain flagged this way in the Phase-1 sweep and was
// a false positive). So this gate is occlusion-CORRECTED: for every candidate element outside
// the tile, it samples real points inside that element's on-screen box and asks the browser,
// via document.elementFromPoint, what is actually painted there. Only a sample point that
// resolves to the tile (or one of its descendants) counts as a hit.
//
// Candidates are gathered structurally, not by a hand-maintained per-module class list: any
// element outside the tile that either carries its own direct text (a footer caption, a status
// label, an answer button's label, the question prompt) or is a childless "leaf" with a visible
// box (a life/hull/streak pip, which is a bare colored dot with no text of its own). SVG
// subtrees are excluded -- the ship/scene art is decorative, not something a kid reads, and it
// is never the site of this defect.
//
// For every module x grade at 1024x768, one question is driven to a WRONG answer and a
// separate question to a CORRECT one (afterAnswer shows the explain tile on both paths; only
// the wrong path leaves it on screen indefinitely with a NEXT button -- the correct path
// auto-advances in ~1.5s, so it is measured immediately after the tile appears). Which answer
// index lands wrong vs. correct is not predictable from outside the module (the key is drawn
// per-question inside the module's closure), so the driver always clicks answer index 0 and
// classifies whatever happens; if a whole attempt runs out of questions before seeing both
// outcomes (or the level ends early -- most modules end a level after 3 wrong answers), it
// restarts the level fresh and tries again, bounded by MAX_ATTEMPTS.
//
//   node tests/tile-overlap.js
//   PLAYWRIGHT_EXECUTABLE_PATH="C:\\...\\chrome.exe" node tests/tile-overlap.js
//
// GPU note (this machine): always launches with --disable-gpu to avoid the Intel TDR display freeze.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e1) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) { console.error('tile-overlap: neither "playwright" nor "playwright-core" is installed.\n  npm i -D playwright   (CI: also `npx playwright install chromium`)'); process.exit(2); }
}

const ROOT = path.join(__dirname, '..');
const VIEWPORT = { width: 1024, height: 768 };

// [moduleId, css class prefix]. Order and prefixes match tests/smoke.js's MODULES list and the
// Phase-1 overlap-audit sweep's tile selectors (<prefix>-explain.wrong / .right).
const MODULES = [
  ['fraction-rider', 'fr'],
  ['f1-decimals', 'f1'],
  ['razor-crest', 'rc'],
  ['master-builder', 'mb'],
  ['rocky-translator', 'rk'],
  ['floating-bear', 'fb'],
];

// Modules that boot straight into gameplay (fraction-rider never had a pick screen; razor-crest
// has one in the DOM but init() skips it -- "Justin's son saw the cast photos as click targets
// and got stuck", so state.view defaults and startFlight() runs immediately). Everything else
// shows a picker that must be cleared: f1-decimals and master-builder gate their GO button on
// selecting a driver/builder card first; rocky-translator and floating-bear's GO button is live
// immediately.
const PICKER = {
  fr: null,
  f1: { cardSel: '.f1-driver', goSel: '#f1-go' },
  rc: null,
  mb: { cardSel: '.mb-builder', goSel: '#mb-go' },
  rk: { cardSel: null, goSel: '#rk-go' },
  fb: { cardSel: null, goSel: '#fb-go' },
};

// FLAKE BUDGET (26-0812, second pass).  These are sized from the arithmetic, not from taste.
// answerAndMeasure cannot know which choice is correct, so capturing a "correct" explain tile is a
// 1-in-4 draw on EVERY question -- and it is a fresh draw each time, because each question places
// its own key independently. At the previous 6 x 4, a level ending after three wrong answers gave
// roughly 18 real questions, so P(a module-grade never draws the key) = 0.75^18 = 0.56%, and across
// twelve module-grade pairs P(some pair fails) = 6.6% per run. That is what reddened this gate three
// times in one session.
// At 12 x 6 the same arithmetic gives well under 0.1% across all twelve pairs. The extra budget is
// only ever spent when a correct sample has not been found yet, since the loops exit the moment both
// samples are captured, so the common case costs nothing.
const MAX_ATTEMPTS = 12;  // fresh-level restarts per module x grade
const MAX_QUESTIONS = 6;  // questions driven within one attempt before giving up and restarting

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

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

const RESOURCE_NOISE = /Failed to load resource|net::|ERR_|favicon|status of (4|5)\d\d|downloadable font|Access-Control|preload/i;

// Runs INSIDE the page. Scoped to the module root (not just the question cell) because the
// defect this gate exists for is the tile spilling OUT of the question cell into sibling
// chrome (the foot bar sits next to, not inside, #rc-question).
function occlusionScanInPage(px) {
  const root = document.querySelector('.mod-' + px);
  if (!root) return { tileFound: false, reason: 'no module root .mod-' + px };
  const tile = root.querySelector('.' + px + '-explain');
  if (!tile) return { tileFound: false };
  const tileClass = tile.classList.contains('wrong') ? 'wrong' : (tile.classList.contains('right') ? 'right' : 'unknown');

  function hasOwnText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0) return true;
    }
    return false;
  }
  function describe(el) {
    const parts = [];
    let cur = el, depth = 0;
    while (cur && cur !== root && depth < 5) {
      let s = cur.tagName.toLowerCase();
      if (typeof cur.className === 'string' && cur.className.trim()) s += '.' + cur.className.trim().split(/\s+/).join('.');
      parts.unshift(s);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  const vw = window.innerWidth, vh = window.innerHeight;
  const blocked = [];
  let checked = 0;
  for (const el of root.querySelectorAll('*')) {
    if (el === tile || tile.contains(el)) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    if (el.closest('svg')) continue; // decorative art, never the site of this defect
    const isLeaf = el.children.length === 0;
    if (!hasOwnText(el) && !isLeaf) continue;

    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left), top = Math.max(0, r.top);
    const right = Math.min(vw, r.right), bottom = Math.min(vh, r.bottom);
    const w = right - left, h = bottom - top;
    if (w <= 1 || h <= 1) continue; // off-screen or collapsed -- nothing to sample

    checked++;
    const cx = left + w / 2, cy = top + h / 2;
    const pts = [[cx, cy]];
    if (w >= 6 && h >= 6) {
      pts.push([left + w * 0.2, top + h * 0.3], [left + w * 0.8, top + h * 0.3],
        [left + w * 0.2, top + h * 0.7], [left + w * 0.8, top + h * 0.7]);
    }
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === tile || tile.contains(hit))) {
        blocked.push({
          selector: describe(el),
          text: (el.textContent || '').trim().slice(0, 70),
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
          at: { x: Math.round(x), y: Math.round(y) },
        });
        break;
      }
    }
  }
  return { tileFound: true, tileClass, candidatesChecked: checked, blocked };
}

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const launchOpts = { headless: true, args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: VIEWPORT });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!RESOURCE_NOISE.test(t)) errors.push('console.error: ' + t); } });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith('data:')) return route.continue();
    return route.abort();
  });

  const problems = [];
  const note = (m) => console.log('  ' + m);

  const hideModals = () => page.evaluate(() => {
    document.querySelectorAll('.stats-modal').forEach((m) => { m.style.display = 'none'; });
  });

  // Opens `modId` fresh at the CURRENT grade and clears its picker (if any), landing on the
  // first rendered question with its answer buttons live.
  async function openFresh(modId, px) {
    await hideModals();
    await page.evaluate((mid) => { window.openModule(mid); window.playLevel(0); }, modId);
    await page.waitForSelector('.mod-' + px, { timeout: 8000 });

    const picker = PICKER[px];
    if (picker) {
      if (picker.cardSel) {
        await hideModals();
        const cards = await page.$$(picker.cardSel);
        if (!cards.length) throw new Error(`${modId}: picker card ${picker.cardSel} never rendered`);
        await cards[0].click();
        await page.waitForTimeout(30);
      }
      await hideModals();
      await page.click(picker.goSel, { timeout: 5000 });
    }
    await page.waitForSelector(`#${px}-question .${px}-ans`, { timeout: 8000 });
    await page.waitForTimeout(40);
  }

  // Answers the CURRENT question with choice index 0 and returns the occlusion-scan result
  // once the explain tile has rendered.
  // This always clicked data-idx="0". Rotating the index instead, as a first pass at the flake,
  // was WRONG and is kept only because it costs nothing: each question places its key
  // independently, so which index you click does not change the 1-in-4 odds of drawing a correct
  // answer on any given question. Rotation would only help if the key position were fixed across
  // questions, and it is not. The flake is fixed by the question BUDGET above, sized from that
  // arithmetic; see the comment on MAX_ATTEMPTS.
  //
  // Reading the key from the DOM instead is not available: the module marks the correct button
  // with `.correct` only inside its own answer handler, after the click that ends the question.
  async function answerAndMeasure(px, pickIdx) {
    await hideModals();
    const all = await page.$$(`#${px}-question .${px}-ans`);
    if (!all.length) throw new Error(`${px}: no answer buttons to click`);
    const btn = all[pickIdx % all.length];
    await btn.click();
    await page.waitForSelector(`#${px}-question .${px}-explain`, { timeout: 6000 });
    return page.evaluate(occlusionScanInPage, px);
  }

  // Advances past the just-measured tile: clicks the injected NEXT button on the wrong path,
  // or simply waits out the correct path's auto-advance. Returns true if a fresh question
  // rendered (the old tile detached and new answer buttons appeared), false if the level
  // appears to have ended (which is expected: most modules end after 3 wrong answers).
  async function advance(px) {
    await hideModals();
    const nextBtn = await page.$(`#${px}-question .explain-next`);
    if (nextBtn) await nextBtn.click();
    const detached = await page.waitForSelector(`#${px}-question .${px}-explain`, { state: 'detached', timeout: 5000 }).then(() => true).catch(() => false);
    if (!detached) return false;
    return page.waitForSelector(`#${px}-question .${px}-ans`, { timeout: 3000 }).then(() => true).catch(() => false);
  }

  async function testModuleGrade(modId, px, grade) {
    let wrongCap = null, correctCap = null;
    // Rotates across every question of every attempt, so all four choice positions get tried.
    let pick = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !(wrongCap && correctCap); attempt++) {
      try {
        await openFresh(modId, px);
      } catch (e) {
        problems.push(`${modId} g${grade}: could not reach gameplay (attempt ${attempt + 1}) -- ${e.message}`);
        return;
      }

      for (let q = 0; q < MAX_QUESTIONS && !(wrongCap && correctCap); q++) {
        let result;
        try {
          result = await answerAndMeasure(px, pick++);
        } catch (e) {
          problems.push(`${modId} g${grade}: answering question ${q + 1} failed (attempt ${attempt + 1}) -- ${e.message}`);
          break;
        }
        if (!result.tileFound) {
          problems.push(`${modId} g${grade}: explain tile never appeared after answering (attempt ${attempt + 1}, q${q + 1})`);
          break;
        }
        if (result.tileClass === 'wrong' && !wrongCap) wrongCap = result;
        else if (result.tileClass === 'right' && !correctCap) correctCap = result;

        if (wrongCap && correctCap) break;

        const advanced = await advance(px);
        if (!advanced) break; // level likely ended -- restart fresh on the next attempt
      }
    }

    if (!wrongCap || !correctCap) {
      problems.push(`${modId} g${grade}: gave up after ${MAX_ATTEMPTS} attempts without capturing both a wrong and a correct explain-tile sample (wrong=${!!wrongCap}, correct=${!!correctCap})`);
      return;
    }

    for (const [label, cap] of [['wrong', wrongCap], ['correct', correctCap]]) {
      if (cap.blocked.length) {
        problems.push(`${modId} g${grade} [${label} tile]: ${cap.blocked.length} element(s) occluded by the explain tile (checked ${cap.candidatesChecked} candidates):`);
        for (const b of cap.blocked) problems.push(`    ${b.selector} "${b.text}" -- covered at (${b.at.x},${b.at.y}), box ${b.rect.w}x${b.rect.h} at (${b.rect.x},${b.rect.y})`);
      }
    }
    note(`${modId} g${grade}: wrong tile checked ${wrongCap.candidatesChecked} candidates (${wrongCap.blocked.length} blocked), correct tile checked ${correctCap.candidatesChecked} candidates (${correctCap.blocked.length} blocked)`);
  }

  try {
    await page.goto(base + '/Math-Multiverse.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#module-grid .module-card', { timeout: 15000 });

    for (const grade of [5, 6]) {
      await page.evaluate(() => window.exitToLauncher && window.exitToLauncher());
      await page.click('#btn-grade-' + grade);
      await page.waitForSelector('#module-grid .module-card', { timeout: 10000 });
      await page.waitForTimeout(80);

      for (const [modId, px] of MODULES) {
        await testModuleGrade(modId, px, grade);
      }
    }
  } catch (e) {
    problems.push('harness failed: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n=== tile-overlap summary: ${errors.length} JS error(s), ${problems.length} problem(s) ===`);
  if (errors.length) { console.log('JS errors:'); errors.slice(0, 30).forEach((e) => console.log('  ' + e)); }
  if (problems.length) { console.log('problems:'); problems.forEach((p) => console.log('  ' + p)); }

  if (errors.length || problems.length) { console.log('\nRESULT: FAIL'); process.exit(1); }
  console.log('\nRESULT: ALL CLEAN'); process.exit(0);
})().catch((e) => { console.error('tile-overlap crashed: ' + (e && e.stack || e)); process.exit(2); });
