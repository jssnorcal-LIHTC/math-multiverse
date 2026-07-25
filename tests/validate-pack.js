'use strict';
// validate-pack.js -- the content gate for authored packs.
//
// Math content is verified by an independent arithmetic oracle (tests/oracles.js). There is no
// oracle for "which line best supports the claim," so authored content is gated by structural
// validation, content validation, and a committed blind re-answer ledger instead. A pack that
// fails any check does not ship.
//
//   node tests/validate-pack.js                    validate every pack in packs/
//   node tests/validate-pack.js packs/ela-g6-spy.json
//
// HARD RULE (k8s-thinking): finding no packs is a FAILURE, never a silent pass. A validator that
// validates nothing must never report clean.

const fs = require('fs');
const path = require('path');
const { isTarget } = require('./targets');

const PACK_DIR = path.join(__dirname, '..', 'packs');

const ITEM_TYPES   = Object.freeze(['mc', 'ms', 'ebsr', 'hottext', 'match', 'order', 'cloze', 'shorttext', 'listen', 'write']);
const AUTO_TYPES   = Object.freeze(['mc', 'ms', 'ebsr', 'hottext', 'match', 'order', 'cloze', 'shorttext']);
const CHOICE_TYPES = Object.freeze(['mc', 'ms', 'ebsr', 'cloze']);
const GENRES       = Object.freeze(['literary', 'informational']);

function loadPackFile(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`${path.basename(absPath)}: invalid JSON: ${e.message}`); }
}

function nonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

// ---------- envelope: meta ----------
function checkMeta(pack, errors, expectedId) {
  const m = pack.meta;
  if (!m || typeof m !== 'object') { errors.push('meta: missing or not an object'); return; }
  for (const k of ['id', 'subject', 'title']) {
    if (!nonEmptyString(m[k])) errors.push(`meta.${k}: missing or empty`);
  }
  if (!Number.isInteger(m.grade)) errors.push(`meta.grade: must be an integer, got ${JSON.stringify(m.grade)}`);
  if (!Number.isInteger(m.version)) errors.push(`meta.version: must be an integer, got ${JSON.stringify(m.version)}`);
  if (nonEmptyString(m.subject) && !/^[a-z]+$/.test(m.subject)) {
    errors.push(`meta.subject: must be a lowercase slug, got "${m.subject}"`);
  }
  if (nonEmptyString(m.id) && expectedId && m.id !== expectedId) {
    errors.push(`meta.id: "${m.id}" does not match filename "${expectedId}"`);
  }
}

// ---------- envelope: passages ----------
function checkPassages(pack, errors) {
  const list = pack.passages;
  if (!Array.isArray(list)) { errors.push('passages: missing or not an array'); return new Map(); }
  const byId = new Map();
  list.forEach((p, i) => {
    const where = `passages[${i}]`;
    if (!p || typeof p !== 'object') { errors.push(`${where}: not an object`); return; }
    if (!nonEmptyString(p.id)) { errors.push(`${where}.id: missing or empty`); return; }
    if (byId.has(p.id)) errors.push(`${where}: duplicate passage id "${p.id}"`);
    else byId.set(p.id, p);
    if (!nonEmptyString(p.title))  errors.push(`${where}(${p.id}).title: missing or empty`);
    if (!nonEmptyString(p.text))   errors.push(`${where}(${p.id}).text: missing or empty`);
    if (!nonEmptyString(p.source)) errors.push(`${where}(${p.id}).source: missing (use "original" for authored text)`);
    if (!GENRES.includes(p.genre)) errors.push(`${where}(${p.id}).genre: must be one of ${GENRES.join(', ')}, got ${JSON.stringify(p.genre)}`);
  });
  return byId;
}

