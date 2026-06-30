'use strict';
// smoke.js -- headless render gate. Serves the repo over http and boots the launcher plus all six
// modules at Grade 5 AND Grade 6 in a real Chromium, asserting zero uncaught JS errors / console
// errors (resource-load noise excluded) and the expected launcher state. External image requests
// are blocked so the run is hermetic and not flaky on the network; the game's onerror fallbacks
// handle the misses, so a blocked image is not a JS error.
//
//   node tests/smoke.js
//   PLAYWRIGHT_EXECUTABLE_PATH="C:\\...\\chrome.exe" node tests/smoke.js   (reuse a local browser)
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
  catch (e2) { console.error('smoke: neither "playwright" nor "playwright-core" is installed.\n  npm i -D playwright   (CI: also `npx playwright install chromium`)'); process.exit(2); }
}

const ROOT = path.join(__dirname, '..');
const MODULES = [
  ['fraction-rider', '.mod-fr'],
  ['f1-decimals', '.mod-f1'],
  ['razor-crest', '.mod-rc'],
  ['master-builder', '.mod-mb'],
  ['rocky-translator', '.mod-rk'],
  ['floating-bear', '.mod-fb'],
];

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

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const launchOpts = { headless: true, args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); if (!RESOURCE_NOISE.test(t)) errors.push('console.error: ' + t); } });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  // Hermetic: only same-origin (localhost) + data: requests proceed; external images are blocked.
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(base) || u.startsWith('data:')) return route.continue();
    return route.abort();
  });

  const problems = [];
  const note = (m) => { console.log('  ' + m); };

  try {
    await page.goto(base + '/Math-Multiverse.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#module-grid .module-card', { timeout: 15000 });
    note('launcher booted');

    for (const grade of [5, 6]) {
      const before = errors.length;
      await page.evaluate(() => window.exitToLauncher && window.exitToLauncher()); // show launcher screen (grade btn re-renders but doesn't switch screen)
      await page.click('#btn-grade-' + grade);
      await page.waitForSelector('#module-grid .module-card', { timeout: 10000 });
      await page.waitForTimeout(80);

      const cards = await page.$$eval('#module-grid .module-card', (els) => els.length);
      if (cards !== 6) problems.push(`grade ${grade}: expected 6 launcher cards, got ${cards}`);

      if (grade === 6) {
        const soon = await page.$$eval('#module-grid .module-card', (els) => els.filter((e) => /coming soon/i.test(e.textContent)).length);
        if (soon !== 0) problems.push(`grade 6: ${soon} module(s) still "coming soon"`);
      }
      note(`grade ${grade}: launcher ${cards} cards${grade === 6 ? ', 0 coming-soon' : ''}`);

      for (const [id, sel] of MODULES) {
        const b2 = errors.length;
        try {
          await page.evaluate((mid) => { window.openModule(mid); window.playLevel(0); }, id);
          await page.waitForSelector(sel, { timeout: 8000 });
          await page.waitForTimeout(40);
        } catch (e) {
          problems.push(`grade ${grade} ${id}: did not render (${sel}) -- ${e.message}`);
          continue;
        }
        const newErr = errors.slice(b2);
        if (newErr.length) problems.push(`grade ${grade} ${id}: ${newErr.length} JS error(s): ${newErr[0]}`);
        else note(`grade ${grade} ${id}: ok`);
      }

      if (errors.length > before) {
        // already attributed per-module above; nothing extra
      }
    }
  } catch (e) {
    problems.push('navigation/boot failed: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n=== smoke summary: ${errors.length} JS error(s), ${problems.length} problem(s) ===`);
  if (errors.length) { console.log('JS errors:'); errors.slice(0, 30).forEach((e) => console.log('  ' + e)); }
  if (problems.length) { console.log('problems:'); problems.forEach((p) => console.log('  ' + p)); }

  if (errors.length || problems.length) { console.log('\nRESULT: FAIL'); process.exit(1); }
  console.log('\nRESULT: ALL CLEAN'); process.exit(0);
})().catch((e) => { console.error('smoke crashed: ' + (e && e.stack || e)); process.exit(2); });
