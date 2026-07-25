'use strict';
// smoke.js -- headless render gate. Serves the repo over http and boots the launcher plus all six
// modules at Grade 5 AND Grade 6 in a real Chromium, asserting zero uncaught JS errors / console
// errors (resource-load noise excluded) and the expected launcher state. It then plays one level of
// the ela-g6-spy content pack end to end at 1024x768, which is the only automated check that a pack
// level actually renders, grades, explains and stays inside a 768px screen. External image requests
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

    // That selector resolves on the SYNCHRONOUS math-only render: boot calls buildShelves(null) and
    // renderLauncher() before it ever fetches the manifest, and the pack shelf only appears when
    // MVPack.loadManifest() resolves and re-renders. Sampling between those two points would find no
    // English shelf and blame the grade filter for a race. Wait for the registry itself to be
    // complete, which is grade-independent -- SHELVES is the full registry whatever campaign is on
    // screen. `SHELVES` is a top-level `let`, so it is reachable as a bare identifier but is NOT a
    // window property; `window.SHELVES` is undefined and would hang here.
    await page.waitForFunction(
      () => typeof SHELVES !== 'undefined' && SHELVES.some((s) => s.subject === 'ela'),
      { timeout: 15000 },
    ).catch(() => problems.push('boot: pack manifest never reached SHELVES (fetch failed or engine did not load)'));
    note('launcher booted');

    for (const grade of [5, 6]) {
      const before = errors.length;
      await page.evaluate(() => window.exitToLauncher && window.exitToLauncher()); // show launcher screen (grade btn re-renders but doesn't switch screen)
      await page.click('#btn-grade-' + grade);
      await page.waitForSelector('#module-grid .module-card', { timeout: 10000 });
      await page.waitForTimeout(80);

      // Per-shelf counts, not one total. The math shelf must always hold exactly six; other shelves are
      // checked against the manifest so a pack that fails to load cannot pass as "no shelf". A single
      // number for both grades would have hidden the real defect smoke exposed: a grade-6 pack rendering
      // on the grade-5 launcher, under a header that reads "5th grade CCSS practice".
      const shelfCounts = await page.$$eval('.subject-shelf', (els) => els.map((e) => ({
        subject: e.dataset.subject,
        cards: e.querySelectorAll('.module-card').length,
      })));
      const mathShelf = shelfCounts.find((s) => s.subject === 'math');
      if (!mathShelf) problems.push(`grade ${grade}: no math shelf rendered`);
      else if (mathShelf.cards !== 6) problems.push(`grade ${grade}: math shelf expected 6 cards, got ${mathShelf.cards}`);

      // Assert what the cards ARE, not only how many, so a pack landing on the wrong shelf is caught by
      // name rather than by arithmetic. The one pack in the manifest declares grade 6, so the English
      // shelf is expected on grade 6 and expected to be absent on grade 5. When a grade-5 pack ships,
      // this list is what changes, and it fails loudly rather than silently blessing the wrong grade.
      const titlesOn = (subject) => page.$$eval(
        `.subject-shelf[data-subject="${subject}"] .mc-title`, (els) => els.map((e) => e.textContent.trim()));
      const elaTitles = await titlesOn('ela');
      const wantEla = grade === 6 ? ['Cold Signal'] : [];
      if (elaTitles.join(' | ') !== wantEla.join(' | ')) {
        problems.push(`grade ${grade}: english shelf cards [${elaTitles.join(', ')}], expected [${wantEla.join(', ')}]`);
      }
      const mathTitles = await titlesOn('math');
      const strays = mathTitles.filter((t) => t === 'Cold Signal');
      if (strays.length) problems.push(`grade ${grade}: pack card(s) [${strays.join(', ')}] sitting on the math shelf`);

      if (grade === 6) {
        const soon = await page.$$eval('#module-grid .module-card', (els) => els.filter((e) => /coming soon/i.test(e.textContent)).length);
        if (soon !== 0) problems.push(`grade 6: ${soon} module(s) still "coming soon"`);
      }
      // Report the campaign the page believes it is on, sampled at the same moment as the shelves.
      // If a shelf assertion ever fails, this one value says whether the filter is wrong or the click
      // simply did not take effect, which is otherwise indistinguishable from the outside.
      const active = await page.evaluate(() => (typeof ACTIVE_GRADE !== 'undefined' ? ACTIVE_GRADE : 'unreachable'));
      if (active !== grade) problems.push(`grade ${grade}: clicked grade ${grade} but ACTIVE_GRADE is ${active}`);
      note(`grade ${grade}: ACTIVE_GRADE=${active}, shelves ${shelfCounts.map((s) => s.subject + '=' + s.cards).join(' ')}${grade === 6 ? ', 0 coming-soon' : ''}`);

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

    // ---- pack playthrough: boot a level, answer an item, confirm the explain path and the layout ----
    // Runs once rather than per grade, because a pack carries its own grade.
    await page.setViewportSize({ width: 1024, height: 768 });
    const packBefore = errors.length;
    try {
      await page.evaluate(async () => { await window.openPack('ela-g6-spy'); });
      // The grid id is `level-grid`, singular. There is no `#levels-grid` in the shell.
      await page.waitForSelector('#level-grid .level-card', { timeout: 8000 });

      // Pin the shuffle. MVRunner.pickItems draws a level's questions with Math.random, and the shell
      // registers a pack through MVRunner.register, which passes deps=null -- so there is no rng
      // injection point and an unseeded run plays a different first item every time. Level 1's pool is
      // 4 ebsr, 3 mc, 2 hottext, 1 ms, 1 cloze and 1 match, and only mc, ms and ebsr expose .mv-choice,
      // so an unpinned gate would go red two runs in three for a reason that has nothing to do with the
      // code under test. Pinned, a failure here is reproducible. Restored in the finally below.
      //
      // This seed draws l1-ebsr-why-skip-the-meeting first, deliberately: ebsr is the richest path
      // (committing Part A locks it and reveals Part B) and it is the type whose Part B lock defect the
      // reclick probe below was written to guard. Its Part A key is choice 0 and the evidence that
      // supports choice 0 is Part B choice 1, so the "first live choice in each group" policy below
      // answers Part A right and Part B wrong, which is what puts the explain tile on screen. Changing
      // this pack's level 1 can change which item is drawn; the note below prints the stem so a
      // maintainer can see what actually ran.
      await page.evaluate(() => {
        window.__realRandom = Math.random;
        let s = 20;
        Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      });
      await page.evaluate(() => window.playLevel(0));
      await page.waitForSelector('.mv-shell .mv-item', { timeout: 8000 });

      // A real item must be on screen, not an empty shell. ebsr puts a "Part A" label before its stem,
      // so the stem itself is read from .mv-stem whenever there is one.
      const played = await page.evaluate(() => {
        const item = document.querySelector('.mv-shell .mv-item');
        const s = item && item.querySelector('.mv-stem');
        const text = ((s ? s.textContent : (item ? item.textContent : '')) || '').trim();
        return { len: text.length, head: text.slice(0, 44), parts: item ? item.querySelectorAll('.mv-part-label').length : 0 };
      });
      if (played.len < 5) problems.push('pack: level rendered with no question text');
      note(`pack ela-g6-spy: level 1 rendered, ${played.parts} part label(s), stem "${played.head}..."`);

      // Fill every choice group the item exposes, re-querying after each click instead of snapshotting
      // the buttons once: ebsr keeps Part B hidden until Part A is committed and disables Part A on
      // commit, so a single pass would leave Part B unanswered and its Check button disabled forever.
      // Stops when Check goes live (ms, ebsr) or the item grades itself (mc, which has no Check).
      const fillChoices = async () => {
        for (let guard = 0; guard < 8; guard++) {
          const st = await page.evaluate(() => {
            const item = document.querySelector('.mv-shell .mv-item');
            if (!item) return 'no-item';
            if (item.dataset.locked === '1') return 'graded';
            const check = document.querySelector('.mv-check');
            if (check && !check.disabled) return 'ready';
            for (const b of item.querySelectorAll('.mv-choice')) {
              if (b.disabled || b.classList.contains('sel')) continue;
              b.click();
              return 'clicked';
            }
            return 'no-choices';
          });
          if (st !== 'clicked') return st;
          await page.waitForTimeout(60);
        }
        return 'guard';
      };

      // Answer up to four items, stopping at the first wrong one, because the wrong path carries the
      // assertions worth making: the explain tile, the 26-0714 no-auto-advance rule, the graded-item
      // lock, and the NEXT button's position on a 768px screen. A correct answer flashes and
      // auto-advances, which is equally valid, so it is walked past rather than failed.
      let exercised = false;
      let answered = 0;
      for (let n = 0; n < 4 && !exercised; n++) {
        const filled = await fillChoices();
        if (filled === 'no-choices' || filled === 'no-item' || filled === 'guard') {
          problems.push(`pack: item ${n + 1} could not be answered (${filled}); re-pin the shuffle seed above`);
          break;
        }
        if (filled === 'ready') await page.click('.mv-check');
        answered++;
        // Either the answer was right (a flash, then auto-advance) or wrong (an explain tile with
        // NEXT). Both are valid; neither may be absent.
        await page.waitForSelector('.mv-explain .mv-next, .mv-flash.ok', { timeout: 6000 });
        if (!(await page.$('.mv-explain .mv-next'))) {
          await page.waitForTimeout(1600);   // correct: let the 1400ms auto-advance land, then try again
          continue;
        }
        exercised = true;

        // The 26-0714 rule: a wrong answer must NOT auto-advance. Prove the tile is still there.
        await page.waitForTimeout(2600);
        const stillThere = await page.$('.mv-explain .mv-next');
        if (!stillThere) problems.push('pack: explain tile auto-advanced on a wrong answer (26-0714 regression)');

        // A graded item must be inert. Only checked on the wrong-answer path: a correct answer
        // flashes and auto-advances, and the next item's box is deliberately unlocked, so asking
        // this question there is a race that fails for the wrong reason. tests/items.test.js proves
        // the lock precisely against a DOM stub; this is the real-browser sanity check that the stub
        // is not lying. The defect it guards shipped: ebsr's Part B stayed clickable after grading
        // because the guard read a sub-box nobody locks, so a child could change a scored answer.
        const reclick = await page.evaluate(() => {
          const item = document.querySelector('.mv-shell .mv-item');
          if (!item) return 'no-item';
          if (item.dataset.locked !== '1') return 'not-locked';
          const before = document.querySelectorAll('.mv-choice.sel').length;
          for (const b of document.querySelectorAll('.mv-choice')) {
            if (!b.classList.contains('sel')) { b.click(); break; }
          }
          return document.querySelectorAll('.mv-choice.sel').length === before ? 'inert' : 'CHANGED';
        });
        if (reclick === 'CHANGED') problems.push('pack: a graded item accepted a new answer');
        if (reclick === 'not-locked') problems.push('pack: item was not locked after grading');

        const box = await page.$eval('.mv-explain .mv-next', (el) => el.getBoundingClientRect().bottom);
        if (box > 768) problems.push(`pack: NEXT button sits at ${Math.round(box)}px, off a 768px screen`);
        await page.click('.mv-explain .mv-next');
      }
      if (!exercised) {
        problems.push(`pack: ${answered} item(s) answered with no wrong answer, so the explain tile, the graded-item lock and the NEXT position went unchecked`);
      } else {
        note(`pack ela-g6-spy: answer path ok (item ${answered}: wrong -> explain -> NEXT)`);
      }

      // Nothing may scroll the page body; the passage scrolls inside its own box. The geometry is
      // reported on every run, pass or fail, because the interesting number changed shape with the
      // flex refactor. #app is now exactly the viewport and .host-frame takes the space left after
      // the header and the toolbar, so page slack is 0 by construction rather than by margin, and
      // asking "how much spare page is there" no longer means anything. What does mean something is
      // frameH: how much room the module or the pack actually got. It was a fixed 608px under the old
      // `calc(100vh - 160px)`, and it is now whatever the font stack leaves, which is what makes this
      // correct on a browser nobody measured. Watch frameH across environments: the tightest module
      // is razor-crest, which starts clipping when the frame drops to about 576px.
      // A failure here is shell-wide and not a pack defect: the six math modules share this frame.
      const layout = await page.evaluate(() => {
        const f = document.querySelector('.host-frame');
        const b = f && f.getBoundingClientRect();
        const main = document.querySelector('#app > main');
        return {
          overflowY: document.documentElement.scrollHeight - window.innerHeight,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
          innerH: window.innerHeight, innerW: window.innerWidth,
          bodyH: document.body.scrollHeight,
          frameTop: b ? Math.round(b.top) : null,
          frameH: b ? Math.round(b.height) : null,
          belowFrame: b ? Math.round(document.body.scrollHeight - b.bottom) : null,
          mainOverflow: main ? main.scrollHeight - main.clientHeight : null,
        };
      });
      note(`pack layout: frame ${layout.frameH}px at y=${layout.frameTop}, page ${layout.bodyH}/${layout.innerH}, slack ${layout.innerH - layout.bodyH}px`);
      if (layout.overflowY > 2) {
        problems.push(`pack: page body scrolls by ${layout.overflowY}px at 1024x768 -- ${JSON.stringify(layout)}`);
      }

      const newErr = errors.slice(packBefore);
      if (newErr.length) problems.push(`pack: ${newErr.length} JS error(s): ${newErr[0]}`);
    } catch (e) {
      problems.push('pack playthrough failed: ' + (e && e.message));
    } finally {
      await page.evaluate(() => {
        if (window.__realRandom) { Math.random = window.__realRandom; delete window.__realRandom; }
      }).catch(() => {});
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
