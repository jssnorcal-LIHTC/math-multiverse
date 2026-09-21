// THE PREDICATE, IN ONE PLACE, because the claim that it was in one place was false.
//
// tests/sweep-unquoted-labels.js and tests/fix-unquoted-labels.js were shipped together, and the
// fixer's header says they use "THE SAME PREDICATE ... so the fixer and the sweep cannot disagree
// about what counts".  They did not.  They held two independent copies of the cue regex and the
// floor, and by C4 round 4 the copies had diverged on three axes at once:
//
//                        sweep (v1)              fixer (v1)
//   word floor           3, or 1 under --all     3, hardcoded, no flag
//   cue list             no "marks"/"names"      same list, separately written
//   word boundaries      none                    none
//   figures swept        no                      no
//
// A rule asserted in a comment is not a rule.  Both files now require this module and neither
// defines a predicate of its own, so the header's claim is true for the first time.
'use strict';

// Cue verbs that open a quotation of drawn text.  The optional tail is the intervening noun that
// defeated v1: "prints THE WORDS x", "marks it WITH THE WORDS x", "ends WITH THE WORDS x".  A
// six-word clause-shaped label behind one of those was invisible at every floor.
const CUEVERB = 'reading|reads|read|labelled|labeled|labels|label|headed|marked|marks|named|naming|names'
  + '|says|saying|gives|giving|carries|carrying|prints|printing|print';
// The "<verb> with" family, added after the superseded sweep caught what this one missed: one
// l1-match explain carried three drawn lines, and the fixer closed only the one behind "with the
// words" because "opens with" and "ends with" were not cues.  Quoting one of three and leaving two
// is the sibling miss this whole programme keeps making, reproduced inside a single sentence.
const CUEWITH = 'opens?|ends?|begins?|starts?|closes?|finishes?';
// "the words X" is a quotation cue ON ITS OWN, wherever the verb sits.  The cross-cutting pass found
// four more unclosed labels in ela-g6-spy behind verbs the list does not hold and never should:
// "the drawing PUTS the words X", "it gives a number TO the words X".  Chasing the verb is the wrong
// axis;  the naming noun is the cue.  Probed across all three packs before landing: 4 real hits, 0
// false positives.
const CUENOUN = '(?:the|its)\\s+(?:words?|phrase)';
const CUE = new RegExp(
  '(?:\\b(?:' + CUEVERB + ')(?:\\s+(?:the|a|an)\\s+(?:words?|lines?|phrase|entry|text|heading))?'
  + '|\\b(?:' + CUEWITH + ')\\s+with(?:\\s+(?:the|a|an)\\s+(?:words?|lines?|phrase|entry|text|heading))?'
  + '|\\bwith\\s+the\\s+words?'
  + '|\\b' + CUENOUN + ')\\s+$', 'i');

// A dataTable holds two kinds of string and only one of them is DRAWN TEXT.  Walking all of them
// was the root cause of a false-positive class the cross-cutting pass had to unpick by hand:
//
//   shape: "box"          flagged "a labelled box for the fence", where box is a common noun and
//                         the value is a rendering instruction.  It also matched inside "boxes",
//                         which the word-boundary check below then had to catch separately.
//   id: "willow"          flagged "a labelled willow";  the DRAWN label on that node is "big willow".
//   from/to: "8:22"       a structural reference to an event, not the gap's label, which is
//                         "some forty minutes".
//
// So the walk skips structural keys.  Drawn text lives in label, value, heading, text, title,
// stamp, rows and tracks;  everything named below positions, references or renders it.
const STRUCTURAL = new Set([
  'type', 'layout', 'docKind', 'shape', 'style', 'emphasis', 'id', 'kind', 'mark',
  'sourcePassageId', 'from', 'to', 'track', 'gen', 'src',
]);

