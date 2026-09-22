'use strict';
// sweep-ebsr-rationale.js -- an EBSR's wrong-answer feedback must be about the wrong answer the child
// actually picked.
//
//   node tests/sweep-ebsr-rationale.js            every pack;  exits 1 on a crossed pair
//
// WHY.  An EBSR ties each Part A choice to a Part B line through partB.key (the line that would seem
// to support that claim;  engine/items.js gives half credit for evidence consistent with a wrong
// claim), and each wrong Part A choice has a distractorRationale that the child reads after picking
// it.  Those three things are written separately and nothing checked that they agree.  Found on
// 26-0921 by the Vault authoring agent while it rewrote options for the length cue:  in eleven Cold
// Signal and Vault items two rationales had been filed under each other's choice, or the map sent
// each of two claims to the other's line, almost always choices 2 and 3.  A child who picked choice
// 2 was told why choice 3 is wrong, about a line choice 3 leans on.  Read one by one, every flag the
// rule below raised on the pre-fix packs was real except one (allowlisted, with its reason).
//
// THE RULE.  For two wrong choices i and j, score how well each rationale fits a choice:  the
// content words it shares with that choice's Part A text AND with the Part B line mapped from it.
// The pair is CROSSED when rationale i fits choice j better than its own, rationale j fits choice i
// better than its own, and swapping them gains at least 2 words.  A second, Part-B-only reading
// (the words shared with the mapped line alone) catches a MAP that sends two claims to each other's
// lines while the rationales still name their own claims;  it needs a gain of 3, because a rationale
// that argues about the claim rather than quoting the line shares fewer words with any line.
//
// It is a word-overlap heuristic and says so:  a flag is a thing to READ, and the fix is either to
// swap the two rationale texts or to swap the two map entries, whichever makes each rationale match
// its own claim and its own line.
//
// CONTROLS:  a real crossed pair from the pre-fix Vault pack (l5-ebsr-door-exhale-turning-point, as
// it stood at 2ebf9b8) is caught;  the same item with its two rationales put back is clean;  a
// crossed MAP (l6-ebsr-callback-to-first-lesson as it stood) is caught by the Part B reading.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const STOP = new Set(('a an the of to in on at by for and or but is are was were be it its this that with from as not no line '
  + 'says said about does do he she they his her you your if picked choice passage text any all never only ever what which who '
  + 'one two three answer option there their them than then so because has have had').split(' '));
const W = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/'s$/, '').replace(/([^s])s$/, '$1')));
const ov = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

// Confirmed by reading, not by the rule:  each entry says why the flag is not a defect.
const ALLOW = new Map([
  ['night-rounds-g6/l3-ebsr-whitlock-note DR0<->DR2', 'Read 26-0921:  both rationales argue about their own claims (a ranking of witnesses, another round of interviews) and quote neither line;  the overlap is the word "witness", which every line on this page shares.'],
]);

function crossedIn(item) {
  const out = [];
  if (item.type !== 'ebsr' || !item.distractorRationale || !item.partA || !item.partB) return out;
  const m = item.partB.key;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  const A = (item.partA.choices || []).map(W), B = (item.partB.choices || []).map(W);
  const R = Object.fromEntries(Object.entries(item.distractorRationale).map(([k, v]) => [k, W(v)]));
  const both = (r, c) => ov(R[r], A[c]) + ov(R[r], B[m[c]] || new Set());
  const lineOnly = (r, c) => ov(R[r], B[m[c]] || new Set());
  const ks = Object.keys(R).map(Number).filter((k) => Number.isInteger(m[k]));
  for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
    const i = ks[a], j = ks[b];
    for (const [how, fit, gain] of [['claim and line', both, 2], ['line', lineOnly, 3]]) {
      const own = fit(i, i) + fit(j, j), sw = fit(i, j) + fit(j, i);
      if (fit(i, j) > fit(i, i) && fit(j, i) > fit(j, j) && sw >= own + gain) {
        out.push({ pair: `DR${i}<->DR${j}`, detail: `by ${how}:  own ${own}, swapped ${sw}` });
        break;
      }
    }
  }
  return out;
}

