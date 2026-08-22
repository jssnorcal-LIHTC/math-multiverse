'use strict';
// validate-pack.js -- the content gate for authored packs.
//
// Math content is verified by an independent arithmetic oracle (tests/oracles.js). There is no
// oracle for "which line best supports the claim," so authored content is gated by structural
// validation, content validation, and a committed blind re-answer ledger instead. A pack that
// fails any check does not ship.
//
//   node tests/validate-pack.js                    validate every pack in packs/
//   node tests/validate-pack.js packs/ela-g6-spy.json
//
// HARD RULE (k8s-thinking): finding no packs is a FAILURE, never a silent pass. A validator that
// validates nothing must never report clean.

const fs = require('fs');
const path = require('path');
const { isTarget, TARGETS } = require('./targets');
const { fleschKincaid, colemanLiau, textStats } = require('./readability');
const { COACH_FAMILIES } = require('./targets');
const { validateLedger, authoredKeyOf } = require('./verdicts');

const PACK_DIR  = path.join(__dirname, '..', 'packs');
const REPO_ROOT = path.join(__dirname, '..');

const ITEM_TYPES   = Object.freeze(['mc', 'ms', 'ebsr', 'hottext', 'match', 'order', 'cloze', 'shorttext', 'listen', 'write']);
const AUTO_TYPES   = Object.freeze(['mc', 'ms', 'ebsr', 'hottext', 'match', 'order', 'cloze', 'shorttext']);
const CHOICE_TYPES = Object.freeze(['mc', 'ms', 'ebsr', 'cloze']);
const GENRES       = Object.freeze(['literary', 'informational']);

// Copied by VALUE from engine/figures.js -- validate-pack must not require engine files (it runs
// under plain node, with no DOM and no runner). The twin cross-check test in tests/figures.test.js
// imports both copies and asserts deepStrictEqual, so this pair cannot drift apart silently.
const FIG_KINDS = Object.freeze(['photo', 'plate', 'map', 'diagram', 'chart']);
const DOC_KINDS = Object.freeze(['case-file', 'recovered-entry', 'source-desk', 'addendum',
  'field-manual', 'status-log', 'weather-log', 'field-report', 'procedure', 'memo', 'minutes']);

function loadPackFile(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`${path.basename(absPath)}: invalid JSON: ${e.message}`); }
}

function nonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

// The "is this a plain, non-null, non-array object" test recurs everywhere a JSON field is
// supposed to be a map/record rather than a list or a scalar (a chart's dataTable, an assessed
// figure's dataTable). Named once so every site reads the same intent instead of re-deriving it.
function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// ---------- envelope: meta ----------
function checkMeta(pack, errors, expectedId) {
  const m = pack.meta;
  if (!m || typeof m !== 'object') { errors.push('meta: missing or not an object'); return; }
  for (const k of ['id', 'subject', 'title']) {
    if (!nonEmptyString(m[k])) errors.push(`meta.${k}: missing or empty`);
  }
  if (!Number.isInteger(m.grade)) errors.push(`meta.grade: must be an integer, got ${JSON.stringify(m.grade)}`);
  if (!Number.isInteger(m.version)) errors.push(`meta.version: must be an integer, got ${JSON.stringify(m.version)}`);
  if (nonEmptyString(m.subject) && !/^[a-z]+$/.test(m.subject)) {
    errors.push(`meta.subject: must be a lowercase slug, got "${m.subject}"`);
  }
  if (nonEmptyString(m.id) && expectedId && m.id !== expectedId) {
    errors.push(`meta.id: "${m.id}" does not match filename "${expectedId}"`);
  }
}

// ---------- envelope: passages ----------
function checkPassages(pack, errors) {
  const list = pack.passages;
  if (!Array.isArray(list)) { errors.push('passages: missing or not an array'); return new Map(); }
  const byId = new Map();
  list.forEach((p, i) => {
    const where = `passages[${i}]`;
    if (!p || typeof p !== 'object') { errors.push(`${where}: not an object`); return; }
    if (!nonEmptyString(p.id)) { errors.push(`${where}.id: missing or empty`); return; }
    if (byId.has(p.id)) errors.push(`${where}: duplicate passage id "${p.id}"`);
    else byId.set(p.id, p);
    if (!nonEmptyString(p.title))  errors.push(`${where}(${p.id}).title: missing or empty`);
    if (!nonEmptyString(p.text))   errors.push(`${where}(${p.id}).text: missing or empty`);
    if (!nonEmptyString(p.source)) errors.push(`${where}(${p.id}).source: missing (use "original" for authored text)`);
    if (!GENRES.includes(p.genre)) errors.push(`${where}(${p.id}).genre: must be one of ${GENRES.join(', ')}, got ${JSON.stringify(p.genre)}`);
  });
  return byId;
}

// ---------- envelope: items ----------
function checkItemEnvelope(pack, passagesById, errors) {
  const list = pack.items;
  if (!Array.isArray(list)) { errors.push('items: missing or not an array'); return new Map(); }
  const byId = new Map();
  list.forEach((it, i) => {
    const where = `items[${i}]`;
    if (!it || typeof it !== 'object') { errors.push(`${where}: not an object`); return; }
    if (!nonEmptyString(it.id)) { errors.push(`${where}.id: missing or empty`); return; }
    const w = `items(${it.id})`;
    if (byId.has(it.id)) errors.push(`${where}: duplicate item id "${it.id}"`);
    else byId.set(it.id, it);

    if (!ITEM_TYPES.includes(it.type)) {
      errors.push(`${w}.type: must be one of ${ITEM_TYPES.join(', ')}, got ${JSON.stringify(it.type)}`);
    }
    if (it.passageId !== undefined && !passagesById.has(it.passageId)) {
      errors.push(`${w}.passageId: "${it.passageId}" does not resolve to any passage`);
    }
    if (!Array.isArray(it.targets) || it.targets.length === 0) {
      errors.push(`${w}.targets: must be a non-empty array of target ids`);
    } else {
      for (const t of it.targets) {
        if (!isTarget(t)) errors.push(`${w}.targets: "${t}" is not a known target id (see tests/targets.js)`);
      }
    }
    if (!nonEmptyString(it.coachTopic)) errors.push(`${w}.coachTopic: missing or empty`);
    if (it.dok !== undefined && ![1, 2, 3, 4].includes(it.dok)) {
      errors.push(`${w}.dok: must be 1, 2, 3 or 4 when present, got ${JSON.stringify(it.dok)}`);
    }
  });
  return byId;
}

// ---------- envelope: items and levels cite only their own subject's targets ----------
// Both subjects share one target id namespace (tests/targets.js), so isTarget's membership check
// alone cannot catch an ELA pack citing a science target or vice versa -- the id is legal, just
// borrowed from the wrong subject. ELA target entries carry no explicit `subject` field (they
// predate the science namespace), so an absent field defaults to 'ela' here, matching every
// existing pack's meta.subject and leaving the ELA entries themselves untouched.
//
// isTarget itself is checked against BOTH item.targets (checkItemEnvelope) and level.targets
// (checkLevels), so this honesty check follows the same two surfaces -- a level citing a
// cross-subject target is exactly as real a leak as an item doing it, and checking only items
// would let it sneak through the one place isTarget's own coverage says it must not.
function checkTargetSubjects(pack, itemsById, errors) {
  const packSubject = pack.meta && pack.meta.subject;
  if (!nonEmptyString(packSubject)) return;   // meta.subject itself already reported by checkMeta

  for (const it of itemsById.values()) {
    if (!Array.isArray(it.targets)) continue;
    for (const t of it.targets) {
      if (!isTarget(t)) continue;             // invented id already reported by checkItemEnvelope
      const targetSubject = TARGETS[t].subject || 'ela';
      if (targetSubject !== packSubject) {
        errors.push(`items(${it.id}).targets: "${t}" belongs to subject "${targetSubject}", but this pack's subject is "${packSubject}"`);
      }
    }
  }

  if (Array.isArray(pack.levels)) {
    pack.levels.forEach((lv, i) => {
      if (!lv || !Array.isArray(lv.targets)) return;
      for (const t of lv.targets) {
        if (!isTarget(t)) continue;           // invented id already reported by checkLevels
        const targetSubject = TARGETS[t].subject || 'ela';
        if (targetSubject !== packSubject) {
          errors.push(`levels[${i}](${lv.name || '?'}).targets: "${t}" belongs to subject "${targetSubject}", but this pack's subject is "${packSubject}"`);
        }
      }
    });
  }
}

