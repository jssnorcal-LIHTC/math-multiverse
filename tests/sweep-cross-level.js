'use strict';
// sweep-cross-level.js -- every level asks only about its own stories.
//
// Justin, 26-1004, relaying Niall:  "in Vault of Ages, in the sixth level, it was asking a question about
// what happened in the second level."  The 26-0921 rule ("no review questions can echo") had been built as
// sweep-review-echo.js's E1 to E4:  a review item may not repeat an earlier question, figure fact or keyed
// answer.  Every pack read ALL CLEAN while level 6 still served 56 questions on EARLIER levels' passages
// (Cold Signal 28 of 28, Vault 15, Firsthand 9, Outpost 4), and 7 practice items did the same.  A new
// question about an old story passed every one of E1 to E4, because Niall's own case was never one of their
// controls.  It is the FIRST control here, verbatim from 02a63cf
// (tests/fixtures/cross-level-niall-vault-26-1004.json).
//
//   I1  ONE LEVEL PER PASSAGE.  A passage is served by the items of one level only.
//   I2  ONE LEVEL PER FIGURE.  A figure belongs to one level only, counting every way a level shows it:  an
//       item that reads it, the level's reveal, and the figure strip of a passage the level serves.  A
//       drawing from an earlier level is the earlier story coming back.
//   I3  NO EARLIER LEVEL STATES THE KEY.  sweep-review-echo's E1 test (a key's content words, 80% or more
//       and at least three, inside one asserting field of another item), widened from level 6 to every
//       level, checked against every EARLIER level.  Only that direction:  a later item that restates an
//       earlier key teaches it again, it does not ask about it.
//   I4  NO QUESTION POINTS BACK.  A question can ask about an earlier story from its OWN passage:  Vault's
//       level 6 asked "What do Mila's introduction in 'Two Empty Chairs' and her role in the final vault have
//       in common?", Firsthand's "a civilization studied earlier in this record", Cold Signal level 5 "The
//       Halloway training log and this article...".  I1 cannot see those, because the passage is the level's
//       own.  So the text a child is ASKED (stem, options, Part A, blank and tile options, row and column
//       labels;  never a Part B line or a hottext span, which quote the item's own passage) may not carry a
//       pointer phrase (POINTERS), cite another level's passage title in quotation marks or where the item's
//       own passage never uses it, or name another level's document from SOURCE_NAMES.  The real cases are
//       the controls (tests/fixtures/cross-level-callbacks-26-1004.json), with a same-level "earlier entry"
//       and a word a level's own passage introduces as the two that must stay clean.  A passage may still
//       remember the series (the Vault finale's keys are the earlier relics);  a question may not ask about
//       the remembering.
//   I5  NO QUESTION READS ANOTHER LEVEL'S DRAWING.  Found by the Phase 1 lens, 26-1004, after every rule
//       above read ALL CLEAN:  Outpost's level 6 asked the child to put "the proposals panel" (its own) together
//       with "the fledge-rate chart", which only level 5 shows.  The item's figure was its own, so I2 was
//       blind, and the chart was named by what it plots, not by a title, so I4 was too.  So in the asked text,
//       a drawing noun (chart, map, timeline, panel, card, plan, ...) with the words in front of it ("the
//       fledge-rate chart") is matched against every figure's caption, alt text, table title and id:  if a
//       figure the item's own level shows matches, it is the level's own drawing;  if none does and a figure
//       only another level shows matches, it is a finding.  That case, verbatim, is the control
//       (tests/fixtures/cross-level-figure-ref-26-1004.json), with its fixed text as the clean twin.
//   I6  NO NAME FROM ANOTHER LEVEL'S STORY.  Found by the Phase 2 lens, 26-1004:  Firsthand level 6 offered
//       "Samaria" and "Jerusalem", places only level 2 names.  I4 knew names only from a hand-written list, so
//       its first run over every pack also found Vault level 1 calling its unnamed narrator "Mila" (a name the
//       child meets in level 3), "Kade" in two distractors and "Qin" in another.  A name is a word the passages
//       capitalize mid-sentence and never write in lowercase;  it is a finding in a question whose own level
//       (passages, titles, figures) never uses it while another level's passage does.  Frame words the game
//       shows on every level (the skin, level names and goals:  "The Archive") are exempt, and a long name
//       matches its word forms ("Buddhist" in a level that says "Buddhism").  Controls:
//       tests/fixtures/cross-level-names-26-1004.json.
//   I7  NO FEEDBACK POINTS AT ANOTHER LEVEL.  Found by the completion check Justin asked for, 26-1004, after I1 to I6
//       read ALL CLEAN:  no rule read the text a child sees AFTER answering, and eight practice items used it to send
//       the child elsewhere.  Firsthand level 2 explained a wrong "Babylon" by "the law code filed at the very start of this
//       record";  level 1 credited "baked brick" to "the Indus cities in a later file";  Vault level 2 traced two
//       distractors to "the Osiris and Isis story connected to the Abydos seal", a level-4 relic;  Outpost level 4 cited
//       "Tile 3's field manual";  Night Rounds level 6, "a case two levels earlier".  So the feedback (the explanation,
//       each option's rationale, and each blank's rationales) is held to I6's name test, and to the pointers that can
//       only mean another level:  a level by number other than the item's own, a count of levels back, and
//       FEEDBACK_POINTERS.  A distractor borrowed from another level's story is caught the same way, by the rationale
//       that says where it came from.  The number and the count apply to the asked text under I4 as well.  Controls:
//       tests/fixtures/cross-level-feedback-26-1004.json.
//
//   node tests/sweep-cross-level.js            every pack in the manifest;  exits 1 on any finding
//
// SCOPE.  I1 and I2 apply to every pack whose passages are read as texts (ela, hist, sci).  The math pack
// (meta.subject "math") is exempt from those two, on purpose:  its passages are how-to notes (how to read a
// figure, how to read a decimal), and its figures are shapes to compute on, so its level 6 ("Review and
// Preview") re-computes on level-1 shapes by design and no story comes back.  Whether it should is a separate
// call, logged 26-1004.  I3 to I7 apply to every pack.
//
// Reviewed exceptions live in tests/cross-level-allowlist.json as { pack, sig, reason }.  An entry that no
// longer matches a finding is STALE and fails, so the list cannot outlive the content it excused.

