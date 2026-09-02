'use strict';
// figure-fidelity.js -- proves a generated figure says only what its passage says, and that every
// item keyed to a figure is licensed by that figure's own dataTable.
//
// WHY THIS GATE EXISTS, AND WHY THE OTHER TWO CANNOT DO ITS JOB.
// tests/figure-derive.js proves REPRODUCIBILITY: a figure regenerates byte-identically from its own
// dataTable. tests/blind-reanswer.js proves a key is UNAMBIGUOUS given what the model was shown --
// and what it is shown IS the dataTable, so it verifies the item against the table rather than the
// table against the passage. Neither can see a dataTable that states something the passage never
// said. That is not hypothetical: on 26-0812 fig-proposals' feature table asserted "Proposal C is
// the only one whose column is filled for every test", an inference, and false, and the blind pass
// returned a confident AGREE on an item keyed to it (tasks/lessons.md:40-41). Transcription is the
// control, and this file is the check on the transcription.
//
// THE NORMALISATION, stated so an author can predict a pass without running the gate. Both sides are
// lower-cased, curly quotes are straightened to their ASCII forms, all whitespace runs collapse to a
// single space, and TRAILING punctuation is dropped. Nothing else is touched: an interior comma,
// parenthesis or dash is compared as written, so "lot 3902 (front freezer)" does NOT match a passage
// that says "lot 3902, front freezer". Transcribe, do not summarise.
//
// ARMING IS PER PACK, and the reasoning matters. Arming per FIGURE (on the presence of
// dataTable.sourcePassageId) lets any single figure opt out of the whole gate by omitting one field,
// which is the silent-clean shape constraint 12 forbids. Requiring the field on every generated
// figure in the repo is also wrong: packs/cpm-cc1-g6.json and packs/outpost-protocol-g6.json ship
// eight generated charts between them whose figures are built from lesson data rather than from a
// passage, and reddening them would say nothing true. So: a pack ARMS when any generated figure in
// it carries sourcePassageId, and once armed EVERY generated figure in that pack must carry one.
// A pack carrying any DOCUMENT-type figure (timeline, facsimile, schematic, route) is armed
// unconditionally, because those renderers exist only to draw a passage.
//
// PART 2 IS THE ANTI-TAUTOLOGY HALF. W0.1 generates the fixtures from the renderers and W0.2
// byte-compares against those same renderers, so a renderer that silently DROPS a label passes both
// green. Part 2 reads the COMMITTED SVG and requires every checked string to be present in it as
// drawn text. It is the only check in the program whose two sides have independent origins.

const fs = require('fs');
const path = require('path');
const { stableStringify } = require('./verdicts.js');
const { genTargets } = require('../build/figure-gen.js');
const { FONT_FLOOR, truncateToWidth } = require('../build/figure-tokens.js');

const REPO_ROOT = path.join(__dirname, '..');
const PACK_DIR = path.join(REPO_ROOT, 'packs');
const DOC_FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'figure-docs');
const DOC_TYPES = ['timeline', 'facsimile', 'schematic', 'route'];
const MAX_PARAPHRASE = 3;

const problems = [];
const note = (m) => console.log('  ' + m);
function fail(m) { problems.push(m); }

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// =====================================================================================================
// normalisation and string extraction
// =====================================================================================================

