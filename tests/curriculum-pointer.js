'use strict';
// curriculum-pointer.js -- the WP4 gate on the lesson pointer.
//
//   node tests/curriculum-pointer.js
//
// Everything here is measured in a real headless browser against the real shell, because the
// three claims WP4 makes are all about persistence across a boundary a unit test cannot cross:
// a grade flip changes which localStorage key Save reads, a reload re-runs boot from scratch,
// and "an older save loads with nothing lost" is a statement about reconcile() running on real
// stored bytes. Asserting any of those against a re-implementation would prove nothing.
//
// HARD RULE (constraint 12): every claim carries its own negative control, and a run that
// asserts nothing FAILS rather than reporting clean.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const fs = require('fs');
const http = require('http');
const path = require('path');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) { console.error('curriculum-pointer: playwright is not installed.'); process.exit(2); }
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

  const boot = async () => {
    await page.goto(base + '/Math-Multiverse.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#module-grid .module-card', { timeout: 15000 });
    await page.waitForFunction(() => typeof Curriculum !== 'undefined' && (Curriculum.ready() || Curriculum.error), { timeout: 15000 });
  };

  try {
    await boot();

    // ---- ARMING. A gate whose subject did not load must fail, not pass quietly. ----
    const armed = await page.evaluate(() => ({
      ready: Curriculum.ready(),
      error: Curriculum.error,
      lessons: Curriculum.ready() ? Curriculum.order.length : 0,
      hasCard: !!document.getElementById('mission-card'),
      hasSelect: !!document.getElementById('mission-lesson-select'),
    }));
    check('ARMING: the crosswalk loaded in the real page', armed.ready && armed.lessons > 60,
      `ready=${armed.ready} lessons=${armed.lessons} error=${armed.error || '-'}`);
    check('ARMING: the mission card and its lesson control rendered', armed.hasCard && armed.hasSelect,
      `card=${armed.hasCard} select=${armed.hasSelect}`);
    if (!armed.ready) throw new Error('crosswalk did not load; nothing below would be measuring anything');

    // ---- the control is on the mission card, NOT in the header bar ----
    const where = await page.evaluate(() => ({
      inCard: !!document.querySelector('#mission-card #mission-lesson-select'),
      inHeader: !!document.querySelector('.shell-header #mission-lesson-select')
             || !!document.querySelector('.shell-header select'),
      headerH: Math.round(document.querySelector('.shell-header').getBoundingClientRect().height),
    }));
    check('the lesson control lives on the mission card', where.inCard, 'not found inside #mission-card');
    check('the lesson control is NOT in the header bar', !where.inHeader,
      'a control in the header spends reward-geometry margin the v4 roadmap measured as absent');

    // ---- setting the pointer ----
    const set = await page.evaluate(() => {
      Save.setCurriculum({ lesson: '1.1.3', autoAdvance: false });
      renderMissionCard();
      return {
        state: JSON.parse(JSON.stringify(Save.state.curriculum)),
        shared: localStorage.getItem('mathMultiverse.curriculum.v1'),
        effective: Save.effectiveLesson(),
        note: (document.getElementById('mission-pointer-note') || {}).textContent || '',
      };
    });
    check('setting the pointer stores it in Save.state.curriculum', set.state.lesson === '1.1.3', JSON.stringify(set.state));
    check('setting the pointer writes the shared cross-grade key', !!set.shared && JSON.parse(set.shared).lesson === '1.1.3', String(set.shared));
    check('the card names the lesson it is on', /1\.1\.3/.test(set.note) && /Describing and Extending Patterns/.test(set.note), set.note.slice(0, 160));

    // ---- SURVIVES A GRADE FLIP (measured, not assumed) ----
    const flip = await page.evaluate(() => {
      const seen = [];
      for (const g of [6, 5, 6]) {
        Save.switchGrade(g);          // this re-runs Save.load() against the OTHER localStorage key
        seen.push({ grade: ACTIVE_GRADE, key: Save.key(), lesson: Save.state.curriculum.lesson });
      }
      return seen;
    });
    const flipOk = flip.every((s) => s.lesson === '1.1.3') && new Set(flip.map((s) => s.key)).size === 2;
    check('the pointer survives a grade flip, both directions', flipOk, JSON.stringify(flip));

    // ---- SURVIVES A RELOAD ----
    await boot();
    const afterReload = await page.evaluate(() => ({
      lesson: Save.state.curriculum.lesson,
      grade: ACTIVE_GRADE,
      selectValue: (document.getElementById('mission-lesson-select') || {}).value,
    }));
    check('the pointer survives a page reload', afterReload.lesson === '1.1.3', JSON.stringify(afterReload));
    check('the reloaded control shows the stored lesson', afterReload.selectValue === '1.1.3', String(afterReload.selectValue));

    // ---- the pointer is stored TWICE on purpose, and that is worth asserting ----
    // setCurriculum writes the shared cross-grade key AND saveNow() writes state.curriculum into
    // whichever per-grade save is active, so an export carries it and a browser that refuses the
    // shared key (Safari with Block All Cookies) still keeps the pointer within one grade. Losing
    // the shared key alone therefore recovers from the save rather than resetting -- measured here
    // because an earlier version of this gate assumed the opposite and was wrong.
    await page.evaluate(() => { localStorage.removeItem('mathMultiverse.curriculum.v1'); });
    await boot();
    const sharedGone = await page.evaluate(() => ({
      lesson: Save.state.curriculum.lesson,
      shared: localStorage.getItem('mathMultiverse.curriculum.v1'),
    }));
    check('losing the shared key alone recovers the pointer from the per-grade save',
      sharedGone.lesson === '1.1.3', JSON.stringify(sharedGone));

    // ---- NEGATIVE CONTROL for every persistence assertion above ----
    // If the pointer were a hard-coded constant, or these assertions were reading a default rather
    // than storage, wiping storage entirely would change nothing. It must come back unset.
    await page.evaluate(() => { localStorage.clear(); });
    await boot();
    const cleared = await page.evaluate(() => ({
      lesson: Save.state.curriculum.lesson,
      note: (document.getElementById('mission-pointer-note') || {}).textContent || '',
      selectValue: (document.getElementById('mission-lesson-select') || {}).value,
    }));
    check('NEGATIVE CONTROL: wiping storage leaves the pointer unset',
      cleared.lesson === null, `lesson=${JSON.stringify(cleared.lesson)} -- if this still reads 1.1.3, `
      + 'the pointer is a constant and every persistence result above is void');
    check('NEGATIVE CONTROL: with no pointer the card says so rather than guessing a lesson',
      /Set the lesson/i.test(cleared.note), cleared.note.slice(0, 160));
    check('NEGATIVE CONTROL: with no pointer the control shows "Not set yet"',
      cleared.selectValue === '', `value=${JSON.stringify(cleared.selectValue)}`);

    // ---- WEEKDAY AUTO-ADVANCE, and its clamp ----
    const adv = await page.evaluate(() => {
      const order = Curriculum.order;
      // A fixed Monday so the arithmetic below is not a function of the day this gate runs.
      const monday = new Date(2026, 7, 17, 9, 0, 0).getTime();   // Mon 17 Aug 2026
      const day = 24 * 60 * 60 * 1000;
      const out = {};
      Save.setCurriculum({ lesson: order[0], autoAdvance: true });
      Save.state.curriculum.setAt = monday;
      out.sameDay = Save.effectiveLesson(monday);
      out.plus1 = Save.effectiveLesson(monday + 1 * day);          // Tue -> 1 weekday
      out.plus4 = Save.effectiveLesson(monday + 4 * day);          // Fri -> 4 weekdays
      out.plus5 = Save.effectiveLesson(monday + 5 * day);          // Sat -> still 4
      out.plus6 = Save.effectiveLesson(monday + 6 * day);          // Sun -> still 4
      out.plus7 = Save.effectiveLesson(monday + 7 * day);          // next Mon -> 5
      out.plus9999 = Save.effectiveLesson(monday + 9999 * day);    // clamp
      out.weekendCount = [out.plus4, out.plus5, out.plus6].map((l) => order.indexOf(l));
      // autoAdvance off: the stored lesson, unmoved, however long it has been.
      Save.setCurriculum({ lesson: order[0], autoAdvance: false });
      Save.state.curriculum.setAt = monday;
      out.frozen = Save.effectiveLesson(monday + 9999 * day);
      // A manual set always wins: it re-stamps setAt, so the advance restarts from today.
      Save.setCurriculum({ lesson: order[10], autoAdvance: true });
      out.manual = Save.effectiveLesson();
      out.order0 = order[0]; out.order1 = order[1]; out.order4 = order[4];
      out.order5 = order[5]; out.order10 = order[10]; out.last = order[order.length - 1];
      return out;
    });
    check('same day: no advance', adv.sameDay === adv.order0, `${adv.sameDay} vs ${adv.order0}`);
    check('one weekday later: one lesson on', adv.plus1 === adv.order1, `${adv.plus1} vs ${adv.order1}`);
    check('four weekdays later: four lessons on', adv.plus4 === adv.order4, `${adv.plus4} vs ${adv.order4}`);
    check('the weekend does not advance the lesson', adv.plus4 === adv.plus5 && adv.plus5 === adv.plus6,
      `Fri=${adv.plus4} Sat=${adv.plus5} Sun=${adv.plus6}`);
    check('the following Monday advances again', adv.plus7 === adv.order5, `${adv.plus7} vs ${adv.order5}`);
    check('the advance clamps to the last lesson of the book', adv.plus9999 === adv.last, `${adv.plus9999} vs ${adv.last}`);
    check('NEGATIVE CONTROL: with autoAdvance off the lesson never moves', adv.frozen === adv.order0,
      `${adv.frozen} vs ${adv.order0} -- if this drifted, the advance is not gated on the flag at all`);
    check('a manual set wins over the auto-advance', adv.manual === adv.order10, `${adv.manual} vs ${adv.order10}`);

    // ---- AN OLDER SAVE LOADS WITH NOTHING LOST ----
    // A real pre-WP4 save: real progress, real analytics, and no `curriculum` key at all.
    const legacy = await page.evaluate(() => {
      localStorage.clear();
      const old = {
        version: 1,
        profile: { name: 'Niall' },
        stats: { totalCorrect: 412, totalAnswered: 500, sessionCount: 31 },
        modules: {
          'fraction-rider': { unlocked: true, levelsCleared: 4, levelStars: [3, 3, 2, 3, 0, 0], levelBest: [100, 95, 70, 90, null, null] },
          'f1-decimals': { unlocked: true, levelsCleared: 2, levelStars: [3, 1, 0, 0, 0, 0], levelBest: [100, 55, null, null, null, null] },
        },
        grandGoals: { 'fraction-rider': { unlockedAt: 1750000000000 } },
        previewMode: false,
        created: 1740000000000,
        analytics: {
          totalSessions: 31, totalAttempted: 500, totalCorrect: 412, totalTimeMs: 987654,
          perModule: { 'fraction-rider': { attempted: 300, correct: 260, timeMs: 600000 } },
          perTopic: { 'frac-add-unlike': { attempted: 40, correct: 21, lastWrongAt: 1755000000000, recentWrongs: [1755000000000] } },
          recentMistakes: [{ topic: 'frac-add-unlike', qText: 'x', picked: 1, correct: 0, ts: 1755000000000, moduleId: 'fraction-rider' }],
          coachShown: { 'frac-add-unlike': 1755000000000 },
        },
      };
      localStorage.setItem('mathMultiverse.save.v1', JSON.stringify(old));
      return old;
    });
    await boot();
    const loaded = await page.evaluate(() => ({
      name: Save.state.profile.name,
      cleared: Save.state.modules['fraction-rider'].levelsCleared,
      stars: Save.state.modules['fraction-rider'].levelStars.join(','),
      best: JSON.stringify(Save.state.modules['f1-decimals'].levelBest),
      grand: !!Save.state.grandGoals['fraction-rider'],
      created: Save.state.created,
      attempted: Save.state.analytics.totalAttempted,
      perTopic: JSON.stringify(Save.state.analytics.perTopic['frac-add-unlike']),
      mistakes: (Save.state.analytics.recentMistakes || []).length,
      curriculum: JSON.parse(JSON.stringify(Save.state.curriculum)),
    }));
    const lost = [];
    if (loaded.name !== 'Niall') lost.push('profile.name');
    if (loaded.cleared !== 4) lost.push('levelsCleared');
    if (loaded.stars !== '3,3,2,3,0,0') lost.push('levelStars');
    if (loaded.best !== JSON.stringify([100, 55, null, null, null, null])) lost.push('levelBest');
    if (!loaded.grand) lost.push('grandGoals');
    if (loaded.created !== 1740000000000) lost.push('created');
    if (loaded.attempted !== 500) lost.push('analytics.totalAttempted');
    if (loaded.perTopic !== JSON.stringify(legacy.analytics.perTopic['frac-add-unlike'])) lost.push('analytics.perTopic');
    if (loaded.mistakes !== 1) lost.push('analytics.recentMistakes');
    check('a pre-WP4 save with no curriculum key loads with nothing lost', lost.length === 0,
      lost.length ? 'lost: ' + lost.join(', ') : '');
    check('that older save gains a well-formed, unset curriculum block',
      loaded.curriculum && loaded.curriculum.book === 'cc1' && loaded.curriculum.lesson === null,
      JSON.stringify(loaded.curriculum));

    // ---- NEGATIVE CONTROL on the loss check: it must be able to SEE a loss ----
    const canSeeLoss = await page.evaluate(() => {
      const before = Save.state.modules['fraction-rider'].levelStars.join(',');
      const damaged = Save.reconcile({ version: 1, modules: {} });   // a save that really has lost it
      return { before, after: damaged.modules['fraction-rider'].levelStars.join(',') };
    });
    check('NEGATIVE CONTROL: the loss check can see a real loss',
      canSeeLoss.before === '3,3,2,3,0,0' && canSeeLoss.after === '0,0,0,0,0,0',
      JSON.stringify(canSeeLoss));

    // ---- a malformed stored pointer must not poison the default ----
    const junk = await page.evaluate(() => {
      const out = {};
      localStorage.setItem('mathMultiverse.curriculum.v1', '{not json');
      Save.load(); out.badJson = JSON.parse(JSON.stringify(Save.state.curriculum));
      localStorage.setItem('mathMultiverse.curriculum.v1', JSON.stringify({ lesson: 'chapter one', setAt: 'yesterday', autoAdvance: 'yes' }));
      Save.load(); out.badFields = JSON.parse(JSON.stringify(Save.state.curriculum));
      localStorage.setItem('mathMultiverse.curriculum.v1', JSON.stringify({ lesson: '9.9.9', autoAdvance: true, setAt: Date.now() }));
      Save.load(); out.unknownLesson = { stored: Save.state.curriculum.lesson, effective: Save.effectiveLesson() };
      return out;
    });
    check('unparseable stored pointer falls back to the default block',
      junk.badJson.book === 'cc1' && junk.badJson.lesson === null, JSON.stringify(junk.badJson));
    check('malformed fields in a stored pointer are each rejected',
      junk.badFields.lesson === null && junk.badFields.setAt === null && junk.badFields.autoAdvance === true,
      JSON.stringify(junk.badFields));
    check('a lesson this book does not have is echoed back, never advanced into a guess',
      junk.unknownLesson.stored === '9.9.9' && junk.unknownLesson.effective === '9.9.9',
      JSON.stringify(junk.unknownLesson));

    // ---- the launcher still fits, and free play is untouched ----
    await page.evaluate(() => { localStorage.clear(); });
    await boot();
    const geo = await page.evaluate(() => ({
      cards: document.querySelectorAll('#module-grid .module-card').length,
      pageScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      bodyScrollW: document.body.scrollWidth,
      cardH: Math.round(document.getElementById('mission-card').getBoundingClientRect().height),
      minTouch: Math.min(...[...document.querySelectorAll('#mission-card select, #mission-card button, #mission-card label.mission-auto')]
        .map((e) => Math.round(e.getBoundingClientRect().height))),
    }));
    check('free play is still there below the mission card', geo.cards === 6, `${geo.cards} module cards`);
    check('the page still does not scroll at 1024x768', !geo.pageScrolls, `scrollHeight vs clientHeight`);
    check('the page still does not scroll horizontally', geo.bodyScrollW <= 1024, `bodyScrollW=${geo.bodyScrollW}`);
    check('every mission-card control clears the 44px touch floor', geo.minTouch >= 44, `smallest=${geo.minTouch}px`);

    if (jsErrors.length) check('no JS errors during the run', false, jsErrors[0]);
    else check('no JS errors during the run', true);
  } catch (e) {
    problems.push('THREW: ' + (e && e.stack || e));
  } finally {
    await browser.close();
    server.close();
  }

  // A gate that asserted nothing must never report clean.
  if (checks.length < 20) problems.push(`ARMING: only ${checks.length} assertions ran, which is too few to be the real gate`);

  console.log('\n=== curriculum pointer (WP4) ===');
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
