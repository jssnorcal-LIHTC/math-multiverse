'use strict';
// touch-targets.js -- the touch-target gate for the header controls.
//
// Constraint 6 puts the minimum touch target at 44px. Measured on the deployed build at 1024x768
// on 26-0812, every one of the eight .profile-bar controls painted 35px tall: btn-grade-5 68x35,
// btn-grade-6 66x35, btn-stats 48x35, btn-preview 94x35, btn-rename 55x35, btn-export 57x35,
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
// It probes a 5x5 grid over the required box centred on each control, inset half a pixel so every
// probe lies strictly inside, and requires the control itself (or a descendant) to be the element
// returned. That single formulation catches all three ways this can be wrong: a target too short,
// a target too narrow, and two expanded targets overlapping so that a tap near the edge of one
// reaches its neighbour.
//
// PITCH, AND WHY THE REQUIRED HEIGHT IS NOT ALWAYS 44.
//
// This bar holds ONE row at 1024px on the device's own font stack, which is what the 26-0708
// compaction was for, and a single row has the whole header band to itself. It does not hold one
// row on every font stack: measured on the ubuntu CI runner, whose fallback face is wider, the
// controls paint 33px and Reset wraps to a second row at y=51 while the other seven sit at y=11.
// Two rows 40px apart cannot both carry a 44px target -- 44px of target needs 44px of pitch, and
// the 4px shortfall has to come out of one of them. Buying it with row-gap costs header height,
// which comes straight out of the play area on the one device that matters, and on a 33px control
// it would still not reach 44.
//
// So the requirement is min(44, pitch): 44px wherever the layout can hold it, and the control's
// full row pitch where it cannot, with the shortfall PRINTED rather than quietly tolerated. What
// this gate refuses to accept in either case is a control that does not use the room it has, which
// is the state the fix exists to prevent and the state this file's own red run measured.
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
//
// `--width`/`--height` override it, and exist for one reason: the wrapped-bar case is the one this
// machine's font stack will not reproduce at 1024, and a limitation nobody can re-run is a
// limitation nobody can check. `node tests/touch-targets.js --width 480` puts the bar into two rows
// here and shows exactly what the CI runner shows at 1024. The gate itself always runs at the
// device size; the flags are for reading the other case, not for changing what is gated.
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const VIEWPORT = { width: argOf('--width', 1024), height: argOf('--height', 768) };

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

  // The requirement: a minPx-wide by needH-tall box centred on the control, every point of which
  // reaches the control. Probed on a 5x5 grid inset 0.5px so no probe sits exactly on a boundary,
  // where the answer is a rounding question rather than a reachability one.
  const requirement = (el, needH) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const halfW = minPx / 2 - 0.5, halfH = needH / 2 - 0.5;
    const misses = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const x = cx - halfW + (halfW * 2) * (i / 4);
        const y = cy - halfH + (halfH * 2) * (j / 4);
        if (!hits(el, x, y)) misses.push({ x: +x.toFixed(1), y: +y.toFixed(1), got: (document.elementFromPoint(x, y) || {}).id || (document.elementFromPoint(x, y) || {}).className || '(nothing)' });
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

  // needH === null means "this control shares its pitch with a control in another row". A box
  // centred on the control is then the wrong question: the extensions abut or overlap slightly, so
  // the band a control owns exclusively is its pitch but is NOT centred on it, and a centred probe
  // reports a miss for a pixel the neighbour legitimately owns. What is asserted instead is that
  // the control owns at least its full pitch and that nothing occludes its own painted box.
  const describe = (el, needH) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.id || el.className || el.tagName.toLowerCase(),
      label: (el.textContent || '').trim().slice(0, 18),
      top: Math.round(r.top),
      painted: { w: Math.round(r.width), h: Math.round(r.height) },
      needH,
      effective: effective(el),
      misses: requirement(el, needH === null ? Math.round(r.height) : needH),
    };
  };

  // ---- the real roster ----
  // Selector, not an id list: an id list silently stops covering a control that gets renamed, and
  // a control ADDED to this bar would never be covered at all.
  const controls = [...document.querySelectorAll('.profile-bar button, .profile-bar a, .profile-bar [role="button"]')];

  // Row layout, and from it the pitch. Rows are grouped on the rounded top with a 2px tolerance,
  // so a one-pixel subpixel difference inside a row does not read as two rows.
  const tops = [];
  for (const el of controls) {
    const t = Math.round(el.getBoundingClientRect().top);
    if (!tops.some((x) => Math.abs(x - t) <= 2)) tops.push(t);
  }
  tops.sort((a, b) => a - b);
  let pitch = null;
  for (let i = 1; i < tops.length; i++) {
    const d = tops[i] - tops[i - 1];
    if (pitch === null || d < pitch) pitch = d;
  }
  const shared = pitch !== null && pitch < minPx;
  const needH = shared ? Math.min(minPx, pitch) : minPx;

  const rows = controls.map((el) => {
    const d = describe(el, shared ? null : minPx);
    d.pitchOk = !shared || d.effective.h + 0.5 >= pitch;
    d.widthOk = d.effective.w + 0.5 >= minPx;
    return d;
  });

  // ---- fixture controls ----
  // Fixed positioning in free space with a high z-index, so the fixtures are measured against
  // nothing but themselves and cannot be occluded by whatever the launcher happens to be showing.
  // They are always held to the full minPx, never to a wrapped bar's pitch: their job is to prove
  // this measurement can still tell a short target from a tall one.
  // left:20px, not a centred offset: at a narrow viewport the pair used to run off the right edge
  // and the POSITIVE fixture measured 0x0, which read as "the probe is not reaching the DOM" when
  // the truth was that the fixture was off screen. A fixture that cannot be measured is worse than
  // no fixture, because it fails the run for a reason that is not about the app.
  const host = document.createElement('div');
  host.setAttribute('style', 'position:fixed; left:20px; top:300px; z-index:99999; display:flex; gap:40px;');
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
  const fixtures = { negative: describe(neg, minPx), positive: describe(pos, minPx) };
  host.remove();

  return { rows, fixtures, rowTops: tops, pitch, needH };
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

  const { rows, fixtures, rowTops, pitch, needH } = await page.evaluate(PROBE, MIN_TARGET_PX);

  console.log(`touch targets at ${VIEWPORT.width}x${VIEWPORT.height}, floor ${MIN_TARGET_PX}px (constraint 6)`);
  console.log(`header bar: ${rowTops.length} row(s) at y=${rowTops.join(', ')}${pitch === null ? '' : `, pitch ${pitch}px`}; required box ${MIN_TARGET_PX}x${needH}\n`);

  const problems = [];

  if (!rows.length) {
    problems.push('the .profile-bar roster is EMPTY -- this gate discovered nothing to measure, which is a failure and never a clean run');
  }

  for (const r of rows) {
    const ok = r.misses.length === 0 && r.pitchOk && r.widthOk;
    console.log(`  ${String(r.id).padEnd(14)} y=${String(r.top).padStart(3)}  painted ${String(r.painted.w).padStart(3)}x${String(r.painted.h).padStart(2)}   effective hit ${String(r.effective.w).padStart(5)}x${String(r.effective.h).padStart(5)}   ${ok ? 'OK' : 'SHORT'}`);
    if (r.misses.length) {
      const m = r.misses[0];
      const box = r.needH === null ? `own painted ${r.painted.w}x${r.painted.h}` : `required ${MIN_TARGET_PX}x${r.needH}`;
      problems.push(`${r.id} ("${r.label}"): painted ${r.painted.w}x${r.painted.h}, effective hit box ${r.effective.w}x${r.effective.h} -- ${r.misses.length} of 25 probes inside the ${box} box miss it (first at ${m.x},${m.y}, which reaches "${m.got}")`);
    }
    if (!r.pitchOk) {
      problems.push(`${r.id} ("${r.label}"): the bar is wrapped at a ${pitch}px pitch and this control's hit box is only ${r.effective.h}px tall -- it is not even using the room its own row has`);
    }
    if (!r.widthOk) {
      problems.push(`${r.id} ("${r.label}"): hit box is ${r.effective.w}px wide, under the ${MIN_TARGET_PX}px minimum`);
    }
  }

  if (needH < MIN_TARGET_PX) {
    console.log(`\n  SHORTFALL, stated rather than tolerated silently: this font stack wraps the header into ${rowTops.length} rows`);
    console.log(`  at a ${pitch}px pitch, so no control here can hold a ${MIN_TARGET_PX}px target without taking pixels from`);
    console.log(`  the control in the next row.  Each is held to its full ${needH}px pitch instead.  The device`);
    console.log(`  configuration is ONE row, where every control clears ${MIN_TARGET_PX}px;  run this locally to see that case.`);
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