const problems = [];
const allowed = [];
let items = 0;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'manifest.json'), 'utf8'));
for (const e of manifest.packs) {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', `${e.id}.json`), 'utf8'));
  for (const it of pack.items || []) {
    if (it.type !== 'ebsr') continue;
    items++;
    for (const f of crossedIn(it)) {
      const k = `${e.id}/${it.id} ${f.pair}`;
      if (ALLOW.has(k)) allowed.push(k);
      else problems.push(`CROSSED  ${k}  (${f.detail}):  read both rationales against both choices and their mapped lines;  swap the rationale texts or the two map entries`);
    }
  }
}
console.log(`sweep-ebsr-rationale: ${items} EBSR item(s) read, ${allowed.length} allowlisted flag(s)`);

// ---- controls, on real pre-fix shapes ----
{
  const doorExhale = {
    type: 'ebsr',
    partA: { key: 0, choices: [
      'It marks the turning point between the corridor\'s buildup of tension and Mila\'s entry into the vault itself.',
      'It is the story\'s opening image, before any other description begins.',
      'It is a random detail unconnected to anything before or after it.',
      'It signals that Mila has already left the building completely.'] },
    partB: { key: { 0: 2, 1: 3, 2: 1, 3: 0 }, choices: [
      'Walking back out through the twelve doors, Mila counts them again in reverse.',
      'Inside, the Wyrdstone sits alone on a raised shelf, under a single cone of light.',
      'The door releases with a sound less like an opening and more like something exhaling, a long low breath of air that had clearly been sealed in for longer than eleven minutes could explain.',
      'Frostbank Storage keeps its lowest floor at a temperature the brochure calls archival.'] },
    distractorRationale: {
      1: 'This line is the passage\'s actual opening sentence, describing the temperature of the whole floor. It is not the exhaling sound this item asks about.',
      2: 'This line describes Mila\'s actual exit at the very end of the passage, not the moment the vault door first opens.',
      3: 'This line describes exactly what comes right after the door opens, connecting the two moments directly. That argues against the sound being unconnected to anything.',
    },
  };
  const fixed = JSON.parse(JSON.stringify(doorExhale));
  [fixed.distractorRationale[2], fixed.distractorRationale[3]] = [doorExhale.distractorRationale[3], doorExhale.distractorRationale[2]];
  const callback = {
    type: 'ebsr',
    partA: { key: 0, choices: [
      'It confirms that the same quality Finch praised at the start, noticing, is what saves the crew at the end.',
      'It shows that Finch was wrong about what mattered most.',
      'It reveals that Theo never actually trusted Finch\'s training.',
      'It shows the crew abandoning everything Finch taught them.'] },
    partB: { key: { 0: 1, 1: 0, 2: 3, 3: 2 }, choices: [
      'We only worked that out because Mila noticed the same spiral, scaled three different ways, on three objects that supposedly had nothing to do with each other.',
      'Finch always said noticing was the only qualification that ever mattered here.',
      'I spent months assuming that was the kind of thing trainers say to sound impressive.',
      'I set the Threadglass last, into the notch on the right.'] },
    distractorRationale: {
      1: 'This line shows Mila\'s noticing directly solving the mystery of the door, which argues for Finch being right, not wrong.',
      2: 'This line describes the narrator\'s doubt from months earlier, a doubt the passage explicitly says he is now revising, not evidence he never trusted Finch by the end.',
      3: 'Setting the relic into its notch is the crew following the training and the plan closely, not abandoning it.',
    },
  };
  const cases = [
    ['NEGATIVE: l5-ebsr-door-exhale-turning-point as it stood (rationales 2 and 3 filed under each other)', doorExhale, true],
    ['POSITIVE: the same item with the two rationales put back', fixed, false],
    ['NEGATIVE: l6-ebsr-callback-to-first-lesson as it stood (the map sent claims 2 and 3 to each other\'s lines)', callback, true],
  ];
  console.log('controls:');
  for (const [name, it, want] of cases) {
    const got = crossedIn(it).length > 0;
    console.log(`  ${got === want ? 'ok  ' : 'BAD '} ${name}  (${got ? 'flagged' : 'clean'})`);
    if (got !== want) problems.push(`CONTROL "${name}" came back ${got ? 'flagged' : 'clean'};  the sweep is void`);
  }
}

if (!items) { console.log('\nNOT ARMED: no EBSR item found.'); console.log('RESULT: FAILED'); process.exit(1); }
if (problems.length) {
  console.log(`\n=== sweep-ebsr-rationale: ${problems.length} problem(s) ===`);
  problems.forEach((p) => console.log('  ' + p));
  console.log('\nRESULT: FAILED');
  process.exit(1);
}
console.log('\nRESULT: ALL CLEAN');
