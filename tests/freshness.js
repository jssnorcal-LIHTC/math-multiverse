'use strict';
// Freshness unit gate. Runs MVFresh inside a bare extract vm context with a SPY storage.
const { loadModules, buildDrivers } = require('./extract.js');

function spyStorage() {
  const ops = []; const map = new Map();
  return {
    ops,
    getItem(k) { ops.push(['get', k]); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { ops.push(['set', k]); map.set(k, String(v)); },
    removeItem(k) { ops.push(['rm', k]); map.delete(k); },
  };
}
function fresh(extra) {
  const store = spyStorage();
  const d = buildDrivers(loadModules(), { extraGlobals: Object.assign({ localStorage: store }, extra || {}) })[0];
  const F = d.sandbox.MVFresh;
  if (!F) throw new Error('MVFresh not captured');
  F._resetForTest();
  return { F, store };
}
let fails = 0;
function check(name, fn) { try { fn(); console.log('ok', name); } catch (e) { fails++; console.log('FAIL', name, e.message); } }

check('signature: check object serialized over its OWN keys (point/axis live)', () => {
  const { F } = fresh();
  const a = F.sigOf({ check: { op: 'quadrant', point: [3, 4], answer: 'I' } });
  const b = F.sigOf({ check: { op: 'quadrant', point: [4, 3], answer: 'I' } });
  const c = F.sigOf({ check: { op: 'reflect', point: [3, 4], axis: 'x', answer: '(3,-4)' } });
  const d2 = F.sigOf({ check: { op: 'reflect', point: [3, 4], axis: 'y', answer: '(-3,4)' } });
  if (a === b) throw new Error('point order collapsed');
  if (c === d2) throw new Error('axis ignored');
});
check('signature: prose numerals deduped+sorted; shell echo cannot inflate', () => {
  const { F } = fresh();
  const p = F.sigOf({ topic: 't', text: 'Add <strong>3</strong> and 12', answer: 15 });
  const q = F.sigOf({ topic: 't', text: '12 and 3 make? (yes, 3)', answer: 15 });
  if (p !== q) throw new Error('normalization failed');
});
check('drawRun: within-run dedupe on a healthy pool', () => {
  const { F } = fresh();
  let i = 0; const gen = () => ({ topic: 'syn', text: 'n ' + (i = (i + 1) % 30), answer: i });
  const run = F.drawRun(gen, 'syn.g5.i0', 10);
  const sigs = run.map(F.sigOf);
  if (new Set(sigs).size !== 10) throw new Error('dup within run');
});
check('drawRun: module-grade UNION rejection blocks sibling-level repeats', () => {
  const { F } = fresh();
  const mk = (n) => ({ topic: 'syn', text: 'n ' + n, answer: n });
  let k = 0; F.drawRun(() => mk(k++ % 30), 'syn.g5.i0', 10);      // history: 0..9-ish
  let hits = 0; let j = 0;
  const gen2 = () => { const q = mk(j % 30); j++; return q; };     // walks 0,1,2,...
  const runB = F.drawRun(gen2, 'syn.g5.i5', 10);                  // same module+grade, other level
  const sigsB = new Set(runB.map(F.sigOf));
  if (sigsB.size !== 10) throw new Error('dup in run B');
  // run A drew signatures 0..9 (gen sequential, all fresh). Run B must have skipped them.
  for (let n = 0; n < 10; n++) if (sigsB.has(F.sigOf(mk(n)))) throw new Error('union rejection failed at ' + n);
});
check('drawRun: exhaustion evicts oldest COUNT entries only, then accepts', () => {
  const { F } = fresh();
  const mk = (n) => ({ topic: 'syn', text: 'n ' + n, answer: n });
  let k = 0; F.drawRun(() => mk(k++ % 6), 'tiny.g5.i0', 6);       // exhaust pool of 6
  const runB = F.drawRun(() => mk((k++) % 6), 'tiny.g5.i0', 6);   // must still return 6 questions
  if (runB.length !== 6) throw new Error('short run');
});
check('storage: prefix proof — zero touches of protected keys', () => {
  const { F, store } = fresh();
  let i = 0; F.drawRun(() => ({ topic: 's', text: 'n ' + (i++), answer: i }), 'syn.g5.i0', 10);
  F.markSeenIds('pack.p.i0', ['a', 'b']); F.orderPool('pack.p.i0', ['a', 'b', 'c']);
  const bad = store.ops.filter(([, k]) => /^mathMultiverse\./.test(k) || k === 'multiverse.packs.v1');
  if (bad.length) throw new Error('touched protected key: ' + JSON.stringify(bad));
  const wrote = store.ops.some(([op, k]) => op === 'set' && k === 'multiverse.seen.v1');
  if (!wrote) throw new Error('never persisted to multiverse.seen.v1');
});
check('storage-throw degrades to in-memory, never throws out', () => {
  const bomb = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const d = buildDrivers(loadModules(), { extraGlobals: { localStorage: bomb } })[0];
  const F = d.sandbox.MVFresh; F._resetForTest();
  let i = 0; const run = F.drawRun(() => ({ topic: 's', text: 'n ' + (i++), answer: i }), 'syn.g5.i0', 8);
  if (run.length !== 8) throw new Error('degraded path broke the game');
});
check('orderPool: unseen first, then stalest', () => {
  const { F } = fresh();
  F.markSeenIds('pack.p.i0', ['a']);  // a oldest
  F.markSeenIds('pack.p.i0', ['b']);  // b newer
  const order = F.orderPool('pack.p.i0', ['a', 'b', 'c']);
  if (order[0] !== 'c' || order[1] !== 'a' || order[2] !== 'b') throw new Error('order ' + order.join(','));
});
check('wiring presence: all six loop sites call MVFresh.drawRun', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'Math-Multiverse.html'), 'utf8');
  const n = (src.match(/MVFresh\.drawRun\(/g) || []).length;
  if (n < 6) throw new Error('found ' + n + ' drawRun call sites, need 6');
});
if (fails) { console.log('RESULT: ' + fails + ' FAILURE(S)'); process.exit(1); }
console.log('RESULT: ALL CLEAN');
