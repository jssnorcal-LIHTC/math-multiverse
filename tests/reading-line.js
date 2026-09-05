'use strict';
// reading-line.js -- the WP-R gate: tap a line of the passage and it stays lit.
//
//   node tests/reading-line.js
//
// Measured in a real headless browser against a real pack level, because every claim here is
// geometric: which glyphs a tap lands on, which of them share a rendered line, and whether the
// band still covers the same words after a resize. None of that survives a re-implementation.
//
// HARD RULES (constraint 12). Both directions, on every claim:
//   POSITIVE  a tap lights the line under it, covering the tapped word and nothing on the lines
//             above or below.
//   NEGATIVE  a tap on the figure strip lights nothing; a tap on the lit line puts it out; a new
//             passage clears it; and a control proves the "same line" test can tell two different
//             lines apart at all.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) { console.error('reading-line: playwright is not installed.'); process.exit(2); }
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
  const launchOpts = {
    headless: true,
    // Constraint 9: motion preference is forced by flag, never by newContext({ reducedMotion }).
    args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--force-prefers-no-reduced-motion'],
  };
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
      () => typeof SHELVES !== 'undefined' && SHELVES.some((s) => s.subject === 'ela'), { timeout: 15000 });

    // Open a real pack level that carries a passage.
    await page.evaluate(() => { localStorage.clear(); Save.load(); Save.state.previewMode = true; });
    await page.evaluate(async () => { await openPack('ela-g6-spy'); playLevel(0); });
    await page.waitForSelector('.mv-passage .mv-para', { timeout: 20000 });
    await page.waitForTimeout(400);

    // ---- ARMING ----
    const armed = await page.evaluate(() => {
      const box = document.querySelector('.mv-passage');
      const paras = box ? box.querySelectorAll('.mv-para') : [];
      const cs = box ? getComputedStyle(box) : null;
      return {
        hasBox: !!box,
        paras: paras.length,
        chars: box ? (box.textContent || '').length : 0,
        positioned: cs ? cs.position : null,
        overlays: box ? box.querySelectorAll('.mv-readline').length : -1,
      };
    });
    check('ARMING: a real passage with real paragraphs is on screen',
      armed.hasBox && armed.paras >= 2 && armed.chars > 400, JSON.stringify(armed));
    check('ARMING: the passage box is the positioning context the overlay needs',
      armed.positioned === 'relative', `position: ${armed.positioned}`);
    check('nothing is lit before he taps anything', armed.overlays === 0, `${armed.overlays} overlay(s)`);
    const blockOrder = await page.evaluate(() => {
      const box = document.querySelector('.mv-passage');
      const blocks = MVRunner.readingLine.blocks(box);
      return {
        n: blocks.length,
        firstIsTitle: blocks[0] && blocks[0].classList.contains('mv-passage-title'),
        paras: box.querySelectorAll('.mv-para').length,
      };
    });
    check('the tracker enumerates the TITLE plus the paragraphs, in document order',
      blockOrder.firstIsTitle && blockOrder.n === blockOrder.paras + 1, JSON.stringify(blockOrder));
    if (!armed.hasBox) throw new Error('arming failed: no passage rendered');

    // A word roughly in the middle of the second visual line of the first long paragraph, chosen
    // from real geometry rather than guessed: walk the characters, group them by rendered top, and
    // pick a point inside a line that has at least one line above and one below it.
    const target = await page.evaluate(() => {
      const box = document.querySelector('.mv-passage');
      // EVERY long paragraph is a candidate, and the box is SCROLLED to it first, the way a reader
      // reaches a paragraph before tapping a line in it. Taking only the first paragraph over 220
      // chars and measuring it wherever it happened to sit was the older shape, and it fails two
      // ways once the passage box is short: the paragraph's second line can be below the fold, and
      // the paragraph itself can start below the fold so that NO three of its lines are visible.
      const paras = [...box.querySelectorAll('.mv-para')].filter((p) => p.textContent.length > 220);
      if (!paras.length) return null;
      const measure = (para) => {
        const t = para.firstChild;
        const lines = [];
        for (let i = 0; i < t.nodeValue.length; i++) {
          const r = document.createRange();
          r.setStart(t, i); r.setEnd(t, i + 1);
          const rect = r.getClientRects()[0];
          if (!rect || !rect.width) continue;
          const last = lines[lines.length - 1];
          if (!last || Math.abs(last.top - rect.top) > rect.height * 0.5) lines.push({ top: rect.top, height: rect.height, from: i, to: i, left: rect.left, right: rect.right });
          else { last.to = i; last.right = rect.right; }
        }
        return lines;
      };
      let para = null, lines = null;
      const tried = [];
      for (const p of paras) {
        // Scroll the paragraph to the top of the box, then re-measure: setting scrollTop reflects
        // in getClientRects synchronously, so the numbers below are post-scroll geometry.
        //
        // Measured from the two rects rather than from offsetTop. The box is position:relative, so
        // it IS the offsetParent of every .mv-para, which means p.offsetTop is ALREADY relative to
        // the box and subtracting box.offsetTop over-scrolls by the box's own offset in its parent.
        // That left exactly one line of each paragraph on screen (boxH 190, lineH 20 -- room for
        // nine) and looked identical to "the passage is too short", which is a different bug.
        box.scrollTop += p.getBoundingClientRect().top - box.getBoundingClientRect().top;
        const ls = measure(p);
        const vis = box.getBoundingClientRect();
        const fits = (ln) => ln.top >= vis.top && (ln.top + ln.height) <= vis.bottom;
        tried.push({ chars: p.textContent.length, lines: ls.length, visible: ls.filter(fits).length,
          boxH: Math.round(vis.height), lineH: ls.length ? Math.round(ls[0].height) : null });
        if (ls.length >= 3 && ls.filter(fits).length >= 3) { para = p; lines = ls; break; }
      }
      // Say WHY, with numbers. "could not measure lines" on its own sent this round-trip through a
      // browser probe to learn something the test already knew.
      if (!para) return { failed: 'no paragraph offers three visible lines', tried, paras: paras.length };
      const t = para.firstChild;
      if (lines.length < 3) return null;
      // THE TARGET MUST BE VISIBLE, not merely rendered. `.mv-passage` scrolls, so a line below the
      // fold still reports a getClientRects() box -- one that lies BELOW the passage box's own
      // bottom edge. Clicking there lands on `.mv-item`, the question below, and nothing lights:
      // the tracker is behaving correctly, because a child cannot tap a line that is not on screen.
      //
      // This used to take lines[1] unconditionally, which was sound only while the passage box
      // happened to be tall enough. It is not a fixed height: it is whatever the item below leaves
      // over, measured between 344px and 542px across twelve loads of this same level, because the
      // level serves a random item each time. Adding a figure reveal strip to this pack took ~22px
      // off the top and pushed the short cases past the edge, so the suite began failing about one
      // run in nine -- always on the SAME assertion, always with the target ten pixels below the
      // box. Diagnosed by elementFromPoint at the tap: DIV.mv-item, not P.mv-para.
      //
      // Pick the first line that is FULLY inside the visible box and still has a line above and
      // below it, so the neighbour assertions below keep their meaning.
      const vis = box.getBoundingClientRect();
      const inside = (ln) => ln.top >= vis.top && (ln.top + ln.height) <= vis.bottom;
      let idx = -1;
      for (let k = 1; k < lines.length - 1; k++) {
        if (inside(lines[k - 1]) && inside(lines[k]) && inside(lines[k + 1])) { idx = k; break; }
      }
      if (idx === -1) return null;
      const line = lines[idx];
      const mid = Math.floor((line.from + line.to) / 2);
      const r = document.createRange();
      r.setStart(t, mid); r.setEnd(t, mid + 1);
      const rect = r.getClientRects()[0];
      // The neighbours are the lines either side of the one actually CHOSEN. They were lines[0] and
      // lines[2], which was only ever right because idx was hard-coded to 1; leaving them fixed
      // while idx moves would point the "covers ONLY that line" assertions at the wrong two lines
      // and quietly stop testing anything.
      const above = lines[idx - 1];
      const below = lines[idx + 1];
      return {
        x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        lineIndex: idx, lineCount: lines.length,
        lineTop: line.top, lineBottom: line.top + line.height,
        boxTop: vis.top, boxBottom: vis.bottom,
        aboveTop: above.top, belowTop: below.top,
        aboveMid: above.top + above.height / 2,
        aboveBottom: above.top + above.height,
        belowMid: below.top + below.height / 2,
        word: t.nodeValue.slice(Math.max(0, mid - 6), mid + 7),
        lineText: t.nodeValue.slice(line.from, line.to + 1),
      };
    });
    check('the passage wraps to at least three rendered lines, so "a line" means something',
      target && target.lineCount >= 3,
      target ? (target.failed ? `${target.failed}: ${JSON.stringify(target.tried)}` : `${target.lineCount} lines`)
             : 'could not measure lines');
    if (!target || target.failed) throw new Error('could not find a wrapped paragraph to tap: '
      + (target ? target.failed + ' ' + JSON.stringify(target.tried) : 'null'));
    // ARMING for the fix above: if the point we are about to click is not inside the passage box,
    // the click lands on the question below and the tracker is right to ignore it. Asserting it
    // here means a future regression in the target picker fails as "we aimed off the passage",
    // which is the truth, instead of as "tapping a line lights it", which is not.
    check('ARMING: the tap target is inside the VISIBLE passage box, not below the fold',
      target.y >= target.boxTop && target.y <= target.boxBottom,
      `target y ${Math.round(target.y)} against box ${Math.round(target.boxTop)}-${Math.round(target.boxBottom)}, line ${target.lineIndex} of ${target.lineCount}`);

    // ---- POSITIVE: a tap lights the line under it ----
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(250);
    const lit = await page.evaluate(({ tgt }) => {
      const box = document.querySelector('.mv-passage');
      const el = box.querySelector('.mv-readline');
      if (!el || el.style.display === 'none') return { shown: false };
      const r = el.getBoundingClientRect();
      return {
        shown: true,
        top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height,
        coversTap: tgt.y >= r.top && tgt.y <= r.bottom && tgt.x >= r.left && tgt.x <= r.right,
        coversAbove: tgt.aboveMid >= r.top && tgt.aboveMid <= r.bottom,
        coversBelow: tgt.belowMid >= r.top && tgt.belowMid <= r.bottom,
        bleedBelow: r.bottom - tgt.belowTop,
        bleedAbove: tgt.aboveBottom - r.top,
        marked: box.hasAttribute('data-readline'),
        pointerEvents: getComputedStyle(el).pointerEvents,
        zIndex: getComputedStyle(el).zIndex,
        paraZ: getComputedStyle(box.querySelector('.mv-para')).zIndex,
      };
    }, { tgt: target });
    check('tapping a line lights it', lit.shown && lit.marked, JSON.stringify(lit));
    check('the lit band covers the word he tapped', lit.coversTap,
      `tapped "${target.word.trim()}" at (${Math.round(target.x)}, ${Math.round(target.y)}), band ${Math.round(lit.top)}-${Math.round(lit.bottom)}`);
    check('and it covers ONLY that line, not the one above or below',
      !lit.coversAbove && !lit.coversBelow,
      `band ${Math.round(lit.top)}-${Math.round(lit.bottom)}, glyphs above centred at ${Math.round(target.aboveMid)}, below at ${Math.round(target.belowMid)}`);
    check('and it does not bleed into either neighbouring line box',
      lit.bleedBelow <= 0.5 && lit.bleedAbove <= 0.5,
      `bleeds ${lit.bleedBelow.toFixed(1)}px past the line below, ${lit.bleedAbove.toFixed(1)}px past the one above`);
    check('the band is about one line tall, not a whole paragraph',
      lit.height > 8 && lit.height < (target.belowTop - target.aboveTop) * 1.6,
      `band ${Math.round(lit.height)}px, line pitch ${Math.round(target.belowTop - target.aboveTop)}px`);
    check('the band never steals a tap from the text it marks', lit.pointerEvents === 'none', lit.pointerEvents);
    check('the words sit ABOVE the band, so a highlight never dims its own line',
      Number(lit.paraZ) > Number(lit.zIndex), `para z=${lit.paraZ}, band z=${lit.zIndex}`);

    // ---- the words on the lit line are still readable ----
    // The band is the one change that can wash the passage out, and neither the reading-surface
    // sweep (passage ground against the respond panel) nor anything else measures TEXT on BAND.
    // Composited exactly: the band's resolved colour and alpha over the passage's own ground, then
    // WCAG contrast against the paragraph's text colour. The floor is 4.5:1, WCAG AA for body text.
    const contrast = await page.evaluate(() => {
      // Composited through a CANVAS rather than parsed by hand: color-mix() resolves to whatever
      // colour syntax the engine prefers (oklab, color(srgb ...)), and a regex for rgba() reads
      // null on all of them. Painting ground then band into one pixel and reading it back gives
      // the true composite in sRGB whatever the source syntax was.
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const px = (fills) => {
        ctx.clearRect(0, 0, 1, 1);
        for (const f of fills) { ctx.fillStyle = f; ctx.fillRect(0, 0, 1, 1); }
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

      const box = document.querySelector('.mv-passage');
      const para = box.querySelector('.mv-para');
      const el = box.querySelector('.mv-readline');
      // Every painted ground from the page down to the passage, in order, so the composite is the
      // real one rather than the passage's own translucent layer over nothing.
      const stack = [];
      for (let n = box; n && n !== document.documentElement; n = n.parentElement) {
        stack.unshift(getComputedStyle(n).backgroundColor);
      }
      stack.unshift(getComputedStyle(document.documentElement).backgroundColor || '#000');
      stack.unshift('#000');            // the browser's own ground, so nothing composites over nothing
      const ground = px(stack);
      const litGround = px(stack.concat([getComputedStyle(el).backgroundColor]));
      const text = px(['#000', getComputedStyle(para).color]);
      const bandAlpha = (() => {
        // How much the band actually moved the ground, in sRGB distance. A visible band moves it.
        const d = Math.abs(litGround.r - ground.r) + Math.abs(litGround.g - ground.g) + Math.abs(litGround.b - ground.b);
        return d;
      })();
      return {
        unlit: +ratio(text, ground).toFixed(2),
        lit: +ratio(text, litGround).toFixed(2),
        ground, litGround, text,
        shift: bandAlpha,
        edge: getComputedStyle(el).borderLeftWidth,
      };
    });
    check('the words on the lit line still clear WCAG AA for body text',
      contrast.lit >= 4.5, `lit ${contrast.lit}:1 (unlit ${contrast.unlit}:1)`);
    check('and the band costs less than a quarter of the unlit contrast',
      contrast.lit >= contrast.unlit * 0.75,
      `lit ${contrast.lit}:1 vs unlit ${contrast.unlit}:1`);
    // A tracking aid nobody can see is not one. The first pass shipped a band that only moved the
    // ground by a few sRGB steps and was invisible in a live screenshot of the deployed page; this
    // is the assertion that would have caught it.
    check('the band is actually visible, not a decorative whisper',
      parseFloat(contrast.edge) >= 3 && contrast.shift >= 30,
      `edge ${contrast.edge}, the band moves the ground by ${contrast.shift} sRGB steps `
      + `(ground ${JSON.stringify(contrast.ground)} -> ${JSON.stringify(contrast.litGround)})`);

    // ---- the passage text itself is untouched ----
    const untouched = await page.evaluate(() => {
      const box = document.querySelector('.mv-passage');
      const paras = [...box.querySelectorAll('.mv-para')];
      return {
        text: paras.map((p) => p.textContent).join(' '),
        marks: box.querySelectorAll('mark, .mv-para span, .mv-para b, .mv-para i').length,
        paraChildren: paras.map((p) => p.childNodes.length).join(','),
      };
    });
    check('the passage text is not wrapped, split or otherwise mutated to draw the line',
      untouched.paraChildren.split(',').every((n) => Number(n) === 1),
      `paragraph child-node counts: ${untouched.paraChildren}`);

    // ---- it survives a resize, by re-finding the same WORDS ----
    const beforeText = await page.evaluate(() => {
      // Which characters the band currently covers, read back from the stored anchor. Blocks come
      // from the tracker's OWN enumeration (title first, then paragraphs), never from a separate
      // querySelectorAll here: indexing .mv-para alone is off by the title, which is exactly the
      // mistake this gate's own distinctness control caught.
      const box = document.querySelector('.mv-passage');
      const block = MVRunner.readingLine.blocks(box)[MVRunner.readingLine.state.anchor.blockIndex];
      const t = block.textContent;
      return t.slice(MVRunner.readingLine.state.anchor.lineStart, MVRunner.readingLine.state.anchor.lineEnd + 1);
    });
    await page.setViewportSize({ width: 820, height: 768 });
    await page.waitForTimeout(350);
    const afterResize = await page.evaluate(() => {
      const box = document.querySelector('.mv-passage');
      const el = box.querySelector('.mv-readline');
      const block = MVRunner.readingLine.blocks(box)[MVRunner.readingLine.state.anchor.blockIndex];
      const t = block.textContent;
      return {
        shown: !!el && el.style.display !== 'none',
        text: t.slice(MVRunner.readingLine.state.anchor.lineStart, MVRunner.readingLine.state.anchor.lineEnd + 1),
        anchorOffset: MVRunner.readingLine.state.anchor.offset,
        lineStart: MVRunner.readingLine.state.anchor.lineStart,
        lineEnd: MVRunner.readingLine.state.anchor.lineEnd,
      };
    });
    // What "survives a resize" MEANS, precisely. Narrowing the column rewraps the paragraph, so the
    // run of characters on the anchored line is genuinely different text: it starts earlier and
    // ends earlier. The property that must hold is not "the same string" -- that would only be
    // true if the tracker had pinned a pixel row and never re-measured. It is that the CHARACTER
    // he tapped is still inside the lit line, and that the two runs still share the words around
    // it. An earlier version of this gate asserted the same string and failed on correct
    // behaviour, which is how the distinction got pinned down.
    check('the line survives a resize', afterResize.shown, JSON.stringify(afterResize));
    check('the anchored character is still inside the lit line after the rewrap',
      afterResize.anchorOffset >= afterResize.lineStart && afterResize.anchorOffset <= afterResize.lineEnd,
      `anchor ${afterResize.anchorOffset} vs line [${afterResize.lineStart}, ${afterResize.lineEnd}]`);
    const wordOverlap = (a, b) => {
      const wa = new Set((a.toLowerCase().match(/[a-z]{4,}/g) || []));
      const wb = (b.toLowerCase().match(/[a-z]{4,}/g) || []);
      return wb.filter((w) => wa.has(w)).length;
    };
    check('and it re-finds the line around the same WORDS rather than the same pixel row',
      wordOverlap(beforeText, afterResize.text) >= 2,
      `before "${beforeText.slice(0, 70)}" | after "${afterResize.text.slice(0, 70)}" | ${wordOverlap(beforeText, afterResize.text)} shared word(s)`);
    check('CONTROL: the word-overlap metric can read zero on unrelated text',
      wordOverlap(beforeText, 'zzzz qqqq wwww vvvv') === 0,
      'the overlap metric accepts anything, so the result above is void');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);

    // ---- arrow keys walk it a line at a time ----
    const walked = await page.evaluate(async () => {
      const box = document.querySelector('.mv-passage');
      const read = () => {
        const el = box.querySelector('.mv-readline');
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), start: MVRunner.readingLine.state.anchor.lineStart, block: MVRunner.readingLine.state.anchor.blockIndex };
      };
      const before = read();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const down = read();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const back = read();
      return { before, down, back };
    });
    check('ArrowDown moves the line down by one', walked.down.top > walked.before.top,
      `${walked.before.top} -> ${walked.down.top}`);
    check('ArrowUp brings it back to where it was',
      walked.back.top === walked.before.top && walked.back.start === walked.before.start,
      JSON.stringify(walked));

    // ---- NEGATIVE CONTROL: tapping the lit line puts it out ----
    const off = await page.evaluate(async ({ tgt }) => {
      const box = document.querySelector('.mv-passage');
      const el = box.querySelector('.mv-readline');
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      // A real pointer round trip, so the tap-versus-drag guard is exercised too.
      box.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
      const at = document.elementFromPoint(x, y);
      (at || box).dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
      await new Promise((res) => setTimeout(res, 120));
      return {
        shown: el.style.display !== 'none',
        anchor: MVRunner.readingLine.state.anchor,
        marked: box.hasAttribute('data-readline'),
      };
    }, { tgt: target });
    check('NEGATIVE CONTROL: tapping the lit line puts it out',
      !off.shown && off.anchor === null && !off.marked, JSON.stringify(off));

    // ---- NEGATIVE CONTROL: a drag (a scroll gesture, or a selection) does not move the line ----
    const dragged = await page.evaluate(async ({ tgt }) => {
      const box = document.querySelector('.mv-passage');
      box.dispatchEvent(new PointerEvent('pointerdown', { clientX: tgt.x, clientY: tgt.y, bubbles: true }));
      const at = document.elementFromPoint(tgt.x, tgt.y + 40);
      (at || box).dispatchEvent(new PointerEvent('pointerup', { clientX: tgt.x, clientY: tgt.y + 40, bubbles: true }));
      await new Promise((res) => setTimeout(res, 120));
      return { anchor: MVRunner.readingLine.state.anchor };
    }, { tgt: target });
    check('NEGATIVE CONTROL: a drag is a scroll or a selection, and lights nothing',
      dragged.anchor === null, JSON.stringify(dragged));

    // ---- NEGATIVE CONTROL: the same-line test can tell two lines apart ----
    // Without this, a widener that returned the whole paragraph would satisfy every check above.
    const distinct = await page.evaluate(({ tgt }) => {
      const box = document.querySelector('.mv-passage');
      const para = [...box.querySelectorAll('.mv-para')].find((p) => p.textContent.length > 220);
      const t = para.firstChild;
      const rectAt = (i) => { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1); return r.getClientRects()[0]; };
      const nodes = [t];
      const total = t.nodeValue.length;
      // Light line 1, record its run; light line 2, record its run; they must not be the same run.
      const bi = MVRunner.readingLine.blocks(box).indexOf(para);
      const runFor = (i) => {
        MVRunner.readingLine.state.anchor = { blockIndex: bi, offset: i };
        MVRunner.readingLine.paint(box);
        return { start: MVRunner.readingLine.state.anchor.lineStart, end: MVRunner.readingLine.state.anchor.lineEnd };
      };
      // two offsets known to be on different rendered lines
      let a = 0, b = 0;
      const top0 = rectAt(0).top;
      for (let i = 1; i < total; i++) { const r = rectAt(i); if (r && Math.abs(r.top - top0) > r.height * 0.5) { b = i; break; } }
      const runA = runFor(a);
      const runB = runFor(b);
      MVRunner.readingLine.clear(box);
      return { runA, runB, total };
    }, { tgt: target });
    check('CONTROL: two different rendered lines produce two different character runs',
      distinct.runA.start !== distinct.runB.start && distinct.runA.end !== distinct.runB.end
      && distinct.runA.end < distinct.total - 1,
      `line 1 = [${distinct.runA.start}, ${distinct.runA.end}], line 2 = [${distinct.runB.start}, ${distinct.runB.end}] of ${distinct.total} chars`);
    check('CONTROL: and neither run is the whole paragraph, which a broken widener would return',
      (distinct.runA.end - distinct.runA.start) < distinct.total * 0.9,
      `line 1 covers ${distinct.runA.end - distinct.runA.start + 1} of ${distinct.total} chars`);

    // ---- NEGATIVE CONTROL: a new passage clears the line ----
    const cleared = await page.evaluate(async () => {
      const box = document.querySelector('.mv-passage');
      MVRunner.readingLine.state.anchor = { blockIndex: 0, offset: 5 };
      MVRunner.readingLine.paint(box);
      const before = MVRunner.readingLine.state.anchor !== null;
      MVRunner.readingLine.clear(box);                               // what the runner calls on a passage swap
      const el = box.querySelector('.mv-readline');
      return { before, after: MVRunner.readingLine.state.anchor, shown: el ? el.style.display !== 'none' : false };
    });
    check('NEGATIVE CONTROL: a new passage clears the line rather than lighting new words',
      cleared.before && cleared.after === null && !cleared.shown, JSON.stringify(cleared));

    check('no JS errors during the run', jsErrors.length === 0, jsErrors[0] || '');
  } catch (e) {
    problems.push('THREW: ' + ((e && e.stack) || e));
  } finally {
    await browser.close();
    server.close();
  }

  if (checks.length < 14) problems.push(`ARMING: only ${checks.length} assertions ran, too few to be the real gate`);

  console.log('\n=== reading-line tracker (WP-R) ===');
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
