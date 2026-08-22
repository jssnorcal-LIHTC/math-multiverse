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
//   PART 3, the app's own code. attachExplainNext() scrolls the NEXT button into view with an
//           explicit behavior argument, which is an animation NO stylesheet reaches -- not the
//           @media block, not CSS scroll-behavior, because the argument overrides it. The behavior
//           it actually passes is read back under both preferences.
//
// THE TRAP THIS FILE EXISTS TO REMEMBER: Playwright's newContext({ reducedMotion }) DOES NOT REACH
// AN IMAGE DOCUMENT. The parent page reports what was asked for while the SVG inside the <img>
// keeps reporting the real browser/OS value, so on a machine whose OS has reduced motion ON, a
// probe using the context option measures 'reduce' in BOTH of its two "conditions" and a gated
// animation reads STILL in both -- which looks like a pass and proves nothing. The preference is
// therefore forced with Chromium's own launch switches, --force-prefers-reduced-motion and
// --force-prefers-no-reduced-motion, for PARTS 1 AND 2.
//
// PART 3 INVERTS THAT, and the inversion is the same fact seen from the other side. Playwright's
// context sets the PAGE's motion preference and that setting overrides the launch switch, while
// never crossing into an <img>'s SVG. So the switch is the only thing that reaches an image, and
// the context option is the only thing that reaches the page. Measured, not assumed: with
// --force-prefers-reduced-motion and a navigated page, matchMedia('(prefers-reduced-motion:
// reduce)').matches came back FALSE. PART 3 measures the page's own JS, so it uses the context
// option, and it asserts that its two conditions really do differ inside the page -- which is the
// check that would have caught the switch not landing.
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
  // The server stays up for PART 3 below, which loads the shell itself rather than an asset.

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

  // ---------------- PART 3: the one motion no stylesheet can reach ----------------
  // Parts 1 and 2 measure ASSETS. This measures the app's own code, because there is a motion in it
  // that no stylesheet governs: attachExplainNext() brings the NEXT button into view by calling
  // scrollIntoView with an explicit behavior argument. engine.css's @media (prefers-reduced-motion:
  // reduce) block does not reach scrolling, and CSS scroll-behavior is overridden by that argument,
  // so constraint 7 can only be kept for it by reading the preference in JS. A rule kept in JS needs
  // a gate in JS, or it is documentation.
  //
  // TWO THINGS HERE CONTRADICT PART 2 ON PURPOSE, and both were measured before being relied on.
  //
  // FIRST, this half uses newContext({ reducedMotion }) -- the option the header above bans. The ban
  // is real and it is about IMAGE documents: Playwright's emulation does not cross into an <img>'s
  // SVG, so PART 2 must use the launch switch. The reverse is true here. Playwright's context
  // defaults prefers-reduced-motion to no-preference for the PAGE, and that default OVERRIDES the
  // launch switch, so a page-level matchMedia reads no-preference in both conditions no matter which
  // switch is passed. Measured: with --force-prefers-reduced-motion and a navigated page,
  // matchMedia('(prefers-reduced-motion: reduce)').matches came back false. The parent page is
  // exactly where the context option is the right tool, and the assertion below fails if the two
  // conditions ever stop differing, so this cannot rot into measuring one condition twice.
  //
  // SECOND, this does not watch the scroll move. Headless Chromium does not animate scrollIntoView:
  // measured across both motion switches and both compositing modes, behavior 'smooth' and behavior
  // 'auto' each land in ONE step, 1060px, indistinguishable. A glide-versus-jump probe cannot arm in
  // this environment, and a gate that cannot arm is worse than no gate. So what is measured is the
  // DECISION the app makes: scrollIntoView is wrapped, attachExplainNext is called for real, and the
  // argument it actually passed is read back. Reverting the guard flips that argument and fails
  // here, which is the property a gate has to have.
  const scrollDecision = async (mode, controlDelayMs) => {
    const ctx = await browser2.newContext({ viewport: { width: 1024, height: 768 }, reducedMotion: mode });
    try {
      const pg = await ctx.newPage();
      await pg.goto(`http://127.0.0.1:${port}/Math-Multiverse.html`, { waitUntil: 'domcontentloaded' });
      await pg.waitForFunction(() => typeof window.attachExplainNext === 'function', null, { timeout: 8000 });
      return await pg.evaluate((delayMs) => new Promise((resolve) => {
        const seen = [];
        const real = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function patched(arg) {
          seen.push(arg && typeof arg === 'object' ? arg.behavior : String(arg));
          return real.apply(this, arguments);
        };
        const host = document.createElement('div');
        host.setAttribute('style', 'position:fixed;left:0;top:0;width:400px;height:200px;overflow:auto;z-index:2147483000;background:#000');
        const spacer = document.createElement('div');
        spacer.setAttribute('style', 'height:1200px');
        const tile = document.createElement('div');
        tile.setAttribute('style', 'height:60px');
        host.appendChild(spacer); host.appendChild(tile);
        document.body.appendChild(host);
        // delayMs > 0 is the CONTROL run: instead of the app's own scroll, one that deliberately
        // stays still for a while and only then moves. It goes through the very same sampler below,
        // because a control that re-implements the thing it tests proves only that the copy agrees
        // with itself. This is what holds the settle logic on a machine whose browser does not
        // animate a smooth scroll at all, which is every run on this Windows box.
        let attached = true;
        if (delayMs > 0) {
          seen.push('control');
          setTimeout(() => { host.scrollTop = 99999; }, delayMs);
        } else {
          attached = window.attachExplainNext(tile, () => {});
        }
        // WAIT FOR THE SCROLL TO SETTLE, do not assume it lands in a fixed number of frames. This
        // originally waited two frames, which is correct only where a smooth scroll does not
        // animate. It does not animate on this Windows machine and it DOES on CI's Linux Chromium,
        // where two frames caught the glide at 0px and read as "the scroll did nothing". So the
        // sampler runs until the position stops changing, and the positions it passed through are
        // carried out as well: an environment that animates can then also be asked whether the
        // reduce path jumped, and one that does not can say so instead of pretending.
        const positions = [];
        const startPos = Math.round(host.scrollTop);
        let stable = 0, frames = 0, lastPos = null, moved = false;
        const tick = () => {
          const now = Math.round(host.scrollTop);
          positions.push(now);
          if (now !== startPos) moved = true;
          stable = (now === lastPos) ? stable + 1 : 0;
          lastPos = now;
          // Three still frames AFTER THE SCROLL HAS ACTUALLY MOVED, or a hard stop well past the
          // ~300ms a smooth scroll takes at 60fps.
          //
          // The `moved` half is not belt and braces. Without it the loop accepted the stillness at
          // the START: a smooth scroll sits at 0 for a few frames before it begins gliding, three
          // of those frames satisfied "stable", and the probe reported that a working scroll had
          // settled at 0px and done nothing. It passed twice on CI and then failed on main, because
          // whether the glide begins within three frames is a race. Both real cases move -- the jump
          // in one frame, the glide over many -- so requiring movement costs nothing and closes it.
          if ((stable >= 3 && seen.length && moved) || ++frames > 90) {
            Element.prototype.scrollIntoView = real;
            host.remove();
            return resolve({
              attached, scrolled: now, behaviors: seen, frames,
              distinct: Array.from(new Set(positions)).length,
              prefersReduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), controlDelayMs || 0);
    } finally { await ctx.close(); }
  };

  const browser2 = await chromium.launch(
    process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { args: ['--disable-gpu', '--no-sandbox'], executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : { args: ['--disable-gpu', '--no-sandbox'] });
  let sAllowed, sReduced, sDelayed;
  try {
    sAllowed = await scrollDecision('no-preference');
    sReduced = await scrollDecision('reduce');
    // A scroll that stays still for 120ms and only then moves, through the same sampler.
    sDelayed = await scrollDecision('no-preference', 120);
  } finally { await browser2.close(); }

  console.log('\nNEXT-button scroll (attachExplainNext), behavior argument as actually passed:');
  console.log(`  motion allowed: ${JSON.stringify(sAllowed.behaviors)}  (settled at ${sAllowed.scrolled}px through ${sAllowed.distinct} position(s), matchMedia reduce = ${sAllowed.prefersReduce})`);
  console.log(`  reduced motion: ${JSON.stringify(sReduced.behaviors)}  (settled at ${sReduced.scrolled}px through ${sReduced.distinct} position(s), matchMedia reduce = ${sReduced.prefersReduce})`);

  // The two conditions have to actually differ, or both readings are of the same one.
  if (sAllowed.prefersReduce !== false || sReduced.prefersReduce !== true) {
    problems.push(`the two motion conditions did not differ inside the page (allowed reported prefersReduce=${sAllowed.prefersReduce}, reduced reported ${sReduced.prefersReduce}), so both scroll readings are of the same condition and neither means anything`);
  }
  for (const [label, s] of [['motion allowed', sAllowed], ['reduced motion', sReduced]]) {
    if (!s.attached) problems.push(`attachExplainNext returned false under ${label}, so it never reached its scroll and the reading below is of nothing`);
    if (s.behaviors.length !== 1) problems.push(`under ${label} attachExplainNext called scrollIntoView ${s.behaviors.length} time(s) (${JSON.stringify(s.behaviors)}); this gate reads a single call and cannot interpret that`);
    if (!(s.scrolled > 0)) problems.push(`under ${label} the container never scrolled at all, so the recorded behavior belongs to a scroll that did nothing`);
  }
  // NEGATIVE half first: if the app does not ask for a glide when motion is allowed, then "it asks
  // for a jump under reduce" is true of an app that always jumps, and proves nothing about the guard.
  if (sAllowed.behaviors[0] !== 'smooth') {
    problems.push(`with motion ALLOWED attachExplainNext passed behavior ${JSON.stringify(sAllowed.behaviors[0])} rather than "smooth", so this gate cannot tell a guarded scroll from one that never glides, and the reduced reading below proves nothing`);
  }
  if (sReduced.behaviors[0] !== 'auto') {
    problems.push(`under prefers-reduced-motion attachExplainNext passed behavior ${JSON.stringify(sReduced.behaviors[0])} rather than "auto", so the NEXT button still glides into view. Constraint 7 is not kept: no stylesheet can collapse a JS scroll, so attachExplainNext has to read the preference itself.`);
  }

  // THE SAMPLER'S OWN CONTROL. The settle loop used to accept the stillness at the START, so a
  // smooth scroll that sat at 0 for a few frames before gliding was reported as having settled at
  // 0px and done nothing. It passed twice on CI and then failed on main, because whether the glide
  // begins within three frames is a race. This control takes the race out of the question: a scroll
  // that is still for 120ms and then jumps must be reported at its END, and it fails on any machine
  // if the loop ever goes back to accepting the opening stillness -- including this one, where a
  // real smooth scroll does not animate and so could never have caught it.
  console.log(`  sampler control (still for 120ms, then jumps): settled at ${sDelayed.scrolled}px`);
  if (!(sDelayed.scrolled > 0)) {
    problems.push(`the settle sampler reported ${sDelayed.scrolled}px for a scroll that was deliberately `
      + 'still for 120ms and then jumped to the bottom. It is accepting the stillness before the scroll '
      + 'starts rather than the one after it ends, so every reading above is of a moment chosen at random.');
  }

  // SUPPLEMENTARY, and it arms itself. Whether a smooth scroll actually ANIMATES is a property of
  // the environment, not of the app: it does not animate under headless Chromium on Windows and it
  // does under CI's Linux Chromium, measured both ways. So the painted half of this claim is only
  // asserted where the environment can express it, and where it cannot, it says so rather than
  // reporting a pass it did not earn. The behavior-argument checks above are the ones that always
  // run, and they are what actually holds constraint 7 here.
  if (sAllowed.distinct > 1) {
    console.log(`  glide check ARMED: this environment animates scrollIntoView (${sAllowed.distinct} positions with motion allowed)`);
    if (sReduced.distinct > 1) {
      problems.push(`under prefers-reduced-motion the NEXT-button scroll still passed through ${sReduced.distinct} distinct positions, so it is gliding rather than jumping to its end state, even though the behavior argument read "auto"`);
    }
  } else {
    console.log('  glide check NOT ARMED: this environment does not animate scrollIntoView '
      + `(motion allowed settled through ${sAllowed.distinct} position(s)), so only the behavior argument was measured`);
  }
  server.close();

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
