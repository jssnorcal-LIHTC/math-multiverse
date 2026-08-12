'use strict';
// blind-reanswer.js -- LOCAL ONLY. Answers every comparable item in a pack with no access to the
// key, the explanation or the rationales, then writes packs/<packId>.verdicts.json. CI never runs
// this; CI only validates the committed ledger (see tests/verdicts.js).
//
//   node tests/blind-reanswer.js ela-g6-spy
//   node tests/blind-reanswer.js ela-g6-spy --only i-mc-1,i-ebsr-1
//   node tests/blind-reanswer.js ela-g6-spy --concurrency 2
//
// Uses the `claude -p` subscription CLI on purpose. This is authoring-time verification that runs
// hundreds of calls; paying metered API rates for it would be the wrong tool.
//
// Existing adjudicated records are PRESERVED when their itemHash still matches, so a re-run never
// silently discards a human decision.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadPackFile } = require('./validate-pack');
const { itemHash, blindQuestion, authoredKeyOf, sameAnswer } = require('./verdicts');

const PACK_DIR = path.join(__dirname, '..', 'packs');
const MODEL_LABEL = process.env.BLIND_MODEL || 'claude-sonnet-5';

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

// PASSAGE-AWARE (N4 fix, 26-0807): the single seam both call sites below go through, so there is
// exactly one place that could regress back to the legacy no-passage hash, not two. Resolves the
// item's own passage by passageId and folds it into itemHash exactly like validateLedger() does in
// tests/verdicts.js -- an item whose passage was rewritten underneath it must dirty here too, or a
// stale answer can survive a passage edit unexamined (the defect N4 exists to catch). Exported so
// tests/verdicts.test.js can pin this against the REAL function, not a hand-reimplementation of the
// resolve-then-hash logic in the test fixture, which is how the pre-fix legacy calls at these two
// sites escaped review in the first place: the fixture computed hashes manually and never exercised
// this file's own resolution path.
// V3: threads the item's FIGURE as well as its passage, because a figure-bearing item's hash pins
// the figure's dataTable.  Same seam reasoning as the passage fix above: both call sites go
// through here, so neither can drift into hashing without the figure.
function resolvedItemHash(item, passages, figures) {
  return itemHash(item, passages.get(item.passageId), figures && figures.get(item.figureId));
}

