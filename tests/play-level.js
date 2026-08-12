#!/usr/bin/env node
// play-level.js -- drives a pack level to its END through the real app, then asserts the
// completion-screen reward card.  This exists because the reward card was the one shipped
// surface of the visual-engagement program that had never been driven end to end:  finishing a
// level means operating EVERY item type the level serves, and the ad-hoc drivers each phase
// hand-rolled could not operate `match` or `order`, so they stalled mid-level and the reward
// card's claims rested on a unit gate plus byte-identity rather than on a playthrough.
//
//   node tests/play-level.js [--base <url>] [--pack <id>] [--level <n>] [--wrong <n>] [--json]
//
// With no --base it serves the repo itself on an ephemeral port, so it runs offline and in CI.
// With --base it drives a remote origin (the deploy) instead.
//
// TWO deliberate design rules, both of them lessons this repo paid for:
//
//   1. The answer key comes from the pack the APP fetched, never from the local working tree.
//      Driving a deployed origin while answering from the checkout would silently produce a
//      nonsense run the moment the two differ, which is exactly the class of "green on the
//      wrong artifact" this project has been bitten by before.
//
//   2. The origin is proven with a NEGATIVE control before anything is driven.  A nonexistent
//      path must NOT return 200.  A positive-only reachability check once called a stray
//      process green when it answered 200 with a 73-byte PNG for every path, including paths
//      that cannot exist, while the real server had never bound.  MVPack.loadPack uses fetch,
//      Chromium blocks it on file://, and that failure is SILENT (the level grid paints "Could
//      not load"), so a driver that skips this reports a stall it caused itself.
//
// GPU note (this machine): always launches with --disable-gpu to avoid the Intel TDR display freeze.
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) {
    console.error('play-level: neither "playwright" nor "playwright-core" is installed.\n  npm i -D playwright');
    process.exit(2);
  }
}

const ROOT = path.resolve(__dirname, '..');
const VIEWPORT = { width: 1024, height: 768 };   // the iPad 6 CSS viewport this project targets
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const out = { base: null, pack: 'firsthand-g6', level: 0, wrong: 0, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || '').replace(/\/+$/, '');
    else if (a === '--pack') out.pack = String(argv[++i] || '');
    else if (a === '--level') out.level = Number(argv[++i]);
    else if (a === '--wrong') out.wrong = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') { usage(0); }
    else { console.error('play-level: unknown argument ' + a); usage(2); }
  }
  if (!Number.isInteger(out.level) || out.level < 0) { console.error('play-level: --level must be a non-negative integer'); usage(2); }
  if (!Number.isInteger(out.wrong) || out.wrong < 0) { console.error('play-level: --wrong must be a non-negative integer'); usage(2); }
  return out;
}

function usage(code) {
  console.error('usage: node tests/play-level.js [--base <url>] [--pack <id>] [--level <n>] [--wrong <n>] [--json]');
  process.exit(code);
}

// ---------------------------------------------------------------- local server

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(String(req.url).split('?')[0]);
      const p = path.join(ROOT, rel);
      // Refuse to serve outside the repo root, so a traversal in a hand-typed path cannot read
      // the rest of the disk -- this process is short-lived but it does bind a real socket.
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

// ---------------------------------------------------------------- http probe

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      // Follow one redirect: the deploy's own root does this, and a probe that treats a 301 as a
      // failure would refuse a perfectly good origin.
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return resolve(fetchUrl(next));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        type: String(res.headers['content-type'] || ''),
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout after 30s: ' + url)); });
  });
}

