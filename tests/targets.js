'use strict';
// targets.js -- the frozen target vocabulary. A pack may only cite ids that appear here. This is
// what stops target drift as packs accumulate: an invented target id is a hard validator failure,
// not a silent new category.
//
// Three subjects share this one namespace:
//   ELA (grade 6, Smarter Balanced, mapped to CCSS): fields claim, label, ccss. Claim 1 Reading
//   carries targets 1-7 twice, once for literary text and once for informational; Claim 2 Writing,
//   Claim 3 Listening and Claim 4 Research follow the published target numbering. No `subject`
//   field is stamped on these entries; callers that need one default it to 'ela'.
//   Science (grade 6, Outpost Protocol, mapped to NGSS performance expectations): fields label,
//   subject: 'sci', pe, confidence. `pe` is empty for thematic on-ramp targets that cite no code.
//   `confidence` mirrors the spec's own confidence tiers (verified / inherited-plausible /
//   inferred / thematic) so an item can never overstate how firmly its content is grounded.
//   History-Social Science (grade 6, Ancient Civilizations, mapped to CA HSS standards): fields
//   label, subject: 'hist', hss, confidence. `hss` holds standard codes (6.1 through 6.7) in place
//   of `pe`. All six targets carry `confidence: 'verified'`; the standards text was confirmed
//   verbatim against the published CA HSS framework, so no lower tier applies here.
//   Math (grade 6 with the grade 3-5 review CPM Core Connections Course 1 sits on, mapped to CCSS
//   mathematics): fields label, subject: 'math', ccss, confidence. Every code was read verbatim out
//   of the published CCSS mathematics standards (pages 42-45 for grade 6, 34-37 for grade 5, 28 and
//   23 for the grade 4 and 3 review), so all math targets carry `confidence: 'verified'`; the lower
//   tiers stay available for any later target whose code assignment is not confirmed that way.

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

  // ---- Science: Outpost Protocol (grade 6, NGSS performance expectations) ----
  // Confidence tiers are the spec's own (SPEC-multiverse-outpost-protocol-v1-26-0806.md section 3):
  // tiles 5-6 verified, tiles 3-4 inherited-plausible (segment-anchored, suffix is this project's
  // own reasonable match), tile 2 inferred (item content stays within the segment's systems theme
  // rather than leaning on the code), tile 1 thematic on-ramp material citing no code at all.
  'sci-t1-systems-vocab':      { label: 'Systems vocabulary and scale ordering',            subject: 'sci', pe: [], confidence: 'thematic' },
  'sci-t2-systems-subsystems': { label: 'Life-support subsystems: air, water, food',         subject: 'sci', pe: ['MS-LS1-3'], confidence: 'inferred' },
  'sci-t3-weather-evidence':   { label: 'Reading weather-log data as evidence',              subject: 'sci', pe: ['MS-ESS2-5'], confidence: 'inherited-plausible' },
  'sci-t4-climate-patterns':   { label: 'Comparing climate patterns across outposts',        subject: 'sci', pe: ['MS-ESS2-6'], confidence: 'inherited-plausible' },
  'sci-t5-warming-adaptation': { label: 'Warming limits and species adaptation',              subject: 'sci', pe: ['MS-ESS3-3', 'MS-ESS3-5', 'MS-LS1-4', 'MS-LS1-5'], confidence: 'verified' },
  'sci-t6-design-evaluate':    { label: 'Evaluate a design against stated constraints',       subject: 'sci', pe: ['MS-ETS1-1', 'MS-ETS1-2'], confidence: 'verified' },

  // ---- History-Social Science: Ancient Civilizations (grade 6, CA HSS standards) ----
  // hss codes and confidence verbatim-confirmed against the published CA HSS framework.
  'hist-t1-first-entry': { label: 'Early humans and the first civilizations: Mesopotamia, Egypt, and Kush', subject: 'hist', hss: ['6.1', '6.2'], confidence: 'verified' },
  'hist-t2-hebrews':     { label: 'The Ancient Hebrews: religious, social, and political structures',       subject: 'hist', hss: ['6.3'], confidence: 'verified' },
  'hist-t3-greece':      { label: 'Ancient Greece: geography, government, and society',                     subject: 'hist', hss: ['6.4'], confidence: 'verified' },
  'hist-t4-india':       { label: 'Ancient India: geography, religion, and social structures',               subject: 'hist', hss: ['6.5'], confidence: 'verified' },
  'hist-t5-china':       { label: 'Ancient China: geography, government, and society',                       subject: 'hist', hss: ['6.6'], confidence: 'verified' },
  'hist-t6-rome':        { label: 'Ancient Rome: geography, government, and society',                        subject: 'hist', hss: ['6.7'], confidence: 'verified' },

  // ---- Math: CPM Core Connections Course 1 (grade 6 CCSS, plus the grade 3-5 review it sits on) ----
  // The vocabulary is organised by CCSS domain rather than by CC1 chapter, because CC1's order is
  // not the standards' order and not the app's order either: chapter 1 opens on grade-5 patterns and
  // grade-3 bar graphs, chapter 9 closes on volume and percents. A crosswalk row cites these ids;
  // packs/curriculum-cc1.json is what carries the lesson-to-target mapping.
  // Codes verbatim from the published CCSS mathematics standards, verified 26-0822.

  // 6.RP -- Ratios and Proportional Relationships
  'math-rp-ratio-concept':      { label: 'Ratio language and equivalent ratios',                    subject: 'math', ccss: ['6.RP.A.1', '6.RP.A.3.a'], confidence: 'verified' },
  'math-rp-unit-rate':          { label: 'Unit rate and rate reasoning',                            subject: 'math', ccss: ['6.RP.A.2', '6.RP.A.3.b'], confidence: 'verified' },
  'math-rp-percent':            { label: 'Percent as a rate per hundred',                           subject: 'math', ccss: ['6.RP.A.3.c'], confidence: 'verified' },
  'math-rp-unit-conversion':    { label: 'Convert measurement units by ratio reasoning',            subject: 'math', ccss: ['6.RP.A.3.d'], confidence: 'verified' },

  // 6.NS -- The Number System
  'math-ns-divide-fractions':   { label: 'Divide a fraction by a fraction',                         subject: 'math', ccss: ['6.NS.A.1'], confidence: 'verified' },
  'math-ns-multi-digit-ops':    { label: 'Add, subtract, multiply and divide multi-digit decimals', subject: 'math', ccss: ['6.NS.B.2', '6.NS.B.3'], confidence: 'verified' },
  'math-ns-factors-multiples':  { label: 'Factors, multiples, primes, GCF and LCM',                 subject: 'math', ccss: ['6.NS.B.4'], confidence: 'verified' },
  'math-ns-integers':           { label: 'Positive and negative numbers and their opposites',       subject: 'math', ccss: ['6.NS.C.5', '6.NS.C.6.a'], confidence: 'verified' },
  'math-ns-order-abs':          { label: 'Ordering rational numbers and absolute value',            subject: 'math', ccss: ['6.NS.C.7.a', '6.NS.C.7.c'], confidence: 'verified' },
  'math-ns-coordinate-plane':   { label: 'Points and distances in all four quadrants',              subject: 'math', ccss: ['6.NS.C.6.b', '6.NS.C.6.c', '6.NS.C.8'], confidence: 'verified' },

  // 6.EE -- Expressions and Equations
  'math-ee-exponents':          { label: 'Whole-number exponents',                                  subject: 'math', ccss: ['6.EE.A.1'], confidence: 'verified' },
  'math-ee-write-expression':   { label: 'Write an expression using a letter for a number',         subject: 'math', ccss: ['6.EE.A.2.a', '6.EE.A.2.b'], confidence: 'verified' },
  'math-ee-evaluate':           { label: 'Evaluate an expression by substitution',                  subject: 'math', ccss: ['6.EE.A.2.c'], confidence: 'verified' },
  'math-ee-equivalent':         { label: 'Generate an equivalent expression, distributive property', subject: 'math', ccss: ['6.EE.A.3', '6.EE.A.4'], confidence: 'verified' },
  'math-ee-solve-equations':    { label: 'Solve a one-step equation in context',                    subject: 'math', ccss: ['6.EE.B.5', '6.EE.B.6', '6.EE.B.7'], confidence: 'verified' },
  'math-ee-inequalities':       { label: 'Write and graph an inequality',                           subject: 'math', ccss: ['6.EE.B.8'], confidence: 'verified' },
  'math-ee-generalize':         { label: 'Use a variable to generalise a pattern',                  subject: 'math', ccss: ['6.EE.C.9'], confidence: 'verified' },

  // 6.G -- Geometry
  'math-g-area-polygons':       { label: 'Area of triangles, quadrilaterals and complex figures',   subject: 'math', ccss: ['6.G.A.1'], confidence: 'verified' },
  'math-g-volume-prisms':       { label: 'Volume of a right rectangular prism',                     subject: 'math', ccss: ['6.G.A.2'], confidence: 'verified' },
  'math-g-coordinate-polygons': { label: 'Polygons drawn on the coordinate plane',                  subject: 'math', ccss: ['6.G.A.3'], confidence: 'verified' },
  'math-g-surface-area':        { label: 'Surface area from a net',                                 subject: 'math', ccss: ['6.G.A.4'], confidence: 'verified' },

  // 6.SP -- Statistics and Probability
  'math-sp-statistical-question': { label: 'Statistical questions and variability',                 subject: 'math', ccss: ['6.SP.A.1', '6.SP.A.2'], confidence: 'verified' },
  'math-sp-center-spread':      { label: 'Measures of centre and of spread',                        subject: 'math', ccss: ['6.SP.A.3', '6.SP.B.5.c'], confidence: 'verified' },
  'math-sp-displays':           { label: 'Dot plots, histograms and box plots',                     subject: 'math', ccss: ['6.SP.B.4'], confidence: 'verified' },

  // Grade-5 review CC1 chapters 1, 3, 4 and 5 sit on
  'math-r5-decimal-place-value': { label: 'Read, write and compare decimals to thousandths',        subject: 'math', ccss: ['5.NBT.A.3.a', '5.NBT.A.3.b'], confidence: 'verified' },
  'math-r5-decimal-ops':        { label: 'Add, subtract, multiply and divide decimals to hundredths', subject: 'math', ccss: ['5.NBT.A.4', '5.NBT.B.7'], confidence: 'verified' },
  'math-r5-numerical-patterns': { label: 'Generate and compare two numerical patterns',             subject: 'math', ccss: ['5.OA.B.3'], confidence: 'verified' },
  'math-r5-classify-figures':   { label: 'Classify two-dimensional figures by their properties',    subject: 'math', ccss: ['5.G.B.3', '5.G.B.4'], confidence: 'verified' },
  'math-r5-fraction-add-sub':   { label: 'Add and subtract fractions with unlike denominators',     subject: 'math', ccss: ['5.NF.A.1', '5.NF.A.2'], confidence: 'verified' },
  'math-r5-fraction-multiply':  { label: 'Multiply a fraction, including with an area model',       subject: 'math', ccss: ['5.NF.B.4'], confidence: 'verified' },
  'math-r5-volume':             { label: 'Volume by counting unit cubes and by formula',            subject: 'math', ccss: ['5.MD.C.5'], confidence: 'verified' },

  // Grade 3-4 review CC1 chapters 1 and 6 also lean on
  'math-r4-perimeter':          { label: 'Perimeter of a polygon from its labelled sides',          subject: 'math', ccss: ['4.MD.A.3'], confidence: 'verified' },
  'math-r3-scaled-graphs':      { label: 'Read and draw a scaled bar graph',                        subject: 'math', ccss: ['3.MD.B.3'], confidence: 'verified' },
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