function norm(s) {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

// Every string a renderer actually DRAWS. The plan's list omitted every string a bar chart draws and
// every time a timeline draws, which would have left the gate checking nothing at all on a chart and
// no time on a timeline while the plan's own text promises "times and numbers must appear as
// written". build/figure-gen.js draws categoryLabels at :583, xLabel at :588, yLabel at :667 and
// notes at :679.
function checkedStrings(dt) {
  const out = [];
  const add = (field, v) => {
    if (typeof v === 'string' && v.trim()) out.push({ field, value: v });
  };
  add('title', dt.title);
  add('start', dt.start);
  add('end', dt.end);
  (dt.tracks || []).forEach((t, i) => add(`tracks[${i}]`, t));
  (dt.events || []).forEach((e, i) => { add(`events[${i}].t`, e && e.t); add(`events[${i}].label`, e && e.label); });
  (dt.gaps || []).forEach((g, i) => {
    add(`gaps[${i}].from`, g && g.from); add(`gaps[${i}].to`, g && g.to); add(`gaps[${i}].label`, g && g.label);
  });
  (dt.header || []).forEach((h, i) => { add(`header[${i}].label`, h && h.label); add(`header[${i}].value`, h && h.value); });
  (dt.lines || []).forEach((l, i) => add(`lines[${i}].text`, l && l.text));
  (dt.columns || []).forEach((c, i) => {
    add(`columns[${i}].heading`, c && c.heading);
    ((c && c.rows) || []).forEach((r, j) => add(`columns[${i}].rows[${j}]`, r));
  });
  add('stamp', dt.stamp);
  (dt.nodes || []).forEach((n, i) => add(`nodes[${i}].label`, n && n.label));
  (dt.edges || []).forEach((e, i) => add(`edges[${i}].label`, e && e.label));
  (dt.stops || []).forEach((s, i) => { add(`stops[${i}].label`, s && s.label); add(`stops[${i}].note`, s && s.note); });
  (dt.categoryLabels || []).forEach((c, i) => add(`categoryLabels[${i}]`, c));
  add('xLabel', dt.xLabel);
  add('yLabel', dt.yLabel);
  (dt.notes || []).forEach((n, i) => add(`notes[${i}]`, n));
  (dt.series || []).forEach((s, i) => add(`series[${i}].label`, s && s.label));
  return out;
}

// The collapsed text content of each <text> element, tspans folded in. A label wrapped across two
// tspans inside ONE text element is still that label; split across two <text> elements it is not,
// which is why the renderers wrap with tspans.
function textContents(svg) {
  const out = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg)) !== null) {
    out.push(String(m[1])
      .replace(/<[^>]*>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim());
  }
  return out;
}

// For rule 2(b): the text an item's KEY actually points at.
function keyedTextOf(item) {
  const key = require('./verdicts.js').authoredKeyOf(item);
  if (item.type === 'mc' && Number.isInteger(key) && Array.isArray(item.choices)) {
    return String(item.choices[key] === undefined ? '' : item.choices[key]);
  }
  if (item.type === 'ms' && Array.isArray(key) && Array.isArray(item.choices)) {
    return key.map((i) => String(item.choices[i] === undefined ? '' : item.choices[i])).join(' ');
  }
  // order, match and cloze key positions rather than prose, so the stem is where the licensing
  // fact has to be visible to a reader.
  return String(item.stem || '');
}

// =====================================================================================================
// the three rules, plus part 2, for ONE figure
// =====================================================================================================