// ---------- envelope: levels ----------
function checkLevels(pack, itemsById, errors, warnings) {
  // Validated independent of pack.levels' own validity, so a broken levels array does not mask
  // a broken pack-root repeatPolicy (or vice versa).
  if (pack.repeatPolicy !== undefined && !['rotate', 'free'].includes(pack.repeatPolicy)) {
    errors.push(`repeatPolicy: must be "rotate" or "free", got ${JSON.stringify(pack.repeatPolicy)}`);
  }
  const list = pack.levels;
  if (!Array.isArray(list) || list.length === 0) { errors.push('levels: missing or empty'); return new Set(); }
  const referenced = new Set();
  list.forEach((lv, i) => {
    const where = `levels[${i}]`;
    if (!lv || typeof lv !== 'object') { errors.push(`${where}: not an object`); return; }
    if (!Number.isInteger(lv.id))     errors.push(`${where}.id: must be an integer`);
    if (!nonEmptyString(lv.name))     errors.push(`${where}.name: missing or empty`);
    if (!nonEmptyString(lv.goal))     errors.push(`${where}.goal: missing or empty`);
    if (!Array.isArray(lv.targets) || lv.targets.length === 0) {
      errors.push(`${where}.targets: must be a non-empty array`);
    } else {
      for (const t of lv.targets) {
        if (!isTarget(t)) errors.push(`${where}.targets: "${t}" is not a known target id`);
      }
    }
    if (!Array.isArray(lv.itemIds) || lv.itemIds.length === 0) {
      errors.push(`${where}.itemIds: must be a non-empty array`);
      return;
    }
    // A repeated id here is an authoring slip that nothing downstream catches: pickItems draws from this
    // list without deduping, so the child is simply asked the same question twice inside one level.
    const dupes = lv.itemIds.filter((id, i) => lv.itemIds.indexOf(id) !== i);
    if (dupes.length) {
      errors.push(`${where}.itemIds: lists ${JSON.stringify([...new Set(dupes)])} more than once; a level may not ask the same item twice`);
    }
    for (const id of lv.itemIds) {
      if (!itemsById.has(id)) errors.push(`${where}.itemIds: "${id}" does not resolve to any item`);
      else referenced.add(id);
    }
    if (!Number.isInteger(lv.questions) || lv.questions < 1) {
      errors.push(`${where}.questions: must be a positive integer`);
    } else if (lv.questions > lv.itemIds.length) {
      errors.push(`${where}.questions: asks for ${lv.questions} but the level only has ${lv.itemIds.length} item(s)`);
    }
    if (lv.repeatPolicy !== undefined && !['rotate', 'free'].includes(lv.repeatPolicy)) {
      errors.push(`level "${lv.name}": repeatPolicy must be "rotate" or "free"`);
    }
    // Fresh-profile first runs are the authored list verbatim: MVFresh.orderPool stable-sorts with
    // every unseen id tied, and pickItems shuffles presentation order only, so a new profile is
    // served itemIds[0..questions-1] exactly. Under the effective rotate policy the front of the
    // list must therefore cover every item type the level carries (capped at questions), or whole
    // item types stay hidden until replays.
    const effectivePolicy = lv.repeatPolicy !== undefined ? lv.repeatPolicy
      : (pack.repeatPolicy !== undefined ? pack.repeatPolicy : 'rotate');
    if (effectivePolicy === 'rotate'
        && Number.isInteger(lv.questions) && lv.questions >= 1 && lv.questions <= lv.itemIds.length
        && lv.itemIds.every(id => itemsById.has(id))) {
      const poolTypes = new Set(lv.itemIds.map(id => itemsById.get(id).type));
      const served = new Set(lv.itemIds.slice(0, lv.questions).map(id => itemsById.get(id).type));
      const need = Math.min(lv.questions, poolTypes.size);
      if (served.size < need) {
        const missing = [...poolTypes].filter(t => !served.has(t));
        errors.push(`${where}.itemIds: the first ${lv.questions} ids cover ${served.size} of ${poolTypes.size} item types (missing: ${missing.join(', ')}); a fresh profile is served this slice verbatim, so interleave the list until the first ${lv.questions} cover every type the level carries`);
      }
    }
  });
  for (const id of itemsById.keys()) {
    if (!referenced.has(id)) warnings.push(`items(${id}): not referenced by any level (orphan)`);
  }
  return referenced;
}

// ---------- envelope: figures ----------
// A brand-new optional envelope (no shipped pack declares one yet): a strip of illustrative or
// assessed media a passage, level reveal, or item can point at. Validated the same way as
// passages/items above -- structural rules here, independent of who references what; resolution
// of the references themselves is checkFigureReferences below.

// Shared by both a figure's own `src` and a plate figure's per-view `src`/`overlaySrc`. `packId`
// is resolved once by the caller (checkFigures) and is null only when neither source was
// available; requirePrefix && packId therefore already skips the prefix half safely in that case
// (checkFigures pushes its own explicit error for the missing-packId condition itself, once, so
// this does not need to repeat it per src). `assetBase` defaults to 'art' (the real, public,
// GitHub-Pages-served tree); tests point it at tests/fixtures so the existsSync/prefix/case checks
// below run against real fixture files that live outside that public tree. main() never overrides
// it, so every real pack stays gated on art/<packId>/ exactly as shipped.
function checkArtSrc(src, w, packId, requirePrefix, errors, assetBase) {
  if (!nonEmptyString(src)) { errors.push(`${w}: missing or empty`); return; }
  // Rejected outright, before any prefix or existence check: a ".." segment can make a string
  // that STARTS WITH the required prefix resolve somewhere else entirely (art/pack-x/../pack-y/foo
  // satisfies startsWith("art/pack-x/") while actually pointing at pack-y), and a backslash is
  // never a valid path separator in a src that ships to a browser over a URL.
  if (src.includes('..') || src.includes('\\')) {
    errors.push(`${w}: "${src}" must not contain ".." or backslashes (got "${src}")`);
    return;
  }
  // An absolute src makes the prefix half (path.resolve, which honours an absolute path and
  // discards REPO_ROOT entirely once it sees one) and the existence half (path.join, which never
  // does -- it just concatenates) disagree about which file is even being examined, so the two
  // halves of this same function can report factually inconsistent diagnoses for one input.
  // Rejected outright rather than diagnosed twice, inconsistently.
  if (path.isAbsolute(src) || src.startsWith('/')) {
    errors.push(`${w}: "${src}" must be a repo-relative path, not an absolute one`);
    return;
  }
  // A trailing separator validates clean today only because path.relative (used by the on-disk
  // walk below) strips it before splitting into segments, but POSIX pathname resolution requires
  // a trailing slash to resolve to a DIRECTORY -- so this src would 404 on the case-sensitive,
  // POSIX-serving host even where the file itself genuinely exists.
  if (src.endsWith('/')) {
    errors.push(`${w}: "${src}" must not end with a trailing slash`);
    return;
  }
  if (requirePrefix && packId) {
    const prefix = `${assetBase}/${packId}/`;
    // Resolved-path comparison, not a raw string prefix: robust to redundant slashes and the like,
    // and (with the traversal reject above already closing the sharpest edge) a second, independent
    // check that what the src ACTUALLY resolves to is inside the pack's own directory.
    const absSrc = path.resolve(REPO_ROOT, src);
    const absPrefixDir = path.resolve(REPO_ROOT, assetBase, packId);
    if (absSrc !== absPrefixDir && absSrc.indexOf(absPrefixDir + path.sep) !== 0) {
      errors.push(`${w}: "${src}" must live under "${prefix}"`);
    }
  }
  const abs = path.join(REPO_ROOT, src);
  const verifiedAbs = checkOnDiskCase(abs, src, w, errors);
  if (verifiedAbs === null) return;   // not found, wrong case, or an unreadable dir; already reported

  // "The asset exists" must mean a FILE. fs.existsSync (and the listing walk above) both return
  // true for a directory, so a src naming a directory -- e.g. the pack's own art folder -- would
  // otherwise satisfy every check above and validate clean.
  let isFile = true;
  try { isFile = fs.statSync(verifiedAbs).isFile(); } catch (e) { /* just verified by the walk above; treat as fine */ }
  if (!isFile) {
    errors.push(`${w}: "${src}" resolves to a directory, not a file`);
  }
}