const fs = require('fs');
const path = require('path');
const { STOP, norm, words, keysOf, assertingFields } = require('./echo-lib');

const ROOT = path.join(__dirname, '..');
const ALLOW_PATH = path.join(__dirname, 'cross-level-allowlist.json');
const NIALL_PATH = path.join(__dirname, 'fixtures', 'cross-level-niall-vault-26-1004.json');
const CALLBACKS_PATH = path.join(__dirname, 'fixtures', 'cross-level-callbacks-26-1004.json');
const FIGREF_PATH = path.join(__dirname, 'fixtures', 'cross-level-figure-ref-26-1004.json');
const NAMES_PATH = path.join(__dirname, 'fixtures', 'cross-level-names-26-1004.json');
const FEEDBACK_PATH = path.join(__dirname, 'fixtures', 'cross-level-feedback-26-1004.json');
const OBJECTS_PATH = path.join(__dirname, 'fixtures', 'cross-level-objects-26-1004.json');

// Phrases that send a child back to another part of the series.  Each was a real callback on 26-1004, and
// each was checked against every question in every pack for a false hit first:  "one more time" and "earlier
// entry" were dropped, because a question can quote the first from its own passage and Firsthand uses the
// second for an entry on its own level.
const POINTERS = ['earlier in the story', 'earlier in this record', 'earlier in the record', 'studied earlier',
  'start of this record', 'a lesson from earlier', 'from earlier in', 'where else in the story', 'first scene',
  'on the first day', 'connect back', 'connects back', 'looking back', 'rereads', 'reopens', 'previous level',
  'earlier level', 'in the van story', 'debrief story', 'both stories', 'two stories', 'another story', 'the other story'];
const POINTER_RES = [/\becho(es|ed)?\b/];
// I7's phrases:  only those that can mean nothing but another level.  I4's list is not reused, because feedback walks
// its own passage:  "from earlier in the log" and "looking back afterwards" are a passage talking about itself, and a
// level with three files has "a different file" and "the earlier entry" of its own (Firsthand levels 4 and 5).
const FEEDBACK_POINTERS = ['start of this record', 'studied earlier', 'a lesson from earlier', 'previous level',
  'earlier level', 'different tile'];
// A level by number other than the item's own ("Tile 3's field manual" on level 4;  the packs' prose numbers a level
// as a level or a tile), or counted back from it ("a case two levels earlier").
const LEVEL_BY_NUMBER = /\b(?:level|tile)\s+(\d)\b/g;
const LEVELS_BACK = /\b(?:a|an|one|two|three|four|five|\d)\s+(?:levels?|tiles?)\s+(?:earlier|ago|back|before|later)\b/g;
function levelPointers(said, lv) {
  const why = [];
  for (const m of said.matchAll(LEVEL_BY_NUMBER)) if (Number(m[1]) !== lv) why.push(`"${m[0]}"`);
  for (const m of said.matchAll(LEVELS_BACK)) why.push(`"${m[0]}"`);
  return why;
}
// Names that belong to one level's story, mapped to a passage of that level.  Later levels used them to ask
// about the earlier story:  "The Halloway training log and this article...", "the Petrel-4 brief's single
// thirty-day number", "the Frostbank corridor", "Hammurabi's code".  A name is exempt in a level that serves
// its passage, and in a level whose own passage TITLE carries it (Cold Signal level 3's "The Van on Halloway
// Road" is that level's own story).  Names a passage's own TEXT carries are not exempt:  the Vault finale
// remembers Frostbank, and that is exactly the remembering a question may not ask about.  Three lowercase ones
// came from the completion audit, 26-1004, each a wrong answer no name rule could see:  "the maintenance binder"
// (the file Night Rounds levels 4 and 5 both carry, offered at level 6), "hungriest stretch" (Outpost level 5's
// phrase, at level 6) and "the dome" (Outpost level 2's station, at level 1).  A name two levels' stories share
// lists both passages, and is exempt in either level.
const SOURCE_NAMES = {
  'ela-g6-spy': [['halloway', 'p-beacon-log'], ['cold-weather log', 'p-cold-weather-log'], ['cold-weather trial', 'p-cold-weather-log'],
    ['petrel-4', 'p-petrel-brief'], ['wren-7', 'p-beacon-brief'], ['corvid', 'p-beacon-brief']],
  'vault-of-ages-g6': [['frostbank', 'p-frostbank-vault'], ['two empty chairs', 'p-two-empty-chairs'],
    ['temple chronicle', 'p-temple-chronicle'], ["reckoner's ledger", 'p-reckoners-ledger']],
  'firsthand-g6': [['hammurabi', 'p-t1-hammurabi-recovered-entry'], ['aegean desk', 'p-t3-source-a-athenian'],
    ['peloponnese desk', 'p-t3-source-b-spartan'], ['athens', 'p-t3-source-a-athenian'], ['athenian', 'p-t3-source-a-athenian'],
    ['sparta', 'p-t3-source-b-spartan']],
  'night-rounds-g6': [['maintenance binder', ['p-l4-maintenance-file-fence-nine', 'p-l5-rehabbers-van']]],
  'outpost-protocol-g6': [['hungriest stretch', 'p-halyard-nesting-record'], ['the dome', 'p-meridian-status-log']],
};

