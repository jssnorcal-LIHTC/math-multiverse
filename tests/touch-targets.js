'use strict';
// touch-targets.js -- the touch-target gate for the header controls.
//
// Constraint 6 puts the minimum touch target at 44px. Measured on the deployed build at 1024x768
// on 26-0812, every one of the eight .profile-bar controls painted 35px tall: btn-grade-5 66x35,
// btn-grade-6 68x35, btn-stats 48x35, btn-preview 94x35, btn-rename 55x35, btn-export 57x35,
// btn-import 59x35, btn-reset 51x35. Systematic and pre-existing, dating to the 26-0708 one-row
// compaction that shrank the bar so the play area would fit 768px.
//
// WHY THIS GATE MEASURES HIT-TESTING AND NOT getBoundingClientRect.
//
// A tap target is not a painted box, it is the region in which a tap reaches the control. The two
// are the same only when nothing extends the hit region, and the fix this gate exists to hold in
// place does exactly that: a 44px-tall pseudo-element that contributes no layout and paints
// nothing. A geometry probe would read that fix as unapplied (the button still paints 35px) and a
// stylesheet probe would read it as applied whether or not the browser agreed. So every number
// below comes from document.elementFromPoint, which is the same question the child's finger asks.
//
// It probes a 5x5 grid over the REQUIRED 44x44 box centred on each control, inset half a pixel so
// every probe lies strictly inside, and requires the control itself (or a descendant) to be the
// element returned. That single formulation catches all three ways this can be wrong: a target
// too short, a target too narrow, and two expanded targets overlapping so that a tap near the
// edge of one reaches its neighbour.
//
// FIXTURE CONTROLS, both mandatory, per constraint 12. Discovering zero controls is a FAIL, never
// a silent pass. Beyond that, a run in which everything passes has to be distinguishable from a
// run in which the measurement was broken and saw nothing, so each run also injects:
//   NEGATIVE  a 35px-tall button with no hit-area extension, which MUST fail the 44px check.
//             If it passes, the measurement cannot see a short target and the whole run is void.
//   POSITIVE  a 60px-tall button, which MUST pass. If it fails, the probe is not reaching the DOM.
//
//   node tests/touch-targets.js
//   PLAYWRIGHT_EXECUTABLE_PATH="C:\\...\\chrome.exe" node tests/touch-targets.js
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
  catch (e2) { console.error('touch-targets: neither "playwright" nor "playwright-core" is installed.'); process.exit(2); }
}

const ROOT = path.join(__dirname, '..');

// The iPad 6 in landscape, which is the device Niall actually uses, and the width the one-row
// header compaction was tuned for.
const VIEWPORT = { width: 1024, height: 768 };

// Apple's HIG minimum, carried into this program as constraint 6.
const MIN_TARGET_PX = 44;

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

// Everything below runs inside the page. Kept as one function so the fixture controls are measured
// by exactly the same code path as the real ones, rather than by a second copy of the logic that
// could drift away from it.
const PROBE = (minPx) => {
  const hits = (el, x, y) => {
    const at = document.elementFromPoint(x, y);
    return !!at && (at === el || el.contains(at));
  };

  // The requirement: a minPx x minPx box centred on the control, every point of which reaches the
  // control. Probed on a 5x5 grid inset 0.5px so no probe sits exactly on a boundary, where the
  // answer is a rounding question rather than a reachability one.
  const requirement = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const half = minPx / 2 - 0.5;
    const misses = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const x = cx - half + (half * 2) * (i / 4);
        const y = cy - half + (half * 2) * (j / 4);
        if (!hits(el, x, y)) misses.push({ x: +x.toFixed(1), y: +y.toFixed(1), got: (document.elementFromPoint(x, y) || {}).className || '(nothing)' });
      }
    }
    return misses;
  };

  // Reported alongside the pass/fail so a log line says how much target there actually is, not
  // merely whether it cleared the bar. Walks outward from the centre in 0.5px steps.
  const effective = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const walk = (dx, dy) => {
      let d = 0;
      for (let k = 0.5; k <= 80; k += 0.5) {
        if (!hits(el, cx + dx * k, cy + dy * k)) break;
        d = k;
      }
      return d;
    };
    return { w: +(walk(-1, 0) + walk(1, 0)).toFixed(1), h: +(walk(0, -1) + walk(0, 1)).toFixed(1) };
  };

  const describe = (el) => ({
    id: el.id || el.className || el.tagName.toLowerCase(),
    label: (el.textContent || '').trim().slice(0, 18),
    painted: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
    effective: effective(el),
    misses: requirement(el),
  });

  // ---- the real roster ----
  // Selector, not an id list: an id list silently stops covering a control that gets renamed, and
  // a control ADDED to this bar would never be covered at all.
  const controls = [...document.querySelectorAll('.profile-bar button, .profile-bar a, .profile-bar [role="button"]')];
  const rows = controls.map(describe);

  // ---- fixture controls ----
  // Fixed positioning in free space with a high z-index, so the fixtures are measured against
  // nothing but themselves and cannot be occluded by whatever the launcher happens to be showing.
  const host = document.createElement('div');
  host.setAttribute('style', 'position:fixed; left:340px; top:360px; z-index:99999; display:flex; gap:40px;');
  const mk = (h, tag) => {
    const b = document.createElement('button');
    b.id = tag;
    b.textContent = tag;
    b.setAttribute('style', `all:unset; display:block; width:80px; height:${h}px; background:#333;`);
    host.appendChild(b);
    return b;
  };
  const neg = mk(35, 'fixture-short');    // must FAIL the 44px requirement
  const pos = mk(60, 'fixture-tall');     // must PASS it
  document.body.appendChild(host);
  const fixtures = { negative: describe(neg), positive: describe(pos) };
  host.remove();

  return { rows, fixtures };
};