function checkFigure(where, fig, passages, itemsByFigure, packDir) {
  const dt = fig.dataTable;
  const spid = dt.sourcePassageId;

  // ---- rule 3: the figure names a passage in its own pack, and is read beside it ----
  if (typeof spid !== 'string' || !spid) {
    fail(`${where}: generated figure "${fig.id}" has no dataTable.sourcePassageId, but its pack is armed for fidelity`);
    return;
  }
  const passage = passages.get(spid);
  if (!passage) {
    fail(`${where}: figure "${fig.id}" names sourcePassageId "${spid}", which is not a passage in this pack`);
    return;
  }
  const listed = Array.isArray(passage.figureIds) && passage.figureIds.indexOf(fig.id) !== -1;
  const usedByItem = (itemsByFigure.get(fig.id) || []).some((it) => it.passageId === spid);
  if (!listed && !usedByItem) {
    fail(`${where}: figure "${fig.id}" illustrates passage "${spid}", but that passage does not list it in figureIds and no item on that passage uses it; it is an orphan`);
  }

  const hay = norm(passage.text || '');

  // ---- the two exemption channels ----
  const paraphrase = Array.isArray(dt.paraphrase) ? dt.paraphrase : [];
  if (paraphrase.length > MAX_PARAPHRASE) {
    fail(`${where}: figure "${fig.id}" declares ${paraphrase.length} paraphrase entries; the cap is ${MAX_PARAPHRASE}`);
  }
  const excused = new Set();
  paraphrase.forEach((p, i) => {
    if (!p || typeof p.text !== 'string' || typeof p.reason !== 'string' || !p.reason.trim()) {
      fail(`${where}: figure "${fig.id}" paraphrase[${i}] needs both a text and a reason`);
      return;
    }
    excused.add(norm(p.text));
    note(`${where}: figure "${fig.id}" PARAPHRASE ${JSON.stringify(p.text)} -- ${p.reason}`);
  });

  // An absence is a statement about what the passage does NOT contain, so it gets the INVERSE test:
  // the named thing must be missing from the passage. An absence that is actually present is a
  // figure telling the reader something false.
  const absences = Array.isArray(dt.absences) ? dt.absences : [];
  absences.forEach((a, i) => {
    if (!a || typeof a.text !== 'string' || typeof a.absent !== 'string') {
      fail(`${where}: figure "${fig.id}" absences[${i}] needs a text (what the figure says) and an absent (the phrase that must NOT be in the passage)`);
      return;
    }
    excused.add(norm(a.text));
    if (hay.indexOf(norm(a.absent)) !== -1) {
      fail(`${where}: figure "${fig.id}" absences[${i}] claims "${a.absent}" is absent from passage "${spid}", but the passage contains it`);
    } else {
      note(`${where}: figure "${fig.id}" ABSENCE confirmed -- "${a.absent}" is not in "${spid}"`);
    }
  });

  // ---- rule 1: every drawn string is verbatim in the passage ----
  const strings = checkedStrings(dt);
  let checked = 0;
  const drawn = [];
  strings.forEach((s) => {
    if (excused.has(norm(s.value))) return;
    checked++;
    drawn.push(s);
    if (hay.indexOf(norm(s.value)) === -1) {
      fail(`${where}: figure "${fig.id}" ${s.field} = ${JSON.stringify(s.value)} is not a verbatim substring of passage "${spid}"`);
    }
  });
  if (checked === 0) {
    fail(`${where}: figure "${fig.id}" has no fidelity-checked strings at all; the check on it is vacuous`);
  }

  // ---- part 2: the committed drawing actually carries what the table says ----
  const srcAbs = path.join(REPO_ROOT, fig.src || '');
  if (!fig.src || !fs.existsSync(srcAbs)) {
    fail(`${where}: figure "${fig.id}" declares src ${JSON.stringify(fig.src)}, which is not on disk, so the drawing cannot be checked against its table`);
    return { checked };
  }
  const svg = fs.readFileSync(srcAbs, 'utf8');
  const contents = textContents(svg).map(norm);
  drawn.forEach((s) => {
    const want = norm(s.value);
    if (contents.some((c) => c.indexOf(want) !== -1)) return;
    // A renderer is allowed to truncate when nothing else fits, but only visibly, and only exactly
    // as truncateToWidth declares it. Anything else is a label the reader never sees.
    const isTruncation = contents.some((c) => {
      if (c.indexOf('…') === -1) return false;
      const stem = c.slice(0, c.indexOf('…')).trim();
      return stem.length > 0 && want.indexOf(stem) === 0;
    });
    if (!isTruncation) {
      fail(`${where}: figure "${fig.id}" ${s.field} = ${JSON.stringify(s.value)} is in the dataTable but is NOT drawn in ${fig.src}`);
    } else {
      note(`${where}: figure "${fig.id}" ${s.field} is drawn TRUNCATED; shorten the transcription if the reader needs it whole`);
    }
  });

  // ---- mechanical checks on the committed drawing ----
  const root = svg.split('\n')[0] || '';
  if (!/width="800"/.test(root) || !/height="450"/.test(root) || !/viewBox="0 0 800 450"/.test(root) || !/role="img"/.test(root)) {
    fail(`${where}: figure "${fig.id}" src root must carry width, height, viewBox and role="img"; got ${JSON.stringify(root.slice(0, 120))}`);
  }
  const sizes = (svg.match(/font-size="([0-9.]+)"/g) || []).map((s) => parseFloat(/"([0-9.]+)"/.exec(s)[1]));
  const under = sizes.filter((n) => n < FONT_FLOOR);
  if (under.length) {
    fail(`${where}: figure "${fig.id}" draws text below the ${FONT_FLOOR}px authored floor: ${JSON.stringify(under)}`);
  }
  if (svg.indexOf('undefined') !== -1 || svg.indexOf('NaN') !== -1) {
    fail(`${where}: figure "${fig.id}" renders a literal "undefined" or "NaN"`);
  }
  return { checked };
}

// =====================================================================================================
// rule 2: every item keyed to a figure is licensed by that figure's own table
// =====================================================================================================

function checkItemLicence(where, item, fig) {
  const ff = item.figureFact;
  if (typeof ff !== 'string' || !ff.trim()) {
    fail(`${where}: item "${item.id}" carries figureId "${item.figureId}" but no figureFact; its key cannot be traced to the table the blind pass is shown`);
    return;
  }
  const table = stableStringify(fig.dataTable);
  if (table.indexOf(ff) === -1) {
    fail(`${where}: item "${item.id}" figureFact ${JSON.stringify(ff)} is not a verbatim substring of figure "${fig.id}"'s dataTable`);
  }
  const keyed = norm(keyedTextOf(item));
  const stem = norm(item.stem || '');
  const n = norm(ff);
  if (keyed.indexOf(n) === -1 && stem.indexOf(n) === -1) {
    fail(`${where}: item "${item.id}" figureFact ${JSON.stringify(ff)} appears in neither its keyed answer nor its stem, so it does not license the key`);
  }
}