// Every level that shows each passage and each figure, and how.
function usage(pack) {
  const byId = new Map((pack.items || []).map((i) => [i.id, i]));
  const passagesById = new Map((pack.passages || []).map((p) => [p.id, p]));
  const passageLevels = new Map();   // passageId -> Map(level -> [itemIds])
  const figureLevels = new Map();    // figureId  -> Map(level -> [how])
  const note = (map, key, lv, how) => {
    if (!map.has(key)) map.set(key, new Map());
    const m = map.get(key);
    if (!m.has(lv)) m.set(lv, []);
    m.get(lv).push(how);
  };
  (pack.levels || []).forEach((l, li) => {
    const lv = li + 1;
    const served = new Set();
    for (const id of l.itemIds || []) {
      const it = byId.get(id);
      if (!it) continue;
      if (it.passageId) { note(passageLevels, it.passageId, lv, id); served.add(it.passageId); }
      if (it.figureId) note(figureLevels, it.figureId, lv, `item ${id}`);
    }
    if (l.reveal && l.reveal.figureId) note(figureLevels, l.reveal.figureId, lv, 'reveal');
    for (const pid of served) {
      const p = passagesById.get(pid);
      for (const fid of (p && p.figureIds) || []) note(figureLevels, fid, lv, `strip of ${pid}`);
    }
  });
  return { byId, passageLevels, figureLevels };
}

const EXEMPT_FROM_I1_I2 = new Set(['math']);