(async () => {
  const { server, port } = await startServer();
  const launchOpts = { args: ['--disable-gpu', '--disable-gpu-compositing'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: VIEWPORT });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e.message)));

  // Origin proof, the same discipline tests/play-level.js runs: a path that cannot exist must not
  // answer 200, so a run against a misconfigured server cannot look like a clean one.
  const ghost = await page.request.get(`http://127.0.0.1:${port}/__no_such_file__.html`);
  if (ghost.status() === 200) {
    console.error('touch-targets: the ghost path answered 200 -- this origin serves anything, so nothing it says is evidence');
    await browser.close(); server.close(); process.exit(2);
  }

  await page.goto(`http://127.0.0.1:${port}/Math-Multiverse.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.profile-bar button', { timeout: 8000 });

  const { rows, fixtures } = await page.evaluate(PROBE, MIN_TARGET_PX);

  console.log(`touch targets at ${VIEWPORT.width}x${VIEWPORT.height}, floor ${MIN_TARGET_PX}px (constraint 6)\n`);

  const problems = [];

  if (!rows.length) {
    problems.push('the .profile-bar roster is EMPTY -- this gate discovered nothing to measure, which is a failure and never a clean run');
  }

  for (const r of rows) {
    const ok = r.misses.length === 0;
    console.log(`  ${String(r.id).padEnd(14)} painted ${String(r.painted.w).padStart(3)}x${String(r.painted.h).padStart(2)}   effective hit ${String(r.effective.w).padStart(5)}x${String(r.effective.h).padStart(5)}   ${ok ? 'OK' : 'SHORT'}`);
    if (!ok) {
      const m = r.misses[0];
      problems.push(`${r.id} ("${r.label}"): painted ${r.painted.w}x${r.painted.h}, effective hit box ${r.effective.w}x${r.effective.h} -- ${r.misses.length} of 25 probes inside the required ${MIN_TARGET_PX}x${MIN_TARGET_PX} box miss it (first at ${m.x},${m.y}, which reaches "${m.got}")`);
    }
  }

  console.log('\nfixture controls (constraint 12: a clean run must be distinguishable from a blind one):');
  const negFailed = fixtures.negative.misses.length > 0;
  const posPassed = fixtures.positive.misses.length === 0;
  console.log(`  NEGATIVE  35px button, no hit-area extension: effective ${fixtures.negative.effective.w}x${fixtures.negative.effective.h}, ${fixtures.negative.misses.length} of 25 probes miss -> ${negFailed ? 'correctly REJECTED' : 'WRONGLY ACCEPTED'}`);
  console.log(`  POSITIVE  60px button:                        effective ${fixtures.positive.effective.w}x${fixtures.positive.effective.h}, ${fixtures.positive.misses.length} of 25 probes miss -> ${posPassed ? 'correctly ACCEPTED' : 'WRONGLY REJECTED'}`);
  if (!negFailed) problems.push('the NEGATIVE fixture (a 35px control with no hit-area extension) PASSED the 44px check -- this measurement cannot see a short target, so every other result in this run is void');
  if (!posPassed) problems.push('the POSITIVE fixture (a 60px control) FAILED the 44px check -- the probe is not reaching the DOM, so every other result in this run is void');

  console.log(`\n=== touch-targets: ${rows.length} control(s), ${problems.length} problem(s), ${jsErrors.length} JS error(s) ===`);
  for (const p of problems) console.log('  ' + p);
  for (const e of jsErrors) console.log('  JS ERROR: ' + e);

  await browser.close();
  server.close();

  if (problems.length || jsErrors.length) {
    console.log('\nRESULT: FAILED');
    process.exit(1);
  }
  console.log('\nRESULT: ALL CLEAN');
  // Explicit, for the reason reading-surface.js records at its own clean exit: under Node 24 a
  // stray rejection settling after this point would otherwise overwrite a result already decided.
  process.exit(0);
})().catch((e) => {
  console.error('touch-targets: harness error:', e && e.stack || e);
  process.exit(2);
});
