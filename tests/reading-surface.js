'use strict';
// reading-surface.js -- the reading surface gate.
//
// Every other check on this pack asks whether the child can ANSWER: the items grade correctly, the
// tap targets are 44px, the quotes are verbatim.  None of them asked whether the child can still
// READ.  They passed while a third of the pack rendered its passage at 48 to 84px, because
// .mv-passage is `flex: 1 1 auto` next to a `flex: 0 0 auto` item, so the reading surface absorbed
// all the pressure from a tall item and was the first thing to collapse.
//
// EBSR Part B asks "which sentence from the passage best supports the answer you just gave?".  An
// evidence item whose passage is not readable is broken, not merely ugly, so this is a gate rather
// than a lint.
//
// It asserts on MEASURED GEOMETRY in a real browser at the target device size, never on the CSS
// source, so it cannot be satisfied by a rule that is written but overridden.
//
// Packs are ENUMERATED FROM THE MANIFEST, not hardcoded to one pack id: originally this gate only
// ever fetched packs/ela-g6-spy.json, so registering a second pack (Vault of Ages) left it reporting
// "ALL CLEAN" while never once measuring the new pack's items -- passing for the wrong reason, which
// is worse than failing. The manifest is only the roster here; the oracle (MIN_PASSAGE_PX, SLIT_PX,
// the footer/scroll checks) is unchanged and applies identically to every pack found. Zero packs
// discovered in the manifest is a FAIL, never a silent pass, same house rule as
// tests/validate-pack.js: a harness that silently finds nothing must never report clean.
//
//   node tests/reading-surface.js
//   PLAYWRIGHT_EXECUTABLE_PATH="C:\\...\\chrome.exe" node tests/reading-surface.js
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
  catch (e2) { console.error('reading-surface: neither "playwright" nor "playwright-core" is installed.'); process.exit(2); }
}

const ROOT = path.join(__dirname, '..');

// The iPad 6 in landscape, which is the device Niall actually uses.
const VIEWPORT = { width: 1024, height: 768 };

// A passage must keep at least this much height.  One .mv-para line is about 21px at 0.95rem/1.5,
// and the title plus the box padding costs about 44px, so 190px is roughly a title plus seven lines:
// enough to read a paragraph and locate a quoted sentence without the box being a slit.  The number
// is a floor, not a target; most items get two to three times this.
const MIN_PASSAGE_PX = 190;

