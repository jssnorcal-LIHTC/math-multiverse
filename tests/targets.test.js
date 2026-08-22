'use strict';
const assert = require('assert');
const { TARGETS, isTarget, COACH_FAMILIES } = require('./targets');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

// The vocabulary now spans four subjects sharing one id namespace. ELA ids never carry the
// 'sci-', 'hist-' or 'math-' prefix, science ids always carry 'sci-', history ids always carry
// 'hist-' and math ids always carry 'math-' (see tests/targets.js), so the prefix is a stable,
// non-circular way to scope an assertion to its subject without relying on the very field the
// assertion checks.
const SCI_IDS = Object.keys(TARGETS).filter(id => id.startsWith('sci-'));
const HIST_IDS = Object.keys(TARGETS).filter(id => id.startsWith('hist-'));
const MATH_IDS = Object.keys(TARGETS).filter(id => id.startsWith('math-'));
const ELA_IDS = Object.keys(TARGETS).filter(
  id => !id.startsWith('sci-') && !id.startsWith('hist-') && !id.startsWith('math-'));

check('every Smarter Balanced claim is represented (ELA subset)', () => {
  const claims = new Set(ELA_IDS.map(id => TARGETS[id].claim));
  assert.deepStrictEqual([...claims].sort(), [1, 2, 3, 4]);
});

check('claim 1 covers all seven reading targets for both text kinds', () => {
  const lit = Object.keys(TARGETS).filter(k => k.startsWith('c1-lit-'));
  const inf = Object.keys(TARGETS).filter(k => k.startsWith('c1-inf-'));
  assert.strictEqual(lit.length, 7, 'literary targets: ' + lit.length);
  assert.strictEqual(inf.length, 7, 'informational targets: ' + inf.length);
});

check('every ELA target carries at least one valid grade-6 CCSS code', () => {
  for (const id of ELA_IDS) {
    const t = TARGETS[id];
    assert.strictEqual(Array.isArray(t.ccss) && t.ccss.length > 0, true, id + ' has no ccss');
    assert.strictEqual(t.ccss.every(c => /^(RL|RI|W|L|SL)\.6\./.test(c)), true, id + ' has an off-grade ccss: ' + t.ccss);
  }
});

check('every science target declares subject "sci"', () => {
  for (const id of SCI_IDS) {
    assert.strictEqual(TARGETS[id].subject, 'sci', id + ' must declare subject "sci"');
  }
});

check('every science target carries a valid PE-code array and a legal confidence tier', () => {
  const CONFIDENCE_TIERS = ['verified', 'inherited-plausible', 'inferred', 'thematic'];
  for (const id of SCI_IDS) {
    const t = TARGETS[id];
    assert.strictEqual(Array.isArray(t.pe), true, id + ' pe must be an array (empty is legal for thematic targets)');
    assert.strictEqual(t.pe.every(p => /^MS-(ESS|LS|PS|ETS)[0-9]-[0-9]$/.test(p)), true, id + ' has a malformed PE code: ' + JSON.stringify(t.pe));
    assert.strictEqual(CONFIDENCE_TIERS.includes(t.confidence), true, id + ' has an invalid confidence tier: ' + JSON.stringify(t.confidence));
  }
});

check('every history target declares subject "hist"', () => {
  for (const id of HIST_IDS) {
    assert.strictEqual(TARGETS[id].subject, 'hist', id + ' must declare subject "hist"');
  }
});

check('every history target carries a valid HSS-code array and a legal confidence tier', () => {
  const CONFIDENCE_TIERS = ['verified', 'inherited-plausible', 'inferred', 'thematic'];
  for (const id of HIST_IDS) {
    const t = TARGETS[id];
    assert.strictEqual(Array.isArray(t.hss) && t.hss.length > 0, true, id + ' hss must be a non-empty array');
    assert.strictEqual(t.hss.every(h => /^6\.[1-7]$/.test(h)), true, id + ' has a malformed HSS code: ' + JSON.stringify(t.hss));
    assert.strictEqual(CONFIDENCE_TIERS.includes(t.confidence), true, id + ' has an invalid confidence tier: ' + JSON.stringify(t.confidence));
  }
});