// fs.existsSync is case-INSENSITIVE on this authoring machine's filesystem (and on macOS default),
// but GitHub Pages -- which serves this repo -- is case-SENSITIVE, so a src whose case does not
// match the file on disk can validate clean here and 404 in production. existsSync is therefore
// never the primary oracle below: fs.readdirSync always reports each entry's real on-disk spelling
// regardless of the OS's own case-folding rules (Windows preserves case even though its lookups
// ignore it), so walking every path segment against its parent's real listing gives ONE answer on
// Windows, macOS and Linux alike. A mis-cased DIRECTORY segment is exactly as real a 404 as a
// mis-cased filename, so every segment is walked, not just the last one.
//
// Returns the fully verified absolute path on success. Returns null once an error has already
// been pushed (not found, wrong case) or the read-failure fallback below has run; the caller must
// not do anything further with the path in that case.
function checkOnDiskCase(abs, src, w, errors) {
  const rel = path.relative(REPO_ROOT, abs);
  const segments = rel.split(path.sep).filter(Boolean);
  let dir = REPO_ROOT;
  for (const seg of segments) {
    let entries;
    try { entries = fs.readdirSync(dir); }
    catch (e) {
      // The parent directory itself could not be read (missing, permissions...). A missing parent
      // must not throw out of the validator; fall back to a plain existence check on the full path.
      // Case cannot be verified in this branch, so no "different case" message is possible here.
      if (!fs.existsSync(abs)) errors.push(`${w}: file not found at "${src}" (resolved from repo root)`);
      return null;
    }
    if (entries.includes(seg)) { dir = path.join(dir, seg); continue; }
    const ciHit = entries.some(e => e.toLowerCase() === seg.toLowerCase());
    if (ciHit) {
      errors.push(`${w}: "${src}" exists on disk, but the "${seg}" segment has a different case there; this authoring machine's filesystem may resolve it anyway, but GitHub Pages, which serves this repo, is case-sensitive, so this would 404 in production`);
    } else {
      errors.push(`${w}: file not found at "${src}" (resolved from repo root)`);
    }
    return null;
  }
  return dir;
}

function checkFigures(pack, errors, opts) {
  const list = pack.figures;
  if (list === undefined) return new Map();
  if (!Array.isArray(list)) { errors.push(`figures: present but not an array, got ${JSON.stringify(list)}`); return new Map(); }
  if (list.length === 0) {
    errors.push('figures: declared as an empty array; omit the field entirely instead of declaring one with no figures');
    return new Map();
  }

  const assetBase = (opts && nonEmptyString(opts.assetBase)) ? opts.assetBase : 'art';
  // The validator's own expectedId (the filename, authoritative when the CLI supplies it) wins
  // over the pack's self-reported meta.id; meta.id is only a fallback for callers with no filename
  // at all (in-memory packs). When neither is available the prefix rule is unverifiable, and that
  // is reported once, explicitly, rather than every src silently skipping its prefix check.
  const expectedId = opts && opts.expectedId;
  const packId = nonEmptyString(expectedId) ? expectedId
    : ((pack.meta && nonEmptyString(pack.meta.id)) ? pack.meta.id : null);
  if (!packId) {
    errors.push(`figures: no pack id available (neither the validator's expectedId nor meta.id) to build the "${assetBase}/<packId>/" prefix check; every figure src's location rule is unverifiable until one is supplied`);
  }

  const byId = new Map();
  list.forEach((fig, i) => {
    const where = `figures[${i}]`;
    if (!fig || typeof fig !== 'object') { errors.push(`${where}: not an object`); return; }
    if (!nonEmptyString(fig.id)) { errors.push(`${where}.id: missing or empty`); return; }
    const w = `figures(${fig.id})`;
    if (byId.has(fig.id)) errors.push(`${where}: duplicate figure id "${fig.id}"`);
    else byId.set(fig.id, fig);

    if (!FIG_KINDS.includes(fig.kind)) {
      errors.push(`${w}.kind: must be one of ${FIG_KINDS.join(', ')}, got ${JSON.stringify(fig.kind)}`);
    }
    for (const k of ['caption', 'credit', 'alt']) {
      if (!nonEmptyString(fig[k])) errors.push(`${w}.${k}: missing or empty`);
    }

    if (fig.kind === 'plate') {
      if (!Array.isArray(fig.views) || fig.views.length < 2) {
        errors.push(`${w}.views: plate figures need at least two views, got ${JSON.stringify(fig.views)}`);
      } else {
        fig.views.forEach((v, vi) => {
          const vw = `${w}.views[${vi}]`;
          if (!v || typeof v !== 'object') { errors.push(`${vw}: not an object`); return; }
          if (!nonEmptyString(v.label)) errors.push(`${vw}.label: missing or empty`);
          checkArtSrc(v.src, `${vw}.src`, packId, true, errors, assetBase);
          // overlaySrc obeys the SAME art/<packId>/ prefix as src: it ships to the same public
          // tree under the same per-pack provenance discipline, so it gets no exemption.
          if (v.overlaySrc !== undefined) checkArtSrc(v.overlaySrc, `${vw}.overlaySrc`, packId, true, errors, assetBase);
        });
      }
    } else {
      // Every non-plate kind (including an already-invalid kind) still owes a real src; the kind
      // check above already reported the invalid kind, so this does not mask it, it adds to it.
      checkArtSrc(fig.src, `${w}.src`, packId, true, errors, assetBase);
    }

    if (fig.kind === 'chart') {
      const dt = fig.dataTable;
      if (!isPlainObject(dt)) {
        errors.push(`${w}.dataTable: chart figures require a dataTable object, got ${JSON.stringify(dt)}`);
      }
    }

    // Task 9 fix round 1, item 11: `gen` is opt-in and, before this check, unvalidated -- a chart
    // carrying a dataTable but no `gen` flag (or a mistyped one, e.g. the string "true") silently
    // escaped tests/figure-derive.js entirely while its own NOT-ARMED banner asserted that nothing
    // needed guarding. This only enforces the TYPE here; whether an assessed chart is REQUIRED to
    // carry `gen: true` is enforced below in checkFigureReferences, where the assessed set (item
    // .figureId) is already in hand.
    if (fig.gen !== undefined && typeof fig.gen !== 'boolean') {
      errors.push(`${w}.gen: must be a boolean when present, got ${JSON.stringify(fig.gen)}`);
    }
  });
  return byId;
}