function findingsIn(pack) {
  const found = [];
  const { byId, passageLevels, figureLevels } = usage(pack);
  const shared = !EXEMPT_FROM_I1_I2.has(pack.meta && pack.meta.subject);
  for (const [pid, m] of shared ? passageLevels : []) {
    if (m.size < 2) continue;
    const lvs = [...m.keys()].sort((a, b) => a - b);
    for (const lv of lvs) {
      found.push({ rule: 'I1', sig: `I1|${pid}@L${lv}`, group: `I1|${pid}`, level: lv,
        detail: `passage ${pid} is served by levels ${lvs.join(', ')};  level ${lv} by ${m.get(lv).join(', ')}` });
    }
  }
  for (const [fid, m] of shared ? figureLevels : []) {
    if (m.size < 2) continue;
    const lvs = [...m.keys()].sort((a, b) => a - b);
    for (const lv of lvs) {
      found.push({ rule: 'I2', sig: `I2|${fid}@L${lv}`, group: `I2|${fid}`, level: lv,
        detail: `figure ${fid} is shown by levels ${lvs.join(', ')};  level ${lv} by ${[...new Set(m.get(lv))].join(', ')}` });
    }
  }
  const levels = pack.levels || [];
  for (let L = 1; L < levels.length; L++) {
    const earlier = levels.slice(0, L).flatMap((l, li) => (l.itemIds || []).map((id) => ({ it: byId.get(id), level: li + 1 }))).filter((x) => x.it);
    for (const id of levels[L].itemIds || []) {
      const it = byId.get(id);
      if (!it) continue;
      for (const k of keysOf(it)) {
        const kw = [...new Set(words(k.text))];
        if (kw.length < 3) continue;
        for (const { it: ot, level } of earlier) {
          for (const f of assertingFields(ot)) {
            const fw = new Set(words(f.text));
            const hit = kw.filter((w) => fw.has(w)).length;
            if (hit / kw.length >= 0.8) {
              const sig = `I3|${it.id}|${k.where}|${ot.id}.${f.where}`;
              found.push({ rule: 'I3', sig, group: sig, level: L + 1,
                detail: `level ${L + 1} ${it.id} ${k.where} "${k.text}" is stated by level ${level} ${ot.id}.${f.where} (${hit}/${kw.length} words)` });
            }
          }
        }
      }
    }
  }
  // I4
  const levelsOf = new Map();
  for (const [pid, m] of passageLevels) levelsOf.set(pid, [...m.keys()]);
  const passagesById = new Map((pack.passages || []).map((p) => [p.id, p]));
  const names = (SOURCE_NAMES[pack.meta && pack.meta.id] || []).map(([n, pid]) => ({ n, pid }));
  levels.forEach((l, li) => {
    const lv = li + 1;
    for (const id of l.itemIds || []) {
      const it = byId.get(id);
      if (!it) continue;
      const asked = askedText(it);
      const own = normText((passagesById.get(it.passageId) || {}).text);
      const why = [];
      POINTERS.forEach((ph) => { if (asked.includes(ph)) why.push(`"${ph}"`); });
      POINTER_RES.forEach((re) => { const m = asked.match(re); if (m) why.push(`"${m[0]}"`); });
      why.push(...levelPointers(asked, lv));
      for (const p of pack.passages || []) {
        const lvs = levelsOf.get(p.id) || [];
        if (p.id === it.passageId || !lvs.length || lvs.includes(lv)) continue;
        const core = titleCore(p.title);
        if (core.split(' ').length < 2 && core.length < 8) continue;
        const cited = asked.includes(`"${core}"`) || asked.includes(`"the ${core}"`) || asked.includes(`'${core}'`);
        if (cited || (asked.includes(core) && !own.includes(core))) why.push(`the title of ${p.id} (level ${lvs.join('/')})`);
      }
      for (const { n, pid } of names) {
        const lvs = [...new Set([].concat(pid).flatMap((x) => levelsOf.get(x) || []))].sort((a, b) => a - b);
        if (!lvs.length || lvs.includes(lv) || !asked.includes(n)) continue;
        const ownTitles = (l.itemIds || []).map((x) => byId.get(x)).filter(Boolean)
          .map((x) => normText((passagesById.get(x.passageId) || {}).title));
        if (ownTitles.some((t) => t.includes(n))) continue;
        why.push(`"${n}", from level ${lvs.join('/')}'s story`);
      }
      if (why.length) {
        const sig = `I4|${id}`;
        found.push({ rule: 'I4', sig, group: sig, level: lv, detail: `level ${lv} ${id} points back:  ${why.join(', ')}` });
      }
    }
  });
  // I5
  const figWords = new Map((pack.figures || []).map((f) => [f.id, new Set(tokens([f.caption, f.alt,
    f.dataTable && f.dataTable.title, f.id.replace(/^fig-/, '')].join(' ')))]));
  levels.forEach((l, li) => {
    const lv = li + 1;
    const own = [...figureLevels].filter(([, m]) => m.has(lv)).map(([fid]) => fid);
    const other = [...figureLevels].filter(([, m]) => !m.has(lv)).map(([fid]) => fid);
    for (const id of l.itemIds || []) {
      const it = byId.get(id);
      if (!it) continue;
      const why = [];
      const asked = askedText(it);
      const ownText = normText((passagesById.get(it.passageId) || {}).text);
      for (const m of asked.matchAll(FIG_REF)) {
        const phrase = m[0].replace(/^\S+\s+/, '').trim();
        // The story's own object ("smaller than the catalog photograph" quotes the item's own passage), or the
        // noun used as a verb ("which source should the team plan around"):  neither names a drawing.
        if (ownText.includes(phrase) || VERB_NEXT.test(asked.slice(m.index + m[0].length))) continue;
        const mods = tokens(m[1]).filter((w) => !GENERIC_MODS.has(w) && w.length >= 3);
        if (!mods.length) continue;
        const matches = (fid) => figWords.has(fid) && mods.every((w) => figWords.get(fid).has(w));
        if (own.some(matches)) continue;
        const hit = other.filter(matches);
        if (hit.length) why.push(`"${m[0].trim()}" is ${hit.map((f) => `${f} (level ${[...figureLevels.get(f).keys()].join('/')})`).join(', ')}`);
      }
      if (why.length) {
        const sig = `I5|${id}`;
        found.push({ rule: 'I5', sig, group: sig, level: lv, detail: `level ${lv} ${id} reads another level's drawing:  ${why.join(';  ')}` });
      }
    }
  });
  // I6
  const properNames = passageNames(pack.passages || []);
  const frame = wordSet([JSON.stringify(pack.skin || {}), ...levels.map((l) => `${l.name || ''} ${l.goal || ''}`)].join(' '));
  const figuresById = new Map((pack.figures || []).map((f) => [f.id, f]));
  const levelPassages = levels.map((l, li) => [...passageLevels].filter(([, m]) => m.has(li + 1)).map(([pid]) => passagesById.get(pid)).filter(Boolean));
  const ownWords = levels.map((l, li) => wordSet([
    ...levelPassages[li].map((p) => `${p.title || ''} ${p.text || ''}`),
    ...[...figureLevels].filter(([, m]) => m.has(li + 1)).map(([fid]) => figuresById.get(fid)).filter(Boolean)
      .map((f) => [f.caption, f.alt, JSON.stringify(f.dataTable || '')].join(' ')),
  ].join(' ')));
  const otherWords = levels.map((l, li) => wordSet(levelPassages[li].map((p) => p.text || '').join(' ')));
  // The name test, shared by I6 (the asked text) and I7 (the feedback).
  const foreignNames = (text, li) => {
    const why = [];
    for (const m of foldText(text).matchAll(/\b([A-Z][a-z]+(?:-[A-Z]?[a-z]+)*)\b/g)) {
      const w = m[1].toLowerCase();
      if (!properNames.has(w) || frame.has(w) || hasWord(ownWords[li], w) || why.some((x) => x.startsWith(`"${w}"`))) continue;
      const from = otherWords.map((s, k) => (k !== li && s.has(w) ? k + 1 : 0)).filter(Boolean);
      if (from.length) why.push(`"${w}" (level ${from.join('/')})`);
    }
    return why;
  };
  levels.forEach((l, li) => {
    const lv = li + 1;
    for (const id of l.itemIds || []) {
      const it = byId.get(id);
      if (!it) continue;
      const why = foreignNames(askedRaw(it), li);
      if (why.length) {
        const sig = `I6|${id}`;
        found.push({ rule: 'I6', sig, group: sig, level: lv, detail: `level ${lv} ${id} names what only another level's story names:  ${why.join(', ')}` });
      }
    }
  });
  // I7
  levels.forEach((l, li) => {
    const lv = li + 1;
    for (const id of l.itemIds || []) {
      const it = byId.get(id);
      if (!it) continue;
      const fb = feedbackRaw(it);
      const said = normText(fb);
      const why = foreignNames(fb, li);
      FEEDBACK_POINTERS.forEach((ph) => { if (said.includes(ph)) why.push(`"${ph}"`); });
      why.push(...levelPointers(said, lv));
      if (why.length) {
        const sig = `I7|${id}`;
        found.push({ rule: 'I7', sig, group: sig, level: lv, detail: `level ${lv} ${id} feedback points at another level:  ${why.join(', ')}` });
      }
    }
  });
  return found;
}

