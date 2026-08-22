'use strict';
// validate-curriculum.js -- the gate on packs/curriculum-cc1.json, the CPM Core Connections
// Course 1 crosswalk.
//
//   node tests/validate-curriculum.js [N_per_driver]     (default 700)
//
// WHAT IT CHECKS
//   1. Every `targets[]` id exists in tests/targets.js AND belongs to subject 'math'. An invented
//      id is a hard failure, exactly as it is for a pack.
//   2. Every `moduleTopics[]` id appears in the EMITTED topic set -- the set produced by running
//      the six modules' real dispatch, never a static scan of TOPIC_LABELS. That distinction is
//      the whole point: the shell labels 107 topics and emits 83, so a crosswalk validated
//      against the labels would count 24 topics as coverage that no child can ever be served.
//   3. Every lesson with no module topic and no pack item appears in `gaps[]`. A row that serves
//      nothing and declares no gap reads as covered while covering nothing.
//   4. Every lesson id and problem list matches build/cc1-lesson-index.json, so a row cannot cite
//      a lesson the book does not have.
//   5. The gap count PRINTS. It is the program's own progress meter and it must be visible on
//      every run rather than inferred from a silent pass.
//   6. The dangling-label census: a topic in the GRANULAR half of TOPIC_LABELS that carries a
//      COACH_TIPS entry and is emitted by nothing reads as shipped to anyone who greps the shell.
//      Any such topic that is not in KNOWN_ORPHANS below fails the gate.
//
//      The granular/coarse boundary is the shell's own, not this gate's opinion: TOPIC_LABELS is
//      authored in two halves separated by the comment "Coarse fallback labels (level-gen IDs used
//      when a generator hasn't been tagged with a granular topic yet)". Above it, an entry claims
//      a topic the game teaches; below it, an entry is machinery that catches an untagged question
//      by its LEVEL id, which by design no generator emits as a topic. Sweeping both halves would
//      flag 16 deliberate fallbacks as defects, so the census reads only the half that makes a
//      coverage claim. If that boundary comment ever disappears the gate fails rather than
//      quietly widening or narrowing its own scope.
//
// HARD RULES (constraint 12). A run that discovers zero lessons, zero emitted topics or zero
// labelled topics FAILS rather than reporting clean. Three negative controls -- a fabricated
// lesson id, a fabricated target id and a labelled-but-unemitted topic -- must each be caught,
// and a positive control (the real crosswalk, untouched) must pass. If any control misbehaves the
// gate is void and says so.

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8'); // Windows cp1252 guard

const fs = require('fs');
const path = require('path');
const { TARGETS } = require('./targets');
const { loadModules, buildDrivers, HTML_PATH } = require('./extract');

const ROOT = path.join(__dirname, '..');
const CROSSWALK_PATH = path.join(ROOT, 'packs', 'curriculum-cc1.json');
const INDEX_PATH = path.join(ROOT, 'build', 'cc1-lesson-index.json');

const N = parseInt(process.argv[2] || process.env.CURRICULUM_N || '700', 10);
if (!Number.isInteger(N) || N < 50) { console.error('bad N (minimum 50)'); process.exit(2); }

// Topics that carry a label and a coach tip and are emitted by nothing. Each one reads as shipped
// to anyone grepping TOPIC_LABELS, and each is a decision for Justin rather than a defect the gate
// may fix on its own: deleting a label is a shell edit and permitted, but giving one a producer
// would edit a math IIFE, which constraint 2 forbids outright. Listing them here keeps them
// visible on every run and makes any NEW one a hard failure.
// `coord-shape` and `coord-real-world` were the two the 26-0819 plan named, and WP1 deleted them
// outright from both tables. `coord-translate` is a third the emitted-topic sweep turned up on
// 26-0822: same condition, not in that decision, so it is listed rather than deleted.
const KNOWN_ORPHANS = {
  'coord-translate': 'Labelled and coach-tipped since the grade-5 build; no Razor Crest level '
              + 'dispatches a translate question in either grade, in either grade\'s RC_LEVELS. '
              + 'Found by the emitted-topic sweep 26-0822. Deleting a label is a shell edit and '
              + 'permitted; giving it a producer would edit a math IIFE, which constraint 2 '
              + 'forbids. Justin\'s call, not the gate\'s.',
};

