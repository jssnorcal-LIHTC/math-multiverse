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

// Case, curly quotes and whitespace only. Trailing punctuation is NOT stripped, and the earlier
// version that stripped it from BOTH sides was a hole: a label authored as "gate closed?" reduced to
// "gate closed", matched the passage, and the question mark -- a claim the passage does not make --
// went unnoticed in both directions, because part 2 then compared the same stripped needle. A figure
// that adds punctuation the passage does not have is adding a claim.
function norm(s) {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Quantifiers assert scope: "the only stop", "every night", "no other witness". A caption is fed
// verbatim to the blind certifier alongside the dataTable, so a quantifier the passage never uses is
// an inference the figure adds to the record -- precisely the 26-0812 fig-proposals defect, which
// was the single word "only" in a feature table. Legitimate uses are allowed: the test is whether
// the PASSAGE uses the word too.
// Deliberately narrow. It holds the words that assert EXCLUSIVITY or UNIVERSALITY, which is the
// claim a figure cannot make on its own authority. Words like "each", "first" and "any" were tried
// and removed: they fire on ordinary distributive prose ("one column each") and a rule that cries
// wolf gets switched off, which costs more than it catches.
const SCOPE_WORDS = ['only', 'no other', 'never', 'none', 'always', 'every', 'all'];

// What makes a string a statement of ABSENCE rather than an assertion. Used to bind the absences[]
// exemption channel, which without it excused any invented sentence at all.
const NEGATION = /(^|[^a-z])(no|not|never|none|nothing|without|blank|unsigned|missing|empty|left blank|nobody)([^a-z]|$)/;

// Every string a renderer actually DRAWS. The plan's list omitted every string a bar chart draws and
// every time a timeline draws, which would have left the gate checking nothing at all on a chart and
// no time on a timeline while the plan's own text promises "times and numbers must appear as
// written". build/figure-gen.js draws categoryLabels at :583, xLabel at :588, yLabel at :667 and
// notes at :679.
function checkedStrings(dt) {
  const out = [];
  // COERCE, do not skip. The earlier `typeof v === 'string'` guard silently dropped every non-string
  // scalar, and the renderers String()-coerce a cell before drawing it -- so a facsimile row holding
  // the NUMBER 3902 printed "3902" on the canvas while rule 1 never saw it. A number a figure states
  // is a transcription like any other, and a wrong one is the most answerable-looking kind of lie.
  const add = (field, v) => {
    if (v === undefined || v === null || typeof v === 'object') return;
    const s = String(v);
    if (s.trim()) out.push({ field, value: s });
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

// Every text run's box, measured with the SAME model tests/figure-derive.js uses (GLYPH_W for width,
// 0.8/0.25 of the font for ascent and descent). Rotated text is handled rather than ignored: the
// facsimile stamp is drawn inside a <g transform="rotate(...)">, and reading its x/y as if the
// transform were absent measured a real label in the wrong place entirely.
function outOfCanvas(svg) {
  const bad = [];
  const re = /<g\b([^>]*)>([\s\S]*?)<\/g>|<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  const runs = [];
  while ((m = re.exec(svg)) !== null) {
    if (m[3] !== undefined) { runs.push({ attrs: m[3], inner: m[4], rot: null }); continue; }
    const rm = /rotate\(\s*(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s*\)/.exec(m[1] || '');
    const tre = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let t;
    while ((t = tre.exec(m[2])) !== null) {
      runs.push({
        attrs: t[1], inner: t[2],
        rot: rm ? { a: parseFloat(rm[1]) * Math.PI / 180, cx: parseFloat(rm[2]), cy: parseFloat(rm[3]) } : null,
      });
    }
  }
  runs.forEach((r) => {
    const get = (k) => {
      const a = new RegExp('(?:^|\\s)' + k + '="([^"]*)"').exec(r.attrs);
      return a ? a[1] : null;
    };
    const fontSize = parseFloat(get('font-size') || '0');
    if (!fontSize) return;
    const anchor = get('text-anchor') || 'start';
    const x = parseFloat(get('x') || '0');
    const y = parseFloat(get('y') || '0');
    // MEASURE PER LINE, NOT PER ELEMENT. A wrapped label is one <text> holding a <tspan> per line,
    // so the element's collapsed content is every line concatenated. Measuring that as though it
    // were drawn on one line over-reports the width by the number of lines and flags correct
    // figures -- which is how this check first fired on two perfectly well-fitted ones.
    const unesc = (t) => String(t).replace(/<[^>]*>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim();
    const spans = [];
    const sre = /<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g;
    let sm;
    let dy = 0;
    while ((sm = sre.exec(r.inner)) !== null) {
      const sa = sm[1];
      const gx = /(?:^|\s)x="([^"]*)"/.exec(sa);
      const gd = /(?:^|\s)dy="([^"]*)"/.exec(sa);
      dy += gd ? parseFloat(gd[1]) : 0;
      spans.push({ text: unesc(sm[2]), x: gx ? parseFloat(gx[1]) : x, y: y + dy });
    }
    const lines = spans.length ? spans : [{ text: unesc(r.inner), x: x, y: y }];
    lines.forEach((ln) => measureOne(ln.text, ln.x, ln.y, fontSize, anchor, r.rot, bad));
  });
  return bad;
}

function measureOne(plain, x, y, fontSize, anchor, rot, bad) {
  {
    if (!plain) return;
    const w = plain.length * 0.6 * fontSize;
    const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    const box = [[left, y - 0.8 * fontSize], [left + w, y - 0.8 * fontSize],
      [left + w, y + 0.25 * fontSize], [left, y + 0.25 * fontSize]];
    const r = { rot: rot };
    const pts = r.rot
      ? box.map((p) => {
        const dx = p[0] - r.rot.cx, dy = p[1] - r.rot.cy;
        return [r.rot.cx + dx * Math.cos(r.rot.a) - dy * Math.sin(r.rot.a),
          r.rot.cy + dx * Math.sin(r.rot.a) + dy * Math.cos(r.rot.a)];
      })
      : box;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const l = Math.min.apply(null, xs), rgt = Math.max.apply(null, xs);
    const t0 = Math.min.apply(null, ys), b0 = Math.max.apply(null, ys);
    if (l < -0.5 || rgt > 800.5 || t0 < -0.5 || b0 > 450.5) {
      bad.push({ text: plain, why: `x ${l.toFixed(1)}..${rgt.toFixed(1)}, y ${t0.toFixed(1)}..${b0.toFixed(1)}` });
    }
  }
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
  // An absence EXCUSES a drawn string from rule 1, so it is an exemption channel and is capped and
  // bound like one. Uncapped and unbound it voided the whole gate: any invented sentence could be
  // excused by pairing it with a nonsense "absent" string that is trivially missing from the passage.
  // The binding requirement is that the absence be ABOUT the thing it excuses.
  const absences = Array.isArray(dt.absences) ? dt.absences : [];
  if (absences.length > MAX_PARAPHRASE) {
    fail(`${where}: figure "${fig.id}" declares ${absences.length} absence entries; the cap is ${MAX_PARAPHRASE}`);
  }
  absences.forEach((a, i) => {
    if (!a || typeof a.text !== 'string' || typeof a.absent !== 'string' || !a.text.trim() || !a.absent.trim()) {
      fail(`${where}: figure "${fig.id}" absences[${i}] needs a text (what the figure says) and an absent (the phrase that must NOT be in the passage)`);
      return;
    }
    // The binding requirement: the excused string must actually BE a statement of absence. Requiring
    // instead that `absent` be a substring of `text` was tried and was wrong in the honest direction
    // -- "no name is written on the keeper row", justified by the absence of a name that appears
    // nowhere in the passage, is exactly the case this channel exists for. A negation marker is what
    // separates it from "the otter pool is the only stop anyone recorded", which asserts rather than
    // negates and must go through rule 1 like any other claim.
    if (!NEGATION.test(norm(a.text))) {
      fail(`${where}: figure "${fig.id}" absences[${i}] excuses ${JSON.stringify(a.text)}, which states `
        + 'something rather than stating that something is MISSING; the absence channel exempts only '
        + 'a claim about what the record does not contain');
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
    // An excused string is exempt from rule 1 and STILL SUBJECT TO PART 2. Dropping it from `drawn`
    // let an exemption disable the drawn-check too, so a paraphrase or an absence bought silence in
    // both directions at once when it was only ever meant to buy it in one.
    drawn.push(s);
    if (excused.has(norm(s.value))) return;
    checked++;
    if (hay.indexOf(norm(s.value)) === -1) {
      fail(`${where}: figure "${fig.id}" ${s.field} = ${JSON.stringify(s.value)} is not a verbatim substring of passage "${spid}"`);
    }
  });
  if (checked === 0) {
    fail(`${where}: figure "${fig.id}" has no fidelity-checked strings at all; the check on it is vacuous`);
  }

  // The caption and the alt text are NOT transcriptions -- they are written for a reader and may use
  // ordinary connective words. But both are shown to the blind certifier alongside the dataTable, so
  // a claim in a caption can license a key just as a label can. Two mechanical rules, both narrow:
  // every number must come from the passage, and every scope word must be one the passage itself
  // uses. The judgment half stays with the two independent fidelity reviewers.
  ['caption', 'alt'].forEach((field) => {
    const v = fig[field];
    if (typeof v !== 'string' || !v.trim()) return;
    const nv = norm(v);
    (nv.match(/\d[\d:,.]*/g) || []).forEach((num) => {
      const bare = num.replace(/[.,]+$/, '');
      if (hay.indexOf(bare) === -1) {
        fail(`${where}: figure "${fig.id}" ${field} states the number "${bare}", which is not in passage "${spid}"`);
      }
    });
    SCOPE_WORDS.forEach((wd) => {
      const re = new RegExp('(^|[^a-z])' + wd + '([^a-z]|$)');
      if (re.test(nv) && !re.test(hay)) {
        fail(`${where}: figure "${fig.id}" ${field} uses the scope word "${wd}", which passage "${spid}" never uses; `
          + 'a caption that widens or narrows a claim is an inference the record does not carry');
      }
    });
  });

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
    // NO TRUNCATION ESCAPE. There used to be one and it was three defects at once: it scanned EVERY
    // drawn run rather than the one corresponding to the missing label, it accepted a stem of any
    // length (so a single shared character matched), and it was never bound to truncateToWidth at
    // all. One ellipsis anywhere in a figure -- including one transcribed from a passage that trails
    // off -- excused every other label sharing a first character. No renderer in this build
    // truncates: each measures and REFUSES instead. A missing string is now a missing string.
    fail(`${where}: figure "${fig.id}" ${s.field} = ${JSON.stringify(s.value)} is in the dataTable but is NOT drawn in ${fig.src}`);
  });

  // The other half of that rule: an ellipsis in the DRAWING that no authored string carries means
  // something was cut, whoever cut it, and the reader cannot recover it.
  const authored = drawn.map((s) => norm(s.value));
  contents.forEach((c) => {
    if (c.indexOf('…') === -1) return;
    if (authored.some((k) => k.indexOf('…') !== -1 && c.indexOf(k) !== -1)) return;
    fail(`${where}: figure "${fig.id}" draws ${JSON.stringify(c)}, whose ellipsis no authored string carries; `
      + 'a label was cut');
  });

  // ---- mechanical checks on the committed drawing ----
  const root = svg.split('\n')[0] || '';
  if (!/width="800"/.test(root) || !/height="450"/.test(root) || !/viewBox="0 0 800 450"/.test(root) || !/role="img"/.test(root)) {
    fail(`${where}: figure "${fig.id}" src root must carry width, height, viewBox and role="img"; got ${JSON.stringify(root.slice(0, 120))}`);
  }
  const sizes = (svg.match(/font-size="([0-9.]+)"/g) || []).map((s) => parseFloat(/"([0-9.]+)"/.exec(s)[1]));
  // A scan that matches nothing used to read as "no violations". A renderer that moved sizing into
  // a style attribute or a <style> block would then draw every label at 9px and pass.
  if (!sizes.length && contents.length) {
    fail(`${where}: figure "${fig.id}" draws ${contents.length} text run(s) but declares no font-size at all; the floor check cannot see them`);
  }
  const under = sizes.filter((n) => n < FONT_FLOOR);
  if (under.length) {
    fail(`${where}: figure "${fig.id}" draws text below the ${FONT_FLOOR}px authored floor: ${JSON.stringify(under)}`);
  }
  // 'null' joins the literal scan: the timeline printed the word when start was null, and a scan
  // that looks only for 'undefined' and 'NaN' walked straight past it.
  ['undefined', 'NaN', '>null<'].forEach((lit) => {
    if (svg.indexOf(lit) !== -1) {
      fail(`${where}: figure "${fig.id}" renders a literal ${JSON.stringify(lit)} into the drawing`);
    }
  });

  // CANVAS CONTAINMENT, MEASURED ON EVERY SHIPPED FIGURE. tests/figure-docs.test.js measures this
  // too, but only over the eight hand-fitted fixtures -- it never reads packs/ at all -- so no gate
  // measured a figure a reader will actually see. A label past the edge is a data-truth defect: the
  // figure then displays less than its dataTable says. The bbox model is the one
  // tests/figure-derive.js uses, so a figure that passes here cannot fail there.
  outOfCanvas(svg).forEach((b) => {
    fail(`${where}: figure "${fig.id}" draws ${JSON.stringify(b.text)} outside the 800x450 canvas (${b.why})`);
  });
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
  // The sweep's universe is EVERY figure carrying a dataTable, not genTargets(pack). genTargets
  // requires gen === true, so deleting that one boolean removed a figure from this gate and from
  // figure-derive at the same time, while validate-pack still accepted it and blindQuestion still
  // pasted its dataTable in front of the certifier. A figure whose dataTable is read is a figure
  // whose dataTable is checked.
  const figs = (pack.figures || []).filter((f) => f && f.dataTable && typeof f.dataTable === 'object'
    && !Array.isArray(f.dataTable) && f.dataTable.type !== 'features');
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
  // ARMING MUST NOT BE SELF-DISARMING. Keying it on the presence of sourcePassageId meant a pack
  // could opt out of the whole gate by omitting the very field the gate exists to require, and
  // keying it on gen:true meant one deleted boolean removed a figure from this gate AND from
  // figure-derive while validate-pack still accepted it and the blind pass still read its dataTable.
  // Subject is the fact that cannot be edited away without changing what the pack IS: a reading pack
  // is a pack of passages, and a figure in one illustrates a passage or it does not belong there.
  const isEla = pack.meta && pack.meta.subject === 'ela';
  const armed = isEla || withSpid.length > 0 || docFigs.length > 0;
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
  // Look up, guard, THEN deep-copy: JSON.stringify(undefined) returns undefined and JSON.parse then
  // throws SyntaxError, so the guard below used to be unreachable and a renamed fixture would have
  // surfaced as a harness error rather than the named failure it is.
  const srcFig = pack.figures.find((f) => f.id === 'fig-route-loop');
  if (!srcFig) { fail('control 2 (negative): fixture figure fig-route-loop is missing'); return; }
  const fig = JSON.parse(JSON.stringify(srcFig));
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
  const srcItem = (pack.items || []).find((i) => i.figureId === 'fig-facsimile-columns');
  if (!realFig || !srcItem) { fail('control 2 (negative): no fixture item is keyed to fig-facsimile-columns'); return; }
  const item = JSON.parse(JSON.stringify(srcItem));
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
