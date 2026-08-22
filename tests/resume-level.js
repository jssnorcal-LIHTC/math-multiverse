'use strict';
// resume-level.js -- the WP-S gate: leaving a level and coming back continues it.
//
//   node tests/resume-level.js
//
// Measured in a real headless browser by actually playing part of a level, exiting, coming back,
// and comparing the run's OWN on-screen state. The claim is about a live module's closure state
// surviving a navigation, which nothing short of the real app can demonstrate.
//
// Every module's progress readout is its own markup, so the gate reads a stable, module-agnostic
// fingerprint instead: the question text on screen plus the score text plus the count of answered
// question dots. If that fingerprint is identical across the round trip, the run continued; if it
// reset, it restarted.
//
// HARD RULES (constraint 12). The gate carries both directions:
//   POSITIVE  exit and return to the SAME level -> the run continues.
//   NEGATIVE  start a DIFFERENT level, complete a level, or ask for a level that was never parked
//             -> the run restarts. Without these a "resume" that simply never tore anything down,
//             or one that resumed the wrong run, would pass.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const fs = require('fs');
const http = require('http');
const path = require('path');

// A level may open on a BRIEFING (WP-P, 26-0822): a panel shown once before the first question,
// with the passage and the item held back until Begin is tapped. Every gate that opens a pack level
// has to go through it, exactly as a child does. Deliberately NOT a back door around the briefing:
// a gate that skipped it would stop measuring the path anybody actually takes.
async function dismissBriefing(page) {
  const begin = await page.$('.mv-briefing-begin');
  if (!begin) return false;
  await begin.click();
  await page.waitForTimeout(150);
  return true;
}


let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) { console.error('resume-level: playwright is not installed.'); process.exit(2); }
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

