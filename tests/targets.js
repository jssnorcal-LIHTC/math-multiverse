'use strict';
// targets.js -- the frozen Smarter Balanced target vocabulary for grade 6 ELA, mapped to CCSS.
// A pack may only cite ids that appear here. This is what stops target drift as packs
// accumulate: an invented target id is a hard validator failure, not a silent new category.
//
// Claim 1 Reading carries targets 1-7 twice, once for literary text and once for informational.
// Claim 2 Writing, Claim 3 Listening and Claim 4 Research follow the published target numbering.

const TARGETS = Object.freeze({
  // ---- Claim 1: Reading, literary ----
  'c1-lit-1-key-details':     { claim: 1, label: 'Key details in a story',            ccss: ['RL.6.1'] },
  'c1-lit-2-central-ideas':   { claim: 1, label: 'Theme and summary',                 ccss: ['RL.6.2'] },
  'c1-lit-3-word-meanings':   { claim: 1, label: 'Word meaning and figurative language', ccss: ['RL.6.4'] },
  'c1-lit-4-reasoning':       { claim: 1, label: 'Inference and evidence',            ccss: ['RL.6.1', 'RL.6.3'] },
  'c1-lit-5-analysis':        { claim: 1, label: 'Analysis within or across stories', ccss: ['RL.6.3', 'RL.6.9'] },
  'c1-lit-6-text-structure':  { claim: 1, label: 'How a part fits the whole',         ccss: ['RL.6.5'] },
  'c1-lit-7-language-use':    { claim: 1, label: 'Point of view and narrator effect', ccss: ['RL.6.6'] },

  // ---- Claim 1: Reading, informational ----
  'c1-inf-1-key-details':     { claim: 1, label: 'Key details in an article',         ccss: ['RI.6.1'] },
  'c1-inf-2-central-ideas':   { claim: 1, label: 'Central idea and summary',          ccss: ['RI.6.2'] },
  'c1-inf-3-word-meanings':   { claim: 1, label: 'Academic word meaning',             ccss: ['RI.6.4'] },
  'c1-inf-4-reasoning':       { claim: 1, label: 'Tracing and judging an argument',   ccss: ['RI.6.8'] },
  'c1-inf-5-analysis':        { claim: 1, label: 'Analysis within or across sources', ccss: ['RI.6.3', 'RI.6.9'] },
  'c1-inf-6-text-structure':  { claim: 1, label: 'Text structure and features',       ccss: ['RI.6.5'] },
  'c1-inf-7-language-use':    { claim: 1, label: "Author's purpose and viewpoint",    ccss: ['RI.6.6'] },

  // ---- Claim 2: Writing ----
  'c2-1a-narrative-write':    { claim: 2, label: 'Write a brief narrative',           ccss: ['W.6.3'] },
  'c2-1b-narrative-revise':   { claim: 2, label: 'Revise a brief narrative',          ccss: ['W.6.3', 'W.6.5'] },
  'c2-3a-explanatory-write':  { claim: 2, label: 'Write a brief explanation',         ccss: ['W.6.2'] },
  'c2-3b-explanatory-revise': { claim: 2, label: 'Revise a brief explanation',        ccss: ['W.6.2', 'W.6.5'] },
  'c2-6a-argument-write':     { claim: 2, label: 'Write a brief argument',            ccss: ['W.6.1'] },
  'c2-6b-argument-revise':    { claim: 2, label: 'Revise a brief argument',           ccss: ['W.6.1', 'W.6.5'] },
  'c2-8-language-vocab':      { claim: 2, label: 'Language and vocabulary use',       ccss: ['L.6.3', 'L.6.6'] },
  'c2-9-edit':                { claim: 2, label: 'Edit for conventions',              ccss: ['L.6.1', 'L.6.2'] },

  // ---- Claim 3: Listening ----
  'c3-4-listen-interpret':    { claim: 3, label: 'Listen and interpret',              ccss: ['SL.6.2', 'SL.6.3'] },

  // ---- Claim 4: Research ----
  'c4-2-integrate':           { claim: 4, label: 'Interpret and integrate sources',   ccss: ['W.6.7', 'RI.6.7'] },
  'c4-3-analyze-sources':     { claim: 4, label: 'Judge whether a source is sound',   ccss: ['W.6.8'] },
  'c4-4-use-evidence':        { claim: 4, label: 'Use evidence from sources',         ccss: ['W.6.9', 'W.6.8'] },
});

function isTarget(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TARGETS, id);
}

// Legal coach-topic family prefixes for ELA content. A pack coach topic must either match a
// COACH_TIPS key exactly or begin with one of these families, mirroring the math
// COACH_FAMILY_FALLBACK mechanism in Math-Multiverse.html.
const COACH_FAMILIES = Object.freeze([
  'evidence', 'central', 'vocab', 'structure', 'viewpoint', 'inference', 'grammar', 'research',
]);

module.exports = { TARGETS, isTarget, COACH_FAMILIES };