// VERIFIED 26-0725 against the installed CLI; do not "simplify" this back to execFile with a shell.
// Two traps, both proven by probe rather than reasoned about:
//   1. `shell: true` on Windows CONCATENATES argv rather than escaping it, so a multi-line prompt is
//      torn apart at the newlines and the call fails outright. No shell.
//   2. The CLI waits 3s for piped stdin it will never receive and prints a warning. Close stdin at once.
// The CLI returns BARE JSON with no envelope, e.g. {"answer": "B", "confidence": "high"}, which is what
// parseAnswer below is written against.
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt, '--model', MODEL_LABEL], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', errOut = '';
    // Raised 120s -> 300s (26-0807, fix round 2, ledger item 4): the timing distribution straddled
    // the old cutoff (one ms item completed at 96.7s, two runs of the SAME item exceeded 120s), so
    // the cutoff itself was the defect, not any particular call. 300s comfortably clears that
    // straddle without masking a genuine hang; the existing 120000ms callers are gone, this constant
    // is the only definition. (26-0807, fix round 2 of THIS task: the science-gate ruling verified
    // "300s cutoff in code" against the workspace build copy only; this committed file still carried
    // 120s, same workspace-vs-committed divergence class as the itemHash fix above, one constant.)
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('claude CLI timed out after 300s'));
    }, 300000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errOut += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude CLI failed to start: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${errOut.slice(0, 200)}`));
      resolve(out);
    });
    child.stdin.end();   // never leave it open; see trap 2 above
  });
}

// The CLI returns prose around the JSON often enough that a bare JSON.parse is not safe.
function parseAnswer(raw, optionCount) {
  // /g on purpose. Without it .match() returns only the FIRST hit, so a model that second-guesses
  // itself mid-reply and emits two candidate objects has its abandoned answer used silently. That can
  // manufacture a false "agree" that papers over a real ambiguity, which is the dangerous direction.
  // Two objects is now a hard error rather than a guess.
  const all = String(raw).match(/\{[^{}]*"answer"[^{}]*\}/g);
  if (!all) throw new Error('no JSON object with an "answer" field in the reply: ' + String(raw).slice(0, 160));
  if (all.length > 1) {
    throw new Error('reply contained ' + all.length + ' JSON objects with an "answer" field; refusing to guess which was meant: ' + all.join(' | ').slice(0, 200));
  }
  const m = all;
  const obj = JSON.parse(m[0]);
  const toIdx = (L) => {
    const i = String(L).trim().toUpperCase().charCodeAt(0) - 65;
    if (!Number.isInteger(i) || i < 0 || i >= optionCount) throw new Error(`answer "${L}" is outside A to ${String.fromCharCode(64 + optionCount)}`);
    return i;
  };
  // DO NOT SORT. This will look like a tidy-up to the next reader; it is the opposite. The recorded
  // blind answer is EVIDENCE of what the model actually said, and evidence must not be normalised on
  // the way in. For order, cloze and match the position IS the answer, so sorting a correct reply of
  // ["B","D","A","E","C"] into [0,1,2,3,4] rewrote it into the authored key, and the ledger then
  // logged "agree" on an item that nothing had checked -- silently converting "not verified" into
  // "verified and fine". A comparison that legitimately needs set semantics sorts at COMPARISON time
  // and only for the types that are sets (see sameAnswer in verdicts.js), never at record time.
  const answer = Array.isArray(obj.answer) ? obj.answer.map(toIdx) : toIdx(obj.answer);
  return { answer, confidence: obj.confidence || 'unknown' };
}

async function pool(jobs, size) {
  const out = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      try { out[i] = await jobs[i](); }
      catch (e) { out[i] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
  return out;
}

async function main() {
  const packId = process.argv[2];
  if (!packId || packId.startsWith('--')) {
    console.error('usage: node tests/blind-reanswer.js <packId> [--only id,id] [--concurrency N]');
    process.exit(2);
  }
  const packPath = path.join(PACK_DIR, packId + '.json');
  const ledgerPath = path.join(PACK_DIR, packId + '.verdicts.json');
  if (!fs.existsSync(packPath)) { console.error(`blind-reanswer: pack not found: ${packPath}`); process.exit(2); }

  const pack = loadPackFile(packPath);
  const passages = new Map((pack.passages || []).map(p => [p.id, p]));
  // V3: figures by id, so a figure-bearing item's chart data reaches both the hash and the prompt.
  const figures = new Map((pack.figures || []).map(f => [f.id, f]));
  const only = arg('--only', null);
  const onlySet = only ? new Set(only.split(',').map(s => s.trim())) : null;
  // Default 2, not 4: at concurrency 4 the 26-0725 run lost 18 of 70 items to the 120s
  // per-call timeout (the claude CLI queues under load rather than failing fast), which
  // silently downgraded "checked" to "timed out, prior record carried forward". Concurrency
  // 2 is the highest value that ran the full 70-item pack clean. Override with --concurrency
  // if the CLI's own throughput ever changes, but re-prove it against the full pack first.
  const concurrency = Math.max(1, parseInt(arg('--concurrency', '2'), 10));

  // Preserve prior records whose item is unchanged. Never discard a human adjudication silently.
  const prior = new Map();
  if (fs.existsSync(ledgerPath)) {
    try { (loadPackFile(ledgerPath).records || []).forEach(r => prior.set(r.itemId, r)); }
    catch (e) { console.error('blind-reanswer: existing ledger is unreadable, refusing to overwrite: ' + e.message); process.exit(2); }
  }

  const todo = [];
  const keep = [];
  for (const item of pack.items || []) {
    if (authoredKeyOf(item) === null) continue;
    const h = resolvedItemHash(item, passages, figures);
    const p = prior.get(item.id);
    if (onlySet && !onlySet.has(item.id)) {
      if (p) keep.push(p);
      continue;
    }
    if (p && p.itemHash === h && p.status === 'adjudicated') { keep.push(p); continue; }
    if (p && p.itemHash === h && p.status === 'agree' && !onlySet) { keep.push(p); continue; }
    todo.push(item);
  }

  if (!todo.length) {
    console.log(`blind-reanswer: nothing to do (${keep.length} record(s) already current)`);
    process.exit(0);
  }
  console.log(`blind-reanswer: ${todo.length} item(s) to check, ${keep.length} already current, concurrency ${concurrency}`);

  const jobs = todo.map(item => async () => {
    const passage = passages.get(item.passageId);
    if (!passage) throw new Error(`item ${item.id} has no resolvable passage`);
    const { prompt, optionCount } = blindQuestion(item, passage, figures.get(item.figureId));
    const raw = await callClaude(prompt);
    const { answer, confidence } = parseAnswer(raw, optionCount);
    return { item, answer, confidence };
  });

  const results = await pool(jobs, concurrency);

  let agree = 0, disagree = 0, failed = 0;
  const fresh = [];
  results.forEach((r, i) => {
    const item = todo[i];
    if (!r || r.error) {
      failed++;
      console.log('  ERROR  ' + item.id + ': ' + (r && r.error));
      // Carry the PRIOR record forward untouched rather than dropping it. The ledger write below is
      // unconditional, so without this a transient CLI timeout or a parse failure silently deletes a
      // human adjudication, note and all, contradicting this file's own guarantee. The record is kept
      // with its now-stale itemHash, so validate-pack still refuses the pack until it is re-run: nothing
      // is lost AND nothing is falsely blessed.
      const prev = prior.get(item.id);
      if (prev) {
        keep.push(prev);
        console.log('         prior verdict preserved (stale hash, will still block the pack)');
      }
      return;
    }
    const authored = authoredKeyOf(item);
    // Shares the one type-aware comparison with the CI validator rather than re-implementing it. The
    // hand-rolled version here sorted both sides unconditionally, so this pass wrote status:"agree"
    // for an order, cloze or match item whose blind answer did not match at all.
    const same = sameAnswer(r.answer, authored, item.type);
    if (same) { agree++; console.log(`  agree  ${item.id}  (${r.confidence})`); }
    else { disagree++; console.log(`  DISAGREE ${item.id}: blind ${JSON.stringify(r.answer)} vs authored ${JSON.stringify(authored)}  (${r.confidence})`); }
    fresh.push({
      itemId: item.id, itemHash: resolvedItemHash(item, passages, figures),
      blind: r.answer, authored, confidence: r.confidence,
      status: same ? 'agree' : 'needs-adjudication',
    });
  });

  const out = { packId, model: MODEL_LABEL, records: keep.concat(fresh) };
  fs.writeFileSync(ledgerPath, JSON.stringify(out, null, 2) + '\n');

  console.log(`\n=== blind-reanswer: ${agree} agree, ${disagree} disagree, ${failed} failed ===`);
  console.log(`ledger written: ${ledgerPath}`);

  // ROSTER COVERAGE. Every comparable item must end up with a record, and the run must say so out
  // loud rather than leaving the count to be noticed downstream.
  //
  // The gap this closes: when a job fails, the code above carries the PRIOR record forward so a
  // human adjudication is never destroyed. An item that is NEW has no prior record to carry, so it
  // leaves the ledger one short. The run does already signal that (an ERROR line, a failed count, and
  // a non-zero exit), and validate-pack independently refuses the pack, so nothing was ever silently
  // blessed. What was missing is an assertion that names WHICH items are absent, at the moment the
  // ledger is written, instead of a reader having to derive it from two counts.
  const rosterIds = (pack.items || []).filter(i => authoredKeyOf(i) !== null).map(i => i.id);
  const writtenIds = new Set(out.records.map(r => r.itemId));
  const missingIds = rosterIds.filter(id => !writtenIds.has(id));
  console.log(`roster coverage: ${writtenIds.size} record(s) written for ${rosterIds.length} comparable item(s)` +
    ` (${(pack.items || []).length - rosterIds.length} blind-exempt)`);
  if (missingIds.length) {
    console.log(`\nROSTER SHORTFALL: ${missingIds.length} comparable item(s) have NO record:`);
    missingIds.forEach(id => console.log(`  MISSING  ${id}`));
    console.log('Re-run those ids with --only before the pack can ship.');
  }

  if (disagree) {
    console.log('\nEvery "needs-adjudication" record must become "adjudicated" with a note, an');
    console.log('adjudicatedBy and an adjudicatedAt, or the item must be fixed. validate-pack will');
    console.log('reject the pack until then, which is the point.');
  }
  process.exit((failed || missingIds.length) ? 1 : 0);
}

// The roster-coverage rule, exported so it can be exercised without an API run. A check that has
// never been watched fail is an assumption; `node tests/blind-reanswer.js --self-test-roster` runs it
// against a synthetic ledger that is missing one roster id and requires it to fire.
function rosterShortfall(items, records) {
  const roster = (items || []).filter(i => authoredKeyOf(i) !== null).map(i => i.id);
  const written = new Set((records || []).map(r => r.itemId));
  return roster.filter(id => !written.has(id));
}

function selfTestRoster() {
  const items = [
    { id: 'a', type: 'mc', key: 0 },
    { id: 'b', type: 'order', key: [1, 0] },
    { id: 'c', type: 'shorttext', accept: ['x'], maxWords: 3 },
  ];
  const full = [{ itemId: 'a' }, { itemId: 'b' }];
  const short = [{ itemId: 'a' }];
  const controls = [
    ['a complete ledger reports no shortfall', rosterShortfall(items, full).length === 0],
    ['a ledger missing one roster id FIRES, naming it', JSON.stringify(rosterShortfall(items, short)) === '["b"]'],
    ['the blind-exempt shorttext is never counted into the roster', !rosterShortfall(items, []).includes('c')],
    ['an empty ledger fires for every comparable id', rosterShortfall(items, []).length === 2],
  ];
  let bad = 0;
  console.log('blind-reanswer: roster-coverage self test');
  for (const [label, ok] of controls) { console.log(`  ${ok ? 'CONTROL FIRED ' : 'CONTROL MISSED'}  ${label}`); if (!ok) bad++; }
  console.log(`  ${controls.length - bad} of ${controls.length} controls fired`);
  process.exit(bad ? 1 : 0);
}

// Only run a pack when invoked directly. tests/verdicts.test.js requires this file to reach
// parseAnswer, and a bare require must not start a run or call process.exit.
if (require.main === module && process.argv.includes('--self-test-roster')) {
  selfTestRoster();
} else if (require.main === module) {
  main().catch(e => { console.error('blind-reanswer crashed: ' + (e && e.stack || e)); process.exit(2); });
}

module.exports = { parseAnswer, resolvedItemHash };