// I6's names:  words the passages capitalize in the middle of a sentence and never write in lowercase ("Samaria",
// "Kade");  a word capitalized only where a sentence starts ("If", "Match") is not one.
const foldText = (s) => String(s == null ? '' : s).replace(/[‘’]/g, "'").replace(/'s\b/g, '');
function passageNames(passages) {
  const mid = new Set(), low = new Set();
  for (const p of passages) {
    const t = foldText(p.text);
    for (const m of t.matchAll(/\b([A-Za-z][a-z]+(?:-[A-Za-z]?[a-z]+)*)\b/g)) {
      const w = m[1].toLowerCase();
      if (m[1][0] === m[1][0].toLowerCase()) { low.add(w); continue; }
      const before = t.slice(0, m.index).replace(/\s+$/, '');
      if (before && !/[.!?:;"“(\n]$/.test(before)) mid.add(w);
    }
  }
  return new Set([...mid].filter((w) => !low.has(w)));
}
const wordSet = (s) => new Set(foldText(s).toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean));
// A level that says "Buddhism" or "Europe" has met "Buddhist" and "European":  a long name matches on all but its last
// two letters.  One that says "Babylon" has met "Babylonian":  a long name also matches a whole word of the level's
// own, six letters or more, that it begins with.
const hasWord = (set, w) => set.has(w) || (w.length >= 6 && [...set].some((x) => x.startsWith(w.slice(0, w.length - 2))
  || (x.length >= 6 && w.startsWith(x))));
// What a child reads after answering, for I7:  the explanation, each wrong option's rationale, and each blank's
// rationales (the runner shows a cloze its explanation only, today;  its rationales are held to the rule anyway, so a
// later screen cannot surface one).
function feedbackRaw(it) {
  const parts = [it.explain, ...Object.values(it.distractorRationale || {})];
  (it.blanks || []).forEach((b) => parts.push(...Object.values((b && b.distractorRationale) || {})));
  return parts.filter(Boolean).join(' | ');
}
// The asked text with its capitals kept (askedText lowercases), for I6.
function askedRaw(it) {
  const parts = [it.stem];
  if (it.choices) parts.push(...it.choices);
  if (it.partA) parts.push(it.partA.stem, ...(it.partA.choices || []));
  if (it.blanks) it.blanks.forEach((b) => parts.push(...((b && b.choices) || [])));
  if (it.rowLabels) parts.push(...it.rowLabels);
  if (it.colLabels) parts.push(...it.colLabels);
  if (it.tiles) parts.push(...it.tiles);
  return parts.filter(Boolean).join(' | ');
}

// I5's drawing nouns, and the words in front of one that say WHERE in a drawing, not WHICH drawing.
const FIG_NOUNS = 'chart|map|graph|diagram|timeline|photo|photograph|panel|card|plan|drawing|picture|plate|etching';
// A modifier word is never a function word, so "the order the timeline" or "the reading of the card" is not read
// as a drawing's name:  the phrase must run straight from its article to the noun.
const MOD_STOP = 'the|a|an|of|to|in|on|at|by|for|and|or|but|is|are|was|were|be|been|it|its|this|that|these|those|with|'
  + 'has|have|had|no|not|does|did|do|what|which|who|how|from|into|than|as';
const MOD_WORD = `(?!(?:${MOD_STOP})\\b)[a-z][a-z'-]*`;
const FIG_REF = new RegExp(`\\b(?:the|this|that|its|their)\\s+((?:${MOD_WORD}\\s+){0,2}${MOD_WORD})\\s+(?:${FIG_NOUNS})s?\\b`, 'g');
const VERB_NEXT = /^\s+(around|ahead|out)\b/;
const GENERIC_MODS = new Set(('left right top bottom first second third fourth upper lower same other whole small large '
  + 'full size each every last next new old one two three four both own printed drawn marked middle center centre '
  + 'side front back').split(' '));
const tokens = (s) => String(s == null ? '' : s).toLowerCase().split(/[^a-z0-9']+/).map(norm).filter((w) => w && !STOP.has(w));

function normText(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');
}
// The text a child is asked.  Part B lines and hottext spans are left out on purpose:  each is a verbatim quote of
// the item's own passage (validate-pack holds them to that), so a passage that remembers is not a question that asks.
function askedText(it) {
  const parts = [it.stem];
  if (it.choices) parts.push(...it.choices);
  if (it.partA) parts.push(it.partA.stem, ...(it.partA.choices || []));
  if (it.blanks) it.blanks.forEach((b) => parts.push(...((b && b.choices) || [])));
  if (it.rowLabels) parts.push(...it.rowLabels);
  if (it.colLabels) parts.push(...it.colLabels);
  if (it.tiles) parts.push(...it.tiles);
  return normText(parts.filter(Boolean).join(' | '));
}
const TITLE_PREFIX = /^(source [ab]: |catalog entry: |case file: |case file zero: |recovered entry: |case file addendum: |field manual: |field report: |status log: |weather log: |standing procedure: |maintenance order: |transfer briefing: |analyst's memo: |review board minutes: |final deployment: )/;
function titleCore(t) { return normText(t).replace(TITLE_PREFIX, '').replace(/^the /, '').trim(); }

// An I1 or I2 group fails while two or more of its levels are NOT excused;  an excused level is "used" only
// while the sharing it excuses still exists.  An I3 to I7 finding fails unless its own signature is excused.
function applyAllow(packId, found, allow, used) {
  const mine = allow.filter((a) => a.pack === packId);
  const excused = (f) => mine.find((a) => a.sig === f.sig);
  const out = [];
  const groups = new Map();
  for (const f of found) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  for (const fs_ of groups.values()) {
    const open = fs_.filter((f) => !excused(f));
    fs_.forEach((f) => { const a = excused(f); if (a) used.add(a); });
    if (['I3', 'I4', 'I5', 'I6', 'I7'].includes(fs_[0].rule)) out.push(...open);
    else if (open.length >= 2) out.push(...open);
  }
  return out;
}

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function main() {
  const problems = [];
  const manifest = loadJson(path.join(ROOT, 'packs', 'manifest.json'));
  const allow = fs.existsSync(ALLOW_PATH) ? loadJson(ALLOW_PATH) : [];
  const used = new Set();
  let packs = 0;
  const counts = { I1: 0, I2: 0, I3: 0, I4: 0, I5: 0, I6: 0, I7: 0 };
  for (const e of manifest.packs) {
    const pack = loadJson(path.join(ROOT, 'packs', `${e.id}.json`));
    if (!pack.levels || pack.levels.length < 2) continue;
    packs++;
    for (const f of applyAllow(e.id, findingsIn(pack), allow, used)) {
      counts[f.rule]++;
      problems.push(`${f.rule}  ${e.id}:  ${f.detail}  [sig ${f.sig}]`);
    }
  }
  for (const a of allow) {
    if (!a.reason || String(a.reason).split(/\s+/).length < 8) problems.push(`allowlist entry ${a.pack} ${a.sig}:  needs a reason of eight words or more`);
    if (!used.has(a)) problems.push(`STALE allowlist entry ${a.pack} ${a.sig}:  it no longer matches a finding;  remove it`);
  }
  console.log(`sweep-cross-level: ${packs} pack(s);  every passage, figure and earlier-level key checked;  ${used.size} reviewed exception(s)`);

  // ---- controls ----
  {
    const ctl = [];
    // 1.  NIALL'S CASE, verbatim.  Vault level 6 served four items on two level-2 passages.
    const niall = loadJson(NIALL_PATH);
    const nf = findingsIn(niall).filter((f) => f.rule === 'I1');
    const want = ['I1|p-threadglass-entry@L2', 'I1|p-threadglass-entry@L6', 'I1|p-three-realms-below@L2', 'I1|p-three-realms-below@L6'].sort();
    const got = [...new Set(nf.map((f) => f.sig))].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) ctl.push(`CONTROL Niall failed:  expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    if (applyAllow('vault-of-ages-g6', findingsIn(niall), [], new Set()).length === 0) ctl.push('CONTROL Niall failed:  his case came back clean');

    // 2.  THE REAL CALLBACKS, verbatim.  Each must fire I4;  the same-level reference and the level's own word must not.
    const cb = loadJson(CALLBACKS_PATH);
    for (const c of cb.mustFire) {
      if (!findingsIn(c).some((f) => f.rule === 'I4')) ctl.push(`CONTROL callback failed:  I4 missed a real case (${c.note})`);
    }
    for (const c of cb.mustStayClean) {
      const g = findingsIn(c).filter((f) => f.rule === 'I4');
      if (g.length) ctl.push(`CONTROL callback failed:  I4 fired on a case that is not a callback (${c.note}):  ${g[0].detail}`);
    }

    // 3.  I5, THE LENS'S CASE, verbatim:  Outpost level 6 on level 5's fledge-rate chart must fire;  its fixed text, a
    //     drawing noun used as a verb and an object the item's own passage names must not.
    const fr = loadJson(FIGREF_PATH);
    for (const c of fr.mustFire) {
      if (!findingsIn(c).some((f) => f.rule === 'I5')) ctl.push(`CONTROL figure reference failed:  I5 missed a real case (${c.note})`);
    }
    for (const c of fr.mustStayClean) {
      const g = findingsIn(c).filter((f) => f.rule === 'I5');
      if (g.length) ctl.push(`CONTROL figure reference failed:  I5 fired on a case that is not one (${c.note}):  ${g[0].detail}`);
    }

    // 4.  I6, THE PHASE 2 LENS'S CASE and the first-run cases:  Samaria and Jerusalem at Firsthand level 6, and Vault
    //     level 1's unnamed "Mila", must fire;  each fixed, a frame word, a word form and a sentence-initial "If" must
    //     not.  Each exemption is also shown to carry its weight:  without the level names, "Archive" fires.
    const nm = loadJson(NAMES_PATH);
    for (const c of nm.mustFire) {
      if (!findingsIn(c).some((f) => f.rule === 'I6')) ctl.push(`CONTROL names failed:  I6 missed a real case (${c.note})`);
    }
    for (const c of nm.mustStayClean) {
      const g = findingsIn(c).filter((f) => f.rule === 'I6');
      if (g.length) ctl.push(`CONTROL names failed:  I6 fired on a case that is not one (${c.note}):  ${g[0].detail}`);
    }
    const unframed = JSON.parse(JSON.stringify(nm.mustStayClean.find((c) => /Archive/.test(c.note))));
    unframed.levels.forEach((l) => { delete l.name; delete l.goal; });
    if (!findingsIn(unframed).some((f) => f.rule === 'I6')) ctl.push('CONTROL names failed:  with the level names removed, "Archive" should fire;  the frame exemption is not what passed it');

    // 5.  I7, THE COMPLETION CHECK'S CASES, verbatim from 2733c3e:  the eight feedback texts that sent a child to another
    //     level must each fire on their own item;  each fixed, and five near-misses, must not.  Each exemption is shown to
    //     carry its weight:  without its level's own "Babylon", "Babylonian" fires;  and each I4 near-miss really does
    //     carry one of I4's pointers, so FEEDBACK_POINTERS is what passes it.
    const fb = loadJson(FEEDBACK_PATH);
    for (const c of fb.mustFire) {
      if (!findingsIn(c).some((f) => f.rule === 'I7' && f.sig === `I7|${c.itemId}`)) ctl.push(`CONTROL feedback failed:  I7 missed a real case (${c.note})`);
    }
    for (const c of fb.mustStayClean) {
      const g = findingsIn(c).filter((f) => f.rule === 'I7');
      if (g.length) ctl.push(`CONTROL feedback failed:  I7 fired on a case that is not one (${c.note}):  ${g[0].detail}`);
    }
    const form = JSON.parse(JSON.stringify(fb.mustStayClean.find((c) => c.itemId === 't1-ebsr-what-the-earliest-tablets-hold')));
    const formLevel = form.levels.findIndex((l) => l.itemIds.includes(form.itemId));
    const formOwn = new Set(form.levels[formLevel].itemIds.map((id) => form.items.find((i) => i.id === id).passageId));
    form.passages.filter((q) => formOwn.has(q.id)).forEach((q) => { q.text = q.text.replace(/\bBabylon\b/g, 'Akkad'); });
    if (!findingsIn(form).some((f) => f.rule === 'I7')) ctl.push('CONTROL feedback failed:  with the level\'s own "Babylon" renamed, "Babylonian" should fire;  the word form is not what passed it');
    for (const c of fb.mustStayClean.filter((x) => /^I4 pointer/.test(x.note))) {
      const said = normText(feedbackRaw(c.items.find((i) => i.id === c.itemId)));
      if (!POINTERS.some((ph) => said.includes(ph))) ctl.push(`CONTROL feedback failed:  "${c.note}" no longer carries an I4 pointer, so it proves nothing`);
    }

    // 6.  I4's LOWERCASE STORY OBJECTS, the completion audit's three wrong answers, verbatim from 2733c3e:  each must fire
    //     I4 on its own item;  each fixed, and Night Rounds level 5's own "maintenance binder", must not.  The two-passage
    //     name is shown to carry its weight:  with level 5's passage out of the name's list, level 5 fires.
    const ob = loadJson(OBJECTS_PATH);
    for (const c of ob.mustFire) {
      if (!findingsIn(c).some((f) => f.rule === 'I4' && f.sig === `I4|${c.itemId}`)) ctl.push(`CONTROL objects failed:  I4 missed a real case (${c.note})`);
    }
    for (const c of ob.mustStayClean) {
      const g = findingsIn(c).filter((f) => f.rule === 'I4');
      if (g.length) ctl.push(`CONTROL objects failed:  I4 fired on a case that is not one (${c.note}):  ${g[0].detail}`);
    }
    const listed = JSON.parse(JSON.stringify(ob.mustStayClean.find((c) => c.itemId === 'l5-mc-what-the-place-row-records')));
    const own5 = listed.items.find((i) => i.id === listed.itemId).passageId;
    listed.passages.find((q) => q.id === own5).id = 'p-out-of-the-list';
    listed.items.filter((i) => i.passageId === own5).forEach((i) => { i.passageId = 'p-out-of-the-list'; });
    if (!findingsIn(listed).some((f) => f.rule === 'I4')) ctl.push('CONTROL objects failed:  with level 5\'s passage out of the name\'s list, level 5 should fire;  the two-passage list is not what passed it');

    // A clean six-level pack, then one plant per rule.
    const clean = () => {
      const p = { passages: [], figures: [], levels: [], items: [] };
      for (let n = 1; n <= 6; n++) {
        p.passages.push({ id: `p${n}`, text: `Passage ${n}.`, figureIds: [`f${n}`] });
        p.figures.push({ id: `f${n}` });
        p.items.push({ id: `i${n}`, type: 'mc', passageId: `p${n}`, figureId: `f${n}`,
          stem: `Which lamp is lit in room ${n}?`, choices: [`the lamp of room ${n} by the stair`, 'x', 'y', 'z'], key: 0,
          explain: `Room ${n} keeps its own lamp.` });
        p.levels.push({ itemIds: [`i${n}`], reveal: { figureId: `f${n}` } });
      }
      return p;
    };
    const rules = (p) => [...new Set(findingsIn(p).map((f) => f.rule))].sort();
    const plants = [
      ['clean pack', clean(), []],
      ['level 2 item on level 1 passage', (() => { const p = clean(); p.items[1].passageId = 'p1'; return p; })(), ['I1', 'I2']],
      ['level 2 item reads level 1 figure', (() => { const p = clean(); p.items[1].figureId = 'f1'; return p; })(), ['I2']],
      ['level 2 reveal is level 1 figure', (() => { const p = clean(); p.levels[1].reveal.figureId = 'f1'; return p; })(), ['I2']],
      ['level 2 passage strip shows level 1 figure', (() => { const p = clean(); p.passages[1].figureIds = ['f1']; return p; })(), ['I2']],
      ['level 1 explain states level 3 key', (() => { const p = clean(); p.items[0].explain = 'Room 3 keeps the lamp of room 3 by the stair.'; return p; })(), ['I3']],
      ['level 3 explain restates level 1 key (later teaches, does not ask)', (() => { const p = clean(); p.items[2].explain = 'Remember the lamp of room 1 by the stair.'; return p; })(), []],
      ['level 4 explain cites "Tile 3"', (() => { const p = clean(); p.items[3].explain = "Room 4 keeps its own lamp, as Tile 3's drawing showed."; return p; })(), ['I7']],
      ['level 6 rationale counts "two levels earlier"', (() => { const p = clean(); p.items[5].distractorRationale = { 1: 'That lamp was lit two levels earlier.' }; return p; })(), ['I7']],
      ['level 3 explain cites its own "Level 3"', (() => { const p = clean(); p.items[2].explain = 'Level 3 keeps its own lamp in room 3.'; return p; })(), []],
      ['level 2 stem asks about "Level 1"', (() => { const p = clean(); p.items[1].stem = 'Which lamp from Level 1 is lit in room 2?'; return p; })(), ['I4']],
    ];
    for (const [name, p, wantRules] of plants) {
      const g = rules(p);
      if (JSON.stringify(g) !== JSON.stringify(wantRules)) ctl.push(`CONTROL "${name}" failed:  expected ${JSON.stringify(wantRules)}, got ${JSON.stringify(g)}`);
    }
    // The math exemption covers I1 and I2 only:  the same shared passage in a math pack is not a finding.
    const mathTwin = (() => { const p = clean(); p.meta = { subject: 'math' }; p.items[1].passageId = 'p1'; p.items[1].figureId = 'f1'; return p; })();
    if (rules(mathTwin).length) ctl.push(`CONTROL math exemption failed:  got ${JSON.stringify(rules(mathTwin))}`);
    const mathI3 = (() => { const p = clean(); p.meta = { subject: 'math' }; p.items[0].explain = 'Room 3 keeps the lamp of room 3 by the stair.'; return p; })();
    if (JSON.stringify(rules(mathI3)) !== JSON.stringify(['I3'])) ctl.push(`CONTROL math I3 failed:  I3 must still apply to a math pack, got ${JSON.stringify(rules(mathI3))}`);
    // The allowlist excuses its own level only;  a second unexcused level still fails;  an unused entry is stale.
    const two = (() => { const p = clean(); p.items[1].passageId = 'p1'; p.items[2].passageId = 'p1'; return p; })();
    const ff = findingsIn(two).filter((f) => f.rule === 'I1');
    const u1 = new Set();
    const left1 = applyAllow('t', ff, [{ pack: 't', sig: 'I1|p1@L2', reason: 'control' }], u1);
    if (left1.length !== 2 || u1.size !== 1) ctl.push(`CONTROL allowlist failed:  excusing one of three levels left ${left1.length} open (want 2)`);
    const u2 = new Set();
    const left2 = applyAllow('t', ff, [{ pack: 't', sig: 'I1|p1@L2', reason: 'control' }, { pack: 't', sig: 'I1|p1@L3', reason: 'control' }], u2);
    if (left2.length !== 0 || u2.size !== 2) ctl.push(`CONTROL allowlist failed:  excusing two of three levels left ${left2.length} open (want 0)`);
    const u3 = new Set();
    applyAllow('t', findingsIn(clean()), [{ pack: 't', sig: 'I1|p9@L6', reason: 'control' }], u3);
    if (u3.size !== 0) ctl.push('CONTROL stale-allowlist failed:  an entry matching nothing was counted as used');
    if (ctl.length) problems.push(...ctl);
    else console.log('  controls:  Niall\'s case (Vault level 6 on two level-2 passages, verbatim from 02a63cf) is caught;  four real callbacks from 02a63cf fire I4, and a same-level "earlier entry" and a level\'s own word do not;  Outpost level 6 reading level 5\'s fledge-rate chart fires I5, and its fixed text, "plan around" and the catalog photograph do not;  Firsthand level 6 offering Samaria and Vault level 1\'s unnamed "Mila" fire I6, and their fixes, a frame word, a word form and a sentence-initial "If" do not;  the eight feedback texts from 2733c3e that sent a child to another level fire I7 on their own items, and their fixes, "Babylonian" beside its level\'s "Babylon", a level\'s own "different file" and "earlier entry", and two I4 pointers a passage uses about itself do not;  the audit\'s three borrowed story objects (a binder, a phrase, a dome) fire I4, and their fixes and level 5\'s own binder do not;  a level by number or counted back fires, and a level\'s own number does not;  a clean pack passes;  a shared passage, an item figure, a reveal and a passage strip are each caught;  an earlier level stating a key is caught and a later one restating it is not;  a math pack is exempt from I1 and I2 and still held to I3;  the allowlist excuses its own level only and an unused entry is stale  (fired)');
  }

  if (problems.length) {
    console.log(`\n=== sweep-cross-level: ${problems.length} problem(s)  (I1 ${counts.I1}, I2 ${counts.I2}, I3 ${counts.I3}, I4 ${counts.I4}, I5 ${counts.I5}, I6 ${counts.I6}, I7 ${counts.I7}) ===`);
    problems.forEach((p) => console.log('  ' + p));
    console.log('\nRESULT: FAILED');
    process.exit(1);
  }
  console.log('\nRESULT: ALL CLEAN');
}

module.exports = { findingsIn, applyAllow, askedText, titleCore, POINTERS, FEEDBACK_POINTERS, SOURCE_NAMES };

if (require.main === module) main();
