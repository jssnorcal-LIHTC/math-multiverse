'use strict';
// figure-necessity.js -- LOCAL ONLY. Does the figure actually carry the answer?
//
//   node tests/figure-necessity.js vault-of-ages-g6
//   node tests/figure-necessity.js vault-of-ages-g6 --only l1-mc-x,l2-ms-y --concurrency 3
//   node tests/figure-necessity.js vault-of-ages-g6 --runs 3        <-- see NON-DETERMINISM below
//
// WHY THIS EXISTS.
//
// Rule 1 of every C-wave authoring brief in this repo is that the FIGURE MUST BE NECESSARY: "if the
// item can be answered from the passage prose without looking at the drawing, it is not a
// figure-stimulus item and it does not belong in this wave." Until now that rule was enforced by
// reading, and reading is exactly what it is bad at. C4 round 1 over the Vault of Ages C-wave
// raised "the figure is decorative" against EIGHT of 24 items, on four different lenses, and two of
// those findings were then killed 2-0 by adversarial refuters. Eight judgement calls, disagreeing
// with each other, on the rule the whole wave exists to satisfy.
//
// This makes it a measurement instead. It is a DIFFERENTIAL against a ledger that already exists:
//
//   with the figure     packs/<pack>.verdicts.json, written by tests/blind-reanswer.js, which shows
//                       the model the item, the passage AND the figure's dataTable
//   without the figure  this file, which shows the model the item and the passage ONLY
//
//   right WITHOUT  ->  the figure is DECORATIVE for that item. The passage already answers it.
//   wrong WITHOUT, right WITH  ->  the figure is LOAD-BEARING. This is what the wave is for.
//   wrong BOTH     ->  says nothing about the figure; look at the item.
//
// The prompt is not hand-written here. It is blindQuestion() from tests/verdicts.js -- the same
// function the certification pass uses -- called on a copy of the item with `figureId` deleted.
// That is deliberate and it is the whole reason the comparison means anything: blindQuestion
// switches its own instruction line on figureId ("from the passage and the figure data below" vs
// "from the passage alone") and omits the figure block, so the two arms differ in the figure and in
// nothing else. A hand-rolled prompt here would be measuring two different questions.
//
// WHAT THIS IS NOT. It is not a gate and it is not in the npm test chain, for the same reason
// blind-reanswer is not: it shells out to the `claude -p` subscription CLI, dozens of calls per
// run. It reports. A pack owner decides what to do about a decorative item, because the fix is
// re-authoring, not a field edit.
//
// NON-DETERMINISM, MEASURED, AND IT BOUNDS EVERYTHING BELOW.  The same item, same text, same
// prompt, run three times, answered RIGHT, RIGHT, wrong -- every one of them at "high" confidence.
// So a single run per item is a coin with a bias, not a reading, and "high confidence" says nothing
// about stability.  Consequences, stated rather than buried:
//
//   * A one-run pack total carries per-item noise of at least one item in 24, so two totals a few
//     points apart are the same total.  88% against 83% on the same pack before and after a fix
//     pass is NOT a demonstrated improvement.
//   * The cross-pack comparison SURVIVES this, and is in fact strengthened by it: 88 / 92 / 87
//     across three packs is one spread inside the noise, which is the evidence that the three packs
//     are indistinguishable and none of them meets the bar.  That was the load-bearing conclusion.
//   * --runs N re-answers each item N times and reports the split.  An item right in every run is
//     decorative and an item wrong in every run is load-bearing;  a mixed item is UNSTABLE and is
//     reported as such rather than rounded into one bucket.
//
// Use --runs 3 or more before acting on any single item.  The one-run mode is for a pack-level
// sketch, and it must be described as one.
//
// READING THE RESULT HONESTLY. One model answering one prompt once is evidence, not proof. A single
// "right without the figure" is a reason to go and look at the item; a wave where most items answer
// right without their figures is a wave that has not understood its own brief. And the failure
// direction matters: this pass can only ever UNDER-report decorative figures, because a model that
// answers from the passage is proof the passage suffices, while a model that fails may simply have
// failed.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadPackFile } = require('./validate-pack');
const { blindQuestion, authoredKeyOf, sameAnswer } = require('./verdicts');

const PACK_DIR = path.join(__dirname, '..', 'packs');
const MODEL_LABEL = process.env.BLIND_MODEL || 'claude-sonnet-5';

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

