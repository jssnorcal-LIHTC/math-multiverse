'use strict';
// verdicts.js -- the blind re-answer ledger. Authored content has no arithmetic oracle, so the
// substitute is a second model pass that answers every item with NO access to the key, the
// explanation or the distractor rationales. Agreement is evidence the key is unambiguous;
// disagreement must be adjudicated by a human before the pack ships.
//
// The expensive pass runs locally (tests/blind-reanswer.js) against the Claude subscription CLI.
// CI never calls a model: it only checks this ledger, so the gate stays hermetic and keyless.
//
// Per-item hashing is deliberate. A whole-pack hash would invalidate every verdict on any edit,
// which trains people to regenerate the ledger blindly. Per-item means editing one item
// re-opens exactly one verdict.

const crypto = require('crypto');

const STATUSES = Object.freeze(['agree', 'adjudicated']);
const NOTE_MIN_WORDS = 8;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function itemHash(item) {
  return crypto.createHash('sha256').update(stableStringify(item), 'utf8').digest('hex').slice(0, 16);
}

// The authored answer a blind pass is compared against. Only the types with a single scalar or
// array key participate; order, match, cloze and shorttext are checked structurally instead and
// return null so they are skipped rather than falsely compared.
function authoredKeyOf(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'mc') return Number.isInteger(item.key) ? item.key : null;
  if (item.type === 'ms') return Array.isArray(item.key) ? item.key.slice() : null;
  if (item.type === 'hottext') return Array.isArray(item.key) ? item.key.slice() : null;
  if (item.type === 'ebsr') return (item.partA && Number.isInteger(item.partA.key)) ? item.partA.key : null;
  return null;
}

function blindOptionsOf(item) {
  if (item.type === 'ebsr') return (item.partA && item.partA.choices) || [];
  if (item.type === 'hottext') return item.spans || [];
  return item.choices || [];
}

function blindStemOf(item) {
  if (item.type === 'ebsr') return (item.partA && item.partA.stem) || '';
  return item.stem || '';
}

// Build the blind prompt. Everything that could leak the answer is excluded by construction:
// this assembles the prompt from named fields rather than serialising the item, so a new field
// added later cannot silently leak.
function blindQuestion(item, passage) {
  const options = blindOptionsOf(item);
  const lettered = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');
  const multi = item.type === 'ms' || item.type === 'hottext';
  const answerSpec = multi
    ? '"answer": an array of the letters you choose'
    : '"answer": the single letter you choose';

  const prompt = [
    'You are answering one reading-comprehension question for a grade 6 student.',
    'Answer it yourself from the passage alone. Do not explain your reasoning at length.',
    '',
    'PASSAGE:',
    passage.text,
    '',
    'QUESTION:',
    blindStemOf(item),
    '',
    'OPTIONS:',
    lettered,
    '',
    `Reply with ONE line of JSON and nothing else: {${answerSpec}, "confidence": "high" | "medium" | "low"}`,
  ].join('\n');

  return { prompt, optionCount: options.length };
}

function sameAnswer(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return stableStringify(a.slice().sort()) === stableStringify(b.slice().sort());
  return a === b;
}

function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

function validateLedger(pack, ledger) {
  const errors = [], warnings = [];
  if (!ledger || typeof ledger !== 'object') { errors.push('verdicts: missing or not an object'); return { errors, warnings }; }

  const packId = pack && pack.meta && pack.meta.id;
  if (ledger.packId !== packId) {
    errors.push(`verdicts.packId: "${ledger.packId}" does not match pack meta.id "${packId}"`);
  }
  if (!Array.isArray(ledger.records)) { errors.push('verdicts.records: missing or not an array'); return { errors, warnings }; }

  const byId = new Map();
  for (const r of ledger.records) {
    if (!r || typeof r !== 'object' || !r.itemId) { errors.push('verdicts.records: a record has no itemId'); continue; }
    if (byId.has(r.itemId)) errors.push(`verdicts.records: duplicate record for "${r.itemId}"`);
    byId.set(r.itemId, r);
  }

  const items = Array.isArray(pack.items) ? pack.items : [];
  const itemIds = new Set(items.map(i => i.id));

  for (const item of items) {
    // Only the comparable types need a verdict; the rest are gated structurally.
    if (authoredKeyOf(item) === null) continue;

    const r = byId.get(item.id);
    if (!r) {
      errors.push(`items(${item.id}): no blind verdict on record; run "node tests/blind-reanswer.js ${packId}" and adjudicate before shipping`);
      continue;
    }
    const want = itemHash(item);
    if (r.itemHash !== want) {
      errors.push(`items(${item.id}): stale blind verdict, the item changed since it was checked (ledger ${r.itemHash}, item ${want}); re-run the blind pass for this item`);
      continue;
    }
    if (!STATUSES.includes(r.status)) {
      errors.push(`items(${item.id}): verdict status must be one of ${STATUSES.join(', ')}, got ${JSON.stringify(r.status)}`);
      continue;
    }
    const agrees = sameAnswer(r.blind, r.authored);
    if (r.status === 'agree' && !agrees) {
      errors.push(`items(${item.id}): verdict says "agree" but blind ${JSON.stringify(r.blind)} and authored ${JSON.stringify(r.authored)} disagree; adjudicate it or fix the item`);
    }
    if (r.status === 'adjudicated') {
      if (wordCount(r.note) < NOTE_MIN_WORDS) {
        errors.push(`items(${item.id}): an adjudicated verdict needs a note of at least ${NOTE_MIN_WORDS} words saying why the authored key stands`);
      }
      if (!r.adjudicatedBy) errors.push(`items(${item.id}): an adjudicated verdict needs adjudicatedBy`);
      if (!r.adjudicatedAt) errors.push(`items(${item.id}): an adjudicated verdict needs adjudicatedAt`);
    }
    if (!sameAnswer(r.authored, authoredKeyOf(item))) {
      errors.push(`items(${item.id}): ledger records authored ${JSON.stringify(r.authored)} but the item's key is ${JSON.stringify(authoredKeyOf(item))}`);
    }
  }

  for (const id of byId.keys()) {
    if (!itemIds.has(id)) warnings.push(`verdicts.records: record for "${id}" has no matching item (stale, safe to delete)`);
  }

  return { errors, warnings };
}

module.exports = { itemHash, stableStringify, blindQuestion, authoredKeyOf, validateLedger, STATUSES };
