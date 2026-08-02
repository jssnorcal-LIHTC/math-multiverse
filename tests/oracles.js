'use strict';
// oracles.js -- INDEPENDENT verification of generated questions. Every oracle recomputes the
// answer by a DIFFERENT route than the generator (multiply-back for division, reciprocal for
// fraction division, repeated multiplication for exponents, cross-multiplication for ratios,
// sign logic for quadrants, etc.) so a copy-paste of the generator's own math could never make a
// wrong answer pass. The mutation self-test (fuzz.js) proves each oracle actually rejects a
// corrupted answer.

// ---------- numeric helpers ----------
function approxEq(a, b) {
  if (!isFinite(a) || !isFinite(b)) return false;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}
function igcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
// ---- Task 14 (f1-decimals widening): digit-shift helpers for the 'pow10' op ----
// pow10Places: a factor must be a clean power of ten (10^k, k any integer -- 0.001, 1, 10, 1000,
// ...); Math.round guards against transcendental log10 noise (e.g. 2.9999999999999996), and the
// Math.pow round-trip assertion catches a factor that was never a power of ten at all, rather than
// silently rounding it to the nearest one.
function pow10Places(factor) {
  const places = Math.round(Math.log10(factor));
  if (!approxEq(Math.pow(10, places), factor)) throw new Error(`pow10: factor ${factor} is not a clean power of ten`);
  return places;
}
// shiftDecimalString: moves `value`'s decimal point by `places` (positive = right/bigger,
// negative = left/smaller) via direct string manipulation of its digit representation -- this is
// the actual "digit shift" the generator is teaching, not a stand-in for it. Deliberately never
// uses `*`/`/` against a power-of-ten factor, which would just re-run the same multiplication the
// generator already performed and verify nothing independent.
function shiftDecimalString(value, places) {
  const neg = value < 0;
  const parts = Math.abs(value).toString().split('.');
  const intPart = parts[0], fracPart = parts[1] || '';
  let digits = intPart + fracPart;
  let pointIdx = intPart.length + places;
  while (pointIdx > digits.length) digits += '0';
  while (pointIdx < 0) { digits = '0' + digits; pointIdx++; }
  const result = parseFloat(digits.slice(0, pointIdx) + '.' + digits.slice(pointIdx));
  return neg ? -result : result;
}

// ---------- rational helpers (exact, integer num/den) ----------
function ratEq(a, b) { return a.num * b.den === b.num * a.den; }       // a/b == c/d  <=>  a*d == c*b
function ratCmp(a, b) { return Math.sign(a.num * b.den - b.num * a.den); }
function ratIsReduced(r) { return igcd(r.num, r.den) === 1; }