// ---------- envelope: items ----------
function checkItemEnvelope(pack, passagesById, errors) {
  const list = pack.items;
  if (!Array.isArray(list)) { errors.push('items: missing or not an array'); return new Map(); }
  const byId = new Map();
  list.forEach((it, i) => {
    const where = `items[${i}]`;
    if (!it || typeof it !== 'object') { errors.push(`${where}: not an object`); return; }
    if (!nonEmptyString(it.id)) { errors.push(`${where}.id: missing or empty`); return; }
    const w = `items(${it.id})`;
    if (byId.has(it.id)) errors.push(`${where}: duplicate item id "${it.id}"`);
    else byId.set(it.id, it);

    if (!ITEM_TYPES.includes(it.type)) {
      errors.push(`${w}.type: must be one of ${ITEM_TYPES.join(', ')}, got ${JSON.stringify(it.type)}`);
    }
    if (it.passageId !== undefined && !passagesById.has(it.passageId)) {
      errors.push(`${w}.passageId: "${it.passageId}" does not resolve to any passage`);
    }
    if (!Array.isArray(it.targets) || it.targets.length === 0) {
      errors.push(`${w}.targets: must be a non-empty array of target ids`);
    } else {
      for (const t of it.targets) {
        if (!isTarget(t)) errors.push(`${w}.targets: "${t}" is not a known target id (see tests/targets.js)`);
      }
    }
    if (!nonEmptyString(it.coachTopic)) errors.push(`${w}.coachTopic: missing or empty`);
    if (it.dok !== undefined && ![1, 2, 3, 4].includes(it.dok)) {
      errors.push(`${w}.dok: must be 1, 2, 3 or 4 when present, got ${JSON.stringify(it.dok)}`);
    }
  });
  return byId;
}

// ---------- envelope: levels ----------
function checkLevels(pack, itemsById, errors, warnings) {
  const list = pack.levels;
  if (!Array.isArray(list) || list.length === 0) { errors.push('levels: missing or empty'); return new Set(); }
  const referenced = new Set();
  list.forEach((lv, i) => {
    const where = `levels[${i}]`;
    if (!lv || typeof lv !== 'object') { errors.push(`${where}: not an object`); return; }
    if (!Number.isInteger(lv.id))     errors.push(`${where}.id: must be an integer`);
    if (!nonEmptyString(lv.name))     errors.push(`${where}.name: missing or empty`);
    if (!nonEmptyString(lv.goal))     errors.push(`${where}.goal: missing or empty`);
    if (!Array.isArray(lv.targets) || lv.targets.length === 0) {
      errors.push(`${where}.targets: must be a non-empty array`);
    } else {
      for (const t of lv.targets) {
        if (!isTarget(t)) errors.push(`${where}.targets: "${t}" is not a known target id`);
      }
    }
    if (!Array.isArray(lv.itemIds) || lv.itemIds.length === 0) {
      errors.push(`${where}.itemIds: must be a non-empty array`);
      return;
    }
    for (const id of lv.itemIds) {
      if (!itemsById.has(id)) errors.push(`${where}.itemIds: "${id}" does not resolve to any item`);
      else referenced.add(id);
    }
    if (!Number.isInteger(lv.questions) || lv.questions < 1) {
      errors.push(`${where}.questions: must be a positive integer`);
    } else if (lv.questions > lv.itemIds.length) {
      errors.push(`${where}.questions: asks for ${lv.questions} but the level only has ${lv.itemIds.length} item(s)`);
    }
  });
  for (const id of itemsById.keys()) {
    if (!referenced.has(id)) warnings.push(`items(${id}): not referenced by any level (orphan)`);
  }
  return referenced;
}

// ---------- hooks filled by later tasks ----------
function isIntIn(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }

function checkChoiceBlock(block, where, minN, maxN, errors) {
  if (!Array.isArray(block.choices)) { errors.push(`${where}.choices: must be an array`); return false; }
  const n = block.choices.length;
  if (n < minN || n > maxN) errors.push(`${where}.choices: must hold ${minN} to ${maxN} options, got ${n}`);
  if (!block.choices.every(nonEmptyString)) errors.push(`${where}.choices: every option must be a non-empty string`);
  const seen = new Set();
  for (const c of block.choices) {
    const norm = String(c).trim().toLowerCase();
    if (seen.has(norm)) errors.push(`${where}.choices: duplicate option "${c}"`);
    seen.add(norm);
  }
  return n > 0;
}

