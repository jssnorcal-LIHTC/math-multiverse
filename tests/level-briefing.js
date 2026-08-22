'use strict';
// level-briefing.js -- the WP-P gate on the level briefing.
//
//   node tests/level-briefing.js
//
// A briefing occupies the space the passage and the item will use, so it inherits their 1024x768
// no-page-scroll contract. It is also the first thing a child sees in a level, which makes a
// briefing whose Begin button sits below the fold worse than no briefing at all.
//
// HARD RULES (constraint 12). Both directions:
//   POSITIVE  a level that declares a briefing shows it before the first question, hides the
//             passage and the item behind it, and its Begin button is on screen and finger-sized.
//   NEGATIVE  a level that declares NO briefing goes straight to the question, unchanged. Without
//             that control, a hook that rendered a briefing panel for everything, or one that
//             rendered nothing at all, would both look identical from the positive side.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) { console.error('level-briefing: playwright is not installed.'); process.exit(2); }
}

const ROOT = path.resolve(path.join(__dirname, '..'));
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

const problems = [];
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) problems.push(`${name}${detail ? ' -- ' + detail : ''}`);
}

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const launchOpts = { headless: true, args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e && e.message)));
  await page.route('**/*', (r) => {
    const u = r.request().url();
    return (u.startsWith(base) || u.startsWith('data:')) ? r.continue() : r.abort();
  });

  try {
    await page.goto(base + '/Math-Multiverse.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#module-grid .module-card', { timeout: 15000 });
    await page.waitForFunction(
      () => typeof SHELVES !== 'undefined' && SHELVES.some((s) => s.subject === 'sci'), { timeout: 15000 });
    await page.evaluate(() => { localStorage.clear(); Save.load(); Save.state.previewMode = true; });

    // ---- ARMING: the pack really declares briefings ----
    const declared = await page.evaluate(async () => {
      const pack = await MVPack.loadPack('outpost-protocol-g6');
      const withB = pack.levels.filter((l) => l.briefing && Array.isArray(l.briefing.lines) && l.briefing.lines.length);
      return { levels: pack.levels.length, withBriefing: withB.length, firstTitle: withB[0] && withB[0].briefing.title };
    });
    check('ARMING: every science level declares a briefing',
      declared.withBriefing === declared.levels && declared.levels === 6,
      `${declared.withBriefing} of ${declared.levels}`);
    if (!declared.withBriefing) throw new Error('arming failed: no briefings declared');

    // ---- POSITIVE ----
    await page.evaluate(async () => { await openPack('outpost-protocol-g6'); playLevel(0); });
    await page.waitForSelector('.mv-briefing', { timeout: 20000 });
    await page.waitForTimeout(300);
    const shown = await page.evaluate(() => {
      const b = document.querySelector('.mv-briefing');
      const begin = document.querySelector('.mv-briefing-begin');
      const r = begin ? begin.getBoundingClientRect() : null;
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none';
      return {
        briefing: !!b,
        lines: b ? b.querySelectorAll('.mv-briefing-line').length : 0,
        title: (b && b.querySelector('.mv-briefing-title') || {}).textContent || '',
        passageVisible: vis(document.querySelector('.mv-passage')),
        itemVisible: vis(document.querySelector('.mv-item')),
        questionRendered: (() => { const it = document.querySelector('.mv-item'); return !!it && it.children.length > 0 && (it.textContent || '').trim().length > 20; })(),
        beginH: r ? Math.round(r.height) : 0,
        beginW: r ? Math.round(r.width) : 0,
        beginOnScreen: !!r && r.bottom <= 768 && r.top >= 0 && r.right <= 1024,
        pageScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        bodyScrollW: document.body.scrollWidth,
      };
    });
    check('a level with a briefing shows it before the first question', shown.briefing && shown.lines >= 2,
      JSON.stringify({ briefing: shown.briefing, lines: shown.lines }));
    check('and it names what the briefing is about', shown.title.length > 3, JSON.stringify(shown.title));
    check('the passage and the question wait behind it rather than sharing the screen',
      !shown.passageVisible && !shown.itemVisible,
      JSON.stringify({ passage: shown.passageVisible, item: shown.itemVisible }));
    check('the Begin button is on screen at 1024x768', shown.beginOnScreen,
      `begin ${shown.beginW}x${shown.beginH}, page ${shown.pageScrolls ? 'SCROLLS' : 'does not scroll'}`);
    check('the Begin button clears the 44px touch floor', shown.beginH >= 44 && shown.beginW >= 44,
      `${shown.beginW}x${shown.beginH}`);
    check('the briefing does not make the page scroll', !shown.pageScrolls && shown.bodyScrollW <= 1024,
      `scrollW=${shown.bodyScrollW}`);

    // ---- Begin hands over to the level ----
    await page.click('.mv-briefing-begin');
    await page.waitForTimeout(350);
    const begun = await page.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none';
      return {
        briefingGone: !document.querySelector('.mv-briefing'),
        passageVisible: vis(document.querySelector('.mv-passage')),
        itemVisible: vis(document.querySelector('.mv-item')),
        questionRendered: (() => { const it = document.querySelector('.mv-item'); return !!it && it.children.length > 0 && (it.textContent || '').trim().length > 20; })(),
        pageScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      };
    });
    check('tapping Begin removes the briefing and starts the level',
      begun.briefingGone && begun.passageVisible && begun.itemVisible && begun.questionRendered,
      JSON.stringify(begun));
    check('and the level still fits 1024x768 once it starts', !begun.pageScrolls);

    // ---- NEGATIVE CONTROL: a level with NO briefing goes straight to the question ----
    // Cold Signal declares none, so nothing here is a fixture: it is the shipped behaviour of every
    // pack that has not opted in.
    const noBriefing = await page.evaluate(async () => {
      const pack = await MVPack.loadPack('ela-g6-spy');
      return pack.levels.filter((l) => l.briefing).length;
    });
    check('CONTROL: the comparison pack genuinely declares no briefings', noBriefing === 0, `${noBriefing} found`);
    await page.evaluate(() => exitToLauncher());
    await page.evaluate(async () => { await openPack('ela-g6-spy'); playLevel(0); });
    await page.waitForSelector('.mv-item', { timeout: 20000 });
    await page.waitForTimeout(300);
    const plain = await page.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none';
      return {
        briefing: !!document.querySelector('.mv-briefing'),
        passageVisible: vis(document.querySelector('.mv-passage')),
        questionRendered: (() => { const it = document.querySelector('.mv-item'); return !!it && it.children.length > 0 && (it.textContent || '').trim().length > 20; })(),
      };
    });
    check('NEGATIVE CONTROL: a level with no briefing goes straight to the question',
      !plain.briefing && plain.passageVisible && plain.questionRendered, JSON.stringify(plain));

    check('no JS errors during the run', jsErrors.length === 0, jsErrors[0] || '');
  } catch (e) {
    problems.push('THREW: ' + ((e && e.stack) || e));
  } finally {
    await browser.close();
    server.close();
  }

  if (checks.length < 8) problems.push(`ARMING: only ${checks.length} assertions ran, too few to be the real gate`);

  console.log('\n=== level briefing (WP-P) ===');
  for (const c of checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok || !c.detail ? '' : '\n         ' + c.detail}`);
  if (problems.length) {
    console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
    problems.forEach((p) => console.log('  ' + p));
    console.log('\nRESULT: FAIL');
    process.exit(1);
  }
  console.log(`\nRESULT: ALL CLEAN (${checks.length} assertions, ${checks.filter((c) => /CONTROL/.test(c.name)).length} of them controls)`);
  process.exit(0);
})();