function stripTags(s) { return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

// Parse a single operand token: mixed "w n/d", fraction "n/d", or whole "w".
function parseOperand(tok) {
  tok = tok.trim();
  let m;
  if ((m = /^(-?\d+)\s+(\d+)\/(\d+)$/.exec(tok))) {            // mixed number
    const w = +m[1], n = +m[2], d = +m[3];
    const sign = w < 0 ? -1 : 1;
    return { num: sign * (Math.abs(w) * d + n), den: d };
  }
  if ((m = /^(-?\d+)\/(-?\d+)$/.exec(tok))) return { num: +m[1], den: +m[2] }; // fraction
  if ((m = /^(-?\d+)$/.exec(tok))) return { num: +m[1], den: 1 };             // whole
  return null;
}

// ---------- canonical unit-conversion constants (Task 9, rocky-translator widening) ----------
// Independent of any generator's own embedded factor: the whole point of a lookup table here is
// that a generator bug which computes (or mislabels) a conversion factor gets caught, rather than
// the oracle just trusting whatever number the generator put in check.operands. Keyed by canonical
// "coarse-fine" pair name; a direction ('mul'/'div') on the check object says which way any given
// question converts, so ONE entry per real-world relationship covers both directions.
const UNIT_CONV_FACTORS = {
  // metric (rocky-translator genMetric)
  'km-m': 1000, 'm-cm': 100, 'cm-mm': 10, 'm-mm': 1000, 'kg-g': 1000, 'L-mL': 1000,
  // customary (genCustomary)
  'mi-yd': 1760, 'yd-ft': 3, 'ft-in': 12, 'lb-oz': 16, 'gal-qt': 4, 'qt-pt': 2, 'pt-c': 2,
  // time (genTime)
  'day-hr': 24, 'hr-min': 60, 'min-sec': 60, 'wk-day': 7, 'hr-sec': 3600,
  // eridian (genEridian; factors match the ERIDIAN table in Module 5 exactly)
  'kel-m': 7, 'jiff-sec': 5, 'mol-kg': 4, 'pip-L': 3, 'fip-C': 2,
};

// ========== ORACLE 1: check-contract (covers all Grade-6 + f1 check-bearing gens) ==========
// Each entry recomputes `expected` independently and (where natural) supplies an inverse-relation
// check `rel(answer)` using the OPPOSITE operation. operands come from check.operands or check.point.
const CHECK_OPS = {
  div:        ([a, b]) => ({ expected: a / b,                 rel: (ans) => approxEq(ans * b, a) }),
  mul:        ([x, y]) => ({ expected: x * y,                 rel: (ans) => (x !== 0 ? approxEq(ans / x, y) : true) }),
  add:        ([x, y]) => ({ expected: x + y,                 rel: (ans) => approxEq(ans - y, x) }),
  sub:        ([x, y]) => ({ expected: x - y,                 rel: (ans) => approxEq(ans + y, x) }),
  mul3:       ([l, w, h]) => ({ expected: l * w * h,          rel: (ans) => (l * w !== 0 ? approxEq(ans / (l * w), h) : true) }),
  percent:    ([r, b]) => ({ expected: (r * b) / 100,         rel: (ans) => approxEq(ans * 100, r * b) }),
  proportion: ([a, b, c]) => ({ expected: (b * c) / a,        rel: (ans) => approxEq(ans * a, b * c) }),     // a:b = c:x  =>  a*x = b*c
  pow:        ([b, e]) => { let p = 1; for (let i = 0; i < e; i++) p *= b; return { expected: p, rel: (ans) => ans === p }; },
  linear:     ([a, x, b]) => ({ expected: a * x + b,          rel: (ans) => (a !== 0 ? approxEq((ans - b) / a, x) : true) }),
  'solve-add':([a, b]) => ({ expected: b - a,                 rel: (ans) => approxEq(ans + a, b) }),         // x + a = b
  'solve-mul':([a, b]) => ({ expected: b / a,                 rel: (ans) => approxEq(ans * a, b) }),         // a*x = b
  'rect-area':([x1, y1, x2, y2]) => ({ expected: Math.abs(x2 - x1) * Math.abs(y2 - y1) }),
  'tri-area': ([b, h]) => ({ expected: (b * h) / 2,           rel: (ans) => approxEq(ans * 2, b * h) }),
  'surface-area': ([l, w, h]) => ({ expected: 2 * (l * w + l * h + w * h) }),
  distance:   ([ax, ay, bx, by]) => {
    const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
    return { expected: dx + dy, rel: () => (dx === 0 || dy === 0) };  // axis-aligned: exactly one delta is 0
  },
  mean:   (vals) => ({ expected: vals.reduce((a, b) => a + b, 0) / vals.length }),
  median: (vals) => { const s = vals.slice().sort((a, b) => a - b); const n = s.length; return { expected: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 }; },
  range:  (vals) => { const s = vals.slice().sort((a, b) => a - b); return { expected: s[s.length - 1] - s[0] }; },
  quadrant: (pt) => {
    const [x, y] = pt;
    let q;
    if (x > 0 && y > 0) q = 'I'; else if (x < 0 && y > 0) q = 'II'; else if (x < 0 && y < 0) q = 'III'; else if (x > 0 && y < 0) q = 'IV'; else q = null;
    return { expected: q === null ? null : 'Quadrant ' + q, str: true };
  },
  reflect: (pt, ctx) => {
    const [x, y] = pt;
    const axis = ctx.axis;
    const rx = axis === 'y-axis' ? -x : x;
    const ry = axis === 'x-axis' ? -y : y;
    return { expected: `(${rx}, ${ry})`, str: true };
  },
  // ---- Task 11 (razor-crest widening): read-the-marker op. Independently reformats the
  // point as an ordered pair string and compares it (and the displayed correctIdx option,
  // via checkOracle's own step (b)) against check.answer -- catching a wiring bug in the
  // distractor/shuffle pipeline (wrong correctIdx, a transposed or off-by-one "correct"
  // string) rather than a math error, since there is no alternate math route to a point
  // the question already displays on the grid.
  identify: (pt) => ({ expected: `(${pt[0]}, ${pt[1]})`, str: true }),
  // ---- Task 9 (rocky-translator widening): unit-conversion ops, all independently re-derived
  // from UNIT_CONV_FACTORS above, never from the generator's own operands[1] alone. ----
  'unit-conv': ([value, factor], ctx) => {
    const pair = ctx && ctx.pair;
    const canon = UNIT_CONV_FACTORS[pair];
    if (canon == null) throw new Error(`unit-conv: unknown pair "${pair}"`);
    if (factor !== canon) throw new Error(`unit-conv: operand factor ${factor} != canonical ${canon} for pair "${pair}"`);
    const dir = ctx && ctx.dir;
    if (dir !== 'mul' && dir !== 'div') throw new Error(`unit-conv: bad dir "${dir}"`);
    const expected = dir === 'mul' ? value * canon : value / canon;
    return { expected, rel: (ans) => (dir === 'mul' ? approxEq(ans / canon, value) : approxEq(ans * canon, value)) };
  },
  // A chain of conversions applied in sequence to `start`. When `chain` (an array of canonical
  // pair names, one per factor) is present, every operand factor is cross-checked against its
  // looked-up canonical constant AND `expected` is computed from the canonical factors, not the
  // generator's operands -- catching a wrong OR mislabeled factor. When `chain` is absent (the
  // doubling variant, a pure repeated-x2 fact rather than a looked-up conversion), it just
  // recomputes the product directly from operands.
  'chain-mul': (operands, ctx) => {
    const [start, ...factors] = operands;
    const chain = ctx && ctx.chain;
    if (chain) {
      if (!Array.isArray(chain) || chain.length !== factors.length) throw new Error('chain-mul: chain tag missing or length mismatch');
      const canonFactors = chain.map((pair) => {
        const f = UNIT_CONV_FACTORS[pair];
        if (f == null) throw new Error(`chain-mul: unknown pair "${pair}"`);
        return f;
      });
      canonFactors.forEach((f, i) => { if (f !== factors[i]) throw new Error(`chain-mul: operand factor ${factors[i]} != canonical ${f} for pair "${chain[i]}"`); });
      const expected = canonFactors.reduce((acc, f) => acc * f, start);
      return { expected, rel: (ans) => approxEq(ans, expected) };
    }
    const expected = factors.reduce((acc, f) => acc * f, start);
    return { expected, rel: (ans) => approxEq(ans, expected) };
  },
  // Repeated division (the halving variant): pure math, no looked-up constant to cross-check.
  'chain-div': (operands) => {
    const [start, ...divisors] = operands;
    const expected = divisors.reduce((acc, f) => acc / f, start);
    return { expected, rel: (ans) => approxEq(ans, expected) };
  },
  // A leading multiplier times a repeated-doubling power (the doubling variant): also pure math
  // (2 is a fact of the story, "doubles every 5 hours," not a looked-up conversion constant) --
  // kept as its OWN op rather than folded into chain-mul so the doubling variant's small pool
  // doesn't dilute the unit-conversion chains' own bucket weight/depth ratio.
  'pow-scaled': ([start, base, exp]) => {
    let p = 1; for (let i = 0; i < exp; i++) p *= base;
    const expected = start * p;
    return { expected, rel: (ans) => (p !== 0 ? approxEq(ans / p, start) : true) };
  },
  // count of the coarser unit, plus a remainder already in the finer unit -> total in the finer
  // unit (e.g. 3 days + 5 hours -> total hours). `perUnit` is cross-checked against the canonical
  // factor for `pair`, same independence guarantee as unit-conv/chain-mul.
  'chain-mul-add': ([count, perUnit, remainder], ctx) => {
    const pair = ctx && ctx.pair;
    const canon = UNIT_CONV_FACTORS[pair];
    if (canon == null) throw new Error(`chain-mul-add: unknown pair "${pair}"`);
    if (perUnit !== canon) throw new Error(`chain-mul-add: operand perUnit ${perUnit} != canonical ${canon} for pair "${pair}"`);
    const expected = count * canon + remainder;
    return { expected, rel: (ans) => approxEq((ans - remainder) / canon, count) };
  },
  // ---- Task 10 (master-builder widening): volume ops, each an INDEPENDENT re-derivation
  // (never the generator's own l*w*h math copy-pasted) ----
  // Backward volume->missing-dimension: operands are [length, width, GIVEN volume]; the
  // generator's answer is the height, recomputed here as volume / (l*w). Division must land
  // on an exact integer -- by construction volume = l*w*h in the generator, so a non-integral
  // quotient here means the generator itself is broken, not a rounding nuance to tolerate.
  'missing-dim': ([l, w, volume]) => {
    const base = l * w;
    if (base === 0) throw new Error('missing-dim: zero base area (l*w)');
    const expected = volume / base;
    if (!Number.isInteger(expected)) throw new Error(`missing-dim: volume ${volume} / base ${base} = ${expected} is not integral`);
    return { expected, rel: (ans) => approxEq(ans * base, volume) };
  },
  // Composite volume: two independent rectangular-prism volumes (hull a1*a2*a3, cabin
  // b1*b2*b3) added. All six dimensions are operands -- capturing only the two sub-volumes
  // would let two draws with different dimensions but coincidentally equal sub-volumes
  // collapse onto one signature, exactly the "missing operand" collapse the widening brief
  // warns about.
  'composite-vol': ([a1, a2, a3, b1, b2, b3]) => ({ expected: a1 * a2 * a3 + b1 * b2 * b3 }),
  // Scale-volume: build A's l/w/h times a scale factor applied to one (unspecified-here)
  // dimension -- volume scales by the same factor regardless of which dimension it is, so
  // `dim` (which of length/width/height) is correctly NOT an operand: it never changes the
  // numeric answer, so it plays a shell-equivalent role, not a "varying quantity" one.
  'scale-vol': ([l, w, h, factor]) => {
    const v1 = l * w * h;
    const expected = v1 * factor;
    return { expected, rel: (ans) => (v1 !== 0 ? approxEq(ans / factor, v1) : true) };
  },
  // ---- Task 12 (fraction-rider widening): grade-5 fraction ops, operands are {num,den} pairs.
  // Every entry recomputes the RAW (unreduced, except frac-simplify) num/den via a generic
  // cross-multiplication route -- never the generator's own same-denominator/reciprocal shortcut
  // -- and compares as an EXACT "num/den" string (str:true), mirroring the raw num/den the
  // question's own `answer` object already carries (sigOf's prior check-less fallback formatted
  // it identically); this makes the check exact rather than floating-point-approximate, and
  // catches both a wrong VALUE and a wrong (denominator-dropping) representation.
  // "-like" means same-denominator by construction (asserted, not assumed) -- add/subtract the
  // numerators directly over the shared denominator, exactly the textbook same-denominator rule.
  // A full a/b+c/d cross-multiply formula would still be VALUE-correct but would inflate the
  // denominator to d*d, no longer matching the raw (unreduced) representation the generator's
  // own same-denominator shortcut produces, which check.answer mirrors exactly.
  'frac-add-like': ([f1, f2]) => {
    if (f1.den !== f2.den) throw new Error(`frac-add-like: denominators differ (${f1.den} vs ${f2.den}) -- not a like-denominator pair`);
    return { expected: `${f1.num + f2.num}/${f1.den}`, str: true };
  },
  'frac-sub-like': ([f1, f2]) => {
    if (f1.den !== f2.den) throw new Error(`frac-sub-like: denominators differ (${f1.den} vs ${f2.den}) -- not a like-denominator pair`);
    return { expected: `${f1.num - f2.num}/${f1.den}`, str: true };
  },
  // Generic a/b ÷ c/d = (a*d)/(b*c); whole numbers are just num/1. Same formula backs both
  // div-wu (whole ÷ unit fraction) and div-uw (unit fraction ÷ whole) -- the operand ORDER is
  // what distinguishes them, not the arithmetic.
  'frac-div-wu': ([f1, f2]) => ({ expected: `${f1.num * f2.den}/${f1.den * f2.num}`, str: true }),
  'frac-div-uw': ([f1, f2]) => ({ expected: `${f1.num * f2.den}/${f1.den * f2.num}`, str: true }),
  // Equivalent fraction: fTarget is the target denominator as a {num:dNew,den:1} pair. k is
  // independently re-derived from fTarget/fBase (and asserted to be a whole number -- a
  // structural invariant of how this generator constructs its target denominator, not a general
  // fraction-math necessity), then the new numerator is rebuilt from fBase alone, never from the
  // generator's own nNew.
  'frac-equiv': ([fBase, fTarget]) => {
    if (fTarget.num % fBase.den !== 0) throw new Error(`frac-equiv: target denominator ${fTarget.num} is not a whole multiple of base denominator ${fBase.den}`);
    const k = fTarget.num / fBase.den;
    return { expected: `${fBase.num * k}/${fTarget.num}`, str: true };
  },
  // Simplify: the one op here where reduction is the point. igcd is this file's own from-scratch
  // Euclidean-algorithm helper (never the generator's own gcd/simplify functions in the HTML).
  'frac-simplify': ([f]) => {
    const g = igcd(f.num, f.den) || 1;
    return { expected: `${f.num / g}/${f.den / g}`, str: true };
  },
  // Compare: cross-multiplication (f1.num*f2.den vs f2.num*f1.den) independently determines the
  // larger operand -- a different route than the generator's own common-denominator scaling --
  // and the RAW winning operand (not reduced) is what the generator's `answer` carries too.
  'frac-compare': ([f1, f2]) => {
    const cmp = f1.num * f2.den - f2.num * f1.den;
    const winner = cmp >= 0 ? f1 : f2;
    return { expected: `${winner.num}/${winner.den}`, str: true };
  },
  // ---- Task 12 (fraction-rider widening): grade-6 6.NS.1 dividing-fraction ops. Operands are
  // FLAT number tuples -- every raw draw the generator made (wholes, numerators, denominators),
  // never the generator's own combined a/b/c/e labeling -- and each formula is the generic a/b ÷
  // c/d = (a*d)/(b*c) invert-and-multiply rule applied fresh to the raw draws. Six generators,
  // BRANCH-DISTINCT op strings per internal ri(0,1) fork (genNsDivFrac has no fork, one op) so
  // the freshness-lib gate's topic|op bucket key can see each branch's own depth separately.
  'ns-div-wu': ([w, d]) => ({ expected: `${w * d}/${1 * 1}`, str: true }),           // whole w/1 ÷ unit 1/d
  'ns-div-uw': ([n, d, w]) => ({ expected: `${n * 1}/${d * w}`, str: true }),        // proper n/d ÷ whole w/1
  'ns-div-frac': ([a, b, c, d]) => ({ expected: `${a * d}/${b * c}`, str: true }),   // proper a/b ÷ proper c/d
  'ns-div-mixed-mf': ([W, b, wn, c, d]) => {
    const a = W * b + wn;                                                          // mixed W wn/b -> improper a/b
    return { expected: `${a * d}/${b * c}`, str: true };
  },
  'ns-div-mixed-mm': ([W1, b, wn1, W2, d, wn2]) => {
    const a = W1 * b + wn1, c = W2 * d + wn2;                                      // both mixed -> improper
    return { expected: `${a * d}/${b * c}`, str: true };
  },
  'ns-div-multi-dm': ([a, b, c, d, m]) => {
    const qNum = a * d, qDen = b * c;                                              // a/b ÷ c/d, then × m
    return { expected: `${qNum * m}/${qDen}`, str: true };
  },
  'ns-div-multi-ds': ([a, b, c, d]) => ({ expected: `${a * d}/${b * c}`, str: true }), // a/b ÷ c/d (then simplified for display only)
  'ns-div-word-wf': ([T, c, d]) => ({ expected: `${T * d}/${c}`, str: true }),       // whole T/1 ÷ proper c/d
  'ns-div-word-ff': ([a, b, c, d]) => ({ expected: `${a * d}/${b * c}`, str: true }), // proper a/b ÷ proper c/d
  // ---- Task 13 (floating-bear widening): grade-6 exponent-family ops + a grade-5 nested op. ----
  // pow-expand: PARSES the displayed expansion and re-multiplies it -- a different route than
  // the generator's own Array(exp).fill(base).join, and one that structurally validates every
  // factor equals `base` and the factor COUNT equals `exp` (not just that some product happens
  // to match), catching a wrong count or a wrong factor even if their product coincidentally
  // equals base^exp.
  'pow-expand': ([base, exp], ctx) => {
    const ans = ctx && ctx.answer;
    if (typeof ans !== 'string') throw new Error('pow-expand: check.answer must be a string');
    const parts = ans.split('×').map((s) => s.trim());
    if (parts.length !== exp) throw new Error(`pow-expand: expected ${exp} factors, found ${parts.length} in "${ans}"`);
    let product = 1;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isFinite(n)) throw new Error(`pow-expand: non-numeric factor "${p}" in "${ans}"`);
      if (n !== base) throw new Error(`pow-expand: factor ${n} != base ${base} in "${ans}"`);
      product *= n;
    }
    let expectedProduct = 1; for (let i = 0; i < exp; i++) expectedProduct *= base;
    if (product !== expectedProduct) throw new Error(`pow-expand: re-multiplied product ${product} != base^exp ${expectedProduct}`);
    return { expected: ans, str: true };   // parsed + numerically re-verified above; echoed back
  },
  // pow-compare: Task 13 fix round 1 -- operands are now the FLAT 4-tuple [a,b,c,d] from TWO
  // independently-drawn power expressions (a^b and c^d), each capped at 4096 by the generator's
  // own drawG6PowPair (not re-checked here; this oracle's job is the comparison, not the cap).
  // Independently computes BOTH powers via repeated multiplication and returns whichever label
  // is actually larger, OR 'They are equal' when the values genuinely match -- equal-value
  // outcomes are now an EXPECTED, correct branch (not an excluded invariant), since the
  // generator deliberately engineers them via a curated tie table.
  'pow-compare': ([a, b, c, d]) => {
    let pa = 1; for (let i = 0; i < b; i++) pa *= a;   // a^b via repeated multiplication
    let pc = 1; for (let i = 0; i < d; i++) pc *= c;   // c^d via repeated multiplication
    const expected = pa === pc ? 'They are equal' : (pa > pc ? `${a}^${b}` : `${c}^${d}`);
    return { expected, str: true };
  },
  // nested-div-add (genNested, g5): ((a+b)/b)+c. Re-derives the quotient from the raw operands
  // and re-checks the divisibility invariant here rather than trusting the generator's own
  // retry/constructive-fallback path kept it true.
  'nested-div-add': ([a, b, c]) => {
    const sum = a + b;
    if (sum % b !== 0) throw new Error(`nested-div-add: (${a}+${b}) not divisible by ${b}`);
    const q = sum / b;
    const expected = q + c;
    return { expected, rel: (ans) => approxEq(ans - c, q) };
  },
  // ---- Task 14 (f1-decimals widening): genPowerOfTen (g5), all three variants share this op.
  // Operands [value, multiplier, conversionFactor]: recomputes by SHIFTING value's decimal point
  // (shiftDecimalString), never by multiplying value by the factors -- the shift IS the 5.NBT.A.2
  // skill being tested, so it is also the independent verification method. `rel` reverses the
  // shift on the contract answer and asserts it recovers `value`, an inverse-relation check in the
  // same style as div/mul above.
  'pow10': ([value, multiplier, conversionFactor]) => {
    const places = pow10Places(multiplier) + pow10Places(conversionFactor == null ? 1 : conversionFactor);
    const expected = shiftDecimalString(value, places);
    return { expected, rel: (ans) => approxEq(shiftDecimalString(ans, -places), value) };
  },
};