// ---------------------------------------------------------------------------
// The emitted topic set, measured.
// ---------------------------------------------------------------------------
// Sampled in two independent halves so the run can prove it sampled ENOUGH: if the second half
// turns up a topic the first half missed, the sample was too small and the "not emitted" verdict
// on every other topic is unsafe. That is a real saturation check rather than a guess at N.
function deriveEmittedTopics(nPerDriver) {
  const drivers = buildDrivers(loadModules());
  if (!drivers.length) throw new Error('validate-curriculum: zero drivers -- extraction is broken');
  const half = Math.max(25, Math.floor(nPerDriver / 2));
  const first = new Set();
  const second = new Set();
  let draws = 0;
  for (const d of drivers) {
    for (let i = 0; i < half * 2; i++) {
      let q;
      try { q = d.make(); } catch (e) { continue; }
      draws++;
      if (q && typeof q.topic === 'string' && q.topic) (i < half ? first : second).add(q.topic);
    }
  }
  const all = new Set([...first, ...second]);
  const lateArrivals = [...second].filter((t) => !first.has(t)).sort();
  return { emitted: all, drivers: drivers.length, draws, lateArrivals };
}

// ---------------------------------------------------------------------------
// The shell's declared tables, parsed. Parsing is checked, not trusted: a parse that finds too
// little would make every topic look unlabelled and every orphan look absent.
// ---------------------------------------------------------------------------
function readShellTables() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const block = (name) => {
    const i = html.indexOf(`const ${name} = {`);
    if (i < 0) return null;
    const end = html.indexOf('\n};', i);
    return end < 0 ? null : html.slice(i, end);
  };
  const keysOf = (src) => new Set([...src.matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]));
  const labelsSrc = block('TOPIC_LABELS');
  const tipsSrc = block('COACH_TIPS');
  const famSrc = block('COACH_FAMILY_FALLBACK');
  if (!labelsSrc || !tipsSrc || !famSrc) {
    throw new Error('validate-curriculum: TOPIC_LABELS, COACH_TIPS or COACH_FAMILY_FALLBACK could '
      + 'not be located in the shell, so nothing below would be measuring anything');
  }
  const labelled = keysOf(labelsSrc);
  const tipped = keysOf(tipsSrc);
  const fallbackTargets = new Set([...famSrc.matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((m) => m[2]));
  if (labelled.size < 60) throw new Error(`validate-curriculum: only ${labelled.size} TOPIC_LABELS keys parsed, which is too few to be a real read`);
  if (tipped.size < 40) throw new Error(`validate-curriculum: only ${tipped.size} COACH_TIPS keys parsed, which is too few to be a real read`);
  if (!fallbackTargets.size) throw new Error('validate-curriculum: COACH_FAMILY_FALLBACK parsed to zero entries');

  // The shell's own granular/coarse boundary. See the header note on check 6.
  const COARSE_MARK = '// Coarse fallback labels';
  const cut = labelsSrc.indexOf(COARSE_MARK);
  if (cut < 0) {
    throw new Error('validate-curriculum: the "' + COARSE_MARK + '" boundary comment is gone from '
      + 'TOPIC_LABELS, so the dangling-label census cannot tell a coverage claim from a level-id '
      + 'fallback. Restore the comment or teach this gate the new boundary; it will not guess.');
  }
  const granular = keysOf(labelsSrc.slice(0, cut));
  const coarse = keysOf(labelsSrc.slice(cut));
  if (granular.size < 50) throw new Error(`validate-curriculum: only ${granular.size} granular TOPIC_LABELS keys parsed above the boundary, which is too few to be a real read`);
  if (coarse.size < 10) throw new Error(`validate-curriculum: only ${coarse.size} coarse TOPIC_LABELS keys parsed below the boundary, which is too few to be a real read`);
  return { labelled, granular, coarse, tipped, fallbackTargets };
}

