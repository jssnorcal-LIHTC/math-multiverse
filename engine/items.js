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
  // KNOWN COST, accepted: dropping the article makes "the mark" and "a mark" collide. That is the
  // price of letting a child write "the dead drop" for an accept list of "dead drop", which is the far
  // commoner case. An author who needs the two distinguished must not use shorttext for that item.
  function normalizeText(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:the|a|an)\s+/, '');
  }

  // FILTER, do not coerce. Number(null) is 0 and Number(true) is 1, so mapping first made a stray null
  // read as a deliberate pick of option A and isComplete return true on garbage. Only a value that is
  // already an integer counts, which is all the renderers ever produce.
  function uniqSorted(arr) {
    return [...new Set((arr || []).filter(Number.isInteger))].sort((a, b) => a - b);
  }

  // Range-check against the option count. mc did this and ms did not, and an asymmetry between two
  // types that answer the same question is how the next type gets it wrong too.
  function allInRange(arr, n) {
    const picks = uniqSorted(arr);
    return picks.length > 0 && picks.every((i) => i >= 0 && i < n);
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
  //
  // `box` is where the buttons are appended; `lockHost` is where the locked flag lives, and defaults to
  // `box` because for mc and ms they are the same element. ebsr is why the two are separable: it appends
  // Part A and Part B into their own sub-boxes, so a guard reading box.dataset.locked would read an
  // element nobody ever locks, and a child could change a graded Part B answer. Always pass the host.
  function renderChoices(box, choices, mode, ctx, state, lockHost) {
    const lock = lockHost || box;
    const wrap = el('div', 'mv-choices');
    choices.forEach((text, i) => {
      const b = el('button', 'mv-choice');
      b.type = 'button';
      b.dataset.idx = String(i);
      b.appendChild(el('span', 'mv-choice-letter', String.fromCharCode(65 + i)));
      b.appendChild(el('span', 'mv-choice-text', text));
      b.addEventListener('click', function () {
        if (lock.dataset.locked === '1') return;
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
    box.appendChild(wrap);
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
    isComplete(item, r) {
      return Array.isArray(r) && uniqSorted(r).length > 0 && allInRange(r, (item.choices || []).length);
    },
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

  // The signature CAASPP type. partB.key is a MAP from the chosen Part A index to the Part B index
  // that best supports it, never a scalar. Grading Part B against a fixed answer is the standard
  // way a homemade EBSR is silently wrong, so a scalar key throws rather than grading.
  types.ebsr = {
    needsCheck: true,
    isComplete(item, r) {
      return !!r && Number.isInteger(r.a) && Number.isInteger(r.b)
        && r.a >= 0 && r.a < item.partA.choices.length
        && r.b >= 0 && r.b < item.partB.choices.length;
    },
    grade(item, r) {
      const bKey = item.partB && item.partB.key;
      if (!bKey || typeof bKey !== 'object' || Array.isArray(bKey)) {
        throw new Error('ebsr partB.key must be an object mapping each partA index to a partB index');
      }
      const a = r && r.a, b = r && r.b;
      const aRight = a === item.partA.key;
      const expectedB = bKey[String(a)];
      const consistent = Number.isInteger(expectedB) && b === expectedB;
      const correct = aRight && consistent;

      const notes = [];
      let partial;
      if (correct) {
        partial = 1;
      } else if (aRight && !consistent) {
        partial = 0.5;
        notes.push('Your answer was right, but the line you picked does not prove it. Evidence has to do work, not just sound related.');
      } else if (!aRight && consistent) {
        partial = 0.5;
        notes.push('Your evidence matched your own answer, which is exactly the right habit. Keep that, and re-read the question, because the answer itself was wrong.');
      } else {
        partial = 0;
        notes.push('Both parts are off. Answer the question first in your own words, then hunt for the line that says it.');
      }
      return { correct, partial, consistent, notes };
    },
    render(item, host, ctx) {
      const state = { picked: { a: null, b: null } };
      host._mvState = state;

      const aBox = el('div', 'mv-part mv-part-a');
      aBox.appendChild(el('div', 'mv-part-label', 'Part A'));
      aBox.appendChild(stemNode(item.partA.stem));
      host.appendChild(aBox);

      const bBox = el('div', 'mv-part mv-part-b');
      bBox.style.display = 'none';
      bBox.appendChild(el('div', 'mv-part-label', 'Part B'));
      bBox.appendChild(stemNode(item.partB.stem));
      host.appendChild(bBox);

      // Part A is single-select, and committing it reveals Part B and locks A. Revealing B only
      // after A is what makes the consistency lesson possible.
      const aState = { picked: null };
      // NOTE the trailing `host`: the lock lives there, not on aBox. Without it a graded Part B stays clickable.
      state.aWrap = renderChoices(aBox, item.partA.choices, 'single', {
        onAnswer(i) {
          state.picked.a = i;
          for (const btn of state.aWrap.querySelectorAll('.mv-choice')) btn.disabled = true;
          if (bBox.style.display === 'none') {
            bBox.style.display = '';
            const bState = { picked: null };
            state.bWrap = renderChoices(bBox, item.partB.choices, 'single', {
              onAnswer(j) { state.picked.b = j; ctx.onProgress(); },
              onProgress() {},
            }, bState, host);
            if (bBox.scrollIntoView) bBox.scrollIntoView({ block: 'nearest' });
          }
          ctx.onProgress();
        },
        onProgress() {},
      }, aState, host);
    },
    reveal(item, host, r) {
      const st = host._mvState || {};
      revealChoices(st.aWrap, r && r.a, [item.partA.key]);

      // Part B needs THREE states, not two, because grade() recognises three outcomes. Showing only
      // right-versus-wrong contradicts the consistency credit: a child who picks a wrong claim but then
      // finds the evidence that genuinely supports THAT claim is told "exactly the right habit", and would
      // then watch their evidence painted red, indistinguishable from a guess. So:
      //   green  the evidence for the CORRECT claim, which is the pairing to take away
      //   amber  the child's own pick when it correctly supports their own (wrong) claim
      //   red    a pick that supports neither
      const canonicalB = item.partB.key[String(item.partA.key)];
      const consistentB = item.partB.key[String(r && r.a)];
      const chose = r && r.b;
      revealChoices(st.bWrap, chose, [Number.isInteger(canonicalB) ? canonicalB : consistentB]);
      // If their pick was consistent with their own answer but is not the canonical one, downgrade it from
      // wrong to consistent so the styling can say "good reasoning, wrong premise".
      if (st.bWrap && Number.isInteger(chose) && chose === consistentB && chose !== canonicalB) {
        for (const b of st.bWrap.querySelectorAll('.mv-choice')) {
          if (Number(b.dataset.idx) === chose) { b.classList.remove('wrong'); b.classList.add('consistent'); }
        }
      }
    },
  };

  // Tap a sentence or a word inside the passage. The runner paints the passage and hands the
  // spans here; span text is guaranteed verbatim by the pack validator, so plain string matching
  // is safe.
  types.hottext = {
    needsCheck: true,
    isComplete(item, r) { return Array.isArray(r) && uniqSorted(r).length > 0; },
    grade(item, r) {
      const correct = sameSet(r, item.key);
      return {
        correct,
        partial: correct ? 1 : setPartial(r, item.key),
        notes: correct ? [] : setNotes(r, item.key, 'sentence', 'sentences'),
      };
    },
    render(item, host, ctx) {
      const state = { picked: [] };
      host._mvState = state;
      host.appendChild(stemNode(item.stem));
      const box = el('div', 'mv-hottext');
      item.spans.forEach((text, i) => {
        const s = el('span', 'mv-span', text);
        s.dataset.idx = String(i);
        s.addEventListener('click', function () {
          if (host.dataset.locked === '1') return;
          const set = new Set(state.picked);
          if (set.has(i)) { set.delete(i); s.classList.remove('sel'); }
          else { set.add(i); s.classList.add('sel'); }
          state.picked = [...set].sort((a, b) => a - b);
          ctx.onProgress();
        });
        box.appendChild(s);
        box.appendChild(document.createTextNode(' '));
      });
      host.appendChild(box);
      state.box = box;
    },
    reveal(item, host, r) {
      const box = (host._mvState || {}).box;
      if (!box) return;
      const key = new Set(uniqSorted(item.key));
      const chosen = new Set(uniqSorted(r));
      for (const s of box.querySelectorAll('.mv-span')) {
        const i = Number(s.dataset.idx);
        s.classList.remove('sel');
        if (key.has(i)) s.classList.add('correct');
        else if (chosen.has(i)) s.classList.add('wrong');
      }
    },
  };

  function cellSig(c) { return Number(c[0]) + ',' + Number(c[1]); }

  types.match = {
    needsCheck: true,
    // One cell per row is required, so an unanswered row blocks the check rather than scoring zero.
    isComplete(item, r) {
      if (!Array.isArray(r)) return false;
      const rows = new Set(r.filter(c => Array.isArray(c)).map(c => Number(c[0])));
      return rows.size === item.rowLabels.length;
    },
    grade(item, r) {
      const want = new Set((item.key || []).map(cellSig));
      const got = new Set((Array.isArray(r) ? r : []).filter(Array.isArray).map(cellSig));
      let hits = 0, misses = 0;
      for (const s of got) (want.has(s) ? hits++ : misses++);
      const correct = hits === want.size && misses === 0;
      const partial = correct ? 1 : Math.max(0, (hits - misses) / (want.size || 1));
      const notes = correct ? [] : [`You placed ${hits} of ${want.size} correctly.`];
      return { correct, partial, notes };
    },
    render(item, host, ctx) {
      const state = { picked: [] };
      host._mvState = state;
      host.appendChild(stemNode(item.stem));
      const table = el('table', 'mv-table');
      const head = el('tr');
      head.appendChild(el('th', 'mv-th-corner', ''));
      item.colLabels.forEach(c => head.appendChild(el('th', null, c)));
      table.appendChild(head);
      item.rowLabels.forEach((rowLabel, ri) => {
        const tr = el('tr');
        tr.appendChild(el('th', 'mv-th-row', rowLabel));
        item.colLabels.forEach((_, ci) => {
          const td = el('td', 'mv-cell');
          td.dataset.r = String(ri);
          td.dataset.c = String(ci);
          td.addEventListener('click', function () {
            if (host.dataset.locked === '1') return;
            // One choice per row: clear the row, then set this cell.
            for (const other of tr.querySelectorAll('.mv-cell')) other.classList.remove('sel');
            td.classList.add('sel');
            state.picked = state.picked.filter(c => Number(c[0]) !== ri).concat([[ri, ci]]);
            ctx.onProgress();
          });
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      host.appendChild(table);
      state.table = table;
    },
    reveal(item, host, r) {
      const table = (host._mvState || {}).table;
      if (!table) return;
      const want = new Set((item.key || []).map(cellSig));
      const got = new Set((Array.isArray(r) ? r : []).filter(Array.isArray).map(cellSig));
      for (const td of table.querySelectorAll('.mv-cell')) {
        const sig = td.dataset.r + ',' + td.dataset.c;
        td.classList.remove('sel');
        if (want.has(sig)) td.classList.add('correct');
        else if (got.has(sig)) td.classList.add('wrong');
      }
    },
  };

  types.order = {
    needsCheck: true,
    // A valid arrangement is a full permutation. Tap-to-place can leave holes, so check for them.
    isComplete(item, r) {
      if (!Array.isArray(r) || r.length !== item.tiles.length) return false;
      if (r.some(v => !Number.isInteger(v))) return false;
      return new Set(r).size === item.tiles.length;
    },
    grade(item, r) {
      const key = item.key || [];
      const arr = Array.isArray(r) ? r : [];
      let inPlace = 0;
      for (let i = 0; i < key.length; i++) if (arr[i] === key[i]) inPlace++;
      const correct = inPlace === key.length;
      const partial = key.length ? inPlace / key.length : 0;
      const notes = correct ? [] : [`${inPlace} of ${key.length} were in the right position. Find the step that has to come first, then work forward.`];
      return { correct, partial, notes };
    },
    render(item, host, ctx) {
      // Tap-to-append ordering: tapping a tile appends it to the arrangement, tapping a placed
      // tile removes it. Drag is deliberately avoided; it is unreliable on an iPad in Safari.
      const state = { picked: [] };
      host._mvState = state;
      host.appendChild(stemNode(item.stem));
      const bank = el('div', 'mv-tiles mv-bank');
      const line = el('div', 'mv-tiles mv-line');
      host.appendChild(line);
      host.appendChild(bank);

      function repaint() {
        bank.innerHTML = '';
        line.innerHTML = '';
        item.tiles.forEach((text, i) => {
          if (state.picked.includes(i)) return;
          const b = el('button', 'mv-tile', text);
          b.type = 'button';
          b.addEventListener('click', function () {
            if (host.dataset.locked === '1') return;
            state.picked.push(i);
            repaint();
            ctx.onProgress();
          });
          bank.appendChild(b);
        });
        state.picked.forEach((idx, pos) => {
          const b = el('button', 'mv-tile placed');
          b.type = 'button';
          b.dataset.idx = String(idx);
          b.appendChild(el('span', 'mv-tile-num', String(pos + 1)));
          b.appendChild(el('span', 'mv-tile-text', item.tiles[idx]));
          b.addEventListener('click', function () {
            if (host.dataset.locked === '1') return;
            state.picked.splice(pos, 1);
            repaint();
            ctx.onProgress();
          });
          line.appendChild(b);
        });
      }
      repaint();
      state.repaint = repaint;
      state.line = line;
    },
    reveal(item, host, r) {
      const line = (host._mvState || {}).line;
      if (!line) return;
      const key = item.key || [];
      [...line.querySelectorAll('.mv-tile')].forEach((b, pos) => {
        b.classList.add(Number(b.dataset.idx) === key[pos] ? 'correct' : 'wrong');
        b.disabled = true;
      });
    },
  };

  types.cloze = {
    needsCheck: true,
    isComplete(item, r) {
      return Array.isArray(r) && r.length === item.blanks.length && r.every(v => Number.isInteger(v));
    },
    grade(item, r) {
      const arr = Array.isArray(r) ? r : [];
      let hits = 0;
      item.blanks.forEach((b, i) => { if (arr[i] === b.key) hits++; });
      const correct = hits === item.blanks.length;
      const partial = item.blanks.length ? hits / item.blanks.length : 0;
      const notes = correct ? [] : [`${hits} of ${item.blanks.length} blank${item.blanks.length === 1 ? '' : 's'} correct. Read the whole sentence aloud with your choice in it; the wrong one usually sounds wrong.`];
      return { correct, partial, notes };
    },
    render(item, host, ctx) {
      const state = { picked: item.blanks.map(() => null) };
      host._mvState = state;
      const line = el('div', 'mv-cloze');
      const parts = String(item.stem).split(/(\{\{\d+\}\})/);
      state.selects = [];
      for (const part of parts) {
        const m = part.match(/^\{\{(\d+)\}\}$/);
        if (!m) { line.appendChild(document.createTextNode(part)); continue; }
        const bi = Number(m[1]);
        const blank = item.blanks[bi];
        if (!blank) { line.appendChild(document.createTextNode(part)); continue; }
        const sel = el('select', 'mv-blank');
        const ph = el('option', null, '\u2014');
        ph.value = '';
        sel.appendChild(ph);
        blank.choices.forEach((c, ci) => {
          const o = el('option', null, c);
          o.value = String(ci);
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          if (host.dataset.locked === '1') return;
          state.picked[bi] = sel.value === '' ? null : Number(sel.value);
          ctx.onProgress();
        });
        state.selects[bi] = sel;
        line.appendChild(sel);
      }
      host.appendChild(line);
    },
    reveal(item, host, r) {
      const st = host._mvState || {};
      (st.selects || []).forEach((sel, i) => {
        if (!sel) return;
        sel.disabled = true;
        const got = Array.isArray(r) ? r[i] : null;
        sel.classList.add(got === item.blanks[i].key ? 'correct' : 'wrong');
      });
    },
  };

  types.shorttext = {
    needsCheck: true,
    isComplete(item, r) { return typeof r === 'string' && r.trim().length > 0; },
    grade(item, r) {
      const words = String(r || '').trim().split(/\s+/).filter(Boolean).length;
      if (words > item.maxWords) {
        return {
          correct: false, partial: 0,
          notes: [`Keep it to ${item.maxWords} words or fewer. You used ${words}. A short answer is graded on the phrase itself, so cut everything that is not the answer.`],
        };
      }
      const got = normalizeText(r);
      const correct = (item.accept || []).some(a => normalizeText(a) === got);
      return {
        correct,
        partial: correct ? 1 : 0,
        notes: correct ? [] : [`Not one of the accepted phrasings. Answer in the passage's own words where you can.`],
      };
    },
    render(item, host, ctx) {
      const state = { picked: '' };
      host._mvState = state;
      host.appendChild(stemNode(item.stem));
      const inp = el('input', 'mv-input');
      inp.type = 'text';
      inp.autocomplete = 'off';
      inp.setAttribute('autocapitalize', 'none');
      inp.placeholder = `${item.maxWords} words or fewer`;
      inp.addEventListener('input', function () {
        if (host.dataset.locked === '1') return;
        state.picked = inp.value;
        ctx.onProgress();
      });
      host.appendChild(inp);
      state.input = inp;
    },
    reveal(item, host, r, result) {
      const inp = (host._mvState || {}).input;
      if (!inp) return;
      inp.disabled = true;
      inp.classList.add(result && result.correct ? 'correct' : 'wrong');
      if (!(result && result.correct)) {
        // reveal must be idempotent: it appends to the input's PARENT, not to a container it owns and
        // clears, so a second call with no intervening render would leave the child reading two identical
        // Accepted lines. Every other type paints in place and is naturally idempotent; this one is not.
        const parent = inp.parentNode;
        if (parent && !parent.querySelectorAll('.mv-accepted').length) {
          parent.appendChild(el('div', 'mv-accepted', 'Accepted: ' + (item.accept || []).join(' / ')));
        }
      }
    },
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
    // render OWNS the host. It clears it, establishes the locked flag the click guards read, and drops
    // any state left by a previous item. Task 12's runner also clears the element, and that redundancy is
    // deliberate: this file's guards must not be inert when called by anything else, and a type's render
    // must not silently append a second question beneath the first.
    render(item, host, ctx) {
      const t = typeOf(item);
      // Only a REAL id can establish sameness. Two items without ids both stringify to '' and would
      // otherwise look like the same item, so the lock set on the first would never reset and the second
      // would render fully unanswerable. The validator requires unique non-empty ids pack-wide, so this
      // cannot happen through a valid pack, but nothing else in this file depends on that guarantee and
      // it should not start here.
      const id = item && item.id != null ? String(item.id) : '';
      const sameItem = id !== '' && host.dataset.itemId === id;
      host.innerHTML = '';
      delete host._mvState;
      host.dataset.itemId = id;
      if (!sameItem) host.dataset.locked = '0';
      return t.render(item, host, ctx);
    },
    reveal(item, host, response, result) { return typeOf(item).reveal(item, host, response, result); },
    // exposed for the later type tasks and for the runner's own tests
    _helpers: { el, uniqSorted, sameSet, setPartial, setNotes, renderChoices, revealChoices, stemNode },
  };
});
