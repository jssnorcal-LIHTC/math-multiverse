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
      () => typeof SHELVES !== 'undefined' && SHELVES.some((s) => s.subject === 'ela') && SHELVES.some((s) => s.subject === 'sci') && SHELVES.some((s) => s.subject === 'hist'),
      { timeout: 15000 },
    ).catch(() => problems.push('boot: pack manifest never reached SHELVES with ela, sci and hist (fetch failed or engine did not load)'));
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
      // name rather than by arithmetic. Checked per subject shelf, keyed off PACK_SHELVES below rather
      // than a single English-only list, so the next new pack (or subject) fails loudly here instead
      // of silently passing on card COUNT alone. All four packs in the manifest declare grade 6, so
      // every shelf is expected to carry its full manifest-order list (buildShelves groups manifest.packs
      // by subject and preserves array order; packCardNode then renders `visible` in that same order --
      // confirmed live by this gate before this list was written: an unfixed run reports the cards in
      // exactly this order), and expected to be absent on grade 5. When a grade-5 pack ships, this list
      // is what changes, and it fails loudly rather than silently blessing the wrong grade.
      const titlesOn = (subject) => page.$$eval(
        `.subject-shelf[data-subject="${subject}"] .mc-title`, (els) => els.map((e) => e.textContent.trim()));
      const PACK_SHELVES = {
        ela: ['Cold Signal', 'Vault of Ages', 'Night Rounds'],
        sci: ['Outpost Protocol'],
        hist: ['Firsthand'],
      };
      const ALL_PACK_TITLES = Object.values(PACK_SHELVES).flat();
      for (const [subject, shelfTitles] of Object.entries(PACK_SHELVES)) {
        const titles = await titlesOn(subject);
        const want = grade === 6 ? shelfTitles : [];
        if (titles.join(' | ') !== want.join(' | ')) {
          problems.push(`grade ${grade}: ${subject} shelf cards [${titles.join(', ')}], expected [${want.join(', ')}]`);
        }
      }
      const mathTitles = await titlesOn('math');
      const strays = mathTitles.filter((t) => ALL_PACK_TITLES.includes(t));
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
      // injection point and an unseeded run plays a different first item every time. Only mc, ms and
      // ebsr expose .mv-choice, and every level's served slice now mixes all six item types (the
      // validate-pack first-slice rule fixes each level's front since the 26-0807 interleave
      // retrofit), so an unpinned gate would go red for a reason that has nothing to do with the
      // code under test. Pinned, a failure here is reproducible. Restored in the finally below.
      //
      // This seed currently draws an ebsr first, which is deliberately kept: ebsr is the richest
      // path (committing Part A locks it and reveals Part B) and it is the type whose Part B lock
      // defect the reclick probe below was written to guard. The "first live choice in each group"
      // policy below grades it wrong, which is what puts the explain tile on screen. Reordering or
      // changing this pack's level 1 itemIds changes which item is drawn; the note below prints the
      // stem so a maintainer can see what actually ran.
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
      // correct on a browser nobody measured. Watch frameH across environments: the tightest module is
      // razor-crest, which is clean at 570px and clips 7px at 560px at the default root font, while
      // the other five are clean down to 520px. That floor rises as the font stack grows, because the
      // module's own content grows with it. Windows Chrome gives 629px here and CI gives 595px, so the
      // margin before anything clips is 69px and 35px respectively.
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

    // ---- per-type interaction gate: the five types nothing had ever clicked in a browser --------
    // .mv-choice is the only control the playthrough above ever touches, and that covers mc, ms and
    // ebsr -- 48 of the pack's 72 items. hottext, cloze, match, order and shorttext had their
    // graders unit-tested and their render() called against tests/dom-stub.js, and that was all: no
    // browser had ever tapped a span, opened a blank, chosen a cell, placed a tile or typed an
    // answer. That is the other 24 items.
    //
    // Driven through the engine directly rather than through a level. The shuffle does not reach
    // these types cheaply -- order appears only in levels 2 and 5, shorttext only in 3 and 6 -- and
    // a seed pinned per type is a fixture that stops reaching its type, silently, the first time a
    // level's pool is edited.
    //
    // The response is read from host._mvState.picked, which is not a private back door: runner.js
    // reads that exact field in the Check handler and again in refreshCheck, and hands it to
    // Items.isComplete and Items.grade. Reading it here is what the child's Check button does.
    //
    // Input is real Playwright input -- mouse clicks, selectOption, fill -- not el.click() inside
    // evaluate. Dispatching straight at the listener would prove the wiring while saying nothing
    // about whether the control can be hit at all, and these five have had neither half proved.
    // It still does NOT prove touch: tap-target size, drag, and an on-screen keyboard over the
    // input are not observable here and stay on the iPad checklist.
    const typesBefore = errors.length;
    try {
      await page.evaluate(() => {
        const o = document.createElement('div');
        o.id = 'mv-probe';
        // Fixed, so mounting a probe cannot move the document's scroll geometry that the layout
        // assertion above measures; on top of everything, so nothing can intercept a click meant
        // for a control and turn a real defect into a timeout.
        o.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;overflow:auto;padding:14px;background:#0f1218;';
        document.body.appendChild(o);
      });

      const CONTROL = { hottext: '.mv-span', cloze: '.mv-blank', match: '.mv-cell', order: '.mv-tile', shorttext: '.mv-input' };

      // Mount one item of `type` on a FRESH host and report the pre-interaction state. Fresh
      // matters: MVItems.render only resets dataset.locked when the item id changes, so reusing a
      // host would carry state between the correct and the wrong drive.
      const mount = (type) => page.evaluate(async (t) => {
        const pack = await window.MVPack.loadPack('ela-g6-spy');
        const item = pack.items.find((i) => i.type === t);
        if (!item) return { err: `pack ela-g6-spy has no ${t} item` };
        const o = document.querySelector('#mv-probe');
        o.innerHTML = '';
        const host = document.createElement('div');
        host.className = 'mv-item mv-probe-host';
        o.appendChild(host);
        const p = (window.__probe = { item, host, progress: 0, answers: 0 });
        window.MVItems.render(item, host, { onAnswer() { p.answers++; }, onProgress() { p.progress++; } });
        // Expected control count comes from the ITEM, not a constant, so an authored change to the
        // pack moves this gate with it instead of failing as a stale fixture.
        const want = t === 'hottext' ? item.spans.length
          : t === 'cloze' ? item.blanks.length
            : t === 'match' ? item.rowLabels.length * item.colLabels.length
              : t === 'order' ? item.tiles.length
                : 1;
        const sel = { hottext: '.mv-span', cloze: '.mv-blank', match: '.mv-cell', order: '.mv-tile', shorttext: '.mv-input' }[t];
        const resp = (host._mvState || {}).picked;
        return {
          id: item.id, sel, want,
          controls: host.querySelectorAll(sel).length,
          resp: resp === undefined ? null : resp,
          complete: window.MVItems.isComplete(item, resp),
        };
      }, type);

      // Read the live response exactly as the Check button does, plus the signal that the CONTROL
      // itself moved, and grade it.
      const read = (type) => page.evaluate((t) => {
        const p = window.__probe;
        const st = p.host._mvState || {};
        const q = (s) => [...document.querySelectorAll('#mv-probe ' + s)];
        const typed = String((q('.mv-input')[0] || {}).value || '');
        const signal = t === 'hottext' ? `${q('.mv-span.sel').length} sel`
          : t === 'cloze' ? `values ${q('.mv-blank').map((s) => (s.value === '' ? '-' : s.value)).join(',')}`
            : t === 'match' ? `${q('.mv-cell.sel').length} sel`
              : t === 'order' ? `${q('.mv-line .mv-tile').length} placed, ${q('.mv-bank .mv-tile').length} in bank`
                : `typed "${typed}"`;
        // Each type declares its OWN evidence rather than sharing one rule. hottext, match and order
        // mark the control with a class or move it into the line; cloze and shorttext carry no
        // selected class at all -- .mv-blank is a <select> and .mv-input is a text box, so their
        // state IS the control's value. A single .sel check would silently pass those two on nothing.
        const live = t === 'hottext' ? q('.mv-span.sel').length > 0
          : t === 'match' ? q('.mv-cell.sel').length > 0
            : t === 'cloze' ? q('.mv-blank').length > 0 && q('.mv-blank').every((s) => s.value !== '')
              : t === 'order' ? q('.mv-line .mv-tile').length > 0
                : typed.length > 0;
        let g = null, gerr = null;
        try { g = window.MVItems.grade(p.item, st.picked); } catch (e) { gerr = String(e && e.message); }
        return {
          resp: st.picked === undefined ? null : st.picked,
          complete: window.MVItems.isComplete(p.item, st.picked),
          progress: p.progress, signal, live,
          correct: g ? !!g.correct : null, partial: g ? g.partial : null, gerr,
        };
      }, type);

      // Both drives are derived from the item's OWN authored key, so the gate follows the pack
      // rather than a hardcoded answer. The wrong drive is a real alternative answer clicked through
      // the same controls, never a response synthesized in JS.
      const plan = (type) => page.evaluate((t) => {
        const it = window.__probe.item;
        if (t === 'hottext') {
          const off = it.spans.map((_, i) => i).filter((i) => !it.key.includes(i));
          return { right: it.key.slice(), wrong: off.length ? off : it.key.slice(0, -1) };
        }
        if (t === 'cloze') {
          const right = it.blanks.map((b) => b.key);
          const wrong = right.slice();
          wrong[0] = (right[0] + 1) % it.blanks[0].choices.length;
          return { right, wrong };
        }
        if (t === 'match') {
          const right = it.key.map((c) => [Number(c[0]), Number(c[1])]);
          const wrong = right.map((c, i) => (i === 0 ? [c[0], (c[1] + 1) % it.colLabels.length] : c));
          return { right, wrong };
        }
        if (t === 'order') {
          const right = it.key.slice();
          const wrong = right.slice();
          wrong[0] = right[1]; wrong[1] = right[0];
          return { right, wrong };
        }
        // shorttext. The wrong drive has to fail on CONTENT, not on the word-count branch, or it
        // would pass while proving nothing about the accept list, so both conditions are asserted
        // and reported rather than assumed.
        const wrong = 'nobody';
        const norm = window.MVItems.normalizeText;
        return {
          right: it.accept[0], wrong,
          wrongIsReallyWrong: !it.accept.some((a) => norm(a) === norm(wrong))
            && wrong.trim().split(/\s+/).length <= it.maxWords,
        };
      }, type);

      const T = { timeout: 8000 };
      const drive = async (type, resp) => {
        if (type === 'hottext') {
          for (const i of resp) await page.click(`#mv-probe .mv-span[data-idx="${i}"]`, T);
        } else if (type === 'cloze') {
          for (let bi = 0; bi < resp.length; bi++) {
            // DOM order is not blank order: a select sits wherever {{n}} falls in the stem, which an
            // author is free to write out of sequence. Ask the engine which select is which.
            const nth = await page.evaluate((b) => {
              const st = document.querySelector('#mv-probe .mv-probe-host')._mvState;
              return [...document.querySelectorAll('#mv-probe .mv-blank')].indexOf(st.selects[b]);
            }, bi);
            await page.selectOption(`#mv-probe .mv-blank >> nth=${nth}`, String(resp[bi]), T);
          }
        } else if (type === 'match') {
          for (const [r, c] of resp) await page.click(`#mv-probe .mv-cell[data-r="${r}"][data-c="${c}"]`, T);
        } else if (type === 'order') {
          // Bank tiles carry no data-idx -- only placed tiles do -- and repaint() rebuilds both rows
          // after every tap, so the bank position is recomputed per placement rather than
          // snapshotted. A snapshot would go stale on the first click.
          for (const tile of resp) {
            const nth = await page.evaluate((want) => {
              const st = document.querySelector('#mv-probe .mv-probe-host')._mvState;
              let pos = 0;
              for (let i = 0; i < want; i++) if (!st.picked.includes(i)) pos++;
              return pos;
            }, tile);
            await page.click(`#mv-probe .mv-bank .mv-tile >> nth=${nth}`, T);
          }
        } else {
          await page.fill('#mv-probe .mv-input', resp, T);
        }
      };

      for (const type of ['hottext', 'cloze', 'match', 'order', 'shorttext']) {
        const m = await mount(type);
        if (m.err) { problems.push(`types ${type}: ${m.err}`); continue; }

        // (1) the control rendered at all, counted against the item's own declared shape.
        if (m.controls !== m.want) {
          problems.push(`types ${type}: rendered ${m.controls} ${m.sel}, item ${m.id} declares ${m.want}`);
        }

        // The vacuity control, run on all five rather than the one type it was asked for, because it
        // costs nothing: a gate that only ever reads the END state cannot tell "the interaction
        // worked" from "it was already answered before anything was clicked".
        const emptyBefore = m.resp == null
          || (Array.isArray(m.resp) ? m.resp.every((v) => v == null) : m.resp === '');
        if (!emptyBefore) problems.push(`types ${type}: response was ${JSON.stringify(m.resp)} BEFORE any interaction`);
        if (m.complete) problems.push(`types ${type}: isComplete was already true before any interaction, so the grade below proves nothing`);

        const p = await plan(type);
        if (type === 'shorttext' && !p.wrongIsReallyWrong) {
          problems.push(`types shorttext: the wrong drive "${p.wrong}" is accepted by item ${m.id} or exceeds its maxWords; pick another`);
        }

        // (2) interacting registers, and (3a) the authored key grades correct.
        await drive(type, p.right);
        const ok = await read(type);
        if (ok.gerr) problems.push(`types ${type}: grade threw -- ${ok.gerr}`);
        if (JSON.stringify(ok.resp) === JSON.stringify(m.resp)) {
          problems.push(`types ${type}: response did not change after interaction (still ${JSON.stringify(ok.resp)})`);
        }
        if (!ok.live) problems.push(`types ${type}: control shows no sign of the interaction (${ok.signal})`);
        if (!ok.progress) problems.push(`types ${type}: engine never called onProgress, so the Check button would stay dead`);
        if (!ok.complete) problems.push(`types ${type}: response incomplete after driving the authored key (${JSON.stringify(ok.resp)})`);
        if (ok.correct !== true) problems.push(`types ${type}: item ${m.id} graded correct=${ok.correct} on its OWN key (${JSON.stringify(ok.resp)})`);

        // (3b) a wrong response does not. Re-mounted first, and the remount is itself checked for
        // emptiness: if it were not clean, the wrong drive would land on top of the correct one and
        // this half of the assertion would be measuring the wrong thing.
        const m2 = await mount(type);
        if (m2.complete || m2.controls !== m.want) {
          problems.push(`types ${type}: remount for the wrong drive was not clean (${m2.controls} ${m.sel}, complete=${m2.complete})`);
        }
        await drive(type, p.wrong);
        const bad = await read(type);
        if (bad.correct !== false) {
          problems.push(`types ${type}: a deliberately wrong response graded correct=${bad.correct} (${JSON.stringify(bad.resp)})`);
        }

        note(`type ${type}: ${m.controls}x ${m.sel} (want ${m.want}) | before ${JSON.stringify(m.resp)} incomplete `
          + `| key ${JSON.stringify(ok.resp)} [${ok.signal}] -> correct=${ok.correct} `
          + `| wrong ${JSON.stringify(bad.resp)} -> correct=${bad.correct} partial=${bad.partial}`);
      }
    } catch (e) {
      problems.push('type gate failed: ' + (e && e.message));
    } finally {
      await page.evaluate(() => {
        const o = document.querySelector('#mv-probe');
        if (o) o.remove();
        delete window.__probe;
      }).catch(() => {});
    }
    // The gate must leave the page as it found it, so this is asserted rather than assumed.
    const leftover = await page.evaluate(() => document.querySelectorAll('#mv-probe, .mv-probe-host').length).catch(() => -1);
    if (leftover !== 0) problems.push(`types: probe not cleaned up (${leftover} node(s) left on the page)`);
    const typeErr = errors.slice(typesBefore);
    if (typeErr.length) problems.push(`types: ${typeErr.length} JS error(s): ${typeErr[0]}`);
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