// =====================================================================================================
// sweep
// =====================================================================================================

function sweepPack(packPath, label) {
  const pack = loadJson(packPath);
  const packDir = path.dirname(packPath);
  const figs = genTargets(pack);
  const passages = new Map((pack.passages || []).map((p) => [p.id, p]));
  const figById = new Map((pack.figures || []).map((f) => [f.id, f]));
  const itemsByFigure = new Map();
  (pack.items || []).forEach((it) => {
    if (!it.figureId) return;
    if (!itemsByFigure.has(it.figureId)) itemsByFigure.set(it.figureId, []);
    itemsByFigure.get(it.figureId).push(it);
  });

  const withSpid = figs.filter((f) => f.dataTable && typeof f.dataTable.sourcePassageId === 'string');
  const docFigs = figs.filter((f) => f.dataTable && DOC_TYPES.indexOf(f.dataTable.type) !== -1);
  const armed = withSpid.length > 0 || docFigs.length > 0;
  if (!armed) return { armed: false, figures: 0, byType: {} };

  const byType = {};
  figs.forEach((f) => {
    const t = (f.dataTable && Array.isArray(f.dataTable.panels)) ? 'panels' : (f.dataTable && f.dataTable.type);
    byType[t] = (byType[t] || 0) + 1;
    checkFigure(label, f, passages, itemsByFigure, packDir);
  });

  let licences = 0;
  (pack.items || []).forEach((it) => {
    if (!it.figureId) return;
    const fig = figById.get(it.figureId);
    if (!fig) {
      fail(`${label}: item "${it.id}" names figureId "${it.figureId}", which is not a figure in this pack`);
      return;
    }
    // Only generated, passage-sourced figures are in this gate's scope; a hand-authored figure has
    // no dataTable this gate can license against.
    if (!fig.dataTable || !fig.dataTable.sourcePassageId) return;
    licences++;
    checkItemLicence(label, it, fig);
  });

  return { armed: true, figures: figs.length, byType, licences };
}

// =====================================================================================================
// controls
// =====================================================================================================

function controlPositive() {
  const packPath = path.join(DOC_FIXTURE_DIR, 'pack.json');
  if (!fs.existsSync(packPath)) {
    fail('control 1 (positive): tests/fixtures/figure-docs/pack.json is missing; the gate has no positive control');
    return;
  }
  const before = problems.length;
  const res = sweepPack(packPath, 'control 1 (positive, tests/fixtures/figure-docs)');
  if (!res.armed) {
    fail('control 1 (positive): the fixture pack did not arm, so it proves nothing');
    return;
  }
  // Per-TYPE, never a global compared-count: a control that reached only one renderer proves only
  // that renderer.
  DOC_TYPES.forEach((t) => {
    if (!res.byType[t]) fail(`control 1 (positive): no fixture figure of type "${t}" was reached; that renderer has no positive control`);
  });
  // Rule 2 is half this gate, and it is reached only through items. With none, the licensing half
  // passes by never running -- the same vacuum the per-type assertion above closes for rule 1.
  if (!res.licences) {
    fail('control 1 (positive): the fixture pack has no item carrying a figureId, so rule 2 (item licensing) never ran and proves nothing');
  }
  if (problems.length === before) {
    note(`control 1 (positive): ${res.figures} fixture figures pass every rule (${JSON.stringify(res.byType)}), `
      + `and ${res.licences} item licence(s) check out`);
  }
}

