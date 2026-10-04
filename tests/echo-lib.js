'use strict';
// echo-lib.js -- what counts as an ANSWER and what counts as STATING one, shared by every echo gate.
//
// Moved out of tests/sweep-review-echo.js on 26-1004 so tests/sweep-cross-level.js applies the same
// definitions:  two gates that each carried a copy would drift the first time one was corrected (the
// 26-0922 hottext keyed-span fix had to be made in exactly one place, and now it is).

const STOP = new Set(('a an the of to in on at by for and or but is are was were be been being it its this that these those with '
  + 'from as each which what who whom whose where when why how one two three four five six does do did has have had not no nor so '
  + 'than then there their them they he she his her him we you i my me our your into over under about any all some own same both '
  + 'only just still more most very can could would should will may might must also because if out up down off again once here').split(' '));
const norm = (w) => w.toLowerCase().replace(/[‘’]/g, "'").replace(/'s$/, '').replace(/[^a-z0-9-]/g, '').replace(/([^s])s$/, '$1');
const words = (s) => String(s == null ? '' : s).split(/\s+/).map(norm).filter((w) => w && !STOP.has(w));

function keysOf(it) {
  const out = [];
  const add = (choices, key, where) => (Array.isArray(key) ? key : [key]).forEach((k) => {
    if (Array.isArray(choices) && Number.isInteger(k) && choices[k] !== undefined) out.push({ text: String(choices[k]), where });
  });
  if (it.type === 'mc' || it.type === 'ms') add(it.choices, it.key, 'key');
  if (it.type === 'ebsr') {
    if (it.partA) add(it.partA.choices, it.partA.key, 'partA key');
    // Part B's key is a MAP from each Part A choice to the line that supports it (engine/items.js).
    // Only the line mapped from Part A's KEY is the answer;  the others support wrong claims, and a
    // child who remembers one of them from an earlier level is led to a wrong answer, not given one.
    if (it.partA && it.partB && Array.isArray(it.partB.choices)) {
      const kb = it.partB.key;
      const canon = kb && typeof kb === 'object' && !Array.isArray(kb) ? kb[String(it.partA.key)] : kb;
      add(it.partB.choices, [canon].filter(Number.isInteger), 'partB key');
    }
  }
  if (it.type === 'cloze') (it.blanks || []).forEach((b, i) => add(b.choices, b.key, `blank ${i} key`));
  // A hottext keys the passage sentences it asks for;  each keyed span is an answer (26-0922:  the
  // first draft of this gate left them out, and a keyed span shared with a sibling's Part B key is
  // the same answer asked twice).
  if (it.type === 'hottext') add(it.spans, it.key, 'keyed span');
  return out;
}

// The fields of an earlier item that ASSERT something.
function assertingFields(it) {
  const out = [];
  const push = (v, where) => { if (typeof v === 'string' && v) out.push({ text: v, where }); };
  push(it.stem, 'stem');
  push(it.explain, 'explain');
  push(it.whyTheFigureIsNeeded, 'whyTheFigureIsNeeded');
  if (it.distractorRationale && typeof it.distractorRationale === 'object') {
    for (const [k, v] of Object.entries(it.distractorRationale)) push(v, `distractorRationale.${k}`);
  }
  if (it.partA) push(it.partA.stem, 'partA.stem');
  if (it.partB) push(it.partB.stem, 'partB.stem');
  keysOf(it).forEach((k) => push(k.text, k.where));
  return out;
}

module.exports = { STOP, norm, words, keysOf, assertingFields };
