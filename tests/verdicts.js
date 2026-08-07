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
//
// PASSAGE-AWARE (26-0807, N4 fix): itemHash originally hashed the item object alone, so an item
// whose own fields never changed kept its "verified" status even after the PASSAGE it quotes,
// paraphrases, or otherwise depends on was rewritten underneath it. That is exactly how two items
// survived a controlled-unfreeze passage rewrite unexamined during the outpost-protocol-g6 fix
// round: their own text was untouched, so their hash never moved, so validate-pack never asked
// anyone to look at them again, even though the science they were built to test had changed.
//
// Fix: itemHash now takes an OPTIONAL second argument, the resolved passage object. When a caller
// passes one, its text folds into the hash, so a passage edit changes the hash of every item that
// references it, exactly like an item edit changes that item's own hash. When the second argument
// is omitted, itemHash(item) returns BYTE-IDENTICAL output to the pre-fix function, so any caller
// (in this codebase or a plugin never audited for this) that has not been updated to pass a
// passage keeps working exactly as before rather than silently going stale on every item in every
// pack the moment this file changes. Both real callers (validateLedger below, and
// build/blind-reanswer.js) now resolve and pass the item's own passage; see PASSAGE-AWARE BLAST
// RADIUS in this repo's memory / the fix report for the one-time consequence of that: every
// existing pack's ledger records for passage-linked items will show as stale on their next
// validate-pack run, since the hash they were computed against no longer matches. That is the
// correct, intended behavior of closing this gap, not a bug in the fix.

const crypto = require('crypto');

const STATUSES = Object.freeze(['agree', 'adjudicated']);
const NOTE_MIN_WORDS = 8;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

function itemHash(item, passage) {
  if (!passage) {
    return crypto.createHash('sha256').update(stableStringify(item), 'utf8').digest('hex').slice(0, 16);
  }
  const payload = stableStringify(item) + '|passageText:' + stableStringify(passage.text || '');
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}

// The authored answer a blind pass is compared against. Only the types with a single scalar or
// array key participate; order, match, cloze and shorttext are checked structurally instead and
// return null so they are skipped rather than falsely compared.
// The authored answer a blind pass is compared against. EVERY auto-graded type with a discrete key
// participates. match, order and cloze were exempt in an earlier draft on the grounds that they are
// "checked structurally instead"; that was wrong. A structural check confirms a key is well FORMED
// (every row has exactly one column, the order is a full permutation, each blank has one token) and
// says nothing about whether it is UNAMBIGUOUS. Two definitions can both fit a row, two orderings can
// both be defensible, and "left" and "leaves" can both be grammatical. That is precisely the semantic
// risk this mechanism exists to catch. Only shorttext (free text, no lettered form), listen and write
// remain exempt.
function authoredKeyOf(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.type === 'mc') return Number.isInteger(item.key) ? item.key : null;
  if (item.type === 'ms') return Array.isArray(item.key) ? item.key.slice() : null;
  if (item.type === 'hottext') return Array.isArray(item.key) ? item.key.slice() : null;
  if (item.type === 'ebsr') return (item.partA && Number.isInteger(item.partA.key)) ? item.partA.key : null;
  if (item.type === 'order') return Array.isArray(item.key) ? item.key.slice() : null;
  if (item.type === 'cloze') {
    if (!Array.isArray(item.blanks) || !item.blanks.length) return null;
    const out = item.blanks.map(function (b) { return (b && Number.isInteger(b.key)) ? b.key : null; });
    // A blank with no key (or a non-integer key) is a SHAPE defect for checkItemShape to report,
    // not a verdict question: comparing a blind answer against undefined or null tells us nothing.
    return out.includes(null) ? null : out;
  }
  if (item.type === 'match') {
    // One column per row, expressed in row order, so it compares as a plain array.
    if (!Array.isArray(item.key) || !Array.isArray(item.rowLabels)) return null;
    const n = item.rowLabels.length;
    const byRow = new Map();
    for (const c of item.key) {
      if (!Array.isArray(c)) continue;
      const r = Number(c[0]), col = Number(c[1]);
      // A row index beyond rowLabels, or the same row named twice, is a SHAPE defect for
      // checkItemShape to report, not a verdict question. The old Map/.map construction silently
      // dropped an out-of-range row and let a duplicate row resolve last-write-wins, which hid the
      // defect instead of surfacing it; both now return null here instead.
      if (!Number.isInteger(r) || r < 0 || r >= n || byRow.has(r)) return null;
      byRow.set(r, col);
    }
    const out = item.rowLabels.map(function (_, r) { return byRow.has(r) ? byRow.get(r) : -1; });
    // An incomplete key is a SHAPE defect for checkItemShape to report, not a verdict question.
    return out.includes(-1) ? null : out;
  }
  return null;
}

