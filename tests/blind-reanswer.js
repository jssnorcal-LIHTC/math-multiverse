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
const { execFile } = require('child_process');
const { loadPackFile } = require('./validate-pack');
const { itemHash, blindQuestion, authoredKeyOf } = require('./verdicts');

const PACK_DIR = path.join(__dirname, '..', 'packs');
const MODEL_LABEL = process.env.BLIND_MODEL || 'claude-sonnet-5';

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    // The prompt goes in on stdin, never as an argv element. On win32 the child is spawned through
    // a shell so that `claude` resolves to claude.exe, and a multi-line prompt containing quotes
    // would not survive cmd.exe quoting. Only shell-safe flags are passed as arguments.
    const args = ['-p', '--model', MODEL_LABEL];
    const child = execFile('claude', args, { timeout: 120000, maxBuffer: 1 << 20, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`claude CLI failed: ${err.message} ${String(stderr).slice(0, 200)}`));
      resolve(String(stdout));
    });
    // A child killed by the timeout closes stdin early; the execFile callback already reports that,
    // so swallow the EPIPE rather than letting it become an unhandled error event.
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// The CLI returns prose around the JSON often enough that a bare JSON.parse is not safe.
function parseAnswer(raw, optionCount) {
  const m = String(raw).match(/\{[^{}]*"answer"[^{}]*\}/);
  if (!m) throw new Error('no JSON object with an "answer" field in the reply: ' + String(raw).slice(0, 160));
  const obj = JSON.parse(m[0]);
  const toIdx = (L) => {
    const i = String(L).trim().toUpperCase().charCodeAt(0) - 65;
    if (!Number.isInteger(i) || i < 0 || i >= optionCount) throw new Error(`answer "${L}" is outside A to ${String.fromCharCode(64 + optionCount)}`);
    return i;
  };
  const answer = Array.isArray(obj.answer) ? obj.answer.map(toIdx).sort((a, b) => a - b) : toIdx(obj.answer);
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

(async () => {
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
  const only = arg('--only', null);
  const onlySet = only ? new Set(only.split(',').map(s => s.trim())) : null;
  const concurrency = Math.max(1, parseInt(arg('--concurrency', '4'), 10));

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
    const h = itemHash(item);
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
    const { prompt, optionCount } = blindQuestion(item, passage);
    const raw = await callClaude(prompt);
    const { answer, confidence } = parseAnswer(raw, optionCount);
    return { item, answer, confidence };
  });

  const results = await pool(jobs, concurrency);

  let agree = 0, disagree = 0, failed = 0;
  const fresh = [];
  results.forEach((r, i) => {
    const item = todo[i];
    if (!r || r.error) { failed++; console.log(`  ERROR  ${item.id}: ${r && r.error}`); return; }
    const authored = authoredKeyOf(item);
    const same = JSON.stringify(Array.isArray(authored) ? authored.slice().sort() : authored)
              === JSON.stringify(Array.isArray(r.answer) ? r.answer.slice().sort() : r.answer);
    if (same) { agree++; console.log(`  agree  ${item.id}  (${r.confidence})`); }
    else { disagree++; console.log(`  DISAGREE ${item.id}: blind ${JSON.stringify(r.answer)} vs authored ${JSON.stringify(authored)}  (${r.confidence})`); }
    fresh.push({
      itemId: item.id, itemHash: itemHash(item),
      blind: r.answer, authored, confidence: r.confidence,
      status: same ? 'agree' : 'needs-adjudication',
    });
  });

  const out = { packId, model: MODEL_LABEL, records: keep.concat(fresh) };
  fs.writeFileSync(ledgerPath, JSON.stringify(out, null, 2) + '\n');

  console.log(`\n=== blind-reanswer: ${agree} agree, ${disagree} disagree, ${failed} failed ===`);
  console.log(`ledger written: ${ledgerPath}`);
  if (disagree) {
    console.log('\nEvery "needs-adjudication" record must become "adjudicated" with a note, an');
    console.log('adjudicatedBy and an adjudicatedAt, or the item must be fixed. validate-pack will');
    console.log('reject the pack until then, which is the point.');
  }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('blind-reanswer crashed: ' + (e && e.stack || e)); process.exit(2); });