// ---------- figures: cross-references ----------
// Everything about how the REST of the pack points at a figure: passage strips, a level's reveal
// card, and an assessed item. Kept separate from checkFigures because it needs passagesById and
// itemsById already built, exactly like checkTargetSubjects sits apart from checkLevels above.
function checkFigureReferences(pack, figuresById, passagesById, itemsById, errors) {
  for (const p of passagesById.values()) {
    if (p.figureIds === undefined) continue;
    if (!Array.isArray(p.figureIds)) { errors.push(`passages(${p.id}).figureIds: must be an array, got ${JSON.stringify(p.figureIds)}`); continue; }
    // Fix wave (final review): the spec caps a passage's strip at 1-3 thumbs (0 is expressed by
    // omitting the field entirely, not by an empty array). Nothing enforced the upper bound --
    // executed with 8 figureIds on one passage, all 8 rendered, the strip's own composed height
    // held at 98px, but scrollWidth (1096) exceeded the visible 1000px and most thumbs sat
    // off-screen behind a horizontal scroll the child has no affordance to discover.
    if (p.figureIds.length > 3) {
      errors.push(`passages(${p.id}).figureIds: must have at most 3 entries (the strip caps at 1-3 thumbs), got ${p.figureIds.length}`);
    }
    p.figureIds.forEach((fid, i) => {
      if (!figuresById.has(fid)) errors.push(`passages(${p.id}).figureIds[${i}]: "${fid}" does not resolve to any figure`);
    });
  }

  if (Array.isArray(pack.levels)) {
    pack.levels.forEach((lv, i) => {
      if (!lv || typeof lv !== 'object') return;   // already reported by checkLevels
      const reveal = lv.reveal;
      if (!reveal || typeof reveal !== 'object' || reveal.figureId === undefined) return;
      if (!figuresById.has(reveal.figureId)) {
        errors.push(`levels[${i}].reveal.figureId: "${reveal.figureId}" does not resolve to any figure`);
      }
    });
  }

  for (const it of itemsById.values()) {
    if (it.figureId === undefined) continue;
    const w = `items(${it.id}).figureId`;
    const fig = figuresById.get(it.figureId);
    if (!fig) { errors.push(`${w}: "${it.figureId}" does not resolve to any figure`); continue; }
    if (fig.kind === 'photo') {
      errors.push(`${w}: figure "${fig.id}" is a photograph; photographs are never assessed`);
      continue;
    }
    if (!isPlainObject(fig.dataTable)) {
      errors.push(`${w}: figure "${fig.id}" is assessed by this item and requires a dataTable`);
      continue;
    }
    // Task 9 fix round 1, item 11: a chart figure carrying a dataTable AND assessed by an item is
    // exactly the shape tests/figure-derive.js exists to guard (the picture is graded against this
    // dataTable). `gen` is opt-in everywhere else in this schema, but here it is not optional --
    // `gen !== true` (missing, false, or a truthy-but-mistyped value already caught by the
    // boolean-type check in checkFigures) means the derive gate silently never re-derives this
    // figure, while its own NOT-ARMED banner would keep asserting nothing needs guarding.
    if (fig.kind === 'chart' && fig.gen !== true) {
      errors.push(`${w}: figure "${fig.id}" is a chart assessed by this item and must declare gen: true so tests/figure-derive.js re-derives it from its dataTable, got ${JSON.stringify(fig.gen)}`);
    }
  }
}

