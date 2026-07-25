'use strict';
// items.js -- the engine's item layer.  Subject-agnostic by construction: this file must never
// contain the word "fraction" or any passage-specific logic.  It knows item TYPES, not subjects.
//
// UMD, not an ES module, matching the project rule: the browser gets window.MVItems and the Node
// test harness gets module.exports from the same source.  Nothing here touches `document` at load
// time, so Node can require it and unit-test the pure graders.
//
// Split of responsibility:
//   grade()   pure, unit-tested in tests/items.test.js
//   render()  DOM, verified by tests/smoke.js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MVItems = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : null), function () {

  // ---------------- shared helpers ----------------

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // Answer normalisation for typed responses. Folds case, strips punctuation, drops a leading
  // article, and collapses whitespace, so "The chalk-mark!" matches "chalk mark".
  function normalizeText(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:the|a|an)\s+/, '');
  }

  function uniqSorted(arr) {
    return [...new Set((arr || []).map(Number))].filter(Number.isInteger).sort((a, b) => a - b);
  }

  function sameSet(a, b) {
    const x = uniqSorted(a), y = uniqSorted(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }

  // Set-style partial credit that cannot be gamed by selecting everything: each correct pick earns
  // one unit, each wrong pick spends one, and the result is clamped at zero.
  function setPartial(picked, key) {
    const p = uniqSorted(picked), k = new Set(uniqSorted(key));
    if (!k.size) return 0;
    let hits = 0, misses = 0;
    for (const i of p) (k.has(i) ? hits++ : misses++);
    return Math.max(0, (hits - misses) / k.size);
  }

  function setNotes(picked, key, unitSingular, unitPlural) {
    const p = uniqSorted(picked), k = new Set(uniqSorted(key));
    let hits = 0, misses = 0;
    for (const i of p) (k.has(i) ? hits++ : misses++);
    const short = k.size - hits;
    const notes = [];
    if (hits && short) notes.push(`You found ${hits} of the ${k.size} correct ${k.size === 1 ? unitSingular : unitPlural} and missed ${short}.`);
    else if (!hits && k.size) notes.push(`None of your picks were in the ${k.size === 1 ? unitSingular : unitPlural} being asked for.`);
    if (misses) notes.push(`${misses} of your picks ${misses === 1 ? 'was' : 'were'} not correct, which costs you here; picking everything scores zero.`);
    return notes;
  }

  // Render a list of tappable choices. `mode` is 'single' or 'multi'.
  function renderChoices(host, choices, mode, ctx, state) {
    const wrap = el('div', 'mv-choices');
    choices.forEach((text, i) => {
      const b = el('button', 'mv-choice');
      b.type = 'button';
      b.dataset.idx = String(i);
      b.appendChild(el('span', 'mv-choice-letter', String.fromCharCode(65 + i)));
      b.appendChild(el('span', 'mv-choice-text', text));
      b.addEventListener('click', function () {
        if (host.dataset.locked === '1') return;
        if (mode === 'single') {
          state.picked = i;
          for (const other of wrap.querySelectorAll('.mv-choice')) other.classList.remove('sel');
          b.classList.add('sel');
          ctx.onAnswer(i);
        } else {
          const set = new Set(state.picked || []);
          if (set.has(i)) { set.delete(i); b.classList.remove('sel'); }
          else { set.add(i); b.classList.add('sel'); }
          state.picked = [...set].sort((x, y) => x - y);
          ctx.onProgress();
        }
      });
      wrap.appendChild(b);
    });
    host.appendChild(wrap);
    return wrap;
  }

  // Paint correct and wrong states onto an already-rendered choice list.
  function revealChoices(wrap, picked, keyIdxs) {
    if (!wrap) return;
    const key = new Set(uniqSorted(keyIdxs));
    const chosen = new Set(uniqSorted(Array.isArray(picked) ? picked : [picked]));
    for (const b of wrap.querySelectorAll('.mv-choice')) {
      const i = Number(b.dataset.idx);
      b.classList.remove('sel');
      if (key.has(i)) b.classList.add('correct');
      else if (chosen.has(i)) b.classList.add('wrong');
      b.disabled = true;
    }
  }

  function stemNode(text) {
    const s = el('div', 'mv-stem');
    s.textContent = text;
    return s;
  }

  // ---------------- types ----------------

  const types = {};

  types.mc = {
    needsCheck: false,
    isComplete(item, r) { return Number.isInteger(r) && r >= 0 && r < (item.choices || []).length; },
    grade(item, r) {
      const correct = r === item.key;
      return { correct, partial: correct ? 1 : 0, notes: [] };
    },
    render(item, host, ctx) {
      const state = { picked: null };
      host._mvState = state;
      host.appendChild(stemNode(item.stem));
      state.wrap = renderChoices(host, item.choices, 'single', ctx, state);
    },
    reveal(item, host, r) { revealChoices(host._mvState && host._mvState.wrap, r, [item.key]); },
  };

  types.ms = {
    needsCheck: true,
    isComplete(item, r) { return Array.isArray(r) && uniqSorted(r).length > 0; },
    grade(item, r) {
      const correct = sameSet(r, item.key);
      return {
        correct,
        partial: correct ? 1 : setPartial(r, item.key),
        notes: correct ? [] : setNotes(r, item.key, 'answer', 'answers'),
      };
    },
    render(item, host, ctx) {
      const state = { picked: [] };
      host._mvState = state;
      host.appendChild(stemNode(item.stem));
      const hint = el('div', 'mv-hint', `Choose ${(item.key || []).length}.`);
      host.appendChild(hint);
      state.wrap = renderChoices(host, item.choices, 'multi', ctx, state);
    },
    reveal(item, host, r) { revealChoices(host._mvState && host._mvState.wrap, r, item.key); },
  };

  // ---------------- public surface ----------------

  function typeOf(item) {
    const t = types[item && item.type];
    if (!t) throw new Error(`unknown item type: ${JSON.stringify(item && item.type)}`);
    return t;
  }

  return {
    types,
    normalizeText,
    needsCheck(item) { return !!typeOf(item).needsCheck; },
    isComplete(item, response) { return !!typeOf(item).isComplete(item, response); },
    grade(item, response) { return typeOf(item).grade(item, response); },
    render(item, host, ctx) { return typeOf(item).render(item, host, ctx); },
    reveal(item, host, response, result) { return typeOf(item).reveal(item, host, response, result); },
    // exposed for the later type tasks and for the runner's own tests
    _helpers: { el, uniqSorted, sameSet, setPartial, setNotes, renderChoices, revealChoices, stemNode },
  };
});
