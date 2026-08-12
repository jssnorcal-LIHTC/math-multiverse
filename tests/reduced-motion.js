'use strict';
// reduced-motion.js -- constraint 7's accessibility promise, measured in painted pixels.
//
// Constraint 7: "prefers-reduced-motion collapses motion to end states". engine.css has carried a
// @media (prefers-reduced-motion: reduce) block since V1 and it lists .mv-lb-overlay among the
// nodes it kills animation on. That rule cannot do what it says. .mv-lb-overlay is an <img>
// (engine/figures.js renderPlate), its src is an SVG, and NOTHING in the parent document reaches
// inside an <img>-referenced SVG: the image is a separate document.
//
// Measured before the fix, not assumed: four variants of the same stroked path were rendered in
// <img> tags at both browser-level motion preferences and screenshotted twice, 800ms apart.
//
//   SMIL <animate>                                     MOVED under reduce   MOVED under no-pref
//   SMIL + parent CSS animation:none !important        MOVED under reduce   MOVED under no-pref
//   CSS @keyframes inside the SVG's own <style>        MOVED under reduce   MOVED under no-pref
//   the same, gated by @media reduce inside the SVG    STILL under reduce   MOVED under no-pref
//
// So SMIL is not governed by prefers-reduced-motion by any route, and the only mechanism that works
// is a media query inside the asset itself. This gate holds both halves of that finding:
//
//   PART 1, static and hermetic. No SVG under art/ may use SMIL, because SMIL cannot be gated.
//   PART 2, rendered. Every animated asset must MOVE when motion is allowed and be STILL when it
//           is not, measured by screenshotting the same <img> twice and comparing raw PNG buffers.
//
// THE TRAP THIS FILE EXISTS TO REMEMBER: Playwright's newContext({ reducedMotion }) DOES NOT REACH
// AN IMAGE DOCUMENT. The parent page reports what was asked for while the SVG inside the <img>
// keeps reporting the real browser/OS value, so on a machine whose OS has reduced motion ON, a
// probe using the context option measures 'reduce' in BOTH of its two "conditions" and a gated
// animation reads STILL in both -- which looks like a pass and proves nothing. The preference is
// therefore forced with Chromium's own launch switches, --force-prefers-reduced-motion and
// --force-prefers-no-reduced-motion, and the context option is never used.
//
//   node tests/reduced-motion.js
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
  catch (e2) { console.error('reduced-motion: neither "playwright" nor "playwright-core" is installed.'); process.exit(2); }
}

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'art');
const FIXTURES = path.join(__dirname, 'fixtures', 'reduced-motion');

const SMIL = /<animate\b|<animateTransform\b|<animateMotion\b|<set\b/i;
const CSS_ANIM = /@keyframes\b/i;

// XML comments are stripped before either test runs. The first run of this gate flagged the very
// asset it had just fixed, because that asset's comment explains, in prose, that it USED to carry a
// SMIL `<animate>`. A scanner that cannot tell markup from a sentence about markup would push every
// author into never naming the thing they removed, which is the opposite of what these files are
// for. The negative-control fixture carries a real element outside its comment, so stripping
// comments cannot disarm the scan.
const markup = (src) => src.replace(/<!--[\s\S]*?-->/g, '');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