// Verify one question that carries a `check` contract. Returns
// { fired:true, op, ok:bool, reason } or { fired:false } when there is no check.
function checkOracle(q) {
  const c = q && q.check;
  if (!c) return { fired: false };
  const op = c.op;
  const fn = CHECK_OPS[op];
  if (!fn) return { fired: true, op, ok: false, reason: `no oracle for check.op="${op}"` };

  const operands = c.operands || c.point;
  if (!Array.isArray(operands)) return { fired: true, op, ok: false, reason: 'check has no operands/point array' };

  let res;
  try { res = fn(operands, c); } catch (e) { return { fired: true, op, ok: false, reason: 'oracle threw: ' + e.message }; }

  // (a) independently-recomputed expected must equal the contract's answer
  if (res.str) {
    if (res.expected === null) return { fired: true, op, ok: false, reason: `point on axis, no quadrant: ${JSON.stringify(operands)}` };
    if (res.expected !== c.answer) return { fired: true, op, ok: false, reason: `expected "${res.expected}" != check.answer "${c.answer}"` };
  } else {
    if (!approxEq(res.expected, c.answer)) return { fired: true, op, ok: false, reason: `recompute ${res.expected} != check.answer ${c.answer}` };
    if (res.rel && !res.rel(c.answer)) return { fired: true, op, ok: false, reason: `inverse-relation failed for answer ${c.answer}` };
  }

  // (b) the option the kid would tap (answers[correctIdx]) must equal the contract answer
  if (Array.isArray(q.answers) && Number.isInteger(q.correctIdx)) {
    const shown = q.answers[q.correctIdx];
    if (shown === undefined) return { fired: true, op, ok: false, reason: `correctIdx ${q.correctIdx} out of range` };
    if (res.str) {
      if (String(shown) !== String(c.answer)) return { fired: true, op, ok: false, reason: `displayed "${shown}" != check.answer "${c.answer}"` };
    } else if (!approxEq(parseFloat(shown), c.answer)) {
      return { fired: true, op, ok: false, reason: `displayed "${shown}" != check.answer ${c.answer}` };
    }
  }
  return { fired: true, op, ok: true };
}