const LETTER = (i) => String.fromCharCode(65 + i);

// Per-type blind presentation: the question, a lettered body the model can answer, the JSON answer
// spec, and how many letters are in range. Built field by field rather than by serialising the item,
// so a field added later cannot silently leak the key.
function blindSpecOf(item) {
  const lettered = (arr) => arr.map((o, i) => LETTER(i) + '. ' + o).join('\n');
  switch (item.type) {
    case 'mc':
      return { stem: item.stem, body: lettered(item.choices || []),
               spec: '"answer": the single letter you choose', count: (item.choices || []).length };
    case 'ebsr':
      return { stem: (item.partA && item.partA.stem) || '',
               body: lettered((item.partA && item.partA.choices) || []),
               spec: '"answer": the single letter you choose',
               count: ((item.partA && item.partA.choices) || []).length };
    case 'ms':
      // Keeps the answer count. types.ms.render shows the student a literal "Choose N." hint, so
      // telling the blind pass N puts it in the same information state as the child: fidelity, not
      // a leak. Do not "tidy" this into matching hottext below; the asymmetry is deliberate.
      return { stem: item.stem, body: lettered(item.choices || []),
               spec: '"answer": an array of the ' + (item.key || []).length + ' letters you choose',
               count: (item.choices || []).length };
    case 'hottext':
      // Omits the answer count, unlike ms above. types.hottext.render shows the student no count at
      // all, so stating one here would hand the blind pass an advantage the child never has, making
      // agreement artificially easy and weakening this check's power to catch a genuinely ambiguous
      // key. That is the dangerous direction, so this stays silent on purpose.
      return { stem: item.stem, body: lettered(item.spans || []),
               spec: '"answer": an array of the letters you choose',
               count: (item.spans || []).length };
    case 'order':
      return { stem: item.stem, body: lettered(item.tiles || []),
               spec: '"answer": an array of all ' + (item.tiles || []).length + ' letters, in the correct order',
               count: (item.tiles || []).length };
    case 'cloze':
      return { stem: item.stem,
               body: (item.blanks || []).map((b, bi) =>
                 'Blank ' + bi + ':\n' + (b.choices || []).map((o, i) => '  ' + LETTER(i) + '. ' + o).join('\n')).join('\n'),
               spec: '"answer": an array of ' + (item.blanks || []).length + ' letters, one per blank, in order',
               count: Math.max.apply(null, [1].concat((item.blanks || []).map(b => (b.choices || []).length))) };
    case 'match':
      return { stem: item.stem,
               body: 'COLUMNS:\n' + (item.colLabels || []).map((c, i) => '  ' + LETTER(i) + '. ' + c).join('\n') +
                     '\n\nROWS, answer one column letter for each, in this order:\n' +
                     (item.rowLabels || []).map((r, i) => '  ' + i + '. ' + r).join('\n'),
               spec: '"answer": an array of ' + (item.rowLabels || []).length + ' column letters, one per row, in row order',
               count: (item.colLabels || []).length };
    default:
      return null;
  }
}

// Build the blind prompt. Everything that could leak the answer is excluded by construction:
// this assembles the prompt from named fields rather than serialising the item, so a new field
// added later cannot silently leak.
function blindQuestion(item, passage) {
  const spec = blindSpecOf(item);
  if (!spec) throw new Error('blindQuestion: type ' + JSON.stringify(item && item.type) + ' has no blind form');

  const prompt = [
    'You are answering one reading-comprehension question for a grade 6 student.',
    'Answer it yourself from the passage alone. Do not explain your reasoning at length.',
    '',
    'PASSAGE:',
    passage.text,
    '',
    'QUESTION:',
    spec.stem,
    '',
    'OPTIONS:',
    spec.body,
    '',
    'Reply with ONE line of JSON and nothing else: {' + spec.spec + ', "confidence": "high" | "medium" | "low"}',
    'Emit exactly one JSON object.  Do not offer an alternative or restate a revised answer.',
  ].join('\n');

  return { prompt, optionCount: spec.count };
}