// ---------- envelope: every figure carries a provenance row ----------
// Each art directory's PROVENANCE.md states the rule in its own words: "a figure entering
// packs/<pack>.json without a row here first is itself the defect, not a formatting gap to fix
// later."  That rule was prose only, and prose does not hold: a targeted string replace during V4
// matched the WRONG table (the 3-column rejected-candidates marker is a prefix of the 4-column
// built-assets one), so fig-rivers-map's row silently never landed while the commit that added the
// figure said it had.  Nothing failed, because nothing was checking.
//
// This checks presence and pairing only. It cannot judge whether a row's licence reasoning is
// sound, and it is not trying to: it closes the gap between "a row exists" and "a row was
// believed to exist", which is the gap that actually opened.
function checkProvenance(pack, figures, errors, opts) {
  if (!figures.length) return;
  // Scoped to art/, which is where the rule lives: the spec requires every shipped asset under
  // `art/<packId>/`, and it is that directory's own PROVENANCE.md that states the rule. Test
  // fixtures under tests/fixtures/ carry throwaway src paths and no licence question to answer,
  // so demanding a provenance file from them would be ceremony rather than a check.
  const inArt = (s) => typeof s === 'string' && s.replace(/\\/g, '/').startsWith('art/');
  const dirs = new Set();
  for (const f of figures) {
    // Null and non-object entries are checkFigures' business, and an existing gate asserts they
    // are CAUGHT rather than thrown; this must not be the thing that throws on them.
    if (!f || typeof f !== 'object') continue;
    const srcs = [f.src].concat((Array.isArray(f.views) ? f.views : []).map((v) => v && (v.overlaySrc || v.src)));
    for (const s of srcs) if (inArt(s) && s.includes('/')) dirs.add(path.dirname(s));
  }
  const root = (opts && opts.repoRoot) || path.join(__dirname, '..');
  for (const dir of dirs) {
    const file = path.join(root, dir, 'PROVENANCE.md');
    if (!fs.existsSync(file)) {
      errors.push(`provenance: ${dir} holds figure assets but has no PROVENANCE.md`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const f of figures) {
      if (!f || typeof f !== 'object' || typeof f.id !== 'string') continue;
      const inDir = [f.src].concat((Array.isArray(f.views) ? f.views : []).map((v) => v && v.src))
        .some((s) => typeof s === 'string' && path.dirname(s) === dir);
      if (!inDir) continue;
      // A markdown row for this figure: its id as the first cell.
      if (!new RegExp(`^\\|\\s*${f.id.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*[|(]`, 'm').test(text)) {
        errors.push(`provenance: figure "${f.id}" has no row in ${dir}/PROVENANCE.md, which that file's own rule forbids`);
      }
    }
  }
}

// ---------- envelope: passage docKind and register ----------
// Phase R.  `docKind` stays the STYLING key: it picks the tint, the padding and the gate's own
// list.  `register` is the optional LABEL, overriding the band text the skin would otherwise
// hard-code.  The two were conflated before, which is why `case-file` always reads "PROVENANCE
// OFFICE / CASE FILE": a label written for one pack's fiction, welded to a skin four other packs
// need.  Splitting them means a new pack costs zero CSS.
const REGISTER_MAX = 44;   // measured: the band is one line at 0.62rem/0.14em in a 1024px column,
                           // and past roughly this length it wraps and doubles the band's height,
                           // which shifts every passage's first line down.
function checkDocKinds(passagesById, errors) {
  for (const p of passagesById.values()) {
    if (p.docKind !== undefined && !DOC_KINDS.includes(p.docKind)) {
      errors.push(`passages(${p.id}).docKind: must be one of ${DOC_KINDS.join(', ')}, got ${JSON.stringify(p.docKind)}`);
    }
    if (p.register !== undefined) {
      if (typeof p.register !== 'string' || !p.register.trim()) {
        errors.push(`passages(${p.id}).register: must be a non-empty string, got ${JSON.stringify(p.register)}`);
      } else if (p.register.length > REGISTER_MAX) {
        errors.push(`passages(${p.id}).register: ${p.register.length} chars exceeds the ${REGISTER_MAX}-char band, which would wrap to a second line and push every passage's first line down`);
      }
      // A register with no docKind is a band label with no band: the ::before that paints it is
      // scoped to [data-dockind], so the string would be authored, validated, and never render.
      if (p.docKind === undefined) {
        errors.push(`passages(${p.id}).register: set without a docKind, so no band exists to carry it and the label would never render`);
      }
    }
  }
}

// ---------- whole-pack: no live links ----------
// Scans the raw JSON TEXT, not the parsed object, so a URL cannot hide in a field no schema check
// happens to walk. rawText is the real file bytes when the CLI supplies opts.rawText; validatePack
// falls back to JSON.stringify(pack) so in-memory test fixtures (which never touch disk) get the
// same scan over the same string content.
function checkNoRawUrls(rawText, errors) {
  const m = /https?:\/\/[^"'\\\s]*/.exec(rawText);
  if (m) {
    errors.push(`pack: raw JSON text contains a live URL (${JSON.stringify(m[0].slice(0, 80))}); figures and text may not embed http(s) links`);
  }
}

// ---------- hooks filled by later tasks ----------
function isIntIn(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }

function checkChoiceBlock(block, where, minN, maxN, errors) {
  if (!Array.isArray(block.choices)) { errors.push(`${where}.choices: must be an array`); return false; }
  const n = block.choices.length;
  if (n < minN || n > maxN) errors.push(`${where}.choices: must hold ${minN} to ${maxN} options, got ${n}`);
  if (!block.choices.every(nonEmptyString)) errors.push(`${where}.choices: every option must be a non-empty string`);
  const seen = new Set();
  for (const c of block.choices) {
    const norm = String(c).trim().toLowerCase();
    if (seen.has(norm)) errors.push(`${where}.choices: duplicate option "${c}"`);
    seen.add(norm);
  }
  return n > 0;
}

function checkItemShape(item, passagesById, errors) {
  const w = `items(${item.id})`;
  if (!ITEM_TYPES.includes(item.type)) return;   // already reported by the envelope check

  // Every type except ebsr needs a top-level stem. ebsr carries its prompts in partA.stem and
  // partB.stem, checked separately below; cloze DOES need the top-level stem, because that is
  // where its {{n}} tokens live.
  if (!nonEmptyString(item.stem) && item.type !== 'ebsr') {
    errors.push(`${w}.stem: missing or empty`);
  }

  switch (item.type) {
    case 'mc': {
      if (!checkChoiceBlock(item, w, 3, 5, errors)) break;
      if (!isIntIn(item.key, 0, item.choices.length - 1)) {
        errors.push(`${w}.key: must be an integer index into choices (0 to ${item.choices.length - 1}), got ${JSON.stringify(item.key)}`);
      }
      break;
    }
    case 'ms': {
      if (!checkChoiceBlock(item, w, 4, 6, errors)) break;
      const k = item.key;
      if (!Array.isArray(k) || k.length < 2) {
        errors.push(`${w}.key: multi-select needs an array of two or more indices, got ${JSON.stringify(k)}`);
        break;
      }
      if (!k.every(i => isIntIn(i, 0, item.choices.length - 1))) {
        errors.push(`${w}.key: every index must fall inside choices (0 to ${item.choices.length - 1}), got ${JSON.stringify(k)}`);
      }
      if (new Set(k).size !== k.length) errors.push(`${w}.key: contains a duplicate index`);
      for (let i = 1; i < k.length; i++) {
        if (k[i] <= k[i - 1]) { errors.push(`${w}.key: must be in ascending order, got ${JSON.stringify(k)}`); break; }
      }
      if (k.length === item.choices.length) errors.push(`${w}.key: every option cannot be correct`);
      break;
    }
    case 'ebsr': {
      const A = item.partA, B = item.partB;
      if (!A || typeof A !== 'object') { errors.push(`${w}.partA: missing`); break; }
      if (!B || typeof B !== 'object') { errors.push(`${w}.partB: missing`); break; }
      if (!nonEmptyString(A.stem)) errors.push(`${w}.partA.stem: missing or empty`);
      if (!nonEmptyString(B.stem)) errors.push(`${w}.partB.stem: missing or empty`);
      const aOk = checkChoiceBlock(A, `${w}.partA`, 3, 4, errors);
      const bOk = checkChoiceBlock(B, `${w}.partB`, 3, 4, errors);
      if (!aOk || !bOk) break;
      if (!isIntIn(A.key, 0, A.choices.length - 1)) {
        errors.push(`${w}.partA.key: must index partA.choices, got ${JSON.stringify(A.key)}`);
      }
      // The signature EBSR rule: the correct evidence depends on which Part A the student chose,
      // so partB.key is a map from every Part A index to a Part B index. A fixed scalar key here
      // is the most common way a homemade EBSR is silently wrong.
      if (!isPlainObject(B.key)) {
        errors.push(`${w}.partB.key: must be an object mapping each partA index to a partB index`);
        break;
      }
      for (let a = 0; a < A.choices.length; a++) {
        if (!Object.prototype.hasOwnProperty.call(B.key, String(a))) {
          errors.push(`${w}.partB.key: no entry for partA index ${a}; every Part A choice needs its best supporting evidence`);
          continue;
        }
        const bIdx = B.key[String(a)];
        if (!isIntIn(bIdx, 0, B.choices.length - 1)) {
          errors.push(`${w}.partB.key["${a}"]: must index partB.choices (0 to ${B.choices.length - 1}), got ${JSON.stringify(bIdx)}`);
        }
      }
      break;
    }
    case 'hottext': {
      if (!['sentence', 'word'].includes(item.mode)) {
        errors.push(`${w}.mode: must be "sentence" or "word", got ${JSON.stringify(item.mode)}`);
      }
      if (!Array.isArray(item.spans) || item.spans.length < 2) {
        errors.push(`${w}.spans: needs at least two selectable spans, got ${JSON.stringify(item.spans)}`);
        break;
      }
      if (!item.spans.every(nonEmptyString)) errors.push(`${w}.spans: every span must be a non-empty string`);
      if (!Array.isArray(item.key) || item.key.length < 1) {
        errors.push(`${w}.key: needs an array of at least one span index`);
        break;
      }
      if (!item.key.every(i => isIntIn(i, 0, item.spans.length - 1))) {
        errors.push(`${w}.key: every index must fall inside spans (0 to ${item.spans.length - 1}), got ${JSON.stringify(item.key)}`);
      }
      // Same guard ms carries. A repeated index inflates "how many spans to find" past the number
      // of distinct correct spans, and the grader's set-dedup would silently disagree with the key.
      if (new Set(item.key).size !== item.key.length) {
        errors.push(`${w}.key: contains a duplicate span index, got ${JSON.stringify(item.key)}`);
      }
      if (item.key.length === item.spans.length) errors.push(`${w}.key: every span cannot be correct`);
      break;
    }
    case 'match': {
      const rows = item.rowLabels, cols = item.colLabels;
      if (!Array.isArray(rows) || rows.length < 2) { errors.push(`${w}.rowLabels: needs at least two rows`); break; }
      if (!Array.isArray(cols) || cols.length < 2) { errors.push(`${w}.colLabels: needs at least two columns`); break; }
      if (!rows.every(nonEmptyString)) errors.push(`${w}.rowLabels: every label must be a non-empty string`);
      if (!cols.every(nonEmptyString)) errors.push(`${w}.colLabels: every label must be a non-empty string`);
      if (!Array.isArray(item.key) || item.key.length < 1) { errors.push(`${w}.key: needs at least one [row, col] pair`); break; }
      const seen = new Set();
      item.key.forEach((cell, i) => {
        if (!Array.isArray(cell) || cell.length !== 2) { errors.push(`${w}.key[${i}]: must be a [row, col] pair`); return; }
        const [r, c] = cell;
        if (!isIntIn(r, 0, rows.length - 1) || !isIntIn(c, 0, cols.length - 1)) {
          errors.push(`${w}.key[${i}]: cell [${r}, ${c}] falls outside the ${rows.length} by ${cols.length} table`);
          return;
        }
        const sig = r + ',' + c;
        if (seen.has(sig)) errors.push(`${w}.key: cell [${r}, ${c}] listed twice`);
        seen.add(sig);
      });
      // A match item is a row-to-column FUNCTION: every row needs EXACTLY one correct column.
      // Without this, a row with no correct cell is unanswerable no matter what the student picks,
      // and a row correct in two columns is self-contradictory; the runtime cannot resolve either
      // without guessing. The per-cell dedup above does not catch it, because it keys on the whole
      // (row, col) pair rather than on the row.
      const perRow = new Map();
      for (const cell of item.key) {
        if (!Array.isArray(cell) || cell.length !== 2) continue;   // already reported above
        const r = Number(cell[0]);
        perRow.set(r, (perRow.get(r) || 0) + 1);
      }
      for (let r = 0; r < rows.length; r++) {
        const n = perRow.get(r) || 0;
        if (n === 0) {
          errors.push(`${w}.key: row ${r} ("${rows[r]}") has no correct column; every row needs exactly one`);
        } else if (n > 1) {
          errors.push(`${w}.key: row ${r} ("${rows[r]}") is marked correct in ${n} columns; every row needs exactly one`);
        }
      }
      break;
    }
    case 'order': {
      if (!Array.isArray(item.tiles) || item.tiles.length < 3) { errors.push(`${w}.tiles: needs at least three tiles`); break; }
      if (!item.tiles.every(nonEmptyString)) errors.push(`${w}.tiles: every tile must be a non-empty string`);
      const k = item.key;
      if (!Array.isArray(k) || k.length !== item.tiles.length) {
        errors.push(`${w}.key: must be a permutation the same length as tiles (${item.tiles.length}), got ${JSON.stringify(k)}`);
        break;
      }
      const sorted = [...k].sort((a, b) => a - b);
      const expected = item.tiles.map((_, i) => i);
      if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
        errors.push(`${w}.key: must be a full permutation of 0 to ${item.tiles.length - 1} with no repeats, got ${JSON.stringify(k)}`);
      }
      break;
    }
    case 'cloze': {
      if (!Array.isArray(item.blanks) || item.blanks.length < 1) { errors.push(`${w}.blanks: needs at least one blank`); break; }
      const tokens = String(item.stem || '').match(/\{\{(\d+)\}\}/g) || [];
      if (tokens.length !== item.blanks.length) {
        errors.push(`${w}: stem holds ${tokens.length} {{n}} token(s) but blanks holds ${item.blanks.length}; they must match one to one`);
      }
      for (let i = 0; i < item.blanks.length; i++) {
        if (!String(item.stem || '').includes(`{{${i}}}`)) {
          errors.push(`${w}.stem: missing the token {{${i}}} for blanks[${i}]`);
        }
      }
      item.blanks.forEach((b, i) => {
        const bw = `${w}.blanks[${i}]`;
        if (!b || typeof b !== 'object') { errors.push(`${bw}: not an object`); return; }
        if (!checkChoiceBlock(b, bw, 2, 4, errors)) return;
        if (!isIntIn(b.key, 0, b.choices.length - 1)) {
          errors.push(`${bw}.key: must index its own choices, got ${JSON.stringify(b.key)}`);
        }
      });
      break;
    }
    case 'shorttext': {
      if (!Array.isArray(item.accept) || item.accept.length < 1) {
        errors.push(`${w}.accept: needs at least one accepted answer string`);
        break;
      }
      if (!item.accept.every(nonEmptyString)) errors.push(`${w}.accept: every accepted answer must be a non-empty string`);
      if (!isIntIn(item.maxWords, 1, 40)) {
        errors.push(`${w}.maxWords: must be an integer from 1 to 40, got ${JSON.stringify(item.maxWords)}`);
      }
      break;
    }
    case 'listen':
    case 'write':
      // Reserved. Phase 3 and phase 4 add their shape rules; a pack that ships one now fails
      // rather than passing unvalidated.
      errors.push(`${w}.type: "${item.type}" is reserved for a later phase and cannot ship yet`);
      break;
  }
}
const READ_DEFAULTS = { fkMin: 5.5, fkMax: 8.0, clMin: 4.5, clMax: 9.5 };
const EXPLAIN_MIN_WORDS = 20;

// Plain word count, deliberately NOT textStats().words. That tokeniser matches only letter-led
// tokens because the readability formulas need it that way, so it scores digits and symbols as zero.
// Used as a content gate it rejected explanations a human counts as 24 words: "swaps 4 for 40 percent,
// missing why 5 of 7 signals fail" scores 19. Readability keeps textStats; the floor uses this.
function plainWordCount(s) {
  return String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean).length;
}