function controlNegative() {
  const pack = loadJson(path.join(DOC_FIXTURE_DIR, 'pack.json'));
  const passages = new Map((pack.passages || []).map((p) => [p.id, p]));
  const fig = JSON.parse(JSON.stringify(pack.figures.find((f) => f.id === 'fig-route-loop')));
  if (!fig) { fail('control 2 (negative): fixture figure fig-route-loop is missing'); return; }
  fig.dataTable.stops[0].label = 'a heron on the boardwalk';   // never in that passage
  const before = problems.length;
  checkFigure('control 2 (negative)', fig, passages, new Map(), DOC_FIXTURE_DIR);
  const raised = problems.slice(before);
  const named = raised.filter((p) => p.indexOf('stops[0].label') !== -1 && p.indexOf('a heron on the boardwalk') !== -1);
  problems.length = before;   // the control's own failures are expected; do not report them as defects
  if (!named.length) {
    fail('control 2 (negative): a label that is NOT in its passage was accepted; rule 1 cannot be trusted');
  } else {
    note('control 2 (negative): an invented label was rejected by name -- rule 1 fired');
  }

  // The same control for the OTHER half of the gate. Rule 2 is what stops an item being keyed to
  // something its figure never says, which is the failure the blind ledger structurally cannot see.
  const realFig = pack.figures.find((f) => f.id === 'fig-facsimile-columns');
  const item = JSON.parse(JSON.stringify((pack.items || []).find((i) => i.figureId === 'fig-facsimile-columns')));
  if (!item) { fail('control 2 (negative): no fixture item is keyed to fig-facsimile-columns'); return; }
  const b2 = problems.length;
  item.figureFact = 'the otter pool';   // real words, but not in THAT figure's table
  checkItemLicence('control 2 (negative)', item, realFig);
  const raised2 = problems.slice(b2);
  problems.length = b2;
  if (!raised2.some((p) => p.indexOf('the otter pool') !== -1)) {
    fail('control 2 (negative): a figureFact absent from the figure\'s own dataTable was accepted; rule 2 cannot be trusted');
  } else {
    note('control 2 (negative): an unlicensed figureFact was rejected by name -- rule 2 fired');
  }
}

// The defect that actually shipped, replayed against the passage it was written for. A control built
// by mutating today's clean data proves the checker rejects SOMETHING; replaying a real past defect
// proves it rejects THAT.
function controlReplay() {
  const packPath = path.join(PACK_DIR, 'outpost-protocol-g6.json');
  if (!fs.existsSync(packPath)) { fail('control 3 (replay): outpost-protocol-g6.json is missing'); return; }
  const pack = loadJson(packPath);
  const passage = (pack.passages || []).find((p) => p.id === 'p-final-deployment-proposals');
  if (!passage) { fail('control 3 (replay): passage p-final-deployment-proposals is missing'); return; }
  const SHIPPED_DEFECT = 'Proposal C is the only one whose column is filled for every test';
  const hay = norm(passage.text || '');
  if (hay.indexOf(norm(SHIPPED_DEFECT)) === -1) {
    note('control 3 (replay): the 26-0812 fig-proposals line is correctly rejected as not verbatim in '
      + 'p-final-deployment-proposals -- the summary the blind pass agreed with would not pass this gate');
  } else {
    fail('control 3 (replay): the 26-0812 fig-proposals summary reads as verbatim in its own passage; '
      + 'the normalisation is too loose to catch the defect this gate exists for');
  }
}

// =====================================================================================================
// main
// =====================================================================================================

console.log('figure fidelity: every generated figure label verbatim in its passage, every keyed item licensed by its table');

let harnessError = null;
const armedPacks = [];
try {
  const files = fs.readdirSync(PACK_DIR).filter((f) => f.endsWith('.json')
    && !f.endsWith('.verdicts.json') && f !== 'manifest.json' && f !== 'curriculum-cc1.json');
  for (const f of files) {
    const res = sweepPack(path.join(PACK_DIR, f), f);
    if (res.armed) {
      armedPacks.push(f);
      note(`${f}: ARMED, ${res.figures} generated figure(s) ${JSON.stringify(res.byType)}`);
    }
  }
} catch (e) {
  harnessError = e;
}

if (!harnessError && !armedPacks.length) {
  console.log('\nfigure-fidelity: NOT ARMED (no shipped pack declares a generated figure sourced to a passage); '
    + 'the three controls ran on fixtures anyway\n');
}

try {
  controlPositive();
  controlNegative();
  controlReplay();
} catch (e) {
  if (!harnessError) harnessError = e;
}

console.log(`\n=== figure-fidelity: ${problems.length} problem(s) ===`);
if (problems.length) problems.forEach((p) => console.log('  ' + p));
if (harnessError) {
  console.error('\nfigure-fidelity: harness error: ' + (harnessError.stack || harnessError));
  console.log('\nRESULT: HARNESS ERROR');
  process.exit(2);
}
if (problems.length) {
  console.log('\nRESULT: FAILED');
  process.exit(1);
}
console.log('\nRESULT: ALL CLEAN');
process.exit(0);