function checkItemShape(item, passagesById, errors) {
  const w = `items(${item.id})`;
  if (!ITEM_TYPES.includes(item.type)) return;   // already reported by the envelope check

  // Every type except ebsr needs a top-level stem. ebsr carries its prompts in partA.stem and
  // partB.stem, checked separately below; cloze DOES need the top-level stem, because that is
  // where its {{n}} tokens live.
  if (!nonEmptyString(item.stem) && item.type !== 'ebsr') {
    errors.push(`${w}.stem: missing or empty`);
  }

  switch (item.type) {
    case 'mc': {
      if (!checkChoiceBlock(item, w, 3, 5, errors)) break;
      if (!isIntIn(item.key, 0, item.choices.length - 1)) {
        errors.push(`${w}.key: must be an integer index into choices (0 to ${item.choices.length - 1}), got ${JSON.stringify(item.key)}`);
      }
      break;
    }
    case 'ms': {
      if (!checkChoiceBlock(item, w, 4, 6, errors)) break;
      const k = item.key;
      if (!Array.isArray(k) || k.length < 2) {
        errors.push(`${w}.key: multi-select needs an array of two or more indices, got ${JSON.stringify(k)}`);
        break;
      }
      if (!k.every(i => isIntIn(i, 0, item.choices.length - 1))) {
        errors.push(`${w}.key: every index must fall inside choices (0 to ${item.choices.length - 1}), got ${JSON.stringify(k)}`);
      }
      if (new Set(k).size !== k.length) errors.push(`${w}.key: contains a duplicate index`);
      for (let i = 1; i < k.length; i++) {
        if (k[i] <= k[i - 1]) { errors.push(`${w}.key: must be in ascending order, got ${JSON.stringify(k)}`); break; }
      }
      if (k.length === item.choices.length) errors.push(`${w}.key: every option cannot be correct`);
      break;
    }
    case 'ebsr': {
      const A = item.partA, B = item.partB;
      if (!A || typeof A !== 'object') { errors.push(`${w}.partA: missing`); break; }
      if (!B || typeof B !== 'object') { errors.push(`${w}.partB: missing`); break; }
      if (!nonEmptyString(A.stem)) errors.push(`${w}.partA.stem: missing or empty`);
      if (!nonEmptyString(B.stem)) errors.push(`${w}.partB.stem: missing or empty`);
      const aOk = checkChoiceBlock(A, `${w}.partA`, 3, 4, errors);
      const bOk = checkChoiceBlock(B, `${w}.partB`, 3, 4, errors);
      if (!aOk || !bOk) break;
      if (!isIntIn(A.key, 0, A.choices.length - 1)) {
        errors.push(`${w}.partA.key: must index partA.choices, got ${JSON.stringify(A.key)}`);
      }
      // The signature EBSR rule: the correct evidence depends on which Part A the student chose,
      // so partB.key is a map from every Part A index to a Part B index. A fixed scalar key here
      // is the most common way a homemade EBSR is silently wrong.
      if (!B.key || typeof B.key !== 'object' || Array.isArray(B.key)) {
        errors.push(`${w}.partB.key: must be an object mapping each partA index to a partB index`);
        break;
      }
      for (let a = 0; a < A.choices.length; a++) {
        if (!Object.prototype.hasOwnProperty.call(B.key, String(a))) {
          errors.push(`${w}.partB.key: no entry for partA index ${a}; every Part A choice needs its best supporting evidence`);
          continue;
        }
        const bIdx = B.key[String(a)];
        if (!isIntIn(bIdx, 0, B.choices.length - 1)) {
          errors.push(`${w}.partB.key["${a}"]: must index partB.choices (0 to ${B.choices.length - 1}), got ${JSON.stringify(bIdx)}`);
        }
      }
      break;
    }
    case 'hottext': {
      if (!['sentence', 'word'].includes(item.mode)) {
        errors.push(`${w}.mode: must be "sentence" or "word", got ${JSON.stringify(item.mode)}`);
      }
      if (!Array.isArray(item.spans) || item.spans.length < 2) {
        errors.push(`${w}.spans: needs at least two selectable spans, got ${JSON.stringify(item.spans)}`);
        break;
      }
      if (!item.spans.every(nonEmptyString)) errors.push(`${w}.spans: every span must be a non-empty string`);
      if (!Array.isArray(item.key) || item.key.length < 1) {
        errors.push(`${w}.key: needs an array of at least one span index`);
        break;
      }
      if (!item.key.every(i => isIntIn(i, 0, item.spans.length - 1))) {
        errors.push(`${w}.key: every index must fall inside spans (0 to ${item.spans.length - 1}), got ${JSON.stringify(item.key)}`);
      }
      // Same guard ms carries. A repeated index inflates "how many spans to find" past the number
      // of distinct correct spans, and the grader's set-dedup would silently disagree with the key.
      if (new Set(item.key).size !== item.key.length) {
        errors.push(`${w}.key: contains a duplicate span index, got ${JSON.stringify(item.key)}`);
      }
      if (item.key.length === item.spans.length) errors.push(`${w}.key: every span cannot be correct`);
      break;
    }
    case 'match': {
      const rows = item.rowLabels, cols = item.colLabels;
      if (!Array.isArray(rows) || rows.length < 2) { errors.push(`${w}.rowLabels: needs at least two rows`); break; }
      if (!Array.isArray(cols) || cols.length < 2) { errors.push(`${w}.colLabels: needs at least two columns`); break; }
      if (!rows.every(nonEmptyString)) errors.push(`${w}.rowLabels: every label must be a non-empty string`);
      if (!cols.every(nonEmptyString)) errors.push(`${w}.colLabels: every label must be a non-empty string`);
      if (!Array.isArray(item.key) || item.key.length < 1) { errors.push(`${w}.key: needs at least one [row, col] pair`); break; }
      const seen = new Set();
      item.key.forEach((cell, i) => {
        if (!Array.isArray(cell) || cell.length !== 2) { errors.push(`${w}.key[${i}]: must be a [row, col] pair`); return; }
        const [r, c] = cell;
        if (!isIntIn(r, 0, rows.length - 1) || !isIntIn(c, 0, cols.length - 1)) {
          errors.push(`${w}.key[${i}]: cell [${r}, ${c}] falls outside the ${rows.length} by ${cols.length} table`);
          return;
        }
        const sig = r + ',' + c;
        if (seen.has(sig)) errors.push(`${w}.key: cell [${r}, ${c}] listed twice`);
        seen.add(sig);
      });
      // A match item is a row-to-column FUNCTION: every row needs EXACTLY one correct column.
      // Without this, a row with no correct cell is unanswerable no matter what the student picks,
      // and a row correct in two columns is self-contradictory; the runtime cannot resolve either
      // without guessing. The per-cell dedup above does not catch it, because it keys on the whole
      // (row, col) pair rather than on the row.
      const perRow = new Map();
      for (const cell of item.key) {
        if (!Array.isArray(cell) || cell.length !== 2) continue;   // already reported above
        const r = Number(cell[0]);
        perRow.set(r, (perRow.get(r) || 0) + 1);
      }
      for (let r = 0; r < rows.length; r++) {
        const n = perRow.get(r) || 0;
        if (n === 0) {
          errors.push(`${w}.key: row ${r} ("${rows[r]}") has no correct column; every row needs exactly one`);
        } else if (n > 1) {
          errors.push(`${w}.key: row ${r} ("${rows[r]}") is marked correct in ${n} columns; every row needs exactly one`);
        }
      }
      break;
    }
    case 'order': {
      if (!Array.isArray(item.tiles) || item.tiles.length < 3) { errors.push(`${w}.tiles: needs at least three tiles`); break; }
      if (!item.tiles.every(nonEmptyString)) errors.push(`${w}.tiles: every tile must be a non-empty string`);
      const k = item.key;
      if (!Array.isArray(k) || k.length !== item.tiles.length) {
        errors.push(`${w}.key: must be a permutation the same length as tiles (${item.tiles.length}), got ${JSON.stringify(k)}`);
        break;
      }
      const sorted = [...k].sort((a, b) => a - b);
      const expected = item.tiles.map((_, i) => i);
      if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
        errors.push(`${w}.key: must be a full permutation of 0 to ${item.tiles.length - 1} with no repeats, got ${JSON.stringify(k)}`);
      }
      break;
    }
    case 'cloze': {
      if (!Array.isArray(item.blanks) || item.blanks.length < 1) { errors.push(`${w}.blanks: needs at least one blank`); break; }
      const tokens = String(item.stem || '').match(/\{\{(\d+)\}\}/g) || [];
      if (tokens.length !== item.blanks.length) {
        errors.push(`${w}: stem holds ${tokens.length} {{n}} token(s) but blanks holds ${item.blanks.length}; they must match one to one`);
      }
      for (let i = 0; i < item.blanks.length; i++) {
        if (!String(item.stem || '').includes(`{{${i}}}`)) {
          errors.push(`${w}.stem: missing the token {{${i}}} for blanks[${i}]`);
        }
      }
      item.blanks.forEach((b, i) => {
        const bw = `${w}.blanks[${i}]`;
        if (!b || typeof b !== 'object') { errors.push(`${bw}: not an object`); return; }
        if (!checkChoiceBlock(b, bw, 2, 4, errors)) return;
        if (!isIntIn(b.key, 0, b.choices.length - 1)) {
          errors.push(`${bw}.key: must index its own choices, got ${JSON.stringify(b.key)}`);
        }
      });
      break;
    }
    case 'shorttext': {
      if (!Array.isArray(item.accept) || item.accept.length < 1) {
        errors.push(`${w}.accept: needs at least one accepted answer string`);
        break;
      }
      if (!item.accept.every(nonEmptyString)) errors.push(`${w}.accept: every accepted answer must be a non-empty string`);
      if (!isIntIn(item.maxWords, 1, 40)) {
        errors.push(`${w}.maxWords: must be an integer from 1 to 40, got ${JSON.stringify(item.maxWords)}`);
      }
      break;
    }
    case 'listen':
    case 'write':
      // Reserved. Phase 3 and phase 4 add their shape rules; a pack that ships one now fails
      // rather than passing unvalidated.
      errors.push(`${w}.type: "${item.type}" is reserved for a later phase and cannot ship yet`);
      break;
  }
}
// Task 6 replaces this with verbatim spans, readability, coach resolution and coverage.
function contentChecks(pack, passagesById, itemsById, errors, warnings) { /* task 6 */ }