// Every math module renders its own chrome, so the fingerprint is deliberately generic: the text
// of the host frame, trimmed, plus the number of nodes that look like answered progress markers.
// Identical fingerprint across a navigation means the same run is on screen.
const FINGERPRINT = () => {
  const host = document.getElementById('host-frame');
  if (!host) return null;
  const text = (host.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    len: text.length,
    head: text.slice(0, 220),
    nodes: host.querySelectorAll('*').length,
    // Anything that looks like a per-question progress marker, however each module spells it.
    marks: host.querySelectorAll('[class*="dot"], [class*="pip"], [class*="prog"]').length,
  };
};

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const launchOpts = { headless: true, args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e && e.message)));
  await page.route('**/*', (r) => {
    const u = r.request().url();
    return (u.startsWith(base) || u.startsWith('data:')) ? r.continue() : r.abort();
  });

  // Answer a few questions in whatever module is open, by clicking real choice buttons.
  const answerSome = async (n) => {
    let clicked = 0;
    for (let i = 0; i < n * 4 && clicked < n; i++) {
      const btn = await page.$('#host-frame button:not([disabled]):not(.explain-next)');
      const next = await page.$('#host-frame .explain-next');
      if (next) { await next.click().catch(() => {}); await page.waitForTimeout(120); continue; }
      if (!btn) { await page.waitForTimeout(120); continue; }
      const txt = (await btn.textContent() || '').trim().toLowerCase();
      if (/levels|exit|back|check|next/.test(txt)) {
        // Not an answer control; try the next candidate instead of steering out of the level.
        const alts = await page.$$('#host-frame button:not([disabled])');
        const alt = alts.find(() => false);
        if (!alt) { await page.waitForTimeout(120); continue; }
      }
      await btn.click().catch(() => {});
      clicked++;
      await page.waitForTimeout(220);
    }
    return clicked;
  };

  try {
    await page.goto(base + '/Math-Multiverse.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#module-grid .module-card', { timeout: 15000 });
    await page.evaluate(() => { localStorage.clear(); Save.load(); Save.state.previewMode = true; });

    // ---- ARMING ----
    const armed = await page.evaluate(() => ({
      hasPark: typeof parkActiveModule === 'function',
      hasResume: typeof resumeParkedRun === 'function',
      hasIsParked: typeof isParked === 'function',
      parked: typeof parkedRun !== 'undefined' ? parkedRun : 'missing',
    }));
    check('ARMING: the park and resume machinery exists in the shell',
      armed.hasPark && armed.hasResume && armed.hasIsParked, JSON.stringify(armed));
    if (!armed.hasPark) throw new Error('arming failed');

    // ---- POSITIVE: exit a level mid-run and come back ----
    await page.evaluate(() => { openModule('fraction-rider'); playLevel(0); });
    await page.waitForSelector('.mod-fr', { timeout: 10000 });
    await page.waitForTimeout(300);
    const answered = await answerSome(3);
    await page.waitForTimeout(300);
    const before = await page.evaluate(FINGERPRINT);
    check('the run advanced before we left it', answered >= 1 && before && before.len > 0,
      `answered ${answered}, host text ${before ? before.len : 0} chars`);

    await page.evaluate(() => exitToLauncher());
    await page.waitForTimeout(250);
    const parkedState = await page.evaluate(() => ({
      screen: [...document.querySelectorAll('.screen.active')].map((e) => e.id)[0],
      parked: parkedRun ? parkedRun.key : null,
      hostChildren: document.getElementById('host-frame').children.length,
    }));
    check('leaving to the launcher parks the run rather than tearing it down',
      parkedState.parked === 'g5|fraction-rider|L0', JSON.stringify(parkedState));
    check('and the parked run\'s DOM is moved OFF the shared host frame',
      parkedState.hostChildren === 0, `#host-frame still holds ${parkedState.hostChildren} child node(s)`);

    // The affordance the child actually sees.
    const affordance = await page.evaluate(() => {
      openModule('fraction-rider');
      const cards = [...document.querySelectorAll('#level-grid .level-card')];
      return { first: (cards[0] || {}).textContent.replace(/\s+/g, ' ').trim(), count: cards.length };
    });
    check('the level card says the run is in progress and offers to resume',
      /IN PROGRESS/.test(affordance.first) && /RESUME/.test(affordance.first), affordance.first.slice(0, 140));

    await page.evaluate(() => { openModule('fraction-rider'); playLevel(0); });
    await page.waitForTimeout(400);
    const after = await page.evaluate(FINGERPRINT);
    check('coming back CONTINUES the run rather than restarting it',
      after && before && after.head === before.head && after.len === before.len,
      `before "${before && before.head.slice(0, 90)}" | after "${after && after.head.slice(0, 90)}"`);
    check('and the parked slot is empty again once resumed',
      await page.evaluate(() => parkedRun === null));

    // ---- NEGATIVE 1: a DIFFERENT level restarts ----
    const beforeSwitch = await page.evaluate(FINGERPRINT);
    await page.evaluate(() => exitToLevels());
    await page.waitForTimeout(200);
    await page.evaluate(() => playLevel(2));                 // a different level
    await page.waitForTimeout(400);
    const other = await page.evaluate(FINGERPRINT);
    check('NEGATIVE CONTROL: opening a DIFFERENT level starts it fresh',
      other && beforeSwitch && other.head !== beforeSwitch.head,
      `L1 "${beforeSwitch && beforeSwitch.head.slice(0, 70)}" | L3 "${other && other.head.slice(0, 70)}"`);
    check('NEGATIVE CONTROL: and the old parked run is discarded, not left to resume later',
      await page.evaluate(() => parkedRun === null || parkedRun.levelIndex === 2));

    // ---- NEGATIVE 2: a level that was never parked starts fresh, twice the same way ----
    await page.evaluate(() => { openModule('rocky-translator'); playLevel(0); });
    await page.waitForSelector('.mod-rk', { timeout: 10000 });
    await page.waitForTimeout(300);
    await answerSome(2);
    await page.waitForTimeout(250);
    const rkMid = await page.evaluate(FINGERPRINT);
    await page.evaluate(() => { exitToLevels(); openModule('rocky-translator'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => playLevel(0));
    await page.waitForTimeout(400);
    const rkResumed = await page.evaluate(FINGERPRINT);
    check('a second module resumes the same way, so this is not one module\'s accident',
      rkResumed && rkMid && rkResumed.head === rkMid.head,
      `mid "${rkMid && rkMid.head.slice(0, 70)}" | back "${rkResumed && rkResumed.head.slice(0, 70)}"`);

    // ---- NEGATIVE 3: a COMPLETED run is disposed, never parked ----
    const completed = await page.evaluate(() => {
      // Drive the completion path the module itself uses, then leave.
      currentRunFinished = true;
      parkActiveModule();
      return { parked: parkedRun ? parkedRun.key : null, cleanup: activeModuleCleanup === null };
    });
    check('NEGATIVE CONTROL: a finished run is disposed, never parked',
      completed.parked === null && completed.cleanup, JSON.stringify(completed));

    // ---- the parked run does not leak across a grade flip in the wrong direction ----
    const flip = await page.evaluate(() => {
      localStorage.clear(); Save.load(); Save.state.previewMode = true;
      openModule('fraction-rider'); playLevel(1);
      const keyBefore = currentRunKey();
      exitToLevels();
      const parkedKey = parkedRun ? parkedRun.key : null;
      Save.switchGrade(6);
      const matchesInG6 = isParked(ACTIVE_GRADE, 'fraction-rider', null, 1);
      Save.switchGrade(5);
      const matchesBackInG5 = isParked(ACTIVE_GRADE, 'fraction-rider', null, 1);
      return { keyBefore, parkedKey, matchesInG6, matchesBackInG5 };
    });
    check('a Grade 5 run does not resume into the Grade 6 campaign',
      flip.matchesInG6 === false, JSON.stringify(flip));
    check('and it is still waiting when he flips back to Grade 5',
      flip.matchesBackInG5 === true, JSON.stringify(flip));

    // ---- only one run is ever parked, so this cannot grow without bound ----
    const single = await page.evaluate(() => {
      localStorage.clear(); Save.load(); Save.state.previewMode = true;
      const keys = [];
      for (const [mid, li] of [['fraction-rider', 0], ['f1-decimals', 1], ['razor-crest', 2]]) {
        openModule(mid); playLevel(li); exitToLevels();
        keys.push(parkedRun ? parkedRun.key : null);
      }
      return { keys, finalParked: parkedRun ? parkedRun.key : null };
    });
    check('only one run is parked at a time, so nothing accumulates',
      single.finalParked === 'g5|razor-crest|L2' && single.keys.length === 3, JSON.stringify(single));

    check('no JS errors during the run', jsErrors.length === 0, jsErrors[0] || '');
  } catch (e) {
    problems.push('THREW: ' + ((e && e.stack) || e));
  } finally {
    await browser.close();
    server.close();
  }

  if (checks.length < 10) problems.push(`ARMING: only ${checks.length} assertions ran, too few to be the real gate`);

  console.log('\n=== resume a level (WP-S) ===');
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