// A pack may TIGHTEN its own readability band and may never widen it. Without this clamp the pack
// author sets the very thresholds their content is judged against, which is not a gate at all:
// meta.readability = { fkMin: 0, fkMax: 100 } silently passes anything.
function resolveBand(pack, errors) {
  const band = Object.assign({}, READ_DEFAULTS);
  const ov = (pack.meta && pack.meta.readability) || {};
  for (const k of ['fkMin', 'fkMax', 'clMin', 'clMax']) {
    if (!Object.prototype.hasOwnProperty.call(ov, k)) continue;
    const v = ov[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`meta.readability.${k}: must be a finite number, got ${JSON.stringify(v)}`);
      continue;
    }
    // Mins may only move up, maxes may only move down.
    const tighter = k.endsWith('Min') ? Math.max(READ_DEFAULTS[k], v) : Math.min(READ_DEFAULTS[k], v);
    if (tighter !== v) {
      errors.push(`meta.readability.${k}: ${v} would widen the default band (${READ_DEFAULTS[k]}); a pack may only tighten it`);
    }
    band[k] = tighter;
  }
  return band;
}

// Whitespace-insensitive verbatim containment. Authors and editors introduce line wrapping and
// double spaces; a quote that differs only in whitespace is still the same sentence. Anything
// else (a changed word, a normalised hyphen, a smart quote) is a real defect and must fail.
function normWhitespace(s) { return String(s).replace(/\s+/g, ' ').trim(); }
function containsVerbatim(haystack, needle) {
  return normWhitespace(haystack).includes(normWhitespace(needle));
}

// A coach topic ships if it matches a known family prefix. The engine resolves the exact topic to
// a COACH_TIPS entry at play time and falls back to the family, mirroring COACH_FAMILY_FALLBACK in
// Math-Multiverse.html. The 19-silently-dead-coach-topics bug of 26-0714 is what this prevents.
function coachResolves(topic) {
  const t = String(topic || '');
  return COACH_FAMILIES.some(f => t === f || t.startsWith(f + '-'));
}

// Every string an item claims came out of the passage, with the field path for the error message.
function quotedSpans(item) {
  const out = [];
  if (item.type === 'ebsr' && item.partB && Array.isArray(item.partB.choices)) {
    item.partB.choices.forEach((c, i) => out.push([`partB.choices[${i}]`, c]));
  }
  if (item.type === 'hottext' && Array.isArray(item.spans)) {
    item.spans.forEach((s, i) => out.push([`spans[${i}]`, s]));
  }
  if (nonEmptyString(item.quote)) out.push(['quote', item.quote]);
  return out;
}

