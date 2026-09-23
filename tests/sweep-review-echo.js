'use strict';
// sweep-review-echo.js -- a review question may not echo an earlier level.
//
// Justin, 26-0921:  "no review questions can echo".  Level 6 of every pack is a review level, and a
// review item that re-asks what an earlier item asked, or whose answer an earlier item already states,
// tests memory of that earlier item instead of the skill.  Measured before this gate existed:  the
// level-6 twin l6-mc-chronicle-card-boxed-line shared its figure, its boxed line and its key position
// with a level-4 item, and its key's description repeated the level-4 stem word for word.
//
// An ECHO is any of:
//   E1  KEY STATED EARLIER  a level-6 key (the keyed choice of an mc, ms, ebsr Part A, the Part B line
//       mapped from the Part A key, or a cloze blank) whose content words appear, 80% or more of them and at least three, in ONE earlier-level
//       field that asserts something:  a stem, a KEYED choice, an explain, a distractorRationale or a
//       whyTheFigureIsNeeded.  Unkeyed choices do not count:  a wrong answer gives nothing away.
//       A key of fewer than three content words is NOT scored, on purpose.  Measured 26-0921, every
//       such key that matched an earlier key was a vocabulary term applied to a new case (Outpost's
//       "interaction", for the fish-timing event) or a number that happens to recur in the math pack
//       ("6 cm").  A review level has to be able to key a taught word again in a new case.  What this
//       cannot see is a short key that re-asks the same FACT, and a paraphrase:  Firsthand's author
//       found four by reading ("Saul" as the first king, keyed at level 2 and asked again at level 6)
//       and rewrote them.  Those stay a reader's job, and the lens pass reads every level-6 rewrite.
//   E2  SAME QUESTION      a level-6 item on the same figure AND the same figureFact as an earlier item.
//   E3  SAME STEM           a level-6 stem whose content words overlap an earlier stem's on the same
//       passage by 70% or more (the share of the smaller set).
//
//   node tests/sweep-review-echo.js            every pack in the manifest;  exits 1 on any echo
//
// CONTROLS in the same pass:  a synthetic level-6 item planted with each kind of echo must be caught,
// and the same pack with the plant removed must come back clean.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const STOP = new Set(('a an the of to in on at by for and or but is are was were be been being it its this that these those with '
  + 'from as each which what who whom whose where when why how one two three four five six does do did has have had not no nor so '
  + 'than then there their them they he she his her him we you i my me our your into over under about any all some own same both '
  + 'only just still more most very can could would should will may might must also because if out up down off again once here').split(' '));