// The negative control this file's header argues for.  Both halves must hold:  a path that cannot
// exist must not answer 200, AND the app itself must answer 200 as html.  Either half alone has
// been fooled before.
async function proveOrigin(base) {
  const ghost = base + '/__this-path-cannot-exist-' + process.pid + '.html';
  const g = await fetchUrl(ghost);
  if (g.status === 200) {
    throw new Error(`origin ${base} answered 200 for a path that cannot exist (${g.body.length} bytes). ` +
      'That is a stray or catch-all server, not this app.  Refusing to drive it.');
  }
  const app = await fetchUrl(base + '/Math-Multiverse.html');
  if (app.status !== 200) throw new Error(`origin ${base} answered ${app.status} for Math-Multiverse.html`);
  if (!/text\/html/i.test(app.type)) throw new Error(`origin ${base} served Math-Multiverse.html as "${app.type}", not text/html`);
  return { ghostStatus: g.status, appBytes: app.body.length };
}

// ---------------------------------------------------------------- item identification

// Read enough of the rendered item to identify WHICH pack item it is.  Deliberately reads only
// what the child can see:  no engine internals, no closure peeking.  If this cannot tell two
// items apart the run fails loudly rather than answering the wrong key.
const READ_ITEM = () => {
  const box = document.querySelector('.mv-item');
  if (!box) return null;
  const txt = (el) => (el ? el.textContent.trim().replace(/\s+/g, ' ') : '');
  const all = (sel) => [...box.querySelectorAll(sel)].map((e) => txt(e));

  if (box.querySelector('.mv-part.mv-part-a')) {
    return { type: 'ebsr', stem: txt(box.querySelector('.mv-part-a .mv-stem')) };
  }
  if (box.querySelector('.mv-cloze')) {
    return { type: 'cloze', stem: '', blanks: [...box.querySelectorAll('select.mv-blank')]
      .map((s) => [...s.options].slice(1).map((o) => o.textContent.trim())) };
  }
  if (box.querySelector('table.mv-table')) {
    return { type: 'match', stem: txt(box.querySelector('.mv-stem')),
      rows: all('th.mv-th-row'), cols: [...box.querySelectorAll('tr')][0]
        ? [...[...box.querySelectorAll('tr')][0].querySelectorAll('th')].slice(1).map((e) => txt(e)) : [] };
  }
  if (box.querySelector('.mv-hottext')) {
    return { type: 'hottext', stem: txt(box.querySelector('.mv-stem')), spans: all('.mv-hottext .mv-span') };
  }
  if (box.querySelector('.mv-bank')) {
    return { type: 'order', stem: txt(box.querySelector('.mv-stem')),
      tiles: all('.mv-bank .mv-tile').concat([...box.querySelectorAll('.mv-line .mv-tile')].map((e) => txt(e.querySelector('.mv-tile-text')))) };
  }
  if (box.querySelector('.mv-input')) {
    return { type: 'shorttext', stem: txt(box.querySelector('.mv-stem')) };
  }
  if (box.querySelector('.mv-choice')) {
    // .mv-hint is emitted by ms only ("Choose N."), which is the sole rendered difference
    // between the two single-list choice types.
    return { type: box.querySelector('.mv-hint') ? 'ms' : 'mc',
      stem: txt(box.querySelector('.mv-stem')), choices: all('.mv-choices .mv-choice .mv-choice-text') };
  }
  return { type: 'unknown', html: box.innerHTML.slice(0, 400) };
};

const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

