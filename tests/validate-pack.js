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
// Task 5 replaces this with the per-type key and shape checks.
function checkItemShape(item, passagesById, errors) { /* task 5 */ }
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