// ========== ORACLE 2: fraction arithmetic (parse the displayed equation, recompute) ==========
// Covers the fraction-rider module (G5 arithmetic + G6 dividing-fractions), which has no `check`.
// The kid sees `equation`; we parse it and recompute by exact rationals, then compare to `answer`.
// op token -> how to combine LEFT and RIGHT operands.
const FRAC_BINOPS = {
  '+': (a, b) => ({ num: a.num * b.den + b.num * a.den, den: a.den * b.den }),
  '−': (a, b) => ({ num: a.num * b.den - b.num * a.den, den: a.den * b.den }), // minus sign
  '-': (a, b) => ({ num: a.num * b.den - b.num * a.den, den: a.den * b.den }),
  '×': (a, b) => ({ num: a.num * b.num, den: a.den * b.den }),                 // times
  '÷': (a, b) => ({ num: a.num * b.den, den: a.den * b.num }),                 // divide
  'of': (a, b) => ({ num: a.num * b.num, den: a.den * b.den }),
};

// Tokenize a fraction expression: parentheses, the binary ops (+ - x / of), and operands
// (mixed "w n/d", fraction "n/d", whole "w"). Operands in the game are always non-negative.
const FRAC_TOKEN_RE = /\s+|(\()|(\))|([+−\-×÷])|\bof\b|(\d+\s+\d+\/\d+|\d+\/\d+|\d+)/g;
function tokenizeFrac(str) {
  const toks = [];
  let m;
  FRAC_TOKEN_RE.lastIndex = 0;
  let last = 0;
  while ((m = FRAC_TOKEN_RE.exec(str)) !== null) {
    if (m.index !== last) return null;          // an unrecognized chunk was skipped -> bail
    last = FRAC_TOKEN_RE.lastIndex;
    if (m[0].trim() === '') continue;            // whitespace
    if (m[1]) toks.push({ t: 'lp' });
    else if (m[2]) toks.push({ t: 'rp' });
    else if (m[3]) toks.push({ t: 'op', v: m[3] });
    else if (m[4]) { const r = parseOperand(m[4]); if (!r) return null; toks.push({ t: 'num', v: r }); }
    else if (m[0] === 'of' || /\bof\b/.test(m[0])) toks.push({ t: 'op', v: 'of' });
  }
  if (last !== str.length) return null;
  return toks;
}