// Match the rendered item back to the pack item that produced it.  Matching on the STEM alone is
// not enough for cloze (which renders no .mv-stem at all), so each type contributes whatever it
// actually shows.  A non-unique match is a hard failure:  answering the wrong item's key would
// produce a run that looks like a playthrough and is not one.
function identify(dom, items) {
  if (!dom || dom.type === 'unknown') throw new Error('play-level: unrecognised item DOM: ' + JSON.stringify(dom));
  const pool = items.filter((i) => i.type === dom.type);
  let hits;
  if (dom.type === 'ebsr') {
    hits = pool.filter((i) => norm(i.partA && i.partA.stem) === dom.stem);
  } else if (dom.type === 'cloze') {
    const sig = JSON.stringify(dom.blanks);
    hits = pool.filter((i) => JSON.stringify((i.blanks || []).map((b) => b.choices.map(norm))) === sig);
  } else if (dom.type === 'match') {
    hits = pool.filter((i) => norm(i.stem) === dom.stem
      && JSON.stringify((i.rowLabels || []).map(norm)) === JSON.stringify(dom.rows)
      && JSON.stringify((i.colLabels || []).map(norm)) === JSON.stringify(dom.cols));
  } else if (dom.type === 'order') {
    hits = pool.filter((i) => norm(i.stem) === dom.stem
      && JSON.stringify([...(i.tiles || [])].map(norm).sort()) === JSON.stringify([...dom.tiles].sort()));
  } else if (dom.type === 'hottext') {
    hits = pool.filter((i) => norm(i.stem) === dom.stem
      && JSON.stringify((i.spans || []).map(norm)) === JSON.stringify(dom.spans));
  } else if (dom.type === 'mc' || dom.type === 'ms') {
    hits = pool.filter((i) => norm(i.stem) === dom.stem
      && JSON.stringify((i.choices || []).map(norm)) === JSON.stringify(dom.choices));
  } else {
    hits = pool.filter((i) => norm(i.stem) === dom.stem);
  }
  if (hits.length !== 1) {
    throw new Error(`play-level: ${hits.length} pack items match the rendered ${dom.type} ` +
      `("${(dom.stem || JSON.stringify(dom.blanks) || '').slice(0, 60)}...").  Refusing to guess.`);
  }
  return hits[0];
}

// ---------------------------------------------------------------- answering