function validatePack(pack, opts) {
  const errors = [], warnings = [];
  const expectedId = opts && opts.expectedId;
  if (!pack || typeof pack !== 'object') { errors.push('pack: not an object'); return { errors, warnings }; }

  checkMeta(pack, errors, expectedId);
  const passagesById = checkPassages(pack, errors);
  const itemsById = checkItemEnvelope(pack, passagesById, errors);
  checkLevels(pack, itemsById, errors, warnings);
  for (const it of itemsById.values()) checkItemShape(it, passagesById, errors);
  contentChecks(pack, passagesById, itemsById, errors, warnings);

  return { errors, warnings };
}

// ---------- CLI ----------
function main(argv) {
  let files = argv.slice(2);
  if (files.length === 0) {
    if (!fs.existsSync(PACK_DIR)) {
      console.error(`validate-pack: pack directory not found: ${PACK_DIR}`);
      return 2;
    }
    files = fs.readdirSync(PACK_DIR)
      .filter(f => f.endsWith('.json') && !f.endsWith('.verdicts.json') && f !== 'manifest.json')
      .map(f => path.join(PACK_DIR, f));
  }
  if (files.length === 0) {
    console.error('validate-pack: no packs found. A validator that validates nothing must not report clean.');
    return 2;
  }

  let totalErrors = 0, totalWarnings = 0;
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
    const expectedId = path.basename(abs).replace(/\.json$/, '');
    let pack;
    try { pack = loadPackFile(abs); }
    catch (e) { console.log(`\n${expectedId}\n  LOAD FAILED: ${e.message}`); totalErrors++; continue; }

    const { errors, warnings } = validatePack(pack, { expectedId });
    const nItems = Array.isArray(pack.items) ? pack.items.length : 0;
    console.log(`\n${expectedId}  (${nItems} item(s))`);
    errors.forEach(e => console.log('  ERROR   ' + e));
    warnings.forEach(w => console.log('  warning ' + w));
    if (!errors.length && !warnings.length) console.log('  clean');
    totalErrors += errors.length;
    totalWarnings += warnings.length;
  }

  console.log(`\n=== validate-pack: ${files.length} pack(s), ${totalErrors} error(s), ${totalWarnings} warning(s) ===`);
  if (totalErrors) { console.log('RESULT: FAIL'); return 1; }
  console.log('RESULT: ALL CLEAN');
  return 0;
}

module.exports = { validatePack, loadPackFile, ITEM_TYPES, AUTO_TYPES, CHOICE_TYPES, GENRES };

if (require.main === module) process.exit(main(process.argv));