// Every string a figure actually draws.  Longest first, so a label that contains a shorter one is
// considered before its own substring.
function drawnStrings(fig) {
  const out = new Set();
  const walk = (n) => {
    if (typeof n === 'string') { if (n.trim()) out.add(n.trim()); return; }
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) if (!STRUCTURAL.has(k)) walk(v);
    }
  };
  walk(fig.dataTable);
  return [...out].sort((a, b) => b.length - a.length);
}

// Reader-facing fields only.  svgRead is authoring evidence and is excluded on purpose; a
// non-reader-facing field is allowed to be terse.
function readerStrings(it) {
  const out = [];
  const push = (where, v) => { if (typeof v === 'string' && v.trim()) out.push({ where, text: v }); };
  push('stem', it.stem);
  push('explain', it.explain);
  push('whyTheFigureIsNeeded', it.whyTheFigureIsNeeded);
  (it.choices || []).forEach((c, i) => push(`choices[${i}]`, c));
  (it.tiles || []).forEach((c, i) => push(`tiles[${i}]`, c));
  (it.rowLabels || []).forEach((c, i) => push(`rowLabels[${i}]`, c));
  (it.colLabels || []).forEach((c, i) => push(`colLabels[${i}]`, c));
  (it.blanks || []).forEach((b, n) => (b.choices || []).forEach((c, i) => push(`blanks[${n}].choices[${i}]`, c)));
  Object.entries(it.distractorRationale || {}).forEach(([k, v]) => push(`distractorRationale[${k}]`, v));
  return out;
}

// Load-bearing now that there is no length floor: the drawn string "box" matched inside "boxes" in
// two alts the moment the floor came off.  That false positive was suppressed by the floor rather
// than prevented by it, which is why removing the floor without this check reports noise.
function atWordBoundary(text, i, end) {
  if (i > 0 && /[A-Za-z0-9]/.test(text[i - 1])) return false;
  if (end < text.length && /[A-Za-z0-9]/.test(text[end])) return false;
  return true;
}

// THE single traversal both tools run.  Calls back once per cued use of a drawn label, with enough
// context for a reporter to describe it and a fixer to rewrite it.  Neither tool may re-implement
// this loop; that is the whole point of the module.
function eachCuedUse(text, labels, minWords, cb) {
  for (const L of labels) {
    if (L.split(/\s+/).length < minWords) continue;
    let from = 0;
    for (;;) {
      const i = text.indexOf(L, from);
      if (i === -1) break;
      from = i + 1;
      const end = i + L.length;
      if (!atWordBoundary(text, i, end)) continue;
      const before = text.slice(0, i);
      if (!CUE.test(before)) continue;
      const after = text.slice(end);
      const openQ = /["“]\s*$/.test(before);
      const closeQ = /^\s*["”]/.test(after);
      cb({ label: L, index: i, end, before, after, openQ, closeQ, closed: openQ && closeQ });
    }
  }
}

// Wrap every cued, unquoted occurrence.  Rebuilt left to right so an inserted quote cannot shift an
// index still being held.  Runs the same predicate as the sweep, via the same function.
function closeLabels(text, labels, minWords) {
  let n = 0;
  let out = text;
  for (const L of labels) {
    if (L.split(/\s+/).length < minWords) continue;
    let acc = '';
    let rest = out;
    for (;;) {
      const i = rest.indexOf(L);
      if (i === -1) { acc += rest; break; }
      const before = rest.slice(0, i);
      const after = rest.slice(i + L.length);
      const whole = acc + before;
      const openQ = /["“]\s*$/.test(before);
      const closeQ = /^\s*["”]/.test(after);
      const boundaryOk = atWordBoundary(acc + before + L + after, whole.length, whole.length + L.length);
      if (boundaryOk && CUE.test(whole) && !(openQ && closeQ)) {
        acc += before + '"' + L + '"';
        n++;
      } else {
        acc += before + L;
      }
      rest = after;
    }
    out = acc;
  }
  return { text: out, n };
}

module.exports = { CUE, drawnStrings, readerStrings, atWordBoundary, eachCuedUse, closeLabels };
