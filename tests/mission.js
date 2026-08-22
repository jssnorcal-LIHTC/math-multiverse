'use strict';
// mission.js -- the WP5 gate on Today's Mission.
//
//   node tests/mission.js
//
// Driven in a real headless browser against the real shell, calling the SHIPPED buildMission()
// with synthetic save data. buildMission is pure by construction (every input is a parameter,
// nothing is read from a global) precisely so this gate can assert the DISTRIBUTION a mission
// produces rather than the much weaker "a mission was built".
//
// It also gates the generated TOPIC_INDEX block, via build/topic-index-gen.js --check. The block
// is a measurement baked into the shell; if a generator's mix ever shifts, the map silently stops
// describing the app and every mission built from it is wrong in a way nothing else would notice.
//
// HARD RULES (constraint 12). A run whose subject did not load FAILS rather than reporting clean,
// and every claim carries a control:
//   - moving the pointer must SHIFT the topic distribution, and a control proves the shift metric
//     can register zero when the pointer does not move;
//   - a lesson the app cannot serve must produce a mission that SAYS so;
//   - a negative control proves the assembler can report an empty mission at all.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) { console.error('mission: playwright is not installed.'); process.exit(2); }
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

// ---- part 1: the generated TOPIC_INDEX block is not stale ----------------------------------
// Run before the browser work, because every mission below is built from that map.
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'build', 'topic-index-gen.js'), '--check'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  check('the committed TOPIC_INDEX matches a fresh measurement', /matches a fresh measurement/.test(out), out.trim().slice(0, 200));
} catch (e) {
  check('the committed TOPIC_INDEX matches a fresh measurement', false,
    'build/topic-index-gen.js --check failed: ' + String((e.stderr || e.stdout || e.message)).trim().slice(0, 300));
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

  try {
    await page.goto(base + '/Math-Multiverse.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#module-grid .module-card', { timeout: 15000 });
    await page.waitForFunction(() => typeof Curriculum !== 'undefined' && (Curriculum.ready() || Curriculum.error), { timeout: 15000 });

    // ---- ARMING ----
    const armed = await page.evaluate(() => ({
      curriculum: typeof Curriculum !== 'undefined' && Curriculum.ready(),
      lessons: (typeof Curriculum !== 'undefined' && Curriculum.ready()) ? Curriculum.order.length : 0,
      topics: typeof TOPIC_INDEX !== 'undefined' ? Object.keys(TOPIC_INDEX).length : 0,
      hasBuild: typeof buildMission === 'function',
      exact: typeof TOPIC_INDEX !== 'undefined' ? Object.values(TOPIC_INDEX).filter((s) => s.share >= 0.99).length : 0,
      grades: typeof TOPIC_INDEX !== 'undefined' ? [...new Set(Object.values(TOPIC_INDEX).map((s) => s.g))].sort() : [],
    }));
    check('ARMING: the crosswalk loaded', armed.curriculum && armed.lessons > 60, `lessons=${armed.lessons}`);
    check('ARMING: TOPIC_INDEX is populated', armed.topics > 60, `${armed.topics} topics`);
    check('ARMING: buildMission is reachable in the shell', armed.hasBuild);
    check('TOPIC_INDEX spans BOTH grade tracks, which cross-grade queues require',
      armed.grades.join(',') === '5,6', `grades=${armed.grades.join(',')}`);
    check('most TOPIC_INDEX sites are exact, and the rest are marked rather than hidden',
      armed.exact > 20 && armed.exact < armed.topics, `${armed.exact} exact of ${armed.topics}`);
    if (!armed.curriculum || !armed.topics || !armed.hasBuild) throw new Error('arming failed; nothing below would measure anything');

    // A save with a real shape: some topics strong, some weak, wrongs at different ages.
    const SEED_ANALYTICS = {
      'frac-add-like':   { attempted: 40, correct: 38, lastWrongAt: 0 },
      'frac-sub-like':   { attempted: 30, correct: 29, lastWrongAt: 0 },
      'dec-write-word':  { attempted: 20, correct: 6 },
      'pemdas-pattern':  { attempted: 18, correct: 5 },
      'g6-volume':       { attempted: 22, correct: 9 },
      'unit-metric':     { attempted: 25, correct: 10 },
      'frac-equiv':      { attempted: 16, correct: 7 },
      'g6-percent':      { attempted: 14, correct: 6 },
    };

    const missionFor = (lesson, opts) => page.evaluate(({ lesson, seed, opts }) => {
      const perTopic = {};
      const now = Date.now();
      const ages = { 'dec-write-word': 2, 'pemdas-pattern': 1, 'g6-volume': 3, 'unit-metric': 9, 'frac-equiv': 7, 'g6-percent': 20 };
      for (const [t, v] of Object.entries(seed)) {
        perTopic[t] = Object.assign({}, v, {
          lastWrongAt: v.lastWrongAt === 0 ? 0 : now - (ages[t] || 5) * 86400000,
        });
      }
      const m = buildMission(Object.assign({
        lessonRow: lesson ? Curriculum.row(lesson) : null,
        topicIndex: TOPIC_INDEX,
        mathPerTopic: perTopic,
        packPerTopic: {},
        packLevels: [],
        grade: 5,
        now,
        questionsFor: missionQuestionsFor,
      }, opts || {}));
      return {
        counts: m.counts, minutes: m.minutes, empty: m.empty, lesson: m.lesson,
        topics: m.steps.map((s) => s.topic).filter(Boolean),
        sources: m.steps.map((s) => s.source),
        kinds: m.steps.map((s) => s.kind),
        grades: m.steps.map((s) => s.grade),
        unservable: m.unservable, gaps: m.gaps, notes: m.notes,
      };
    }, { lesson, seed: SEED_ANALYTICS, opts: opts || null });

    // ---- the mission assembles from real save data ----
    const m113 = await missionFor('1.1.3');
    check('a mission assembles from real save data', !m113.empty && m113.counts.total > 0, JSON.stringify(m113.counts));
    check('it stays under the twelve-minute cap', m113.minutes <= 12, `${m113.minutes} min`);
    check('it names the lesson it was built for', m113.lesson === '1.1.3', String(m113.lesson));

    // ---- MOVING THE POINTER SHIFTS THE DISTRIBUTION ----
    // Asserted as a SHIFT, not as "a mission built". Jaccard distance between the two topic sets:
    // 0 means the pointer changed nothing at all.
    const m621 = await missionFor('6.2.1');    // Order of Operations: a whole different topic family
    const shift = (a, b) => {
      const A = new Set(a), B = new Set(b);
      const inter = [...A].filter((x) => B.has(x)).length;
      const uni = new Set([...A, ...B]).size;
      return uni ? 1 - inter / uni : 0;
    };
    const d = shift(m113.topics, m621.topics);
    check('moving the pointer demonstrably shifts the topic distribution', d > 0,
      `1.1.3 -> [${m113.topics.join(', ')}]  |  6.2.1 -> [${m621.topics.join(', ')}]  |  distance ${d.toFixed(2)}`);
    const curriculumTopics113 = m113.topics.filter((_, i) => m113.sources[i] === 'curriculum');
    const curriculumTopics621 = m621.topics.filter((_, i) => m621.sources[i] === 'curriculum');
    check('the curriculum half specifically follows the pointer',
      shift(curriculumTopics113, curriculumTopics621) > 0,
      `1.1.3 curriculum [${curriculumTopics113.join(', ')}]  |  6.2.1 curriculum [${curriculumTopics621.join(', ')}]`);

    // CONTROL on the shift metric itself: the same pointer twice must measure ZERO shift. Without
    // this, a metric that returned a positive number for any two inputs would pass the check above.
    const m113b = await missionFor('1.1.3');
    check('CONTROL: the shift metric reads zero when the pointer does not move',
      shift(m113.topics, m113b.topics) === 0,
      `[${m113.topics.join(', ')}] vs [${m113b.topics.join(', ')}]`);

    // ---- 60/40 blend, and interleaving ----
    const blend = await page.evaluate(() => {
      // A lesson with plenty of servable topics, so the blend has room to express itself: 9.1.1
      // carries the whole volume family.
      const perTopic = {};
      const now = Date.now();
      for (const t of ['unit-metric', 'unit-time', 'frac-equiv', 'g6-percent', 'dec-mult', 'coord-quadrant']) {
        perTopic[t] = { attempted: 20, correct: 6, lastWrongAt: now - 2 * 86400000 };
      }
      const m = buildMission({
        lessonRow: Curriculum.row('9.1.1'),
        topicIndex: TOPIC_INDEX, mathPerTopic: perTopic, packPerTopic: {}, packLevels: [],
        grade: 5, now, minutesCap: 60, questionsFor: missionQuestionsFor,
      });
      return { sources: m.steps.map((s) => s.source), counts: m.counts, minutes: m.minutes };
    });
    const cN = blend.counts.curriculum, wN = blend.counts.weakness, tot = blend.counts.total;
    check('the blend runs roughly 60 curriculum to 40 weakness', tot >= 4 && cN > wN && cN / tot >= 0.5 && cN / tot <= 0.75,
      `${cN} curriculum / ${wN} weakness of ${tot} (${Math.round(100 * cN / tot)}% curriculum)`);
    // Interleaved, not blocked: with both sources present, the sequence must change source at
    // least once before either is exhausted.
    const firstW = blend.sources.indexOf('weakness');
    const lastC = blend.sources.lastIndexOf('curriculum');
    check('the two sources interleave rather than blocking', firstW > -1 && lastC > firstW,
      `sequence: ${blend.sources.join(' > ')}`);

    // ---- the twelve-minute cap is a cap ----
    const capped = await page.evaluate(() => {
      const perTopic = {};
      const now = Date.now();
      for (const t of Object.keys(TOPIC_INDEX)) perTopic[t] = { attempted: 20, correct: 3, lastWrongAt: now - 86400000 };
      const m = buildMission({
        lessonRow: Curriculum.row('9.1.1'), topicIndex: TOPIC_INDEX, mathPerTopic: perTopic,
        packPerTopic: {}, packLevels: [], grade: 5, now, questionsFor: missionQuestionsFor,
      });
      return { minutes: m.minutes, total: m.counts.total, candidates: Object.keys(TOPIC_INDEX).length };
    });
    check('with every topic weak, the mission still caps at twelve minutes',
      capped.minutes <= 12 && capped.total < capped.candidates,
      `${capped.total} steps / ${capped.minutes} min out of ${capped.candidates} candidate topics`);

    // ---- CROSS-GRADE ----
    const cross = await page.evaluate(() => {
      const now = Date.now();
      // Grade 6 campaign, lesson 1.1.3, whose only servable topic is Grade 5 pemdas-pattern.
      const m = buildMission({
        lessonRow: Curriculum.row('1.1.3'), topicIndex: TOPIC_INDEX,
        mathPerTopic: { 'pemdas-pattern': { attempted: 12, correct: 3, lastWrongAt: now - 86400000 } },
        packPerTopic: {}, packLevels: [], grade: 6, now, questionsFor: missionQuestionsFor,
      });
      return { steps: m.steps.map((s) => ({ t: s.topic, g: s.grade })), counts: m.counts };
    });
    check('a Grade 6 campaign can queue a Grade 5 topic the lesson needs',
      cross.counts.crossGrade > 0 && cross.steps.some((s) => s.g === 5),
      JSON.stringify(cross.steps));

    // ---- A LESSON THE APP CANNOT SERVE SAYS SO ----
    const unserved = await page.evaluate(() => {
      // A lesson the app cannot serve, CHOSEN FROM THE CROSSWALK rather than named here. This used
      // to hard-code 1.1.4 (histograms and bar graphs) as a confirmed GAP, and the pack then went
      // and served it: the gate failed because the program had made progress, which is the wrong
      // reason for a gate to go red. Picking the first lesson that still declares a gap keeps the
      // check measuring the behaviour instead of a snapshot of the backlog, and the arming
      // assertion below turns "there are no gaps left" into its own honest result.
      const row = (Curriculum.data.lessons || []).find((l) => (l.gaps || []).length);
      if (!row) return { noGapLessonLeft: true };
      const m = buildMission({
        lessonRow: row, topicIndex: TOPIC_INDEX, mathPerTopic: {},
        packPerTopic: {}, packLevels: [], grade: 5, now: Date.now(), questionsFor: missionQuestionsFor,
      });
      // And what the CARD actually says, which is the thing the child reads.
      Save.setCurriculum({ lesson: row.lesson, autoAdvance: false });
      renderMissionCard();
      return {
        lesson: row.lesson,
        empty: m.empty, gaps: m.gaps, unservable: m.unservable, counts: m.counts,
        cardText: (document.getElementById('mission-body') || {}).textContent.replace(/\s+/g, ' '),
      };
    });
    check('ARMING: the crosswalk still has at least one lesson with an open gap to test against',
      !unserved.noGapLessonLeft,
      'every lesson in packs/curriculum-cc1.json is now fully served -- if that is real, this check '
      + 'and the two below it have nothing left to measure and should be retired with the backlog');
    check('a lesson with no servable topic produces an empty mission rather than a generic one',
      unserved.empty && unserved.counts.total === 0, JSON.stringify(unserved.counts));
    check('and it names what it cannot serve rather than going quiet',
      unserved.gaps.length > 0, JSON.stringify(unserved.gaps));
    check('and the CARD says so in words the child can read',
      /cannot serve|Nothing to queue/i.test(unserved.cardText), unserved.cardText.slice(0, 200));

    // ---- a lesson whose topics exist but which also has gaps names BOTH ----
    const partial = await page.evaluate(() => {
      Save.setCurriculum({ lesson: '1.1.3', autoAdvance: false });
      renderMissionCard();
      return (document.getElementById('mission-body') || {}).textContent.replace(/\s+/g, ' ');
    });
    check('a partly-served lesson still names its gaps on the card',
      /Not covered yet/i.test(partial) && /warm-up|this lesson|needs work/i.test(partial), partial.slice(0, 200));

    // ---- NEGATIVE CONTROL: the assembler CAN report an empty mission ----
    const emptyCtl = await page.evaluate(() => {
      const a = buildMission({ lessonRow: null, topicIndex: TOPIC_INDEX, mathPerTopic: {}, packPerTopic: {}, packLevels: [], grade: 5, now: Date.now() });
      const b = buildMission({ lessonRow: Curriculum.row('1.1.3'), topicIndex: {}, mathPerTopic: { 'pemdas-pattern': { attempted: 9, correct: 1, lastWrongAt: Date.now() } }, packPerTopic: {}, packLevels: [], grade: 5, now: Date.now() });
      return { noPointerNoData: { empty: a.empty, total: a.counts.total }, emptyIndex: { empty: b.empty, total: b.counts.total, unservable: b.unservable.length } };
    });
    check('NEGATIVE CONTROL: no pointer and no history produces an EMPTY mission, reported as such',
      emptyCtl.noPointerNoData.empty && emptyCtl.noPointerNoData.total === 0, JSON.stringify(emptyCtl.noPointerNoData));
    check('NEGATIVE CONTROL: an empty TOPIC_INDEX produces an empty mission that names every unservable topic',
      emptyCtl.emptyIndex.empty && emptyCtl.emptyIndex.unservable > 0, JSON.stringify(emptyCtl.emptyIndex));

    // ---- open on a strength, and say so when there is not one ----
    const opener = await page.evaluate(() => {
      const now = Date.now();
      const strong = buildMission({
        lessonRow: Curriculum.row('6.2.1'), topicIndex: TOPIC_INDEX,
        mathPerTopic: {
          'pemdas-simple': { attempted: 20, correct: 19, lastWrongAt: 0 },
          'pemdas-nested': { attempted: 20, correct: 5, lastWrongAt: now - 86400000 },
        },
        packPerTopic: {}, packLevels: [], grade: 5, now, questionsFor: missionQuestionsFor,
      });
      const cold = buildMission({
        lessonRow: Curriculum.row('6.2.1'), topicIndex: TOPIC_INDEX,
        mathPerTopic: { 'pemdas-nested': { attempted: 4, correct: 1, lastWrongAt: now - 86400000 } },
        packPerTopic: {}, packLevels: [], grade: 5, now, questionsFor: missionQuestionsFor,
      });
      return {
        strongFirst: strong.steps[0] ? { topic: strong.steps[0].topic, warmup: !!strong.steps[0].warmup } : null,
        coldFirst: cold.steps[0] ? { topic: cold.steps[0].topic, warmup: !!cold.steps[0].warmup } : null,
        coldNotes: cold.notes,
      };
    });
    check('the mission opens on a topic he is strong at',
      opener.strongFirst && opener.strongFirst.warmup && opener.strongFirst.topic === 'pemdas-simple',
      JSON.stringify(opener.strongFirst));
    check('CONTROL: with no strength on record it opens on the lesson and SAYS so',
      opener.coldFirst && !opener.coldFirst.warmup && opener.coldNotes.some((n) => /warm-up win/.test(n)),
      JSON.stringify(opener));

    // ---- resurfacing at one, three and seven days ----
    const resurface = await page.evaluate(() => {
      const now = Date.now();
      const day = 86400000;
      // Two topics, identical accuracy, differing only in how long ago the last wrong was. One sits
      // exactly on a resurfacing day, the other between them.
      const score = (ageDays) => {
        const m = buildMission({
          lessonRow: null, topicIndex: TOPIC_INDEX,
          mathPerTopic: { 'unit-metric': { attempted: 20, correct: 10, lastWrongAt: now - ageDays * day } },
          packPerTopic: {}, packLevels: [], grade: 5, now, questionsFor: missionQuestionsFor,
        });
        return m.counts.total;
      };
      return {
        onDay: [1, 3, 7].map(score),
        offDay: [2, 5, 10].map(score),
        raw: [1, 2, 3, 5, 7, 10].map((d) => missionWeaknessScore({ attempted: 20, correct: 10, accuracy: 0.5, lastWrongAt: now - d * day }, now)),
      };
    });
    const [s1, s2, s3, s5, s7, s10] = resurface.raw;
    check('a topic missed one day ago outscores one missed two days ago', s1 > s2, `1d=${s1.toFixed(3)} 2d=${s2.toFixed(3)}`);
    check('a topic missed three days ago outscores one missed five days ago', s3 > s5, `3d=${s3.toFixed(3)} 5d=${s5.toFixed(3)}`);
    check('a topic missed seven days ago outscores one missed ten days ago', s7 > s10, `7d=${s7.toFixed(3)} 10d=${s10.toFixed(3)}`);
    check('CONTROL: the resurfacing boost is a real bump, not the decay curve alone',
      s3 > s2, `3d=${s3.toFixed(3)} must beat 2d=${s2.toFixed(3)} despite being older, or nothing is resurfacing`);

    // ---- packs reach the mission, so subjects genuinely interleave ----
    const withPacks = await page.evaluate(() => {
      const now = Date.now();
      const packLevels = [
        { packId: 'ela-g6-spy', title: 'Cold Signal', subject: 'ela', grade: 6, levelIndex: 0, stars: 1, unlocked: true },
        { packId: 'outpost-protocol-g6', title: 'Outpost Protocol', subject: 'sci', grade: 6, levelIndex: 0, stars: 0, unlocked: true },
        { packId: 'firsthand-g6', title: 'Firsthand', subject: 'hist', grade: 6, levelIndex: 2, stars: 3, unlocked: true },  // full stars: must NOT appear
        { packId: 'night-rounds-g6', title: 'Night Rounds', subject: 'ela', grade: 5, levelIndex: 0, stars: 0, unlocked: true }, // wrong grade: must NOT appear
        { packId: 'vault-of-ages-g6', title: 'Vault of Ages', subject: 'ela', grade: 6, levelIndex: 4, stars: 0, unlocked: false }, // locked: must NOT appear
      ];
      const m = buildMission({
        lessonRow: Curriculum.row('9.1.1'), topicIndex: TOPIC_INDEX,
        mathPerTopic: { 'g6-volume': { attempted: 20, correct: 5, lastWrongAt: now - 86400000 } },
        packPerTopic: { 'evidence-x': { attempted: 5, correct: 1 } },
        packLevels, grade: 6, now, minutesCap: 60, questionsFor: missionQuestionsFor,
      });
      return { kinds: m.steps.map((s) => s.kind), packs: m.steps.filter((s) => s.kind === 'pack').map((s) => s.packId), counts: m.counts };
    });
    check('a weak pack level reaches the mission, so subjects interleave',
      withPacks.counts.packs > 0, JSON.stringify(withPacks));
    check('CONTROL: a full-stars, off-grade or locked pack level does NOT reach the mission',
      !withPacks.packs.includes('firsthand-g6') && !withPacks.packs.includes('night-rounds-g6') && !withPacks.packs.includes('vault-of-ages-g6'),
      JSON.stringify(withPacks.packs));

    // ---- an approximate step is marked, never silently passed off as exact ----
    const approx = await page.evaluate(() => {
      const m = buildMission({
        lessonRow: Curriculum.row('1.1.3'), topicIndex: TOPIC_INDEX, mathPerTopic: {},
        packPerTopic: {}, packLevels: [], grade: 5, now: Date.now(), questionsFor: missionQuestionsFor,
      });
      const s = m.steps.find((x) => x.topic === 'pemdas-pattern');
      return { step: s ? { exact: s.exact, share: s.share } : null, notes: m.notes, counts: m.counts };
    });
    check('a topic that is only part of its level is marked approximate, with its measured share',
      approx.step && approx.step.exact === false && approx.step.share > 0 && approx.step.share < 0.5,
      JSON.stringify(approx.step));
    check('and the fallback to that level\'s natural draw is LOGGED, not swallowed',
      approx.notes.some((n) => /natural mix/.test(n)), JSON.stringify(approx.notes));

    // ---- free play is never removed ----
    const freePlay = await page.evaluate(() => {
      Save.setCurriculum({ lesson: '1.1.3', autoAdvance: false });
      renderMissionCard();
      return {
        cards: document.querySelectorAll('#module-grid .module-card').length,
        skippable: /Skip it/i.test((document.getElementById('mission-body') || {}).textContent || ''),
        pageScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      };
    });
    check('free play is still there below the mission', freePlay.cards >= 6, `${freePlay.cards} cards`);
    check('the mission says out loud that it is skippable', freePlay.skippable);
    check('the launcher still does not scroll at 1024x768', !freePlay.pageScrolls);

    // ---- a mission step actually STARTS that level ----
    // Everything above measures what the mission decides. This measures the one thing Niall does
    // with it. Driven by clicking the real button, not by calling startMissionStep directly.
    const started = await page.evaluate(() => {
      localStorage.clear();
      Save.load();
      Save.state.previewMode = true;                    // so a locked level is not what fails this
      Save.state.analytics.perTopic['pemdas-pattern'] = { attempted: 12, correct: 3, lastWrongAt: Date.now() - 86400000 };
      Save.setCurriculum({ lesson: '1.1.3', autoAdvance: false });
      renderMissionCard();
      const before = { screen: [...document.querySelectorAll('.screen.active')].map((e) => e.id)[0], grade: ACTIVE_GRADE };
      const btns = [...document.querySelectorAll('#mission-body button[data-step]')];
      const target = btns[btns.length - 1];             // the last step, so it is not just "the first thing"
      const label = target ? target.textContent.replace(/\s+/g, ' ').trim() : null;
      if (target) target.click();
      return { before, label, buttons: btns.length };
    });
    await page.waitForTimeout(400);
    const landed = await page.evaluate(() => ({
      screen: [...document.querySelectorAll('.screen.active')].map((e) => e.id)[0],
      grade: ACTIVE_GRADE,
      hostTitle: (document.getElementById('host-title') || {}).textContent || '',
      hostHasContent: (document.getElementById('host-frame') || { children: [] }).children.length > 0,
    }));
    check('every mission step renders as a tappable button', started.buttons > 0, `${started.buttons} buttons`);
    check('tapping a mission step starts that level in the real app',
      landed.screen === 'screen-module' && landed.hostHasContent,
      `clicked "${started.label}" -> screen=${landed.screen} host=${landed.hostHasContent} title="${landed.hostTitle}"`);
    check('and the started level is the one the step named',
      started.label && landed.hostTitle && started.label.includes(landed.hostTitle.split(' — ')[0]),
      `step "${started.label}" vs host "${landed.hostTitle}"`);

    check('no JS errors during the run', jsErrors.length === 0, jsErrors[0] || '');
  } catch (e) {
    problems.push('THREW: ' + ((e && e.stack) || e));
  } finally {
    await browser.close();
    server.close();
  }

  if (checks.length < 25) problems.push(`ARMING: only ${checks.length} assertions ran, which is too few to be the real gate`);

  console.log('\n=== Today\'s Mission (WP5) ===');
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