// Every branch drives the SAME affordances a child has:  real clicks on the real controls, and
// for cloze a real <select> change.  Nothing here calls into the engine.
async function answer(page, item, wantWrong) {
  const box = page.locator('.mv-item');
  const clickChoice = async (scope, idx) => { await scope.locator(`.mv-choice[data-idx="${idx}"]`).click(); };
  const check = async () => {
    const btn = page.locator('.mv-footer .mv-check');
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    if (await btn.isDisabled()) throw new Error(`play-level: Check stayed disabled on ${item.id} -- the response the driver built is not complete`);
    await btn.click();
  };
  const other = (n, len) => (len > 1 ? (n + 1) % len : n);

  switch (item.type) {
    case 'mc': {
      const idx = wantWrong ? other(item.key, item.choices.length) : item.key;
      await clickChoice(box, idx);           // single-select auto-submits, no Check
      return;
    }
    case 'ms': {
      let pick;
      if (!wantWrong) pick = item.key.slice();
      else {
        const outside = item.choices.map((_, i) => i).filter((i) => !item.key.includes(i));
        // A strict subset is still "wrong" and is always available, since a key of every choice
        // with no outside option still has length >= 2 in this pack family.
        pick = outside.length ? [outside[0]] : item.key.slice(0, Math.max(1, item.key.length - 1));
      }
      for (const i of pick) await clickChoice(box, i);
      await check();
      return;
    }
    case 'ebsr': {
      const aKey = item.partA.key;
      const a = wantWrong ? other(aKey, item.partA.choices.length) : aKey;
      await clickChoice(box.locator('.mv-part-a'), a);
      // Part B only exists once A commits, and its key is a MAP from the chosen A, never a
      // scalar -- reading it any other way is the classic homemade-EBSR bug.
      const bBox = box.locator('.mv-part-b');
      await bBox.waitFor({ state: 'visible', timeout: 15000 });
      const expectedB = item.partB.key[String(a)];
      const b = Number.isInteger(expectedB) ? expectedB : 0;
      await clickChoice(bBox, b);
      await check();
      return;
    }
    case 'hottext': {
      let pick;
      if (!wantWrong) pick = item.key.slice();
      else {
        const outside = item.spans.map((_, i) => i).filter((i) => !item.key.includes(i));
        pick = outside.length ? [outside[0]] : item.key.slice(0, Math.max(1, item.key.length - 1));
      }
      for (const i of pick) await box.locator(`.mv-hottext .mv-span[data-idx="${i}"]`).click();
      await check();
      return;
    }
    case 'match': {
      // NOT a tap-source-then-tap-target interaction, which is what an earlier driver assumed
      // and is why it stalled here:  the item renders a rowLabels x colLabels TABLE and one tap
      // on a cell sets that row's answer (the handler clears the row first, so a row can never
      // hold two).  One tap per row, and every row must be set or Check stays disabled.
      for (const cell of item.key) {
        const r = Number(cell[0]);
        const c = wantWrong ? other(Number(cell[1]), item.colLabels.length) : Number(cell[1]);
        await box.locator(`td.mv-cell[data-r="${r}"][data-c="${c}"]`).click();
      }
      await check();
      return;
    }
    case 'order': {
      // Tap-to-append:  tapping a BANK tile appends it to the line.  Bank tiles carry no
      // data-idx (only placed ones do), so the tile is addressed by its own text, which is what
      // a child reads too.  Drag is deliberately unimplemented in the engine.
      const seq = wantWrong ? [...item.key].reverse() : item.key.slice();
      if (wantWrong && seq.every((v, i) => v === item.key[i])) {
        throw new Error(`play-level: cannot build a wrong ordering for ${item.id} (key is palindromic)`);
      }
      for (const idx of seq) {
        const text = norm(item.tiles[idx]);
        // Exact text, not Playwright's substring hasText:  one tile's label can be a substring
        // of another's, and picking the wrong tile would still complete the item and grade as a
        // plain wrong answer, silently turning a positive run into a negative one.
        const pos = await page.evaluate((t) => {
          const bank = document.querySelector('.mv-bank');
          if (!bank) return -1;
          return [...bank.querySelectorAll('.mv-tile')]
            .findIndex((b) => b.textContent.trim().replace(/\s+/g, ' ') === t);
        }, text);
        if (pos < 0) throw new Error(`play-level: no bank tile reads exactly "${text}" on ${item.id}`);
        await box.locator('.mv-bank .mv-tile').nth(pos).click();
      }
      await check();
      return;
    }
    case 'cloze': {
      const selects = box.locator('select.mv-blank');
      for (let i = 0; i < item.blanks.length; i++) {
        const key = item.blanks[i].key;
        const v = (wantWrong && i === 0) ? other(key, item.blanks[i].choices.length) : key;
        await selects.nth(i).selectOption(String(v));
      }
      await check();
      return;
    }
    case 'shorttext': {
      const text = wantWrong ? 'zzz' : String((item.accept || [])[0] || '');
      if (!text) throw new Error(`play-level: ${item.id} has no accepted answer to type`);
      await box.locator('.mv-input').fill(text);
      await check();
      return;
    }
    default:
      throw new Error('play-level: no driver for item type ' + item.type);
  }
}

// ---------------------------------------------------------------- reward-card assertions

// Read the completion screen's reward card as PAINTED, not as authored.  "A picture" means the
// image actually decoded (naturalWidth), never merely that an <img> tag is in the DOM:  a broken
// src is still an <img>.
const READ_CARD = () => {
  const host = document.getElementById('lc-reveal');
  const card = host && host.querySelector('.mv-rv-card');
  if (!card) return { present: false, hostPresent: !!host };
  const frame = card.children[0];
  const grid = frame && frame.children[1];
  const img = card.querySelector('img.mv-rv-img');
  const cap = card.querySelector('.mv-rv-cap');
  const cred = card.querySelector('.mv-lb-credit');
  const zoom = card.querySelector('.mv-rv-zoom');
  const box = img ? img.getBoundingClientRect() : null;
  const tiles = grid ? [...grid.children] : [];
  return {
    present: true,
    frameClass: frame ? frame.className : null,
    gridIsChild1: !!(grid && grid.classList.contains('mv-rv-grid')),
    gridClass: grid ? grid.className : null,
    tileCount: tiles.length,
    tileAllSpans: tiles.every((t) => t.tagName === 'SPAN' && t.classList.contains('mv-rv-tile')),
    tilesAway: tiles.filter((t) => t.classList.contains('away')).length,
    imgPresent: !!img,
    imgSrc: img ? img.getAttribute('src') : null,
    imgComplete: img ? img.complete : false,
    imgNaturalWidth: img ? img.naturalWidth : 0,
    imgAlt: img ? img.getAttribute('alt') : null,
    imgPaintedW: box ? Math.round(box.width) : 0,
    imgPaintedH: box ? Math.round(box.height) : 0,
    imgParentTag: img && img.parentElement ? img.parentElement.tagName : null,
    imgParentClass: img && img.parentElement ? img.parentElement.className : null,
    captionText: cap ? cap.textContent.trim() : null,
    creditText: cred ? cred.textContent.trim() : null,
    zoomPresent: !!zoom,
    zoomAriaHidden: zoom ? zoom.getAttribute('aria-hidden') : null,
  };
};

