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
  CHECK_OPS, FRAC_BINOPS,
};