const norm = (w) => w.toLowerCase().replace(/[‘’]/g, "'").replace(/'s$/, '').replace(/[^a-z0-9-]/g, '').replace(/([^s])s$/, '$1');
const words = (s) => String(s == null ? '' : s).split(/\s+/).map(norm).filter((w) => w && !STOP.has(w));

function keysOf(it) {
  const out = [];
  const add = (choices, key, where) => (Array.isArray(key) ? key : [key]).forEach((k) => {
    if (Array.isArray(choices) && Number.isInteger(k) && choices[k] !== undefined) out.push({ text: String(choices[k]), where });
  });
  if (it.type === 'mc' || it.type === 'ms') add(it.choices, it.key, 'key');
  if (it.type === 'ebsr') {
    if (it.partA) add(it.partA.choices, it.partA.key, 'partA key');
    // Part B's key is a MAP from each Part A choice to the line that supports it (engine/items.js).
    // Only the line mapped from Part A's KEY is the answer;  the others support wrong claims, and a
    // child who remembers one of them from an earlier level is led to a wrong answer, not given one.
    if (it.partA && it.partB && Array.isArray(it.partB.choices)) {
      const kb = it.partB.key;
      const canon = kb && typeof kb === 'object' && !Array.isArray(kb) ? kb[String(it.partA.key)] : kb;
      add(it.partB.choices, [canon].filter(Number.isInteger), 'partB key');
    }
  }
  if (it.type === 'cloze') (it.blanks || []).forEach((b, i) => add(b.choices, b.key, `blank ${i} key`));
  // A hottext keys the passage sentences it asks for;  each keyed span is an answer (26-0922:  the
  // first draft of this gate left them out, and a keyed span shared with a sibling's Part B key is
  // the same answer asked twice).
  if (it.type === 'hottext') add(it.spans, it.key, 'keyed span');
  return out;
}

// The fields of an earlier item that ASSERT something.
function assertingFields(it) {
  const out = [];
  const push = (v, where) => { if (typeof v === 'string' && v) out.push({ text: v, where }); };
  push(it.stem, 'stem');
  push(it.explain, 'explain');
  push(it.whyTheFigureIsNeeded, 'whyTheFigureIsNeeded');
  if (it.distractorRationale && typeof it.distractorRationale === 'object') {
    for (const [k, v] of Object.entries(it.distractorRationale)) push(v, `distractorRationale.${k}`);
  }
  if (it.partA) push(it.partA.stem, 'partA.stem');
  if (it.partB) push(it.partB.stem, 'partB.stem');
  keysOf(it).forEach((k) => push(k.text, k.where));
  return out;
}

function echoesIn(pack) {
  const found = [];
  const levels = pack.levels || [];
  if (levels.length < 6) return found;
  const byId = new Map((pack.items || []).map((i) => [i.id, i]));
  const review = (levels[5].itemIds || []).map((id) => byId.get(id)).filter(Boolean);
  const earlier = levels.slice(0, 5).flatMap((l, li) => (l.itemIds || []).map((id) => ({ it: byId.get(id), level: li + 1 }))).filter((x) => x.it);
  for (const it of review) {
    for (const k of keysOf(it)) {
      const kw = [...new Set(words(k.text))];
      if (kw.length < 3) continue;
      for (const { it: ot, level } of earlier) {
        for (const f of assertingFields(ot)) {
          const fw = new Set(words(f.text));
          const hit = kw.filter((w) => fw.has(w)).length;
          if (hit / kw.length >= 0.8) {
            found.push({ kind: 'E1', item: it.id, detail: `${k.where} "${k.text}" is stated by level ${level} ${ot.id}.${f.where} (${hit}/${kw.length} words)` });
          }
        }
      }
    }
    if (it.figureId && it.figureFact) {
      for (const { it: ot, level } of earlier) {
        if (ot.figureId === it.figureId && ot.figureFact === it.figureFact) {
          found.push({ kind: 'E2', item: it.id, detail: `same figure ${it.figureId} and figureFact "${it.figureFact}" as level ${level} ${ot.id}` });
        }
      }
    }
    const st = new Set(words(it.stem || (it.partA && it.partA.stem)));
    for (const { it: ot, level } of earlier) {
      if (ot.passageId !== it.passageId) continue;
      const os = new Set(words(ot.stem || (ot.partA && ot.partA.stem)));
      const small = Math.min(st.size, os.size);
      if (small < 4) continue;
      const shared = [...st].filter((w) => os.has(w)).length;
      if (shared / small >= 0.7) found.push({ kind: 'E3', item: it.id, detail: `stem overlaps level ${level} ${ot.id}'s stem ${shared}/${small}` });
    }
    // E4  KEY STATED BY A SIBLING (26-0922).  Level 6 serves its items shuffled, so a sibling in the
    // same level can come first and hand this one its answer.  Same test as E1, run against every
    // OTHER level-6 item in both directions.
    for (const k of keysOf(it)) {
      const kw = [...new Set(words(k.text))];
      if (kw.length < 3) continue;
      for (const ot of review) {
        if (ot === it) continue;
        for (const f of assertingFields(ot)) {
          const fw = new Set(words(f.text));
          const hit = kw.filter((w) => fw.has(w)).length;
          if (hit / kw.length >= 0.8) {
            found.push({ kind: 'E4', item: it.id, sig: `${it.id}|${k.where}|${ot.id}.${f.where}`,
              detail: `${k.where} "${k.text}" is stated by level-6 sibling ${ot.id}.${f.where} (${hit}/${kw.length} words)` });
          }
        }
      }
    }
  }
  return found;
}

// Reviewed E4 false positives:  { pack, sig, reason }.  An entry that no longer matches a finding is
// STALE and fails, so the list cannot outlive the text it excused.
const ALLOW_PATH = path.join(__dirname, 'review-echo-allowlist.json');
function applyAllow(packId, found, allow, used) {
  return found.filter((f) => {
    if (f.kind !== 'E4') return true;
    const hit = allow.find((a) => a.pack === packId && a.sig === f.sig);
    if (hit) used.add(hit);
    return !hit;
  });
}

const problems = [];
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'manifest.json'), 'utf8'));
const allow = fs.existsSync(ALLOW_PATH) ? JSON.parse(fs.readFileSync(ALLOW_PATH, 'utf8')) : [];
const used = new Set();
let packs = 0, reviewItems = 0;
for (const e of manifest.packs) {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', `${e.id}.json`), 'utf8'));
  if (!pack.levels || pack.levels.length < 6) continue;
  packs++;
  reviewItems += (pack.levels[5].itemIds || []).length;
  for (const f of applyAllow(e.id, echoesIn(pack), allow, used)) problems.push(`${f.kind}  ${e.id}/${f.item}:  ${f.detail}${f.sig ? `  [sig ${f.sig}]` : ''}`);
}
for (const a of allow) if (!used.has(a)) problems.push(`STALE allowlist entry ${a.pack} ${a.sig}:  it no longer matches a finding;  remove it`);
console.log(`sweep-review-echo: ${packs} pack(s), ${reviewItems} level-6 item(s) checked against every earlier level and every level-6 sibling;  ${used.size} reviewed E4 exception(s)`);

