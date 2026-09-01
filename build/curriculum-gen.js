'use strict';
// curriculum-gen.js -- build packs/curriculum-cc1.json, the CPM Core Connections Course 1
// crosswalk. Run it whenever this file or build/cc1-lesson-index.json changes:
//
//   node build/curriculum-gen.js
//
// Two public publisher sources feed it, and INDEX AND TOPIC NAMES ONLY are taken from either.
// The problems themselves are copyrighted and no problem text is read, stored or emitted.
//
//   1. The free CPM Parent Guide with Extra Practice for Course 1
//      (https://pdfs.cpm.org/CoreConnections/ParentGuide/cc1/CC1_PG.pdf, 89 pages). Its table of
//      contents on pages 5 and 6 names 34 topic blocks against their lesson ranges, plus one pure
//      cross-reference row. BLOCKS below is that table, transcribed.
//   2. The CPM homework-help lesson index (homework.cpm.org), read into
//      build/cc1-lesson-index.json: 80 lessons across 9 chapters, 462 Review and Preview problem
//      numbers.
//
// WHAT IS AUTHORED HERE AND WHAT IS DERIVED. The problem lists are derived from source 2. The
// block titles and their lesson ranges are transcribed from source 1. Everything else -- which
// targets a lesson cites, which emitted module topics serve it, and each block's coverage verdict
// -- is this project's own judgement, and CONFIDENCE says how firmly each row is grounded:
//
//   verified            the Parent Guide names this exact lesson against this block
//   inherited-plausible the lesson sits inside a block's stated lesson range
//   inferred            no block names the lesson; it is tagged from its chapter's correlation
//
// THE COVERAGE VERDICTS ARE MEASURED, NOT ASSUMED. `moduleTopics` may only cite topics that the
// six math modules actually EMIT, which is a different set from the one TOPIC_LABELS declares:
// 107 topics are labelled in the shell and only 83 are ever emitted. tests/validate-curriculum.js
// re-derives the emitted set by running the real drivers and fails on any row that cites a topic
// outside it.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'build', 'cc1-lesson-index.json');
const OUT_PATH = path.join(ROOT, 'packs', 'curriculum-cc1.json');

// A row's ccss[] is DERIVED from its targets rather than authored twice, so the two can never
// disagree. tests/targets.js is the one frozen vocabulary all four subjects share.
const { TARGETS } = require(path.join(ROOT, 'tests', 'targets.js'));
const TARGET_CCSS = {};
for (const [id, t] of Object.entries(TARGETS)) {
  if (t.subject === 'math') TARGET_CCSS[id] = t.ccss;
}

// ---------------------------------------------------------------------------
// Chapter labels. CPM does not publish chapter titles on either free source, so these are this
// project's own labels, named from the Parent Guide blocks that land in each chapter and marked
// as derived so no reader mistakes them for CPM's own.
// ---------------------------------------------------------------------------
const CHAPTERS = [
  { chapter: 1, label: 'Patterns, data displays and types of numbers' },
  { chapter: 2, label: 'Data displays, generic rectangles and the distributive property' },
  { chapter: 3, label: 'Portions, integers and the coordinate plane' },
  { chapter: 4, label: 'Variables, generalising and scale factor' },
  { chapter: 5, label: 'Multiplying fractions and decimals, and area' },
  { chapter: 6, label: 'Dividing fractions, order of operations and algebra tiles' },
  { chapter: 7, label: 'Rates, decimal operations and inequalities' },
  { chapter: 8, label: 'Statistics, equations in context, and distance-rate-time' },
  { chapter: 9, label: 'Volume, surface area and percents' },
];