function walk(dir, out) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.svg$/i.test(name)) out.push(p);
  }
  return out;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(String(req.url).split('?')[0]));
      fs.readFile(p, (err, buf) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Renders one <img src="..."> at the given browser-level motion preference and reports whether the
// painted result changes over time. Buffer equality, not a pixel decoder: two identical renders
// produce identical PNGs, and the positive control proves the comparison can see a difference.
async function measure(port, assets, forceFlag) {
  const launchOpts = { args: ['--disable-gpu', '--disable-gpu-compositing', forceFlag] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOpts);
  // No reducedMotion in newContext, deliberately: see the header. The switch above is the whole
  // condition, and a context option would silently override the parent page while leaving the
  // image document on the machine's own setting.
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  const out = [];

  for (const rel of assets) {
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0e1015">
      <img id="probe" src="http://127.0.0.1:${port}/${rel}?t=${encodeURIComponent(forceFlag)}" style="display:block;width:600px;height:800px;object-fit:contain">
      <div id="blank" style="width:600px;height:800px;background:#0e1015"></div>
      </body></html>`);
    await page.waitForFunction(() => {
      const i = document.getElementById('probe');
      return i && i.complete && i.naturalWidth > 0;
    }, null, { timeout: 8000 });
    const decoded = await page.evaluate(() => {
      const i = document.getElementById('probe');
      return { complete: i.complete, w: i.naturalWidth, h: i.naturalHeight };
    });

    const probe = page.locator('#probe');
    const a = await probe.screenshot();
    await page.waitForTimeout(900);
    const b = await probe.screenshot();
    await page.waitForTimeout(900);
    const c = await probe.screenshot();
    const blank = await page.locator('#blank').screenshot();

    out.push({
      asset: rel,
      decoded,
      moved: !a.equals(b) || !a.equals(c),
      painted: !a.equals(blank),
      bytes: [a.length, b.length, c.length],
      first: a,
    });
  }

  const version = browser.version();
  await browser.close();
  return { rows: out, version };
}

(async () => {
  const problems = [];

  // ---------------- PART 1: no SMIL under art/ ----------------
  const svgs = walk(ART);
  if (!svgs.length) {
    problems.push('art/ contains no SVG at all -- this scan discovered nothing, which is a failure and never a clean run');
  }
  console.log(`SMIL scan: ${svgs.length} SVG(s) under art/`);
  const smilHits = [];
  for (const p of svgs) {
    if (SMIL.test(markup(fs.readFileSync(p, 'utf8')))) smilHits.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
  for (const h of smilHits) {
    problems.push(`${h} uses SMIL. SMIL is not governed by prefers-reduced-motion by any route -- not from the parent stylesheet, not from a media query inside the file -- so an asset that animates with it cannot keep constraint 7. Drive it from a CSS animation in the SVG's own <style> instead.`);
  }
  console.log(`  SMIL found in ${smilHits.length} of ${svgs.length}`);

  // Negative control for the scanner itself.
  const controlSmil = path.join(FIXTURES, 'has-smil.svg');
  if (!fs.existsSync(controlSmil)) {
    problems.push('the SMIL scanner\'s negative-control fixture is missing, so nothing shows the scanner can find SMIL at all');
  } else if (!SMIL.test(markup(fs.readFileSync(controlSmil, 'utf8')))) {
    problems.push('the SMIL scanner did NOT flag its own negative-control fixture -- it is not looking, and "no SMIL found" above means nothing');
  } else {
    console.log('  negative control: tests/fixtures/reduced-motion/has-smil.svg correctly FLAGGED');
  }

  // ---------------- PART 2: the rendered behaviour ----------------
  const animated = svgs
    .filter((p) => CSS_ANIM.test(markup(fs.readFileSync(p, 'utf8'))))
    .map((p) => path.relative(ROOT, p).replace(/\\/g, '/'));

  if (!animated.length) {
    problems.push('no animated asset was discovered under art/, so the rendered half of this gate measured nothing. If the last animated asset was genuinely removed, remove this check with it rather than letting it report clean on an empty roster.');
  }
  console.log(`\nanimated assets under art/: ${animated.length}${animated.length ? ' (' + animated.join(', ') + ')' : ''}`);

  const FIXTURE_STILL = 'tests/fixtures/reduced-motion/still.svg';
  const FIXTURE_MOVES = 'tests/fixtures/reduced-motion/always-moves.svg';
  const roster = [...animated, FIXTURE_STILL, FIXTURE_MOVES];

  const { server, port } = await startServer();
  const ghost = await fetch(`http://127.0.0.1:${port}/__no_such_file__.svg`).then((r) => r.status).catch(() => 0);
  if (ghost === 200) {
    console.error('reduced-motion: the ghost path answered 200 -- this origin serves anything, so nothing it says is evidence');
    server.close();
    process.exit(2);
  }
  console.log(`origin proof: a path that cannot exist answered ${ghost}, not 200\n`);

  const allowed = await measure(port, roster, '--force-prefers-no-reduced-motion');
  const reduced = await measure(port, roster, '--force-prefers-reduced-motion');
  server.close();

  console.log(`Chromium ${allowed.version}\n`);
  console.log('  asset                                              motion allowed   reduced');
  for (let i = 0; i < roster.length; i++) {
    const a = allowed.rows[i], r = reduced.rows[i];
    console.log(`  ${roster[i].padEnd(50)} ${(a.moved ? 'MOVED' : 'STILL').padEnd(16)} ${r.moved ? 'MOVED' : 'STILL'}`);

    for (const [label, row] of [['motion allowed', a], ['reduced', r]]) {
      if (!row.decoded.complete || !row.decoded.w) {
        problems.push(`${roster[i]} (${label}): the image did not decode (${JSON.stringify(row.decoded)}) -- a STILL reading on an image that never painted is not evidence of anything`);
      }
      if (!row.painted) {
        problems.push(`${roster[i]} (${label}): the rendered box is identical to an empty box of the same size, so nothing was painted`);
      }
    }

    if (roster[i] === FIXTURE_STILL) {
      if (a.moved || r.moved) problems.push('the STILL fixture MOVED -- the movement detector is reporting noise, so every STILL in this run is worthless');
      continue;
    }
    if (roster[i] === FIXTURE_MOVES) {
      if (!a.moved) problems.push('the ALWAYS-MOVES fixture read STILL with motion allowed -- the movement detector is not capturing frames, so every STILL in this run is worthless');
      if (!r.moved) problems.push('the ALWAYS-MOVES fixture read STILL under reduced motion -- an UNGATED animation must still run, so either the switch is doing more than it should or the detector is broken');
      continue;
    }

    if (!a.moved) {
      problems.push(`${roster[i]}: does not animate even with motion allowed. Either the animation is broken or this asset should not be on the animated roster.`);
    }
    if (r.moved) {
      problems.push(`${roster[i]}: still animating under prefers-reduced-motion. Constraint 7 is not kept: the reduce branch inside the asset is missing or not taking effect.`);
    }
    // The reduce branch must COLLAPSE TO AN END STATE, not merely freeze frame 0. A frozen
    // animation and a genuine static end state both read STILL, so the two are separated by
    // comparing what is actually painted in each condition.
    if (!r.moved && a.first.equals(r.first)) {
      problems.push(`${roster[i]}: the reduced rendering is byte-identical to the animated one's first frame, so the animation is merely frozen rather than collapsed to its end state.`);
    }
  }

  console.log(`\n=== reduced-motion: ${svgs.length} SVG(s) scanned, ${roster.length} rendered, ${problems.length} problem(s) ===`);
  for (const p of problems) console.log('  ' + p);

  if (problems.length) {
    console.log('\nRESULT: FAILED');
    process.exit(1);
  }
  console.log('\nRESULT: ALL CLEAN');
  process.exit(0);
})().catch((e) => {
  console.error('reduced-motion: harness error:', e && e.stack || e);
  process.exit(2);
});