// Only the stem carrying the QUESTION participates in duplicate detection. An ebsr's partB.stem is
// template text describing the item's mechanism ("Which sentence from the passage best supports your
// answer?") and is EXPECTED to repeat across every ebsr in a pack, so including it rejects a
// legitimate pack. Task 14 ships roughly 24 ebsr items that all share that line.
function itemStems(item) {
  if (item.type === 'ebsr') {
    return (item.partA && nonEmptyString(item.partA.stem)) ? [item.partA.stem] : [];
  }
  return nonEmptyString(item.stem) ? [item.stem] : [];
}

function contentChecks(pack, passagesById, itemsById, errors, warnings) {
  const band = resolveBand(pack, errors);

  // ---- passages: readability band ----
  for (const p of passagesById.values()) {
    if (!nonEmptyString(p.text)) continue;
    const fk = fleschKincaid(p.text);
    const cl = colemanLiau(p.text);
    const words = textStats(p.text).words;
    if (fk < band.fkMin || fk > band.fkMax) {
      errors.push(`passages(${p.id}): readability out of band, Flesch-Kincaid ${fk.toFixed(1)} is outside ${band.fkMin} to ${band.fkMax}`);
    }
    if (cl < band.clMin || cl > band.clMax) {
      errors.push(`passages(${p.id}): readability out of band, Coleman-Liau ${cl.toFixed(1)} is outside ${band.clMin} to ${band.clMax}`);
    }
    if (words < 60)  warnings.push(`passages(${p.id}): only ${words} words, thin for a grade-6 stimulus`);
    if (words > 900) warnings.push(`passages(${p.id}): ${words} words, long enough to crowd the iPad play area`);
  }

  // ---- items: quotes, explanations, rationales, coach topics ----
  const stemIndex = new Map();
  for (const item of itemsById.values()) {
    const w = `items(${item.id})`;

    // The highest-yield check in the suite.
    const spans = quotedSpans(item);
    if (spans.length) {
      const p = passagesById.get(item.passageId);
      if (!p) {
        errors.push(`${w}: quotes text but has no resolvable passageId`);
      } else {
        for (const [field, span] of spans) {
          if (!containsVerbatim(p.text, span)) {
            errors.push(`${w}.${field}: not found verbatim in passage "${p.id}": ${JSON.stringify(String(span).slice(0, 70))}`);
          }
        }
      }
    }

    if (nonEmptyString(item.explain)) {
      const n = plainWordCount(item.explain);
      if (n < EXPLAIN_MIN_WORDS) {
        errors.push(`${w}.explain: only ${n} words; an explanation must name the misconception the student picked, not just restate the answer (minimum ${EXPLAIN_MIN_WORDS})`);
      }
    } else {
      errors.push(`${w}.explain: missing or empty`);
    }

    // Choice-based types owe a rationale per wrong option. Span-based and typed types have no
    // discrete wrong-choice set and are exempt.
    if (CHOICE_TYPES.includes(item.type) && item.type !== 'cloze') {
      const choices = item.type === 'ebsr' ? (item.partA && item.partA.choices) : item.choices;
      const key = item.type === 'ebsr' ? (item.partA && item.partA.key) : item.key;
      if (Array.isArray(choices)) {
        const correct = new Set(Array.isArray(key) ? key : [key]);
        const dr = item.distractorRationale || {};
        for (let i = 0; i < choices.length; i++) {
          if (correct.has(i)) continue;
          if (!nonEmptyString(dr[String(i)])) {
            errors.push(`${w}.distractorRationale["${i}"]: missing; every wrong option must say what mistake picks it`);
          }
        }
      }
    }

    if (!coachResolves(item.coachTopic)) {
      errors.push(`${w}.coachTopic: "${item.coachTopic}" resolves to no coach family (legal families: ${COACH_FAMILIES.join(', ')})`);
    }

    for (const s of itemStems(item)) {
      const norm = normWhitespace(s).toLowerCase();
      if (stemIndex.has(norm)) {
        errors.push(`${w}: duplicate stem, already used by items(${stemIndex.get(norm)}): ${JSON.stringify(norm.slice(0, 60))}`);
      } else {
        stemIndex.set(norm, item.id);
      }
    }
  }

  // ---- levels: every declared target is actually exercised ----
  if (Array.isArray(pack.levels)) {
    pack.levels.forEach((lv, i) => {
      if (!lv || !Array.isArray(lv.targets) || !Array.isArray(lv.itemIds)) return;
      const exercised = new Set();
      for (const id of lv.itemIds) {
        const it = itemsById.get(id);
        if (it && Array.isArray(it.targets)) it.targets.forEach(t => exercised.add(t));
      }
      for (const t of lv.targets) {
        if (!exercised.has(t)) {
          errors.push(`levels[${i}](${lv.name}): declares target "${t}" but no item in the level carries it`);
        }
      }
    });
  }
}

// A child must not be able to score the evidence half of an ebsr item by POSITION instead of by reading.
// The identity map is the likeliest instance of that but not the only one, so this rejects ANY single
// mapping shape that repeats often enough to be learnable, not the identity specifically.
function checkEbsrKeyShapes(pack, errors) {
  const eb = (pack.items || []).filter(i => i && i.type === 'ebsr' && i.partB && i.partB.key);
  if (eb.length < 4) return;                       // too few for a pattern to be learnable
  const counts = {};
  for (const it of eb) {
    const shape = Object.keys(it.partB.key).map(Number).sort((a, b) => a - b)
      .map(a => a + '>' + it.partB.key[a]).join(',');
    (counts[shape] || (counts[shape] = [])).push(it.id);
  }
  for (const [shape, ids] of Object.entries(counts)) {
    if (ids.length * 2 > eb.length) {
      errors.push(`items: ${ids.length} of ${eb.length} ebsr items share the partB.key shape ${shape}; ` +
        `a child can learn that position instead of reading for evidence. Permute partB.choices so the ` +
        `mapping varies (the pairings stay the same, only the order of the quotes changes). ` +
        `Offenders: ${JSON.stringify(ids.slice(0, 6))}${ids.length > 6 ? " ..." : ""}`);
    }
  }
}