check('every math target declares subject "math"', () => {
  for (const id of MATH_IDS) {
    assert.strictEqual(TARGETS[id].subject, 'math', id + ' must declare subject "math"');
  }
});

check('every math target carries a valid CCSS-math code array and a legal confidence tier', () => {
  const CONFIDENCE_TIERS = ['verified', 'inherited-plausible', 'inferred', 'thematic'];
  // grade.domain.cluster.number, with the optional lettered sub-standard CCSS actually uses
  // (6.RP.A.3.a, 5.NBT.A.3.b, 6.NS.C.7.c). Grades 3 to 6 only: CC1 is a grade-6 course whose
  // chapter 1 sits on grade-5 review and leans on grade-3/4 perimeter and scaled bar graphs.
  const CODE = /^[3-6]\.(RP|NS|EE|G|SP|NBT|NF|OA|MD)\.[A-C]\.[0-9]+(\.[a-d])?$/;
  for (const id of MATH_IDS) {
    const t = TARGETS[id];
    assert.strictEqual(Array.isArray(t.ccss) && t.ccss.length > 0, true, id + ' ccss must be a non-empty array');
    assert.strictEqual(t.ccss.every(c => CODE.test(c)), true, id + ' has a malformed CCSS code: ' + JSON.stringify(t.ccss));
    assert.strictEqual(CONFIDENCE_TIERS.includes(t.confidence), true, id + ' has an invalid confidence tier: ' + JSON.stringify(t.confidence));
  }
});

check('the math block spans every grade-6 CCSS math domain', () => {
  // A crosswalk cannot honestly report a coverage gap in a domain the vocabulary cannot name.
  const domains = new Set(MATH_IDS.flatMap(id => TARGETS[id].ccss)
    .filter(c => c.startsWith('6.'))
    .map(c => c.split('.')[1]));
  assert.deepStrictEqual([...domains].sort(), ['EE', 'G', 'NS', 'RP', 'SP']);
});

check('the math block carries the grade 3-5 review CC1 chapter 1 sits on', () => {
  const codes = new Set(MATH_IDS.flatMap(id => TARGETS[id].ccss));
  for (const need of ['5.NBT.A.3.a', '5.OA.B.3', '5.G.B.3', '5.G.B.4', '4.MD.A.3', '3.MD.B.3']) {
    assert.strictEqual(codes.has(need), true, 'missing review standard ' + need);
  }
});

check('the ELA / science / history blocks stayed clear of the math prefix', () => {
  // The four id namespaces are disjoint, which is what makes the prefix-based scoping above sound.
  assert.strictEqual(MATH_IDS.length > 25, true, 'math block is too small to be the real block: ' + MATH_IDS.length);
  const all = SCI_IDS.length + HIST_IDS.length + MATH_IDS.length + ELA_IDS.length;
  assert.strictEqual(all, Object.keys(TARGETS).length, 'the four id families do not partition TARGETS');
});

check('every target carries a human label', () => {
  for (const [id, t] of Object.entries(TARGETS)) {
    assert.strictEqual(typeof t.label === 'string' && t.label.length > 3, true, id + ' has no label');
  }
});

check('isTarget accepts known ids and rejects invented ones', () => {
  assert.strictEqual(isTarget('c1-lit-2-central-ideas'), true);
  assert.strictEqual(isTarget('sci-t5-warming-adaptation'), true);
  assert.strictEqual(isTarget('hist-t2-hebrews'), true);
  assert.strictEqual(isTarget('math-g-area-polygons'), true);
  assert.strictEqual(isTarget('c1-made-up'), false);
  assert.strictEqual(isTarget('sci-made-up'), false);
  assert.strictEqual(isTarget('hist-made-up'), false);
  assert.strictEqual(isTarget('math-made-up'), false);
  assert.strictEqual(isTarget(''), false);
  assert.strictEqual(isTarget(undefined), false);
});

check('TARGETS is frozen so a pack cannot mutate the vocabulary', () => {
  assert.throws(() => { 'use strict'; TARGETS.nonsense = {}; }, TypeError);
});

check('coach families are non-empty lowercase slugs', () => {
  assert.strictEqual(COACH_FAMILIES.length > 0, true);
  assert.strictEqual(COACH_FAMILIES.every(f => /^[a-z]+$/.test(f)), true);
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