// Evaluate the token stream to an exact rational. Standard precedence: (+ -) < (x / of) < parens.
function evalFracExpr(str) {
  const toks = tokenizeFrac(str.trim());
  if (!toks || toks.length === 0) return null;
  let i = 0;
  const peek = () => toks[i];
  function expr() {
    let v = term();
    if (v === null) return null;
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '−' || peek().v === '-')) {
      const op = toks[i++].v; const r = term(); if (r === null) return null;
      v = FRAC_BINOPS[op](v, r);
    }
    return v;
  }
  function term() {
    let v = factor();
    if (v === null) return null;
    while (peek() && peek().t === 'op' && (peek().v === '×' || peek().v === '÷' || peek().v === 'of')) {
      const op = toks[i++].v; const r = factor(); if (r === null) return null;
      v = FRAC_BINOPS[op](v, r);
    }
    return v;
  }
  function factor() {
    const tk = peek();
    if (!tk) return null;
    if (tk.t === 'lp') { i++; const v = expr(); if (v === null) return null; if (!peek() || peek().t !== 'rp') return null; i++; return v; }
    if (tk.t === 'num') { i++; return { num: tk.v.num, den: tk.v.den }; }
    return null;
  }
  const result = expr();
  if (result === null || i !== toks.length) return null;  // trailing junk -> parse failure
  return result;
}