// Lifted verbatim from tests/blind-reanswer.js, including both Windows traps it documents: no
// shell (argv is concatenated, not escaped, and a multi-line prompt is torn apart at the newlines)
// and stdin closed at once (the CLI waits 3s for input it will never get).
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt, '--model', MODEL_LABEL], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', errOut = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude CLI timed out after 300s')); }, 300000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errOut += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude CLI failed to start: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${errOut.slice(0, 200)}`));
      resolve(out);
    });
    child.stdin.end();
  });
}

// Also lifted verbatim, /g and the two-object refusal included: a model that second-guesses itself
// mid-reply must not have its abandoned answer used silently.
function parseAnswer(raw, optionCount) {
  const all = String(raw).match(/\{[^{}]*"answer"[^{}]*\}/g);
  if (!all) throw new Error('no JSON object with an "answer" field in the reply: ' + String(raw).slice(0, 160));
  if (all.length > 1) throw new Error('reply contained ' + all.length + ' JSON objects with an "answer" field: ' + all.join(' | ').slice(0, 200));
  const obj = JSON.parse(all[0]);
  const toIdx = (L) => {
    const i = String(L).trim().toUpperCase().charCodeAt(0) - 65;
    if (!Number.isInteger(i) || i < 0 || i >= optionCount) throw new Error(`answer "${L}" is outside A to ${String.fromCharCode(64 + optionCount)}`);
    return i;
  };
  const answer = Array.isArray(obj.answer) ? obj.answer.map(toIdx) : toIdx(obj.answer);
  return { answer, confidence: obj.confidence || 'unknown' };
}

async function pool(jobs, n) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

async function main() {
  const packId = process.argv[2];
  if (!packId) { console.error('usage: node tests/figure-necessity.js <packId> [--only id,id] [--concurrency N] [--runs N]'); process.exit(2); }
  const packPath = path.join(PACK_DIR, packId + '.json');
  const pack = loadPackFile(packPath);
  const passages = new Map((pack.passages || []).map((p) => [p.id, p]));

  const only = arg('--only', null);
  const onlySet = only ? new Set(only.split(',').map((s) => s.trim()).filter(Boolean)) : null;
  const concurrency = Math.max(1, parseInt(arg('--concurrency', '3'), 10));
  const runs = Math.max(1, parseInt(arg('--runs', '1'), 10));

  // The wave under test is the figure-stimulus items: the ones that CLAIM the figure is necessary.
  let items = (pack.items || []).filter((it) => it && it.figureFact && it.figureId);
  if (onlySet) items = items.filter((it) => onlySet.has(it.id));
  if (!items.length) {
    console.log(`\nNOT ARMED: ${packId} carries no figure-stimulus item, so this measured nothing.`);
    process.exit(1);
  }

  // The WITH-figure arm, already on record. Absent is not a failure; it just means the differential
  // cannot be completed for that item and the row says so.
  const ledgerPath = path.join(PACK_DIR, packId + '.verdicts.json');
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : null;
  const withFig = new Map(((ledger && (ledger.records || ledger.verdicts)) || []).map((r) => [r.itemId, r]));

  console.log(`\nfigure-necessity: ${items.length} figure-stimulus item(s) in ${packId}, answered WITHOUT the figure, concurrency ${concurrency}`);

  // One job per (item, run).  Flattened rather than nested so the concurrency pool stays the only
  // thing deciding how many CLI calls are in flight.
  const jobs = [];
  for (const it of items) for (let k = 0; k < runs; k++) jobs.push({ it, k });
  const raws = await pool(jobs.map(({ it }) => async () => {
    const passage = passages.get(it.passageId);
    if (!passage) return { id: it.id, error: 'no passage ' + it.passageId };
    // The one line that defines this pass: the same prompt builder, on an item that declares no
    // figure. blindQuestion then omits the figure block AND says "from the passage alone".
    const stripped = Object.assign({}, it);
    delete stripped.figureId;
    let q;
    try { q = blindQuestion(stripped, passage, undefined); } catch (e) { return { id: it.id, error: e.message }; }
    try {
      const raw = await callClaude(q.prompt);
      const { answer, confidence } = parseAnswer(raw, q.optionCount);
      const authored = authoredKeyOf(it);
      return { id: it.id, type: it.type, answer, confidence, authored, right: sameAnswer(answer, authored, it.type) };
    } catch (e) { return { id: it.id, type: it.type, error: e.message }; }
  }), concurrency);

  // Fold the runs back together.  An item is DECORATIVE or LOAD-BEARING only if every run agreed;
  // a split is reported as UNSTABLE rather than rounded into whichever answer happened to win.
  const byId = new Map();
  raws.forEach((r, i) => {
    const it = jobs[i].it;
    if (!byId.has(it.id)) byId.set(it.id, { id: it.id, type: it.type, rights: 0, wrongs: 0, errors: [], confs: [] });
    const a = byId.get(it.id);
    if (r.error) a.errors.push(r.error);
    else { if (r.right) a.rights++; else a.wrongs++; a.confs.push(r.confidence); }
  });
  const rows = [...byId.values()].map((a) => ({
    id: a.id,
    type: a.type,
    rights: a.rights,
    wrongs: a.wrongs,
    error: (a.rights + a.wrongs) === 0 ? (a.errors[0] || 'no result') : null,
    unstable: a.rights > 0 && a.wrongs > 0,
    right: a.wrongs === 0 && a.rights > 0,
    confidence: a.confs.length ? (a.confs.every((c) => c === a.confs[0]) ? a.confs[0] : 'mixed') : 'n/a',
  }));

  const dec = [], load = [], both = [], failed = [], unstable = [];
  console.log('\n  item                                        type   without fig   conf     with fig');
  for (const r of rows) {
    const w = withFig.get(r.id);
    const withStr = !w ? '(no record)' : (w.status === 'agree' ? 'agree' : w.status);
    if (r.error) { failed.push(r); console.log(`  ${r.id.padEnd(42)} ${String(r.type || '').padEnd(6)} ERROR  ${r.error.slice(0, 60)}`); continue; }
    const verdict = r.unstable ? `SPLIT ${r.rights}/${r.rights + r.wrongs}` : (r.right ? 'RIGHT' : 'wrong');
    console.log(`  ${r.id.padEnd(42)} ${r.type.padEnd(6)} ${verdict.padEnd(13)} ${String(r.confidence).padEnd(8)} ${withStr}`);
    const withOk = w && (w.status === 'agree' || w.status === 'adjudicated');
    if (r.unstable) unstable.push(r); else if (r.right) dec.push(r); else if (withOk) load.push(r); else both.push(r);
  }

  console.log('\n  DECORATIVE -- answered correctly with the figure withheld, so the passage already');
  console.log('  carries the answer and Rule 1 is not met:');
  if (!dec.length) console.log('    (none)');
  for (const r of dec) console.log(`    ${r.id}  (${r.confidence} confidence)`);

  console.log('\n  LOAD-BEARING -- wrong without the figure, right with it. This is the wave working:');
  if (!load.length) console.log('    (none)');
  for (const r of load) console.log(`    ${r.id}`);

  if (unstable.length) {
    console.log('\n  UNSTABLE -- the runs disagreed with each other on identical prompts, so this item');
    console.log('  has no reading yet.  That is the instrument, not the pack:');
    for (const r of unstable) console.log(`    ${r.id}  right in ${r.rights} of ${r.rights + r.wrongs} run(s)`);
  }
  if (both.length) {
    console.log('\n  INCONCLUSIVE -- wrong both ways, so this says nothing about the figure:');
    for (const r of both) console.log(`    ${r.id}`);
  }
  if (failed.length) {
    console.log('\n  FAILED to measure:');
    for (const r of failed) console.log(`    ${r.id}: ${r.error}`);
  }

  const measured = rows.length - failed.length;
  console.log(`\n  measured ${measured} of ${rows.length} over ${runs} run(s) each;  decorative ${dec.length}, `
    + `load-bearing ${load.length}, unstable ${unstable.length}, inconclusive ${both.length}`
    + `${measured ? `  (${Math.round(100 * dec.length / measured)}% decorative)` : ''}`);
  if (runs > 1 && unstable.length) {
    console.log(`  ${unstable.length} item(s) answered differently across identical prompts.  That is the instrument.`);
  }
  console.log('\n  A "decorative" row is a reason to go and read the item, not a verdict on it: this pass');
  console.log('  can only UNDER-report, since a model answering from the passage proves the passage');
  console.log('  suffices, while a model that fails may simply have failed.');
}

main().catch((e) => { console.error('figure-necessity: ' + e.message); process.exit(2); });