// ---------------------------------------------------------------------------
// The checks, as one pure function so the fixtures run the SHIPPED logic rather than a copy of it.
// ---------------------------------------------------------------------------
function validate(cw, ctx) {
  const errors = [];
  const { emitted, labelled, index } = ctx;

  if (!cw || !Array.isArray(cw.lessons) || !cw.lessons.length) {
    errors.push('crosswalk has no lessons[] at all');
    return errors;
  }

  const seen = new Set();
  for (const row of cw.lessons) {
    const at = `lesson ${row.lesson}`;

    // 4. the lesson has to be a real lesson, with the book's own problem list
    if (!/^\d\.\d\.\d$/.test(String(row.lesson))) {
      errors.push(`${at}: not a lesson id`);
      continue;
    }
    if (seen.has(row.lesson)) errors.push(`${at}: appears twice in lessons[]`);
    seen.add(row.lesson);
    const idxProblems = index.lessons[row.lesson];
    if (!idxProblems) {
      errors.push(`${at}: no such lesson in build/cc1-lesson-index.json -- CC1 does not have it`);
      continue;
    }
    if (JSON.stringify(row.problems) !== JSON.stringify(idxProblems)) {
      errors.push(`${at}: problems ${JSON.stringify(row.problems)} do not match the index ${JSON.stringify(idxProblems)}`);
    }

    // 1. targets must be real, and must be math
    for (const t of row.targets || []) {
      if (!Object.prototype.hasOwnProperty.call(TARGETS, t)) {
        errors.push(`${at}: targets cites "${t}", which is not in the frozen vocabulary`);
      } else if (TARGETS[t].subject !== 'math') {
        errors.push(`${at}: targets cites "${t}", which belongs to subject "${TARGETS[t].subject || 'ela'}"`);
      }
    }
    for (const t of row.packItemTargets || []) {
      if (!Object.prototype.hasOwnProperty.call(TARGETS, t)) {
        errors.push(`${at}: packItemTargets cites "${t}", which is not in the frozen vocabulary`);
      } else if (TARGETS[t].subject !== 'math') {
        errors.push(`${at}: packItemTargets cites "${t}", which belongs to subject "${TARGETS[t].subject || 'ela'}"`);
      }
    }

    // ccss must be exactly what the cited targets carry, so the two can never drift apart
    const wantCcss = [...new Set((row.targets || []).flatMap((t) => (TARGETS[t] && TARGETS[t].ccss) || []))];
    const gotCcss = [...(row.ccss || [])];
    if (wantCcss.sort().join('|') !== gotCcss.sort().join('|')) {
      errors.push(`${at}: ccss ${JSON.stringify(row.ccss)} does not match what its targets carry ${JSON.stringify(wantCcss)}`);
    }

    // 2. module topics must be EMITTED, not merely labelled
    for (const topic of row.moduleTopics || []) {
      if (emitted.has(topic)) continue;
      errors.push(labelled.has(topic)
        ? `${at}: moduleTopics cites "${topic}", which carries a TOPIC_LABELS entry but is emitted `
          + 'by no generator in either grade -- it is a dangling label, not coverage'
        : `${at}: moduleTopics cites "${topic}", which no generator emits and the shell does not `
          + 'even label');
    }

    // 3. a row that serves nothing must say so
    const serves = (row.moduleTopics || []).length + (row.packItemTargets || []).length;
    if (!serves && !(row.gaps || []).length) {
      errors.push(`${at}: serves no module topic and no pack item, and declares no gap -- it reads `
        + 'as covered while covering nothing');
    }
    if (!Array.isArray(row.gaps)) errors.push(`${at}: gaps must be an array`);

    const TIERS = ['verified', 'inherited-plausible', 'inferred'];
    if (!TIERS.includes(row.confidence)) {
      errors.push(`${at}: confidence "${row.confidence}" is not one of ${TIERS.join(' / ')}`);
    }
  }

  // Every lesson the book has must appear. A crosswalk that quietly drops chapter 9 would show a
  // flatteringly small gap count.
  for (const lesson of Object.keys(index.lessons)) {
    if (!seen.has(lesson)) errors.push(`lesson ${lesson} is in the book's index but missing from the crosswalk`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------
const problems = [];
const notes = [];

const crosswalk = JSON.parse(fs.readFileSync(CROSSWALK_PATH, 'utf8'));
const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const { labelled, granular, coarse, tipped, fallbackTargets } = readShellTables();
const { emitted, drivers, draws, lateArrivals } = deriveEmittedTopics(N);

// ---- NOT-ARMED guards. Silent-clean-on-nothing is banned. ----
if (!crosswalk.lessons || !crosswalk.lessons.length) problems.push('ARMING: the crosswalk has zero lessons, so this gate measured nothing');
if (!Object.keys(index.lessons || {}).length) problems.push('ARMING: the lesson index is empty, so no lesson could be checked against the book');
if (!emitted.size) problems.push('ARMING: zero topics were emitted across the whole driver sweep, so every moduleTopics check would pass vacuously');
if (!labelled.size) problems.push('ARMING: zero TOPIC_LABELS keys parsed, so the dangling-label census measured nothing');
if (lateArrivals.length) {
  problems.push(`ARMING: the second sampling half turned up ${lateArrivals.length} topic(s) the first `
    + `half missed (${lateArrivals.join(', ')}), so N=${N} is too small and every "not emitted" `
    + 'verdict below is unsafe. Re-run with a larger N.');
}

const targetCount = Object.values(TARGETS).filter((t) => t.subject === 'math').length;
if (targetCount < 25) problems.push(`ARMING: only ${targetCount} math targets exist, which is too few to be the real vocabulary`);

// ---- the real crosswalk ----
const ctx = { emitted, labelled, index };
problems.push(...validate(crosswalk, ctx));

// ---- 6. the dangling-label census ----
// In the GRANULAR half of TOPIC_LABELS, coach-tipped, and emitted by nothing. The coarse half is
// excluded because those entries are level-id fallbacks by design; the shell's own boundary
// comment is what separates the two, and readShellTables fails if it is missing.
const orphans = [...granular]
  .filter((t) => tipped.has(t) && !emitted.has(t) && !fallbackTargets.has(t) && !coarse.has(t))
  .sort();
const unexpectedOrphans = orphans.filter((t) => !Object.prototype.hasOwnProperty.call(KNOWN_ORPHANS, t));
for (const t of unexpectedOrphans) {
  problems.push(`dangling label: "${t}" has a TOPIC_LABELS entry and a COACH_TIPS entry and is `
    + 'emitted by no generator in either grade, so it reads as shipped coverage and is not. Either '
    + 'delete it from both tables or add it to KNOWN_ORPHANS with a reason.');
}
const staleAllowlist = Object.keys(KNOWN_ORPHANS).filter((t) => !orphans.includes(t));
for (const t of staleAllowlist) {
  problems.push(`KNOWN_ORPHANS lists "${t}", which is no longer a dangling label. Remove the entry `
    + 'so the allowlist cannot outlive the condition it excuses.');
}

// ---- controls ----
// Each control mutates a deep clone of the REAL crosswalk and runs the SHIPPED validate(). A
// control that fails to fire voids every result above, because it proves the checker accepts
// anything.
const clone = (o) => JSON.parse(JSON.stringify(o));
const controls = [];

function control(name, mutate, expect) {
  const cw = clone(crosswalk);
  const where = mutate(cw);
  const errs = validate(cw, ctx);
  const hit = errs.some((e) => e.includes(expect));
  controls.push({ name, fired: hit, where, sample: errs.find((e) => e.includes(expect)) || errs[0] || '(no error at all)' });
  if (!hit) {
    problems.push(`CONTROL "${name}" did not fire: the gate accepted ${where}. Every clean result `
      + 'above is void, because this proves the checker does not reject what it claims to reject.');
  }
}

// positive control: the real crosswalk, deep-cloned and untouched, must come back clean
{
  const errs = validate(clone(crosswalk), ctx);
  controls.push({ name: 'POSITIVE: the real crosswalk, unmodified', fired: errs.length === 0, where: 'no mutation', sample: errs[0] || '(clean)' });
  if (errs.length) problems.push(`POSITIVE CONTROL failed: the unmodified crosswalk produced ${errs.length} error(s), first: ${errs[0]}`);
}

control('NEGATIVE 1: a fabricated lesson id',
  (cw) => { cw.lessons[0].lesson = '1.9.9'; return 'a lesson id CC1 does not have (1.9.9)'; },
  'CC1 does not have it');

control('NEGATIVE 2: a fabricated target id',
  (cw) => { cw.lessons[0].targets = ['math-not-a-real-target']; cw.lessons[0].ccss = []; return 'a target id that is not in the frozen vocabulary'; },
  'not in the frozen vocabulary');

control('NEGATIVE 3: a labelled-but-unemitted topic',
  (cw) => {
    // coord-plot is the live specimen: TOPIC_LABELS declares it, COACH_TIPS coaches it, and no
    // Razor Crest level in either grade dispatches it. This is the condition that made coord-shape
    // and coord-real-world read as coverage in the source for months.
    cw.lessons[0].moduleTopics = ['coord-plot'];
    return 'a topic the shell labels but no generator emits (coord-plot)';
  },
  'dangling label, not coverage');

control('NEGATIVE 4: a row that serves nothing and declares no gap',
  (cw) => { cw.lessons[0].moduleTopics = []; cw.lessons[0].packItemTargets = []; cw.lessons[0].gaps = []; return 'a row serving nothing with an empty gaps[]'; },
  'reads as covered while covering nothing');

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const gapCount = crosswalk.lessons.reduce((n, l) => n + (l.gaps || []).length, 0);
const gapLessons = crosswalk.lessons.filter((l) => (l.gaps || []).length).length;
const servedLessons = crosswalk.lessons.filter((l) => (l.moduleTopics || []).length || (l.packItemTargets || []).length).length;
const packServed = crosswalk.lessons.filter((l) => (l.packItemTargets || []).length).length;
const byConfidence = {};
for (const l of crosswalk.lessons) byConfidence[l.confidence] = (byConfidence[l.confidence] || 0) + 1;
const verdicts = {};
for (const b of crosswalk.blocks || []) { if (!b.crossRef) verdicts[b.verdict] = (verdicts[b.verdict] || 0) + 1; }

console.log(`\n=== curriculum crosswalk: ${crosswalk.bookTitle} (${crosswalk.book}) ===`);
console.log(`emitted-topic sweep: ${drivers} drivers, ${draws} draws, ${emitted.size} distinct topics emitted`);
console.log(`  saturation: the second sampling half added ${lateArrivals.length} new topic(s)${lateArrivals.length ? ' -- ' + lateArrivals.join(', ') : ''}`);
console.log(`  the shell LABELS ${labelled.size} topics (${granular.size} granular + ${coarse.size} coarse fallback) and EMITS ${emitted.size}; this gate checks against the emitted set`);
console.log(`lessons: ${crosswalk.lessons.length}  |  confidence: `
  + Object.entries(byConfidence).map(([k, v]) => `${v} ${k}`).join(' / '));
console.log(`Parent Guide blocks: ${(crosswalk.blocks || []).length}  |  confirmed census: `
  + Object.entries(verdicts).map(([k, v]) => `${v} ${k}`).join(' / '));
console.log(`coverage: ${servedLessons}/${crosswalk.lessons.length} lessons served by an emitted module topic, `
  + `${packServed}/${crosswalk.lessons.length} served by a pack item`);

// THE PROGRESS METER. Printed on every run, never inferred from a silent pass.
console.log(`\nGAP COUNT: ${gapCount} open gap(s) across ${gapLessons} lesson(s).`);
console.log('  This number is the program\'s own progress meter: WP2 fills packItemTargets and it falls.');
const ranked = (crosswalk.blocks || []).filter((b) => b.rank).sort((a, b) => a.rank - b.rank);
if (ranked.length) {
  console.log('  ranked build list, worst first:');
  for (const b of ranked.slice(0, 6)) console.log(`    ${String(b.rank).padStart(2)}. [${b.verdict}] ${b.lessons[0]} ${b.title}`);
  console.log(`    ... ${Math.max(0, ranked.length - 6)} more`);
}

// Duplicate keys inside TOPIC_LABELS: JS keeps the LAST one, so a granular entry duplicated in the
// coarse half is dead source that still reads as a coverage claim to anyone grepping it. Reported
// rather than failed, because the shipped runtime behaviour is the coarse entry's and is correct.
const dupKeys = [...granular].filter((t) => coarse.has(t)).sort();

console.log(`\ndangling-label census: ${orphans.length} granular label(s) with a coach tip and no generator`);
for (const t of orphans) {
  const known = KNOWN_ORPHANS[t];
  console.log(`  ${known ? 'KNOWN ' : 'NEW   '}${t}${known ? ' -- ' + known : ''}`);
}
if (!orphans.length) console.log('  (none)');
console.log(`TOPIC_LABELS duplicate keys (granular entry also present in the coarse half, the later one wins): `
  + `${dupKeys.length}${dupKeys.length ? ' -- ' + dupKeys.join(', ') : ''}`);

console.log('\ncontrols:');
for (const c of controls) {
  console.log(`  ${c.fired ? 'ok  ' : 'FAIL'} ${c.name}`);
  if (!c.fired) console.log(`         expected a rejection of ${c.where}; got: ${c.sample}`);
}
for (const n of notes) console.log('  note: ' + n);

if (problems.length) {
  console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nRESULT: FAIL');
  process.exit(1);
}
console.log(`\nRESULT: ALL CLEAN (${crosswalk.lessons.length} lessons, ${gapCount} open gaps, ${controls.length} controls fired)`);
process.exit(0);