// Returns { applicable, ok, reason, kind } for fraction-rider answer-style questions. Recomputes
// the displayed equation by exact rationals (a different route than the generator's arithmetic)
// and compares to `answer`; "lowest terms" equations must additionally be fully reduced.
function fractionOracle(q) {
  if (!q || !q.equation || !q.answer || typeof q.answer.num !== 'number') return { applicable: false };
  const ans = { num: q.answer.num, den: q.answer.den };
  if (ans.den === 0) return { applicable: true, ok: false, reason: 'answer denominator is 0', kind: 'degenerate' };
  const rawEq = String(q.equation);
  const eq = stripTags(rawEq);

  // compare:  "A vs B"  -- answer must equal the larger operand
  if (/\bvs\b/.test(eq)) {
    const [l, r] = eq.split(/\bvs\b/);
    const A = evalFracExpr(l), B = evalFracExpr(r);
    if (!A || !B) return { applicable: true, ok: false, reason: `compare: cannot parse "${eq}"`, kind: 'parse' };
    const larger = ratCmp(A, B) >= 0 ? A : B;
    if (!ratEq(larger, ans)) return { applicable: true, ok: false, reason: `compare larger ${larger.num}/${larger.den} != answer ${ans.num}/${ans.den}`, kind: 'compare' };
    return { applicable: true, ok: true, kind: 'compare' };
  }

  const eqIdx = eq.indexOf('=');
  if (eqIdx < 0) return { applicable: true, ok: false, reason: `no '=' in "${eq}"`, kind: 'parse' };
  const lhs = eq.slice(0, eqIdx);
  const rhs = eq.slice(eqIdx + 1);

  // equiv:  "nBase/dBase = ?/dNew"  -- answer value-equal to LHS and denominator dNew
  const equivM = /\?\/(\d+)/.exec(rhs);
  if (equivM) {
    const dNew = +equivM[1];
    const left = evalFracExpr(lhs);
    if (!left) return { applicable: true, ok: false, reason: `equiv: cannot parse "${eq}"`, kind: 'parse' };
    if (!ratEq(left, ans)) return { applicable: true, ok: false, reason: `equiv value ${left.num}/${left.den} != answer ${ans.num}/${ans.den}`, kind: 'equiv' };
    if (ans.den !== dNew) return { applicable: true, ok: false, reason: `equiv answer den ${ans.den} != target ${dNew}`, kind: 'equiv' };
    return { applicable: true, ok: true, kind: 'equiv' };
  }

  // simplify or arithmetic (possibly compound, possibly "(lowest terms)"):
  //   evaluate LHS as an expression, compare value, and if reduction is required, enforce it.
  const expected = evalFracExpr(lhs);
  if (!expected) return { applicable: true, ok: false, reason: `cannot parse LHS of "${eq}"`, kind: 'parse' };
  if (expected.den === 0) return { applicable: true, ok: false, reason: `division by zero in "${eq}"`, kind: 'degenerate' };
  if (!ratEq(expected, ans)) return { applicable: true, ok: false, reason: `recompute ${expected.num}/${expected.den} != answer ${ans.num}/${ans.den} for "${eq}"`, kind: 'arith' };
  // `answer` is the RAW value (the engine reduces only for display, via _customChoices/fracToString),
  // so a "lowest terms" requirement is checked on the DISPLAYED correct choice, not the raw answer.
  const lowestTerms = /lowest terms/i.test(eq);
  if (lowestTerms && Array.isArray(q._customChoices)) {
    const cc = q._customChoices.find((c) => c.correct);
    if (cc) {
      const r = parseOperand(String(cc.text).trim());
      if (r && !ratIsReduced(r)) return { applicable: true, ok: false, reason: `displayed correct choice "${cc.text}" not in lowest terms for "${eq}"`, kind: 'simplify' };
      if (r && !ratEq(r, ans)) return { applicable: true, ok: false, reason: `displayed correct choice "${cc.text}" != answer value for "${eq}"`, kind: 'simplify' };
    }
  }
  // classify kind for coverage: single operand + lowest-terms = simplify; else by dominant op token.
  let kind;
  const lhsToks = tokenizeFrac(lhs.trim()) || [];
  const ops = lhsToks.filter((t) => t.t === 'op').map((t) => t.v);
  if (ops.length === 0) kind = lowestTerms ? 'simplify' : 'identity';
  else kind = ops.includes('÷') ? '÷' : ops.includes('×') ? '×' : ops.includes('of') ? 'of' : ops.includes('+') ? '+' : '−';
  return { applicable: true, ok: true, kind };
}