// ---------------------------------------------------------------- main

(async () => {
  const args = parseArgs(process.argv.slice(2));
  let server = null;
  let base = args.base;
  if (!base) {
    const s = await startServer();
    server = s.server;
    base = `http://127.0.0.1:${s.port}`;
  }

  const problems = [];
  const note = (s) => { if (!args.json) console.log(s); };
  let browser = null;
  let exitCode = 0;

  try {
    const origin = await proveOrigin(base);
    note(`origin: ${base}`);
    note(`  ghost path -> ${origin.ghostStatus} (must not be 200);  Math-Multiverse.html -> 200 text/html, ${origin.appBytes} bytes`);

    // The key comes from the bytes the app itself will fetch.  See rule 1 in the header.
    const packRes = await fetchUrl(`${base}/packs/${args.pack}.json`);
    if (packRes.status !== 200) throw new Error(`origin served ${packRes.status} for packs/${args.pack}.json`);
    const pack = JSON.parse(packRes.body.toString('utf8'));
    const level = pack.levels[args.level];
    if (!level) throw new Error(`pack ${args.pack} has no level index ${args.level}`);
    note(`pack: ${pack.meta.id} (${packRes.body.length} bytes served)  level ${args.level + 1} "${level.name}"  ${level.questions} Q  reveal=${level.reveal ? level.reveal.figureId : 'none'}`);

    const launchOpts = { headless: true, args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] };
    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    browser = await chromium.launch(launchOpts);
    // A fresh context every run:  the freshness ledger and PackSave both live in localStorage,
    // and a level already cleared changes which items are served.
    const page = await browser.newPage({ viewport: VIEWPORT });
    const jsErrors = [];
    page.on('pageerror', (e) => jsErrors.push(String(e.message)));

    await page.goto(`${base}/Math-Multiverse.html`, { waitUntil: 'networkidle' });

    // Grade 6 first:  every pack in the shelves is grade 6, and the grade-5 launcher shows no
    // pack shelf at all.
    await page.locator('#btn-grade-6').click();
    const title = (pack.meta && pack.meta.title) || args.pack;
    const card = page.locator('.module-card', { hasText: title }).first();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    const cardClass = await card.getAttribute('class');
    if (/\blocked\b/.test(cardClass)) throw new Error(`the "${title}" card is locked on a fresh profile (class "${cardClass}")`);
    await card.click();

    const levelCard = page.locator('#level-grid .level-card').nth(args.level);
    await levelCard.waitFor({ state: 'visible', timeout: 15000 });
    const lvClass = await levelCard.getAttribute('class');
    if (/\blocked\b/.test(lvClass)) throw new Error(`level ${args.level + 1} is locked on a fresh profile (class "${lvClass}")`);
    await levelCard.click();

    await page.locator('.mv-shell').waitFor({ state: 'visible', timeout: 15000 });

    // ---- play ----
    const served = [];
    const total = level.questions;
    for (let q = 0; q < total; q++) {
      await page.locator('.mv-item').waitFor({ state: 'visible', timeout: 15000 });
      const prog = (await page.locator('.mv-prog').textContent()).trim();
      const dom = await page.evaluate(READ_ITEM);
      const item = identify(dom, pack.items);
      const wantWrong = q < args.wrong;
      served.push({ q: q + 1, prog, id: item.id, type: item.type, wrong: wantWrong });
      note(`  ${String(q + 1).padStart(2)}/${total}  ${prog.padEnd(7)} ${item.type.padEnd(9)} ${item.id}${wantWrong ? '   <- answered WRONG on purpose' : ''}`);
      await answer(page, item, wantWrong);

      // Correct answers flash and auto-advance;  wrong ones show the explanation and REQUIRE a
      // NEXT tap (26-0714).  Waiting for either and then acting is what keeps this honest for
      // both branches rather than assuming one.
      const flash = page.locator('.mv-footer .mv-flash.ok');
      const next = page.locator('.mv-footer .mv-next');
      await Promise.race([
        flash.waitFor({ state: 'visible', timeout: 15000 }),
        next.waitFor({ state: 'visible', timeout: 15000 }),
      ]);
      const wasWrong = await next.isVisible();
      if (wasWrong !== wantWrong) {
        problems.push(`q${q + 1} ${item.id}: driver intended ${wantWrong ? 'WRONG' : 'CORRECT'} but the engine graded it ${wasWrong ? 'wrong' : 'correct'}`);
      }
      if (wasWrong) await next.click();
      if (q < total - 1) {
        // The next question is a genuinely CHANGED artifact, not merely a present one:  waiting
        // on ".mv-item exists" would return instantly against the item still on screen.  That
        // exact mistake produced a false "world cards missing" report in a prior audit.
        await page.waitForFunction(
          (want) => { const p = document.querySelector('.mv-prog'); return p && p.textContent.trim().startsWith(want + ' /'); },
          String(q + 2), { timeout: 20000 });
      }
    }

    // ---- completion ----
    await page.locator('.level-complete').waitFor({ state: 'visible', timeout: 20000 });
    // The last tile's lift timer fires at 120 + 11*90 = 1110ms;  sample after it.
    await page.waitForTimeout(1600);

    const wrongCount = args.wrong;
    const ratio = (total - wrongCount) / total;
    const expectTiles = ratio >= 1 ? 12 : Math.max(1, Math.round(ratio * 12));
    const expectFull = ratio >= 1;
    const figure = (pack.figures || []).find((f) => f.id === (level.reveal && level.reveal.figureId));

    const c = await page.evaluate(READ_CARD);
    const heading = (await page.locator('.level-complete').textContent()).replace(/\s+/g, ' ').trim().slice(0, 80);

    if (!args.json) {
      console.log('');
      console.log(`completion screen: "${heading}"`);
      console.log(`reward card: present=${c.present}`);
      if (c.present) {
        console.log(`  frame.children[1] is .mv-rv-grid : ${c.gridIsChild1}   ("${c.gridClass}")`);
        console.log(`  tiles                            : ${c.tileCount} (all span.mv-rv-tile: ${c.tileAllSpans})`);
        console.log(`  tiles lifted (.away)             : ${c.tilesAway} of ${c.tileCount}   expected ${expectTiles} at foundRatio ${(ratio).toFixed(3)}`);
        console.log(`  picture                          : decoded=${c.imgComplete && c.imgNaturalWidth > 0} natural=${c.imgNaturalWidth}px painted=${c.imgPaintedW}x${c.imgPaintedH}  src=${c.imgSrc}`);
        console.log(`  caption                          : "${c.captionText}"`);
        console.log(`  credit                           : "${c.creditText}"`);
        console.log(`  magnifier (.mv-rv-zoom)          : ${c.zoomPresent}   expected ${expectFull}   (fully revealed: ${expectFull})`);
        console.log(`  image wrapped in enlarge button  : ${c.imgParentClass === 'mv-rv-img-btn'}   expected ${expectFull}`);
      }
      console.log('');
    }

    // ---- assertions ----
    // A run that earns NOTHING must produce no artifact at all:  renderRevealCard returns false
    // at foundRatio 0 and showPackLevelComplete does not even emit the #lc-reveal host, because
    // handing out a reward for a level nobody answered would make the reveal meaningless.  This
    // is a third expected state, not a failure, so --wrong <every question> asserts the absence.
    if (ratio <= 0) {
      if (c.present) problems.push('a reward card rendered on a run that earned zero cells');
      if (c.hostPresent) problems.push('#lc-reveal host was emitted on a run that earned zero cells');
      if (!args.json) console.log(`reward card correctly ABSENT at foundRatio 0 (host emitted: ${c.hostPresent})`);
    } else if (!c.present) problems.push(`no .mv-rv-card on the completion screen (#lc-reveal host present: ${c.hostPresent})`);
    else {
      if (!c.gridIsChild1) problems.push(`the tile grid is not frame.children[1] (found "${c.gridClass}")`);
      if (c.tileCount !== 12) problems.push(`tile grid holds ${c.tileCount} tiles, expected 12`);
      if (!c.tileAllSpans) problems.push('not every tile is a span.mv-rv-tile');
      if (c.tilesAway !== expectTiles) problems.push(`${c.tilesAway} tiles lifted, expected ${expectTiles} at foundRatio ${ratio.toFixed(3)}`);
      if (!c.imgPresent) problems.push('no img.mv-rv-img on the card');
      if (!(c.imgComplete && c.imgNaturalWidth > 0)) problems.push(`the reward image did not decode (complete=${c.imgComplete} naturalWidth=${c.imgNaturalWidth} src=${c.imgSrc})`);
      if (!(c.imgPaintedW > 0 && c.imgPaintedH > 0)) problems.push(`the reward image paints ${c.imgPaintedW}x${c.imgPaintedH}`);
      if (!c.captionText) problems.push('the card carries no caption');
      else if (figure && norm(figure.caption) !== norm(c.captionText)) problems.push(`caption is "${c.captionText}", the served pack says "${figure.caption}"`);
      // The magnifier is the whole point of the enlarge ruling:  it must appear ONLY once every
      // tile has lifted, so a partial card cannot let a child skip past the reveal it has not
      // earned.  Asserted in BOTH directions, which is why this file supports --wrong at all.
      if (c.zoomPresent !== expectFull) problems.push(`magnifier present=${c.zoomPresent}, expected ${expectFull} on a ${expectFull ? 'fully' : 'partially'} revealed card`);
      if ((c.imgParentClass === 'mv-rv-img-btn') !== expectFull) problems.push(`enlarge button wrapping=${c.imgParentClass}, expected ${expectFull ? 'mv-rv-img-btn' : 'a bare frame'}`);
      if (c.zoomPresent && c.zoomAriaHidden !== 'true') problems.push(`magnifier is not aria-hidden (got "${c.zoomAriaHidden}")`);
    }
    if (jsErrors.length) problems.push(`${jsErrors.length} page error(s): ${jsErrors.slice(0, 3).join(' | ')}`);

    if (args.json) console.log(JSON.stringify({ base, pack: args.pack, level: args.level, wrong: args.wrong, served, card: c, expectTiles, expectFull, problems, jsErrors }, null, 2));

    const typesPlayed = [...new Set(served.map((s) => s.type))].sort();
    console.log(`=== play-level: ${args.pack} L${args.level + 1} played ${served.length}/${total} to the end;  types operated: ${typesPlayed.join(', ')} ===`);
    console.log(problems.length
      ? `=== play-level: ${problems.length} problem(s) ===\n  ${problems.join('\n  ')}`
      : '=== play-level: reward card CLEAN ===');
    exitCode = problems.length ? 1 : 0;
  } catch (e) {
    console.error('play-level: ' + (e && e.message ? e.message : String(e)));
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }
  process.exit(exitCode);
})();