// The types whose answer is genuinely a SET, where [2,0,1] and [0,1,2] are the same answer.
// VERIFIED by grading real items through engine/items.js, not by reading it: ms and hottext both
// grade through sameSet(), which compares uniqSorted arrays, so a reordered response still grades
// correct.
//
// Every other comparable type is a SEQUENCE in the representation this ledger stores, where the
// position carries meaning that sorting destroys:
//   order  key[i] is the tile belonging in position i; grade() compares arr[i] === key[i].
//   cloze  key[i] is blank i's choice;                 grade() compares arr[i] === blanks[i].key.
//   match  authoredKeyOf flattens the key to one column per ROW, in row order, so the INDEX is the
//          row. Note that match's engine-native response (an array of [row, col] cells) is itself
//          order-insensitive: each cell names its own row and grade() compares a Set of "row,col"
//          signatures, so reversing THAT still grades correct. It is the flattening done for this
//          ledger that makes position load-bearing. Do not conclude match is a set by reversing a
//          native response; reverse the flattened array and it grades false.
const UNORDERED_TYPES = Object.freeze(new Set(['ms', 'hottext']));

// Compare a blind answer against an authored key. `type` decides how arrays compare, and an
// unrecognised type falls through to the STRICT element-by-element path on purpose. A new set-like
// type will then fail loudly here and get added to UNORDERED_TYPES deliberately; defaulting the
// other way would silently under-check it, which is precisely the defect this replaced -- sorting
// both sides turned "never checked" into "checked and fine" without anyone noticing.
function sameAnswer(a, b, type) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (UNORDERED_TYPES.has(type)) {
      return stableStringify(a.slice().sort()) === stableStringify(b.slice().sort());
    }
    return stableStringify(a) === stableStringify(b);
  }
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
  // PASSAGE-AWARE (N4 fix): resolved once per pack, passed into itemHash below so a passage edit
  // dirties every item that references it, not just items whose own fields changed.
  const passagesById = new Map((Array.isArray(pack.passages) ? pack.passages : []).map(p => [p.id, p]));

  for (const item of items) {
    // Only the comparable types need a verdict; the rest are gated structurally.
    if (authoredKeyOf(item) === null) continue;

    const r = byId.get(item.id);
    if (!r) {
      errors.push(`items(${item.id}): no blind verdict on record; run "node tests/blind-reanswer.js ${packId}" and adjudicate before shipping`);
      continue;
    }
    const passage = item.passageId ? passagesById.get(item.passageId) : null;
    const want = itemHash(item, passage);
    if (r.itemHash !== want) {
      errors.push(`items(${item.id}): stale blind verdict, the item changed since it was checked (ledger ${r.itemHash}, item ${want}); re-run the blind pass for this item`);
      continue;
    }
    if (!STATUSES.includes(r.status)) {
      errors.push(`items(${item.id}): verdict status must be one of ${STATUSES.join(', ')}, got ${JSON.stringify(r.status)}`);
      continue;
    }
    const agrees = sameAnswer(r.blind, r.authored, item.type);
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
    if (!sameAnswer(r.authored, authoredKeyOf(item), item.type)) {
      errors.push(`items(${item.id}): ledger records authored ${JSON.stringify(r.authored)} but the item's key is ${JSON.stringify(authoredKeyOf(item))}`);
    }
  }

  for (const id of byId.keys()) {
    if (!itemIds.has(id)) warnings.push(`verdicts.records: record for "${id}" has no matching item (stale, safe to delete)`);
  }

  return { errors, warnings };
}

// sameAnswer and UNORDERED_TYPES are exported because this comparison decides whether an item was
// actually verified, so it must be directly testable rather than only reachable through validateLedger.
module.exports = { itemHash, stableStringify, blindQuestion, authoredKeyOf, validateLedger, sameAnswer, UNORDERED_TYPES, STATUSES };