// ========== ORACLE 3: universal structural validation (every question, both grades) ==========
// Catches crashes, malformed shapes, off-range correctIdx, duplicate / missing-correct options --
// the bug class that actually regresses (e.g. the prior "two identical buttons" compare bug).
function structuralOracle(q, fracMakeChoices) {
  if (!q || typeof q !== 'object') return { ok: false, reason: 'generator returned non-object' };
  const hasPrompt = (typeof q.prompt === 'string' && q.prompt.trim()) || (typeof q.text === 'string' && q.text.trim());
  if (!hasPrompt) return { ok: false, reason: 'missing prompt/text' };

  // Option-style: answers[] + correctIdx
  if (Array.isArray(q.answers)) {
    const n = q.answers.length;
    if (n < 2) return { ok: false, reason: `only ${n} option(s)` };
    if (!Number.isInteger(q.correctIdx) || q.correctIdx < 0 || q.correctIdx >= n) return { ok: false, reason: `correctIdx ${q.correctIdx} out of range (${n})` };
    const strs = q.answers.map((a) => String(a));
    if (strs.some((s) => s.trim() === '')) return { ok: false, reason: 'blank option' };
    if (new Set(strs).size !== n) return { ok: false, reason: `duplicate options: ${JSON.stringify(strs)}` };
    return { ok: true, kind: 'options' };
  }

  // Custom-choice style: _customChoices [{text, correct}]
  if (Array.isArray(q._customChoices)) {
    return validateChoiceList(q._customChoices, 'customChoices');
  }

  // Fraction answer-style: build the choices the engine would render and validate them.
  if (q.answer && typeof q.answer.num === 'number') {
    if (typeof fracMakeChoices === 'function') {
      let choices;
      try { choices = fracMakeChoices(q); } catch (e) { return { ok: false, reason: 'makeChoices threw: ' + e.message }; }
      return validateChoiceList(choices, 'makeChoices');
    }
    return { ok: true, kind: 'answer-only' };
  }

  return { ok: false, reason: `unrecognized question shape: keys=${Object.keys(q).join(',')}` };
}

function validateChoiceList(choices, kind) {
  if (!Array.isArray(choices) || choices.length < 2) return { ok: false, reason: `${kind}: <2 choices` };
  const texts = choices.map((c) => String(c.text));
  if (texts.some((t) => t.trim() === '')) return { ok: false, reason: `${kind}: blank choice` };
  if (new Set(texts).size !== texts.length) return { ok: false, reason: `${kind}: duplicate choices ${JSON.stringify(texts)}` };
  const nCorrect = choices.filter((c) => c.correct).length;
  if (nCorrect !== 1) return { ok: false, reason: `${kind}: ${nCorrect} correct (need exactly 1)` };
  if (texts.some((t) => /[-−–]/.test(t))) return { ok: false, reason: `${kind}: negative-looking option ${JSON.stringify(texts)}` };
  return { ok: true, kind };
}

module.exports = {
  approxEq, igcd, ratEq, ratCmp, ratIsReduced, parseOperand, stripTags,
  checkOracle, fractionOracle, structuralOracle, validateChoiceList,
  CHECK_OPS, FRAC_BINOPS, UNIT_CONV_FACTORS,
};