// ---- controls ----
{
  const base = {
    levels: [1, 2, 3, 4, 5, 6].map((n) => ({ itemIds: [] })),
    items: [],
  };
  const early = { id: 'e1', type: 'mc', passageId: 'p', figureId: 'f', figureFact: 'the red lantern',
    stem: 'Which lantern does the keeper light first on the north wall?', choices: ['the red lantern by the gate', 'b', 'c', 'd'], key: 0,
    explain: 'The keeper always lights the red lantern by the gate before any other.' };
  base.items.push(early); base.levels[0].itemIds.push('e1');
  const plant = (item) => { const p = JSON.parse(JSON.stringify(base)); p.items.push(item); p.levels[5].itemIds.push(item.id); return p; };
  const clean = plant({ id: 'r0', type: 'mc', passageId: 'q', stem: 'Why does the keeper walk the east path at dusk?',
    choices: ['to count the goats in the yard', 'x', 'y', 'z'], key: 0 });
  const e1 = plant({ id: 'r1', type: 'mc', passageId: 'q', stem: 'What comes first?', choices: ['the red lantern by the gate', 'x', 'y', 'z'], key: 0 });
  const e2 = plant({ id: 'r2', type: 'mc', passageId: 'q', figureId: 'f', figureFact: 'the red lantern', stem: 'Look again at the drawing.',
    choices: ['one', 'two', 'three', 'four'], key: 1 });
  const e3 = plant({ id: 'r3', type: 'mc', passageId: 'p', stem: 'Which lantern does the keeper light first on the north wall of the yard?',
    choices: ['one', 'two', 'three', 'four'], key: 2 });
  // Part B:  the line mapped from Part A's key is the answer;  a line mapped from a wrong Part A choice
  // is not, so an earlier key sitting there leads a remembering child AWAY from the answer.
  const ebsr = (canon) => plant({ id: 'r4', type: 'ebsr', passageId: 'q',
    partA: { stem: 'Why is the yard kept dark?', choices: ['to rest the goats', 'x', 'y', 'z'], key: 0 },
    partB: { stem: 'Which line supports it?', choices: ['the red lantern by the gate', 'the goats sleep early in winter', 'q', 'r'],
      key: canon ? { 0: 0, 1: 1, 2: 2, 3: 3 } : { 0: 1, 1: 0, 2: 2, 3: 3 } } });
  const kinds = (p) => echoesIn(p).map((f) => f.kind);
  // E4:  two level-6 siblings.  s1's explain states s2's key;  a third sibling states nothing.
  const sib = (withEcho) => {
    const p = JSON.parse(JSON.stringify(base));
    p.items.push({ id: 's1', type: 'mc', passageId: 'q', stem: 'What does the keeper do at dusk?', choices: ['a', 'b', 'c', 'd'], key: 0,
      explain: withEcho ? 'At dusk the keeper counts the goats sleeping in the yard.' : 'At dusk the keeper walks the east path.' });
    p.items.push({ id: 's2', type: 'mc', passageId: 'q', stem: 'Why is the yard quiet?', choices: ['the goats sleeping in the yard', 'x', 'y', 'z'], key: 0 });
    p.levels[5].itemIds.push('s1', 's2');
    return p;
  };
  const expect = [[clean, []], [e1, ['E1']], [e2, ['E2']], [e3, ['E3']], [ebsr(true), ['E1']], [ebsr(false), []],
    [sib(true), ['E4']], [sib(false), []]];
  expect.forEach(([p, want], i) => {
    const got = [...new Set(kinds(p))].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`CONTROL ${i} failed:  expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  });
  // The allowlist excuses exactly its own signature, and an unused entry is detected.
  const f4 = echoesIn(sib(true));
  const u1 = new Set();
  const excused = applyAllow('t', f4, [{ pack: 't', sig: f4[0] && f4[0].sig, reason: 'control' }], u1);
  if (excused.some((f) => f.kind === 'E4') || u1.size !== 1) problems.push('CONTROL allowlist failed:  a listed E4 signature was not excused');
  const u2 = new Set();
  applyAllow('t', echoesIn(sib(false)), [{ pack: 't', sig: 'nothing|here|at.all', reason: 'control' }], u2);
  if (u2.size !== 0) problems.push('CONTROL stale-allowlist failed:  an entry matching nothing was counted as used');
  if (!problems.some((p) => p.startsWith('CONTROL'))) console.log('  controls:  a clean review item passes;  a planted E1, E2 and E3 are each caught;  an earlier key as the Part B answer is caught, as the support for a wrong claim it is not;  a sibling that states a level-6 key is caught (E4) and one that does not passes;  the allowlist excuses its own signature only, and an unused entry is detected  (fired)');
}

if (problems.length) {
  console.log(`\n=== sweep-review-echo: ${problems.length} problem(s) ===`);
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nRESULT: FAILED');
  process.exit(1);
}
console.log('\nRESULT: ALL CLEAN');