function validatePack(pack, opts) {
  const errors = [], warnings = [];
  const expectedId = opts && opts.expectedId;
  if (!pack || typeof pack !== 'object') { errors.push('pack: not an object'); return { errors, warnings }; }

  checkMeta(pack, errors, expectedId);
  const passagesById = checkPassages(pack, errors);
  const itemsById = checkItemEnvelope(pack, passagesById, errors);
  checkTargetSubjects(pack, itemsById, errors);
  checkLevels(pack, itemsById, errors, warnings);
  const figuresById = checkFigures(pack, errors, opts);
  checkFigureReferences(pack, figuresById, passagesById, itemsById, errors);
  checkDocKinds(passagesById, errors);
  checkProvenance(pack, Array.isArray(pack.figures) ? pack.figures : [], errors, opts);
  // Scans the UNION of whatever real file bytes the CLI supplied (or JSON.stringify(pack) when a
  // caller has none, e.g. an in-memory test fixture) AND JSON.stringify(pack) itself, so neither
  // surface's blind spot can hide a link: raw bytes miss a URL a duplicate JSON key discarded at
  // parse time (present in the bytes, absent from the parsed object), while the parsed object
  // misses nothing the raw bytes had UNLESS the raw bytes themselves are the only place it showed
  // up -- scanning both closes both gaps at once.
  //
  // The rawText term is normalized (\/ -> /) before scanning, and ONLY the rawText term: real JSON
  // permits an escaped forward slash, so a shipped file can contain "https:\/\/host" verbatim,
  // which JSON.parse silently turns into a live "https://host" link at runtime while the regex
  // below (which requires a literal "://") cannot see through the escape in the raw bytes. The
  // JSON.stringify(pack) term keeps its current meaning (it is already the POST-parse, already
  // unescaped representation, and re-normalizing it would be a no-op at best and could mask an
  // unrelated defect at worst).
  const rawText = (opts && typeof opts.rawText === 'string') ? opts.rawText : JSON.stringify(pack);
  checkNoRawUrls(rawText.replace(/\\\//g, '/') + '\n' + JSON.stringify(pack), errors);
  for (const it of itemsById.values()) checkItemShape(it, passagesById, errors);
  contentChecks(pack, passagesById, itemsById, errors, warnings);
  checkEbsrKeyShapes(pack, errors);

  return { errors, warnings };
}

// Files under packs/ that are deliberately NOT content packs, with the reason each one is there.
// Discovery below validates exactly what packs/manifest.json registers and hard-fails on anything
// else, so a new file lands as an explicit decision rather than as a pack that happens to fail
// every shape check, or worse, as one that quietly passes because it happens to look close enough.
const NON_PACK_FILES = {
  'manifest.json': 'the pack registry itself',
  'curriculum-cc1.json': 'the CPM Core Connections Course 1 crosswalk: a lesson-to-topic map with '
    + 'no items, passages or levels, gated by tests/validate-curriculum.js instead',
};

// ---------- CLI ----------
function main(argv) {
  let files = argv.slice(2);
  const discoveryErrors = [];
  if (files.length === 0) {
    if (!fs.existsSync(PACK_DIR)) {
      console.error(`validate-pack: pack directory not found: ${PACK_DIR}`);
      return 2;
    }
    const onDisk = fs.readdirSync(PACK_DIR)
      .filter(f => f.endsWith('.json') && !f.endsWith('.verdicts.json'));

    let manifest = null;
    try { manifest = loadPackFile(path.join(PACK_DIR, 'manifest.json')); }
    catch (e) {
      console.error(`validate-pack: packs/manifest.json could not be read (${e.message}). Discovery `
        + 'keys off the manifest, so nothing below could be trusted.');
      return 2;
    }
    const registered = ((manifest && manifest.packs) || []).map(p => p && p.id).filter(Boolean);
    if (!registered.length) {
      console.error('validate-pack: packs/manifest.json registers zero packs. A validator that '
        + 'validates nothing must not report clean.');
      return 2;
    }

    // Every registered pack must exist, and every file must be registered or declared a non-pack.
    for (const id of registered) {
      if (!onDisk.includes(id + '.json')) {
        discoveryErrors.push(`manifest registers "${id}" but packs/${id}.json is not on disk`);
      }
    }
    for (const f of onDisk) {
      const id = f.replace(/\.json$/, '');
      if (registered.includes(id)) continue;
      if (Object.prototype.hasOwnProperty.call(NON_PACK_FILES, f)) continue;
      discoveryErrors.push(`packs/${f} is neither registered in manifest.json nor listed in `
        + 'NON_PACK_FILES. Register it so it ships, or declare why it is not a pack.');
    }
    // The manifest's own level count against the pack's. The launcher card reads this number, so a
    // stale one understates a pack to the child looking at it: cpm-cc1-g6 shipped six levels while
    // its entry still said one, left over from when it had one, and nothing noticed. Every other
    // pack's count was accurate, which is what makes the field load-bearing rather than decorative.
    for (const entry of (manifest && manifest.packs) || []) {
      if (!entry || !entry.id || !onDisk.includes(entry.id + '.json')) continue;
      if (typeof entry.levels !== 'number') {
        discoveryErrors.push(`manifest entry "${entry.id}" declares no level count, so the launcher `
          + 'card has nothing to show and nothing here can check it');
        continue;
      }
      let actual = null;
      try { actual = (loadPackFile(path.join(PACK_DIR, entry.id + '.json')).levels || []).length; }
      catch (e) { continue; }   // an unreadable pack is already reported by its own pass below
      if (actual !== entry.levels) {
        discoveryErrors.push(`manifest says "${entry.id}" has ${entry.levels} level(s) and the pack `
          + `has ${actual}. The launcher card shows the manifest's number, so it would tell a child `
          + 'the wrong thing about what is in there.');
      }
    }
    for (const f of Object.keys(NON_PACK_FILES)) {
      if (!onDisk.includes(f)) {
        discoveryErrors.push(`NON_PACK_FILES lists packs/${f}, which is not on disk. Remove the `
          + 'entry so the exemption cannot outlive the file it exempts.');
      }
    }

    files = registered.map(id => path.join(PACK_DIR, id + '.json'));
    const skipped = Object.keys(NON_PACK_FILES).filter(f => f !== 'manifest.json');
    if (skipped.length) {
      console.log(`validate-pack: ${registered.length} registered pack(s); not packs, skipped: `
        + skipped.map(f => `${f} (${NON_PACK_FILES[f]})`).join('; '));
    }
  }
  if (files.length === 0) {
    console.error('validate-pack: no packs found. A validator that validates nothing must not report clean.');
    return 2;
  }
  if (discoveryErrors.length) {
    console.log('\n=== validate-pack discovery ===');
    discoveryErrors.forEach(e => console.log('  ERROR   ' + e));
  }

  let totalErrors = 0, totalWarnings = 0;
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
    const expectedId = path.basename(abs).replace(/\.json$/, '');
    let pack;
    try { pack = loadPackFile(abs); }
    catch (e) { console.log(`\n${expectedId}\n  LOAD FAILED: ${e.message}`); totalErrors++; continue; }

    // Real file bytes, not a re-stringify of the parsed object, so checkNoRawUrls scans exactly
    // what shipped -- including anything JSON.parse/stringify would round-trip identically anyway,
    // but without relying on that being true.
    const rawText = fs.readFileSync(abs, 'utf8');
    const { errors, warnings } = validatePack(pack, { expectedId, rawText });

    // Blind re-answer ledger. A pack with comparable items must ship an adjudicated ledger.
    const ledgerPath = abs.replace(/\.json$/, '.verdicts.json');
    const needsLedger = Array.isArray(pack.items) && pack.items.some(it => authoredKeyOf(it) !== null);
    if (needsLedger) {
      if (!fs.existsSync(ledgerPath)) {
        errors.push(`verdicts: ${path.basename(ledgerPath)} not found; run "node tests/blind-reanswer.js ${expectedId}" then adjudicate any disagreement`);
      } else {
        let ledger = null;
        try { ledger = loadPackFile(ledgerPath); }
        catch (e) { errors.push(`verdicts: ${e.message}`); }
        if (ledger) {
          const lv = validateLedger(pack, ledger);
          lv.errors.forEach(e => errors.push(e));
          lv.warnings.forEach(wn => warnings.push(wn));
        }
      }
    }

    const nItems = Array.isArray(pack.items) ? pack.items.length : 0;
    console.log(`\n${expectedId}  (${nItems} item(s))`);
    errors.forEach(e => console.log('  ERROR   ' + e));
    warnings.forEach(w => console.log('  warning ' + w));
    if (!errors.length && !warnings.length) console.log('  clean');
    totalErrors += errors.length;
    totalWarnings += warnings.length;
  }

  totalErrors += discoveryErrors.length;
  console.log(`\n=== validate-pack: ${files.length} pack(s), ${totalErrors} error(s), ${totalWarnings} warning(s) ===`);
  if (totalErrors) { console.log('RESULT: FAIL'); return 1; }
  console.log('RESULT: ALL CLEAN');
  return 0;
}

module.exports = { validatePack, loadPackFile, ITEM_TYPES, AUTO_TYPES, CHOICE_TYPES, GENRES, FIG_KINDS, DOC_KINDS };

if (require.main === module) process.exit(main(process.argv));