// ---------------------------------------------------------------------------
// The Parent Guide table of contents, transcribed. `lessons` is the block's stated range and is
// what promotes a lesson to `verified`. `verdict` is the CONFIRMED coverage call, measured against
// the emitted-topic census rather than inherited from the plan's preliminary table; `why` states
// what was measured. Build order lives in BUILD_ORDER below, once, so two rows cannot claim the
// same rank.
// ---------------------------------------------------------------------------
const BLOCKS = [
  {
    id: 'pg-1.1.3', page: 1, chapter: 1, title: 'Describing and Extending Patterns',
    lessons: ['1.1.3'],
    targets: ['math-r5-numerical-patterns', 'math-ee-generalize'],
    moduleTopics: ['pemdas-pattern'],
    verdict: 'PARTIAL',
    why: 'pemdas-pattern is emitted, but only out of The Floating Bear Grade 5 levels 2, 3 and 6 '
       + 'and at most 15% of any of their draws. It also hands over both rules and asks for a '
       + 'comparison; it never shows a figure and asks the student to build the rule or predict '
       + 'the 100th term.',
    gaps: [
      { text: 'a drawn growing pattern the student extends', closedBy: 'growpattern-next-figure' },
      { text: 'find the rule from the figures', closedBy: 'growpattern-rule' },
      { text: 'predict a far-out term such as the 100th', closedBy: 'growpattern-far-term' },
    ],
  },
  {
    id: 'pg-1.1.4', page: 3, chapter: 1, title: 'Graphical Representations of Data: Histograms and Bar Graphs',
    lessons: ['1.1.4'],
    targets: ['math-r3-scaled-graphs', 'math-sp-displays'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'No math generator emits a chart-reading topic. g6-stats-* read a comma-separated list of '
       + 'numbers, never a display. Real chart reading exists only under Science (Outpost Protocol '
       + 'level 2) and it is a line chart, not a categorical bar graph or a histogram.',
    gaps: [
      { text: 'read a value off a bar graph', closedBy: 'display-read-a-value' },
      { text: 'compare two bars', closedBy: 'display-compare-bars' },
      { text: 'read a histogram bin', closedBy: 'display-which-kind' },
    ],
  },
  {
    id: 'pg-1.2.3', page: 7, chapter: 1, title: 'Types of Numbers',
    lessons: ['1.2.3', '1.2.4'],
    targets: ['math-ns-factors-multiples'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'Zero emitted topics touch primes, composites, factors, multiples, GCF or LCM.',
    gaps: ['primes and composites', 'factor pairs', 'multiples, GCF and LCM'],
  },
  {
    id: 'pg-2.1.2', page: 8, chapter: 2, title: 'Graphical Representations of Data: Stem-and-Leaf Plots',
    lessons: ['2.1.2'],
    targets: ['math-sp-displays'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'No emitted topic reads any plot. Same root cause as 1.1.4.',
    gaps: ['read a stem-and-leaf plot', 'build one from a data set'],
  },
  {
    id: 'pg-2.3.1', page: 9, chapter: 2, title: 'Multiplication with Generic Rectangles',
    lessons: ['2.3.1', '2.3.2', '2.3.3', '2.3.4'],
    targets: ['math-ee-equivalent', 'math-g-area-polygons'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'The area model itself is absent. g6-rect-area computes one rectangle\'s area from two '
       + 'given sides; it never decomposes a product into partial products.',
    gaps: ['partial products in a generic rectangle', 'read the whole product off the model'],
  },
  {
    id: 'pg-2.3.3', page: 11, chapter: 2, title: 'Distributive Property',
    lessons: ['2.3.3', '2.3.4'],
    targets: ['math-ee-equivalent'],
    moduleTopics: ['g6-evaluate2'],
    verdict: 'PARTIAL',
    why: 'g6-evaluate2 is emitted at 100% of The Floating Bear Grade 6 level 5, but it EVALUATES '
       + 'a(x + b) at a given x. Generating the equivalent expression, which is what 6.EE.A.3 asks '
       + 'and what the block teaches, is never asked.',
    gaps: ['expand a(b + c) to an equivalent expression', 'factor a common factor back out'],
  },
  {
    id: 'pg-3.1.1', page: 14, chapter: 3, title: 'Equivalent Fractions',
    lessons: ['3.1.1'],
    targets: ['math-r5-fraction-add-sub'],
    moduleTopics: ['frac-equiv', 'frac-simplify'],
    verdict: 'COVERED',
    why: 'frac-equiv is emitted from Fraction Rider Grade 5 levels 2, 3 and 6; frac-simplify from '
       + 'levels 3 and 6. Grade 5 track.',
    gaps: [],
  },
  {
    id: 'pg-3.1.2', page: 15, chapter: 3, title: 'Fraction-Decimal-Percent Equivalents',
    lessons: ['3.1.2', '3.1.3', '3.1.4', '3.1.5'],
    targets: ['math-rp-percent', 'math-r5-decimal-place-value'],
    moduleTopics: ['frac-equiv', 'dec-place-value', 'g6-percent'],
    verdict: 'PARTIAL',
    why: 'All three forms are emitted, each in its own world. No emitted topic CONVERTS between '
       + 'them, which is the whole content of the block.',
    gaps: ['fraction to decimal', 'decimal to percent', 'the three-way equivalence in one item'],
  },
  {
    id: 'pg-3.1.2-note', page: 18, chapter: 3, title: 'Operations with Fractions: Addition and Subtraction',
    lessons: ['3.1.2'],
    targets: ['math-r5-fraction-add-sub'],
    moduleTopics: ['frac-add-like', 'frac-sub-like', 'frac-add-unlike', 'frac-sub-unlike'],
    verdict: 'COVERED',
    why: 'All four are emitted from Fraction Rider Grade 5 levels 1, 2, 3 and 6.',
    gaps: [],
  },
  {
    id: 'pg-3.1.6', page: 20, chapter: 3, title: 'Ratios',
    lessons: ['3.1.6'],
    targets: ['math-rp-ratio-concept'],
    moduleTopics: ['g6-ratio-table', 'g6-equiv-ratio'],
    verdict: 'COVERED',
    why: 'Both emitted at 100% of Rocky Grade 6 levels 2 and 3.',
    gaps: [],
  },
  {
    id: 'pg-3.2.1', page: 21, chapter: 3, title: 'Operations with Integers',
    lessons: ['3.2.1', '3.2.2'],
    targets: ['math-ns-integers'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'No emitted topic does integer arithmetic. Razor Crest reaches negative numbers only as '
       + 'coordinates, and its answers are points and distances rather than signed sums.',
    gaps: ['add and subtract integers', 'the meaning of the opposite of a number'],
  },
  {
    id: 'pg-3.2.3-abs', page: 24, chapter: 3, title: 'Absolute Value',
    lessons: ['3.2.3'],
    targets: ['math-ns-order-abs'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'Absolute value is used INSIDE g6-distance to compute a distance, and is never itself the '
       + 'question. No emitted topic names it.',
    gaps: ['absolute value as distance from zero', 'order rational numbers on a number line'],
  },
  {
    id: 'pg-3.2.3-quad', page: 26, chapter: 3, title: 'Four-Quadrant Graphing',
    lessons: ['3.2.3', '3.2.4'],
    targets: ['math-ns-coordinate-plane'],
    moduleTopics: ['g6-quadrant', 'g6-reflect', 'g6-distance'],
    verdict: 'COVERED',
    why: 'All three emitted at 100% of Razor Crest Grade 6 levels 1, 2 and 3.',
    gaps: [],
  },
  {
    id: 'pg-4.1.1-var', page: 28, chapter: 4, title: 'Variable Expressions',
    lessons: ['4.1.1', '4.1.2', '4.1.3'],
    targets: ['math-ee-write-expression'],
    moduleTopics: ['g6-evaluate', 'pemdas-write-expr'],
    verdict: 'PARTIAL',
    why: 'CORRECTION to the preliminary census, which called this COVERED. g6-evaluate substitutes '
       + 'into an expression that is handed over. pemdas-write-expr does write an expression from '
       + 'words, but its expressions are ALL NUMERIC: reading the generator confirms every option '
       + 'is digits and operators. Writing an expression in which a LETTER stands for a number, '
       + 'which is 6.EE.A.2.a and the point of the block, is emitted nowhere.',
    gaps: ['write an expression using a letter', 'name the parts: term, factor, coefficient'],
  },
  {
    id: 'pg-4.1.1-gen', page: 30, chapter: 4, title: 'Using Variables to Generalize',
    lessons: ['4.1.1', '4.1.2', '4.1.3'],
    targets: ['math-ee-generalize'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'Nothing emitted generalises a pattern into a rule. This is the same shortfall 1.1.3 '
       + 'names, one chapter later and with the variable made explicit.',
    gaps: [
      { text: 'write the rule for figure n', closedBy: 'growpattern-rule' },
      { text: 'use the rule to reach a far term', closedBy: 'growpattern-far-term' },
    ],
  },
  {
    id: 'pg-4.1.3-note', page: 32, chapter: 4, title: 'Operations with Fractions: Mixed Numbers',
    lessons: ['4.1.3'],
    targets: ['math-r5-fraction-add-sub'],
    moduleTopics: ['frac-mixed-add', 'frac-mixed-sub'],
    verdict: 'COVERED',
    why: 'Both emitted from Fraction Rider Grade 5; frac-mixed-add from levels 1, 4 and 6, '
       + 'frac-mixed-sub from level 6.',
    gaps: [],
  },
  {
    id: 'pg-4.1.3-sub', page: 34, chapter: 4, title: 'Substitution and Evaluation of Expressions',
    lessons: ['4.1.3'],
    targets: ['math-ee-evaluate'],
    moduleTopics: ['g6-evaluate', 'g6-evaluate2', 'g6-exponent'],
    verdict: 'COVERED',
    why: 'All three emitted at 100% of The Floating Bear Grade 6 levels 1, 2 and 5.',
    gaps: [],
  },
  {
    id: 'pg-4.2.1', page: 36, chapter: 4, title: 'Scaling Figures and Scale Factor',
    lessons: ['4.2.1', '4.2.2', '4.2.3'],
    targets: ['math-rp-ratio-concept'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'vol-scale is adjacent and does not serve it: it is emitted at 12% of LEGO Master Builder '
       + 'Grade 5 level 6 and scales ONE dimension of a solid. Scaling a two-dimensional figure and '
       + 'reading the scale factor back off it is emitted nowhere.',
    gaps: ['scale a figure by a factor', 'find the scale factor between two figures'],
  },
  {
    id: 'pg-4.2.3-xref', page: 20, chapter: 4, title: 'Ratios (cross-reference from Lesson 3.1.6)',
    lessons: ['4.2.4'],
    crossRef: 'pg-3.1.6',
    targets: ['math-rp-ratio-concept'],
    moduleTopics: ['g6-ratio-table', 'g6-equiv-ratio'],
    verdict: 'COVERED',
    why: 'The Parent Guide\'s Ratios entry at Lesson 3.1.6 points forward to Lessons 4.2.3 and '
       + '4.2.4 rather than restating itself, so the coverage is that section\'s. 4.2.3 is already '
       + 'inside the Scaling Figures range; 4.2.4 is reached only through this pointer.',
    gaps: [],
  },
  {
    id: 'pg-5.1.1', page: 38, chapter: 5, title: 'Multiplying Fractions with an Area Model',
    lessons: ['5.1.1', '5.1.4', '5.2.2'],
    targets: ['math-r5-fraction-multiply'],
    moduleTopics: ['frac-mult-frac', 'frac-mult-whole', 'frac-of-whole'],
    verdict: 'PARTIAL',
    why: 'The arithmetic is emitted from Fraction Rider Grade 5 levels 2, 4, 5 and 6. The AREA '
       + 'MODEL, which is what the block is named for and how CC1 teaches it, is absent.',
    gaps: ['read a product off a fraction area model'],
  },
  {
    id: 'pg-5.2.1', page: 40, chapter: 5, title: 'Operations with Decimals: Multiplication of Decimals and Percents',
    lessons: ['5.2.1'],
    targets: ['math-ns-multi-digit-ops', 'math-rp-percent'],
    moduleTopics: ['dec-mult', 'g6-dec-mul', 'g6-percent', 'g6-dec-percent'],
    verdict: 'COVERED',
    why: 'dec-mult at 70% of F1 Grade 5 level 4; g6-dec-mul from Grade 6 level 2; both percent '
       + 'topics at 100% of their own levels.',
    gaps: [],
  },
  {
    id: 'pg-5.3.1', page: 42, chapter: 5, title: 'Area of Polygons and Complex Figures',
    lessons: ['5.3.1', '5.3.2', '5.3.3', '5.3.4'],
    targets: ['math-g-area-polygons', 'math-g-coordinate-polygons'],
    moduleTopics: ['g6-rect-area', 'g6-tri-area', 'g6-coord-rect-area', 'g6-coord-tri-area'],
    verdict: 'PARTIAL',
    why: 'Rectangle and triangle only, each at 100% of its own LEGO Master Builder or Razor Crest '
       + 'Grade 6 level. The parallelogram, the trapezoid and any complex figure decomposed into '
       + 'parts, which are three of the block\'s four sections, are emitted nowhere.',
    gaps: ['area of a parallelogram', 'area of a trapezoid', 'decompose a complex figure'],
  },
  {
    id: 'pg-6.1.1', page: 49, chapter: 6, title: 'Division by Fractions',
    lessons: ['6.1.1', '6.1.2', '6.1.3', '6.1.4'],
    targets: ['math-ns-divide-fractions'],
    moduleTopics: ['ns-div-intro', 'ns-div-frac', 'ns-div-mixed', 'ns-div-multi', 'ns-div-word'],
    verdict: 'COVERED',
    why: 'The whole Grade 6 Fraction Rider campaign: all five emitted at 100% of their own levels.',
    gaps: [],
  },
  {
    id: 'pg-6.2.1', page: 52, chapter: 6, title: 'Order of Operations',
    lessons: ['6.2.1', '6.2.2', '6.2.5'],
    targets: ['math-ee-evaluate', 'math-ee-exponents'],
    moduleTopics: ['pemdas-simple', 'pemdas-multi', 'pemdas-brackets', 'pemdas-nested',
                   'pemdas-full', 'pemdas-compare'],
    verdict: 'COVERED',
    why: 'Six emitted topics across all six Floating Bear Grade 5 levels. Grade 5 track.',
    gaps: [],
  },
  {
    id: 'pg-6.2.3', page: 55, chapter: 6, title: 'Algebra Tiles and Perimeter',
    lessons: ['6.2.3'],
    targets: ['math-r4-perimeter', 'math-ee-write-expression'],
    moduleTopics: [],
    // WP2 level 1 landed 26-0822: 22 items over 15 labelled-polygon figures in
    // packs/cpm-cc1-g6.json. No MODULE emits perimeter, and none ever will under constraint 2, but
    // a pack item now serves it, so this block moves GAP to PARTIAL and the gap count falls. That
    // fall is the whole point of the meter.
    packItemTargets: ['math-r4-perimeter'],
    verdict: 'PARTIAL',
    why: 'No module emits perimeter as a question, and in the six worlds it appears only as the '
       + 'DISTRACTOR inside area items, where the explain text names it to rule it out. '
       + 'packs/cpm-cc1-g6.json level 1 now serves it directly: 22 items over 15 labelled '
       + 'polygons, rectangle through L-shape, including two that run the relationship backwards '
       + 'from a given perimeter. Writing a perimeter as an EXPRESSION, the algebra-tile half of '
       + 'this block, is still absent.',
    gaps: ['perimeter written as an expression'],
  },
  {
    id: 'pg-6.2.4', page: 57, chapter: 6, title: 'Combining Like Terms',
    lessons: ['6.2.4'],
    targets: ['math-ee-equivalent'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'No emitted topic simplifies an expression by collecting terms.',
    gaps: ['combine like terms', 'recognise unlike terms'],
  },
  {
    id: 'pg-7.1.1', page: 59, chapter: 7, title: 'Rates and Unit Rates',
    lessons: ['7.1.1', '7.1.2', '7.1.3'],
    targets: ['math-rp-unit-rate', 'math-rp-unit-conversion'],
    moduleTopics: ['g6-unit-rate', 'g6-dec-unit-rate', 'unit-metric', 'unit-customary',
                   'unit-time', 'unit-multistep'],
    verdict: 'COVERED',
    why: 'Both rate topics at 100% of their own Grade 6 levels, plus the whole Grade 5 Rocky '
       + 'conversion campaign for 6.RP.A.3.d.',
    gaps: [],
  },
  {
    id: 'pg-7.2.1-xref', page: 49, chapter: 7, title: 'Division by Fractions (cross-reference to 6.1.1 to 6.1.4)',
    lessons: ['7.2.1', '7.2.2'],
    crossRef: 'pg-6.1.1',
    targets: ['math-ns-divide-fractions'],
    moduleTopics: ['ns-div-intro', 'ns-div-frac', 'ns-div-mixed', 'ns-div-multi', 'ns-div-word'],
    verdict: 'COVERED',
    why: 'The Parent Guide points this range back at its own chapter-6 section rather than '
       + 'restating it, so the coverage is that section\'s.',
    gaps: [],
  },
  {
    id: 'pg-7.2.3', page: 61, chapter: 7, title: 'Operations with Decimals',
    lessons: ['7.2.3', '7.2.4'],
    targets: ['math-ns-multi-digit-ops', 'math-r5-decimal-ops'],
    moduleTopics: ['g6-dec-add', 'g6-dec-sub', 'g6-dec-mul', 'g6-dec-divide',
                   'dec-add-sub', 'dec-div', 'dec-round'],
    verdict: 'COVERED',
    why: 'All four Grade 6 decimal operations emitted from F1 Grade 6 levels 1, 2 and 6, plus the '
       + 'Grade 5 decimal campaign.',
    gaps: [],
  },
  {
    id: 'pg-7.3.4', page: 64, chapter: 7, title: 'Graphing and Solving Inequalities',
    lessons: ['7.3.4'],
    targets: ['math-ee-inequalities'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'No emitted topic writes, graphs or solves an inequality. frac-compare and pemdas-compare '
       + 'compare two fixed values; neither states a constraint on an unknown.',
    gaps: ['write x > c from a condition', 'graph the solution on a number line'],
  },
  {
    id: 'pg-8.1.1', page: 67, chapter: 8, title: 'Measures of Central Tendency',
    lessons: ['8.1.1', '8.1.2', '8.1.3'],
    targets: ['math-sp-center-spread', 'math-sp-statistical-question'],
    moduleTopics: ['g6-stats-mean', 'g6-stats-median', 'g6-stats-range'],
    verdict: 'COVERED',
    why: 'All three emitted from F1 Grade 6 level 5 at about a third of its draws each, and again '
       + 'from level 6.',
    gaps: [],
  },
  {
    id: 'pg-8.1.4', page: 70, chapter: 8, title: 'Graphical Representations of Data: Box Plots',
    lessons: ['8.1.4', '8.1.5'],
    targets: ['math-sp-displays'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'No emitted topic reads any plot. Third instance of the same root cause as 1.1.4 and 2.1.2.',
    gaps: ['read a box plot', 'read the median and the quartiles off one'],
  },
  {
    id: 'pg-8.3.1', page: 73, chapter: 8, title: 'Solving Equations in Context',
    lessons: ['8.3.1'],
    targets: ['math-ee-solve-equations'],
    moduleTopics: ['g6-solve-add', 'g6-solve-mul'],
    verdict: 'COVERED',
    why: 'Both emitted at 100% of The Floating Bear Grade 6 levels 3 and 4.',
    gaps: [],
  },
  {
    id: 'pg-8.3.2', page: 76, chapter: 8, title: 'Distance, Rate, and Time',
    lessons: ['8.3.2', '8.3.3'],
    targets: ['math-rp-unit-rate', 'math-ee-generalize'],
    moduleTopics: [],
    verdict: 'GAP',
    why: 'No emitted topic relates distance, rate and time. g6-unit-rate finds a rate and stops; '
       + 'the Grade 5 unit-time topic converts time units and never multiplies by a rate.',
    gaps: ['d = r x t in either direction', 'a two-leg trip'],
  },
  {
    id: 'pg-9.1.1', page: 78, chapter: 9, title: 'Prisms: Volume and Surface Area',
    lessons: ['9.1.1', '9.1.2'],
    targets: ['math-g-volume-prisms', 'math-g-surface-area', 'math-r5-volume'],
    moduleTopics: ['g6-volume', 'g6-volume-frac', 'g6-surface-area',
                   'vol-lwh', 'vol-base-height', 'vol-composite', 'vol-missing-dim',
                   'vol-unit-cubes', 'vol-hollow', 'vol-compare'],
    verdict: 'COVERED',
    why: 'Three Grade 6 topics at 100% of their own levels, plus the seven-topic Grade 5 LEGO '
       + 'Master Builder campaign underneath them.',
    gaps: [],
  },
  {
    id: 'pg-9.2.1', page: 82, chapter: 9, title: 'Calculating and Using Percents',
    lessons: ['9.2.1', '9.2.2', '9.2.3', '9.2.4'],
    targets: ['math-rp-percent'],
    moduleTopics: ['g6-percent', 'g6-percent-find', 'g6-dec-percent'],
    verdict: 'COVERED',
    why: 'All three emitted at 100% of Rocky Grade 6 levels 4 and 5 and F1 Grade 6 level 4.',
    gaps: [],
  },
];

// ---------------------------------------------------------------------------
// Standalone gaps. Two of the five concepts in the 26-0819 homework set are named by no Parent
// Guide block at all, so they would be invisible to a crosswalk built from the guide alone. They
// attach to the lessons whose Review and Preview set asks for them, and they contribute targets
// and gaps but never a title: the guide names the title, and these rows are this project's.
// ---------------------------------------------------------------------------
const STANDALONE = [
  {
    id: 'sa-classify-figures', chapter: 1, title: 'Classifying triangles and quadrilaterals',
    lessons: ['1.1.3'],
    targets: ['math-r5-classify-figures'],
    moduleTopics: [],
    // WP2 level 2 landed 26-0822: 20 items over 11 figures, triangles named by side and by angle
    // and the quadrilateral hierarchy, in packs/cpm-cc1-g6.json.
    packItemTargets: ['math-r5-classify-figures'],
    verdict: 'PARTIAL',
    why: 'Problem 1-22 asks for it and the app has zero content for it: no emitted topic names a '
       + 'shape, and a full-text scan of the six modules finds no occurrence of scalene, isosceles, '
       + 'rhombus, trapezoid or obtuse. The two shell topics that LOOK like coverage, coord-shape '
       + 'and coord-real-world, carry a label and a coach tip and are emitted by nothing; WP1 '
       + 'deletes them.',
    gaps: [],
  },
  {
    id: 'sa-decimal-word', chapter: 1, title: 'Decimal word form, both directions',
    lessons: ['1.1.3'],
    targets: ['math-r5-decimal-place-value'],
    moduleTopics: ['dec-write-word'],
    verdict: 'PARTIAL',
    why: 'One direction of two. Problem 1-20a is decimals INTO words and dec-write-word serves it '
       + 'exactly, emitted at about 29% of F1 Apex Decimals Grade 5 level 1. Problem 1-20b is words '
       + 'back into decimals, and every one of that generator\'s four options is a word form, so the '
       + 'reverse direction cannot be drawn at all.',
    // WP2 level 3 landed 26-0822: decword-to-digits is exactly problem 1-20b's direction, "Which
    // number is 'three and twenty-four hundredths'?", 16 items in packs/cpm-cc1-g6.json.
    gaps: [{ text: 'read a word form and pick the decimal', closedBy: 'decword-to-digits' }],
  },
];

// A note on why STANDALONE has exactly two rows and not more. Review and Preview is spiral by
// design, so many lessons' sets almost certainly reach past the topic block the Parent Guide names
// for them. Knowing WHICH would mean reading the problems, and the sourcing rule for this whole
// crosswalk is index and topic names only. Lesson 1.1.3 is the one set whose content is known
// independently, because Justin photographed that homework on 26-0819; the plan records all five
// of its concepts. Every other lesson is tagged from its block, which is what `confidence` says.

// THE PRIORITY SEQUENCE. Not the rank. `rank` is derived from this list further down by dropping
// the rows that have finished, so a row retires itself the day its last gap line closes and the
// rows under it move up without anybody editing this array.
//
// It is a sequence rather than a rank because the ORDER is a judgment nothing can measure, while
// the CUT is a measured fact. Finished rows are kept here on purpose: they are the record of what
// was built and in what order, and their retirement is proven on every build rather than
// remembered.
//
// THE CRITERION, re-set 26-0901. The original first key was "does this row block the homework
// already on the table", and it ran out: that homework was CC1 lesson 1.1.3, and 1.1.3 is now at
// zero gaps. What replaces it:
//
//   PRIMARY, curriculum position ascending. This app exists to track Niall's class, and Justin's
//   only recurring input is which lesson they are on, so a row the class reaches in three weeks is
//   worth more than one it reaches in March. Under the old second key -- hard gap before partial --
//   box plots sat at 10 and Types of Numbers at 13, which builds chapter 8 content while the class
//   is in chapter 2.
//
//   ONE PROMOTION, stated rather than buried in the order: pg-6.2.3 stays first. Its one open gap
//   is perimeter written as an EXPRESSION; the pack already teaches perimeter as a number in L1 and
//   L6 Review and Preview already previews algebra, so it improves a level Niall plays now rather
//   than one he reaches later. It is the only row promoted out of curriculum order.
//
// Cost is deliberately NOT a key. Two of the near rows want a figure type nothing can draw yet
// (stem-and-leaf, generic rectangles) and two want no figure at all (Types of Numbers, the
// distributive property); ordering by cost would quietly re-sort the class's own sequence around
// whatever happens to be cheap to build.
const BUILD_ORDER = [
  // Built, and retired from the rank automatically because no gap line is left. None of these was
  // removed by hand, and none has to be.
  'sa-classify-figures', // L2 Name the Shape, 26-0822
  'pg-1.1.4',            // L5 Read the Chart, 26-0822
  'pg-1.1.3',            // L4 Find the Rule, 26-0822
  'sa-decimal-word',     // L3 Say the Number, 26-0822
  'pg-4.1.1-gen',        // L4 and L6, 26-0822

  // Open, in the order the criterion above sets.
  'pg-6.2.3',            // 6.2.3  promoted: one item type from content that already ships
  'pg-1.2.3',            // 1.2.3  primes, composites, factor pairs, GCF and LCM
  'pg-2.1.2',            // 2.1.2  stem-and-leaf plots
  'pg-2.3.1',            // 2.3.1  generic rectangles and partial products
  'pg-2.3.3',            // 2.3.3  the distributive property
  'pg-3.1.2',            // 3.1.2  fraction, decimal and percent equivalents
  'pg-3.2.1',            // 3.2.1  operations with integers
  'pg-3.2.3-abs',        // 3.2.3  absolute value
  'pg-4.1.1-var',        // 4.1.1  variable expressions
  'pg-4.2.1',            // 4.2.1  scaling figures and scale factor
  'pg-5.1.1',            // 5.1.1  multiplying fractions with an area model
  'pg-5.3.1',            // 5.3.1  area of polygons and complex figures
  'pg-6.2.4',            // 6.2.4  combining like terms
  'pg-7.3.4',            // 7.3.4  graphing and solving inequalities
  'pg-8.1.4',            // 8.1.4  box plots
  'pg-8.3.2',            // 8.3.2  distance, rate and time
];

// ---------------------------------------------------------------------------
// Lessons no Parent Guide block names. Each is tagged from its chapter's correlation and carries
// confidence `inferred`. The tagging is deliberately conservative: a lesson gets a target only
// where its chapter's own blocks make the domain unambiguous, and `moduleTopics` stays empty
// unless the chapter's covered blocks already serve it. An inferred row with no module topic and
// no pack item lands in gaps[] like any other, which is what keeps the gap count honest rather
// than flattered by guesses.
// ---------------------------------------------------------------------------
const INFERRED = {
  '1.1.1': { targets: ['math-sp-statistical-question'], moduleTopics: [], gaps: ['open the course: collect and organise data'] },
  '1.1.2': { targets: ['math-sp-statistical-question'], moduleTopics: [], gaps: ['describe a data set in words'] },
  '1.1.5': { targets: ['math-r3-scaled-graphs', 'math-sp-displays'], moduleTopics: [], gaps: ['choose and read a data display'] },
  '1.2.1': { targets: ['math-ns-factors-multiples'], moduleTopics: [], gaps: ['arrays and factor pairs'] },
  '1.2.2': { targets: ['math-ns-factors-multiples'], moduleTopics: [], gaps: ['multiples and common multiples'] },
  '2.1.1': { targets: ['math-sp-displays'], moduleTopics: [], gaps: ['organise a data set before plotting it'] },
  '2.2.1': { targets: ['math-r5-decimal-place-value'], moduleTopics: ['dec-place-value', 'dec-compare'], gaps: [] },
  '2.2.2': { targets: ['math-r5-decimal-ops'], moduleTopics: ['dec-add-sub'], gaps: [] },
  '2.2.3': { targets: ['math-r5-decimal-ops'], moduleTopics: ['dec-add-sub', 'dec-round'], gaps: [] },
  '5.1.2': { targets: ['math-r5-fraction-multiply'], moduleTopics: ['frac-mult-frac'], gaps: ['the area model itself'] },
  '5.1.3': { targets: ['math-r5-fraction-multiply'], moduleTopics: ['frac-mult-whole', 'frac-of-whole'], gaps: [] },
  '6.2.2': { targets: ['math-ee-evaluate'], moduleTopics: ['pemdas-multi', 'pemdas-brackets'], gaps: [] },
  '6.2.5': { targets: ['math-ee-evaluate'], moduleTopics: ['pemdas-full', 'g6-evaluate'], gaps: [] },
  '7.3.1': { targets: ['math-ee-solve-equations'], moduleTopics: ['g6-solve-add'], gaps: [] },
  '7.3.2': { targets: ['math-ee-solve-equations'], moduleTopics: ['g6-solve-mul'], gaps: [] },
  '7.3.3': { targets: ['math-ee-inequalities'], moduleTopics: [], gaps: ['compare with an inequality symbol'] },
  '8.2.1': { targets: ['math-sp-center-spread'], moduleTopics: ['g6-stats-mean', 'g6-stats-median'], gaps: [] },
};

// ---------------------------------------------------------------------------
// Build.
// ---------------------------------------------------------------------------
const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const lessonIds = Object.keys(index.lessons);
if (lessonIds.length < 60) throw new Error('curriculum-gen: the lesson index looks empty (' + lessonIds.length + ' lessons)');

// BUILD_ORDER's own shape, checked before anything reads it. The RANK is derived further down,
// after the gap lines have been closed, because a row's rank depends on whether it is finished and
// that is not known until then.
const ALL_ROWS = BLOCKS.concat(STANDALONE);
const namedInOrder = new Set();
for (const id of BUILD_ORDER) {
  if (namedInOrder.has(id)) throw new Error('curriculum-gen: BUILD_ORDER names ' + id + ' twice');
  if (!ALL_ROWS.some((b) => b.id === id)) throw new Error('curriculum-gen: BUILD_ORDER names unknown row ' + id);
  namedInOrder.add(id);
}

// A lesson may sit under more than one row (4.1.3 is named by three Parent Guide blocks, 1.1.3 by
// one block and two standalone gaps). Merge them: the guide's blocks give the title, and every row
// contributes its targets, module topics and gaps.
const byLesson = new Map();
for (const b of ALL_ROWS) {
  for (const l of b.lessons) {
    if (!byLesson.has(l)) byLesson.set(l, []);
    byLesson.get(l).push(b);
  }
}

const uniq = (arr) => [...new Set(arr)];

// WHICH TARGETS A PACK ITEM ACTUALLY SERVES, read out of the packs rather than declared here.
//
// packItemTargets used to be typed into each BLOCKS row by hand, and it went stale the moment a
// level shipped: after levels 4, 5 and 6 landed, the packs served seven targets and the crosswalk
// still claimed two. A hand-maintained progress meter measures how recently someone remembered to
// edit it, which is not the thing anyone wants to know. So a block's packItemTargets is now the
// intersection of its own targets with the set the packs really serve, and it cannot overstate
// (a target no item carries can never appear) or fall behind (a new level updates it on the next
// build).
const PACKED_TARGETS = (() => {
  const served = new Set();
  const manifestPath = path.join(ROOT, 'packs', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const p of manifest.packs || []) {
    const file = path.join(ROOT, 'packs', p.id + '.json');
    if (!fs.existsSync(file)) continue;
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const item of pack.items || []) for (const t of item.targets || []) served.add(t);
  }
  if (!served.size) {
    throw new Error('curriculum-gen: no pack item declares a target, so the coverage meter would '
      + 'report every lesson as a gap. The manifest or the packs are not where this expects them.');
  }
  return served;
})();

// WHICH COACH TOPICS THE PACKS CARRY. A gap line may name the topic that closes it, and once that
// topic ships the line stops being a gap. Keyed on coachTopic rather than on a target, because a
// target is coarse: one target covers reading a bar, comparing two, and totalling them, and those
// are three separate lines here. A closedBy that names a topic no pack carries is a BUILD ERROR
// rather than a gap that stays open, so a typo cannot quietly hold a gap open forever; a gap whose
// topic has not been built yet is written as a plain string and stays open until it has.
const PACKED_TOPICS = (() => {
  const topics = new Set();
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'manifest.json'), 'utf8'));
  for (const p of manifest.packs || []) {
    const file = path.join(ROOT, 'packs', p.id + '.json');
    if (!fs.existsSync(file)) continue;
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const item of pack.items || []) if (item.coachTopic) topics.add(item.coachTopic);
  }
  return topics;
})();

let gapsClosed = 0;
for (const b of BLOCKS.concat(STANDALONE)) {
  b.gaps = (b.gaps || []).filter((g) => {
    if (typeof g === 'string') return true;
    if (!PACKED_TOPICS.has(g.closedBy)) {
      throw new Error(`curriculum-gen: block ${b.id} says the gap ${JSON.stringify(g.text)} is closed `
        + `by coachTopic ${JSON.stringify(g.closedBy)}, which no pack item carries. Write the gap as a `
        + 'plain string until the topic exists, or fix the topic name.');
    }
    gapsClosed++;
    return false;
  }).map((g) => (typeof g === 'string' ? g : g.text));
}

for (const b of BLOCKS.concat(STANDALONE)) {
  const derived = (b.targets || []).filter((t) => PACKED_TARGETS.has(t));
  // A row that still carries a hand-typed list must not claim more than the packs serve. This is
  // the check that would have caught the stale two-of-seven, and it runs before the field is
  // replaced so the old value is still there to be judged.
  for (const t of b.packItemTargets || []) {
    if (!PACKED_TARGETS.has(t)) {
      throw new Error(`curriculum-gen: block ${b.id} claims pack coverage of ${t}, but no pack item `
        + 'carries that target. The crosswalk would report progress that does not exist.');
    }
  }
  b.packItemTargets = derived;
}

// ---------------------------------------------------------------------------
// WHAT IS FINISHED, AND THEREFORE WHAT IS STILL RANKED.
//
// `verdict` and the rank were both hand-typed, and on 26-0901 both were stale the way
// packItemTargets had been. Measured across all 38 rows, the authored verdict disagreed with the
// packs on 8, and every one of the 8 was BEHIND the packs, never ahead; five rows WP2 had finished
// still held ranks 2 through 6 and pushed the real backlog down under them. A field nobody
// measures records how recently somebody remembered to edit it.
//
// A row is FINISHED when it has no open gap line left, and that is a measured fact: gap lines close
// themselves against the coach topics the packs carry, and a closedBy naming a topic no pack
// carries already throws above, so a gap cannot be closed by a typo.
//
// What is NOT measurable is the PARTIAL vs GAP split, so it stays authored. Three derivation rules
// were tested against the 38 authored rows on 26-0901 and none beat 32 of 38. Keying "partly
// served" on packItemTargets OVERSTATES: pg-2.1.2 reads as served because a bar-graph item carries
// the coarse math-sp-displays target, while no stem-and-leaf item exists anywhere. Keying it on
// moduleTopics UNDERSTATES: pg-6.2.3 reads as untouched, while the pack teaches perimeter as a
// number in L1. The coarseness is the same one that made gap lines key on coachTopic instead.
//
// The two directions of drift are treated ASYMMETRICALLY, on purpose:
//
//   OVERSTATEMENT throws. A row authored COVERED while it still declares an open gap is a false
//   claim about what the app teaches, and a false claim is never quietly corrected.
//
//   UNDERSTATEMENT is absorbed and reported. A row authored PARTIAL or GAP whose gap lines have all
//   closed is the program having made progress, and progress must not redden a build. Two gates
//   went red for precisely that reason on 26-0822; tasks/lessons.md carries the ruling.
//
// A row with no gap lines AND nothing serving it is silence rather than completion, and throws
// rather than being read as finished.
const VERDICT_DRIFT = [];
for (const b of ALL_ROWS) {
  const open = (b.gaps || []).length;
  const served = (b.moduleTopics || []).length + (b.packItemTargets || []).length;
  if (b.verdict === 'COVERED' && open) {
    throw new Error('curriculum-gen: ' + b.id + ' is authored COVERED but still declares ' + open
      + ' open gap line(s): ' + JSON.stringify(b.gaps) + '. COVERED claims the app already teaches '
      + 'this, so either the verdict is wrong or those gap lines are.');
  }
  if (!open && !served && !b.crossRef) {
    throw new Error('curriculum-gen: ' + b.id + ' declares no gap line, no module topic and no pack '
      + 'item. That is silence rather than coverage, and it would be read as a finished row. Write '
      + 'the gap lines, or name what serves it.');
  }
  if (b.verdict !== 'COVERED' && !open) {
    VERDICT_DRIFT.push({ id: b.id, was: b.verdict, lesson: b.lessons[0], title: b.title });
    b.verdict = 'COVERED';
  }
}

// RANK: BUILD_ORDER filtered to the rows that are still open, renumbered from 1. A finished row
// leaves the list on the next build and every row under it moves up on its own.
const rowById = (id) => ALL_ROWS.find((b) => b.id === id);
const OPEN_ROWS = BUILD_ORDER.map(rowById).filter((b) => (b.gaps || []).length);
const RETIRED = BUILD_ORDER.map(rowById).filter((b) => !(b.gaps || []).length);
const RETIRED_IDS = new Set(RETIRED.map((b) => b.id));
const RANK = new Map();
OPEN_ROWS.forEach((b, i) => RANK.set(b.id, i + 1));

// Every row that still declares a gap must be named in BUILD_ORDER, or it is work nothing tracks.
// The converse is no longer an error: a named row that has finished retires above.
for (const b of ALL_ROWS) {
  if ((b.gaps || []).length && !RANK.has(b.id)) {
    throw new Error('curriculum-gen: ' + b.id + ' declares ' + b.gaps.length + ' open gap line(s) '
      + 'but BUILD_ORDER never names it, so it would be ranked nowhere and built never.');
  }
}

const lessons = lessonIds.map((lesson) => {
  const chapter = Number(lesson.split('.')[0]);
  const problems = index.lessons[lesson];
  const rows = byLesson.get(lesson) || [];
  const guideRows = rows.filter((r) => r.id.startsWith('pg-'));

  if (rows.length) {
    // `verified` when a Parent Guide block names this exact lesson as the FIRST of its range (the
    // anchor the table of contents actually prints); `inherited-plausible` when the lesson only
    // falls inside a range. A lesson carrying standalone rows only is neither, and is `inferred`.
    const anchored = guideRows.some((b) => b.lessons[0] === lesson);
    const confidence = guideRows.length ? (anchored ? 'verified' : 'inherited-plausible') : 'inferred';
    return {
      lesson,
      chapter,
      problems,
      title: guideRows.length
        ? guideRows.map((b) => b.title).join(' + ')
        : (CHAPTERS.find((c) => c.chapter === chapter) || {}).label,
      titleSource: guideRows.length ? 'parent-guide' : 'chapter-correlation',
      blocks: rows.map((b) => b.id),
      ccss: uniq(rows.flatMap((b) => b.targets).flatMap((t) => TARGET_CCSS[t] || [])),
      targets: uniq(rows.flatMap((b) => b.targets)),
      moduleTopics: uniq(rows.flatMap((b) => b.moduleTopics)),
      packItemTargets: uniq(rows.flatMap((b) => b.packItemTargets || [])),
      gaps: uniq(rows.flatMap((b) => b.gaps)),
      confidence,
    };
  }

  const inf = INFERRED[lesson];
  if (!inf) throw new Error('curriculum-gen: lesson ' + lesson + ' has no block and no INFERRED entry');
  return {
    lesson,
    chapter,
    problems,
    title: (CHAPTERS.find((c) => c.chapter === chapter) || {}).label,
    titleSource: 'chapter-correlation',
    blocks: [],
    ccss: uniq(inf.targets.flatMap((t) => TARGET_CCSS[t] || [])),
    targets: inf.targets,
    moduleTopics: inf.moduleTopics,
    packItemTargets: [],
    gaps: inf.gaps,
    confidence: 'inferred',
  };
});

// Every lesson that can serve nothing must say so, in gaps[]. A row with no module topic, no pack
// item and an empty gaps[] would read as covered while serving nothing at all.
for (const row of lessons) {
  if (!row.moduleTopics.length && !row.packItemTargets.length && !row.gaps.length) {
    throw new Error('curriculum-gen: lesson ' + row.lesson + ' serves nothing and declares no gap');
  }
}

const out = {
  version: 1,
  book: 'cc1',
  bookTitle: 'CPM Core Connections, Course 1',
  generatedBy: 'build/curriculum-gen.js',
  sources: [
    {
      id: 'parent-guide',
      what: 'topic block titles and their lesson ranges, from the table of contents on pages 5 and 6',
      url: 'https://pdfs.cpm.org/CoreConnections/ParentGuide/cc1/CC1_PG.pdf',
      read: '2026-08-22',
      note: 'free publisher-hosted guide; index and topic names only, no problem text',
    },
    {
      id: 'homework-index',
      what: 'lesson-to-problem-number index, 80 lessons and 462 Review and Preview problem numbers',
      url: 'https://homework.cpm.org/category/CC/textbook/cc1/chapter/1',
      read: '2026-08-22',
      note: 'problem NUMBERS only; the problems are copyrighted and no problem text is stored',
    },
  ],
  chapters: CHAPTERS.map((c) => Object.assign({}, c, { labelSource: 'derived-from-parent-guide-blocks' })),
  blocks: ALL_ROWS.map((b) => ({
    id: b.id,
    source: b.id.startsWith('pg-') ? 'parent-guide-toc' : 'homework-set',
    chapter: b.chapter, title: b.title, page: b.page || null, lessons: b.lessons,
    crossRef: b.crossRef || null,
    verdict: b.verdict, rank: RANK.get(b.id) || null, retired: RETIRED_IDS.has(b.id), why: b.why,
    targets: b.targets, moduleTopics: b.moduleTopics, packItemTargets: b.packItemTargets || [], gaps: b.gaps,
  })),
  lessons,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1) + '\n');

// ---- report ----
const tally = { COVERED: 0, PARTIAL: 0, GAP: 0 };
for (const b of BLOCKS) { if (!b.crossRef) tally[b.verdict]++; }
const saTally = STANDALONE.reduce((n, b) => n + (b.verdict === 'GAP' ? 1 : 0), 0);
const gapLessons = lessons.filter((l) => l.gaps.length);
const servedLessons = lessons.filter((l) => l.moduleTopics.length || l.packItemTargets.length);
console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
console.log(`  ${gapsClosed} gap line(s) closed by a coach topic the packs now carry`);
console.log(`  ${lessons.length} lessons, ${BLOCKS.length} Parent Guide blocks `
  + `(${BLOCKS.filter((b) => b.crossRef).length} cross-reference), ${STANDALONE.length} standalone gap rows`);
console.log(`  confirmed census, Parent Guide blocks: ${tally.COVERED} COVERED / ${tally.PARTIAL} PARTIAL / ${tally.GAP} GAP`);
console.log(`  plus ${saTally} standalone GAP row(s) no block names`);
console.log(`  confidence: ${lessons.filter((l) => l.confidence === 'verified').length} verified / `
  + `${lessons.filter((l) => l.confidence === 'inherited-plausible').length} inherited-plausible / `
  + `${lessons.filter((l) => l.confidence === 'inferred').length} inferred`);
console.log(`  ${servedLessons.length}/${lessons.length} lessons are served by at least one emitted module topic`);
console.log(`  ${gapLessons.length}/${lessons.length} lessons declare at least one gap`);
console.log(`  GAP COUNT, the program's progress meter: ${out.lessons.reduce((n, l) => n + l.gaps.length, 0)} `
  + `open gaps across ${gapLessons.length} lessons`);
console.log('\n  ranked build list, worst first (BUILD_ORDER minus the rows that have finished):');
for (const b of OPEN_ROWS) {
  console.log(`   ${String(RANK.get(b.id)).padStart(2)}. [${b.verdict.padEnd(7)}] ${b.lessons[0].padEnd(6)} ${b.title}`);
}
console.log(`  retired from the build list, every gap line closed: ${RETIRED.length}`);
for (const b of RETIRED) console.log(`       -- ${b.lessons[0].padEnd(6)} ${b.title}`);
if (VERDICT_DRIFT.length) {
  console.log(`  verdicts carried forward, the authored value having fallen behind the packs: ${VERDICT_DRIFT.length}`);
  for (const d of VERDICT_DRIFT) console.log(`       ${d.was.padEnd(7)} -> COVERED  ${d.lesson.padEnd(6)} ${d.title}`);
}