// Below this a box is not a short passage, it is a sliced line of text.  Reported separately because
// it is the failure Justin actually saw and it should never come back quietly.
const SLIT_PX = 100;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(String(req.url).split('?')[0]));
      fs.readFile(p, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  const { server, port } = await startServer();
  const launchOpts = { args: ['--disable-gpu', '--disable-gpu-compositing'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: VIEWPORT });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));

  await page.goto(`http://127.0.0.1:${port}/Math-Multiverse.html`, { waitUntil: 'networkidle' });

  const manifest = await page.evaluate(async () => (await (await fetch('packs/manifest.json')).json()));
  const manifestPacks = (manifest && Array.isArray(manifest.packs)) ? manifest.packs : [];
  if (!manifestPacks.length) {
    console.error('reading-surface: manifest declares zero packs -- refusing to report clean on nothing');
    await browser.close();
    server.close();
    process.exit(1);
  }

  const rows = [];
  const perPackCounts = [];

  for (const entry of manifestPacks) {
    // Return to the launcher and select this pack's own grade before looking for its card: a prior
    // iteration may have left the page mid-level on a different grade entirely.
    await page.evaluate(() => { if (typeof exitToLauncher === 'function') exitToLauncher(); });
    await page.waitForTimeout(150);
    await page.evaluate((grade) => {
      const b = [...document.querySelectorAll('button')].find((x) => new RegExp(`Grade ${grade}\\b`, 'i').test(x.textContent));
      if (!b) throw new Error(`no Grade ${grade} button`);
      b.click();
    }, entry.grade);
    await page.waitForTimeout(300);

    await page.evaluate(({ title, grade }) => {
      const t = [...document.querySelectorAll('.module-card .mc-title')].find((x) => x.textContent.trim() === title);
      if (!t) throw new Error(`no "${title}" card on the grade ${grade} launcher`);
      t.closest('.module-card').click();
    }, { title: entry.title, grade: entry.grade });
    await page.waitForSelector('.level-card', { timeout: 8000 });
    await page.waitForTimeout(1200);

    await page.evaluate(() => {
      const l = document.querySelector('.level-card:not(.locked)');
      if (!l) throw new Error('no open level card');
      l.click();
    });
    await page.waitForSelector('.mv-passage, .mv-item', { timeout: 8000 });
    await page.waitForTimeout(700);

    const items = await page.evaluate(async (packId) => {
      window.__pack = await (await fetch(`packs/${packId}.json`)).json();
      if (!window.__pack.items || !window.__pack.items.length) throw new Error(`pack ${packId} has no items`);
      return window.__pack.items.map((i) => ({ id: i.id, type: i.type }));
    }, entry.id);
    perPackCounts.push({ id: entry.id, title: entry.title, n: items.length });

    for (const meta of items) {
      const m = await page.evaluate((itemId) => {
        const pack = window.__pack;
        const item = pack.items.find((i) => i.id === itemId);
        const passage = pack.passages.find((p) => p.id === item.passageId);
        const box = document.querySelector('.mv-passage');
        const host = document.querySelector('.mv-item');
        if (!box || !host) throw new Error('level shell missing .mv-passage or .mv-item');

        box.innerHTML = '';
        const t = document.createElement('div');
        t.className = 'mv-passage-title';
        t.textContent = passage.title;
        box.appendChild(t);
        for (const para of String(passage.text).split(/\n\s*\n/)) {
          const p = document.createElement('p');
          p.className = 'mv-para';
          p.textContent = para.trim();
          box.appendChild(p);
        }

        MVItems.render(item, host, { onAnswer() {}, onProgress() {} });
        // EBSR hides Part B until Part A is committed.  Measure the state the child is actually in
        // when they are asked to find the supporting sentence, which is the tall one.
        if (item.type === 'ebsr') {
          host._mvState.aWrap.querySelector(`.mv-choice[data-idx="${item.partA.key}"]`).click();
        }

        const frame = document.querySelector('.host-frame') || document.querySelector('#app');
        const fr = frame.getBoundingClientRect();
        const footer = document.querySelector('.mv-footer');
        const passStyle = getComputedStyle(box);
        return {
          passagePx: Math.round(box.getBoundingClientRect().height),
          // The passage is allowed to scroll, but only if it is tall enough to read in the first place.
          itemPx: Math.round(host.getBoundingClientRect().height),
          // The item is allowed to scroll ONLY when the passage has already given everything it can.
          // Without this the fix inverts: a passage with an `auto` basis wins the shrink split and
          // squeezes a short item into a scrollbar while sitting at three times its own floor.
          itemScrolls: host.scrollHeight > host.clientHeight + 1,
          passageAtFloor: Math.round(box.getBoundingClientRect().height) <= Math.ceil(parseFloat(passStyle.minHeight)) + 2,
          footerBelowFrame: footer ? Math.round(footer.getBoundingClientRect().bottom - fr.bottom) : 0,
        };
      }, meta.id);
      rows.push({ packId: entry.id, ...meta, ...m });
    }
  }

  const byType = {};
  for (const r of rows) (byType[r.type] = byType[r.type] || []).push(r.passagePx);
  console.log(`reading surface at ${VIEWPORT.width}x${VIEWPORT.height}, ${rows.length} items across ${manifestPacks.length} pack(s)\n`);
  for (const c of perPackCounts) console.log(`  pack ${c.id} ("${c.title}"): ${c.n} items`);
  console.log('');
  for (const [t, hs] of Object.entries(byType).sort()) {
    hs.sort((a, b) => a - b);
    console.log(`  ${t.padEnd(10)} n=${String(hs.length).padStart(2)}  min=${String(hs[0]).padStart(4)}px  median=${String(hs[Math.floor(hs.length / 2)]).padStart(4)}px  max=${String(hs[hs.length - 1]).padStart(4)}px`);
  }

  const problems = [];
  for (const r of rows) {
    const tag = `${r.packId}/${r.id} [${r.type}]`;
    if (r.passagePx < SLIT_PX) problems.push(`${tag}: passage is a ${r.passagePx}px SLIT, not a readable box (item is ${r.itemPx}px)`);
    else if (r.passagePx < MIN_PASSAGE_PX) problems.push(`${tag}: passage ${r.passagePx}px is under the ${MIN_PASSAGE_PX}px floor (item is ${r.itemPx}px)`);
    if (r.footerBelowFrame > 1) problems.push(`${tag}: the Check button is ${r.footerBelowFrame}px below the frame, off screen`);
    if (r.itemScrolls && !r.passageAtFloor) problems.push(`${tag}: the item is scrolling while the passage sits at ${r.passagePx}px, well above its floor. The passage should give first.`);
  }

  console.log(`\n=== reading-surface: ${rows.length} items, ${problems.length} problem(s), ${jsErrors.length} JS error(s) ===`);
  for (const p of problems) console.log('  ' + p);
  for (const e of jsErrors) console.log('  JS ERROR: ' + e);

  await browser.close();
  server.close();

  if (problems.length || jsErrors.length) {
    console.log('\nRESULT: FAILED');
    process.exit(1);
  }
  console.log('\nRESULT: ALL CLEAN');
  // Fix wave (final review): every OTHER browser-driving gate (figures-offline, figure-derive,
  // smoke, tile-overlap) exits explicitly on its clean path; this one fell off the end of its
  // async IIFE instead. Under Node 24 a stray promise rejection settling AFTER this line is
  // fatal to the still-running process, which sets exit 1 on a run that already printed ALL
  // CLEAN and truncates the chain script before tile-overlap ever runs -- reproduced live by
  // injecting a timed stray rejection here. Every problem path above (missing playwright at
  // :40, zero packs at :91, problems.length || jsErrors.length at :208, and the outer .catch at
  // the end of the file, `})().catch((e) => {...})`, for any thrown harness error) already calls
  // process.exit(1) or exit(2) before reaching this line, so this exit(0) cannot mask a real
  // failure -- it only closes the window where a late, unrelated rejection could overwrite a
  // result this gate already decided.
  process.exit(0);
})().catch((e) => {
  console.error('reading-surface: harness error:', e && e.stack || e);
  process.exit(2);
});
