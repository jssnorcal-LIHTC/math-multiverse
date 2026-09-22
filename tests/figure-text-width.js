'use strict';
// figure-text-width.js -- every generated label is measured in a real browser against the width the
// generators sized it by.
//
// WHY THIS EXISTS.  Every generator in build/ lays text out by estimateTextWidth()
// (build/figure-tokens.js):  it sizes boxes, wraps phrases, draws underlines and refuses what will
// not fit by that one number.  Until 26-0921 the number was a flat 0.6 em per character, and no gate
// in this repo could see what that cost, because figure-derive, figure-docs, figure-fidelity and
// figure-reconcile all compare a render against the SAME estimate that produced it.  A figure whose
// estimate is 44% wider than its ink is byte-perfect by every one of them.  Measured when this gate
// was written, over 743 label runs in 48 figures, the flat estimate ran from 0.85 to 1.86 times the
// drawn width:  up to 86% fat on prose, and SHORT on two all-capitals runs, which is the direction
// that clips.
//
// So this gate asks the question none of the others can:  put every run in a browser, read the
// width the font actually draws, and compare.
//
//   UNDER    drawn wider than the estimate           a label can overrun the box sized for it
//   FAT      estimate more than FAT_BOUND x drawn     the layout defects Stage D existed to remove
//   UNKNOWN  a drawn character missing from the table   sized at the 1.0 em fallback;  safe, but the
//            table (build/measure-tnr.py) is incomplete and should be re-measured
//
// ITS OWN ENVIRONMENT IS MEASURED FIRST.  The table is Times New Roman's, and the SVGs declare that
// family with Liberation Serif, its metric twin, as the Linux fallback.  If neither is installed the
// browser falls back to some other serif and every comparison below would be against the wrong font,
// so a calibration string is rendered first and the gate REFUSES to report anything, clean or not,
// unless it matches the table.
//
// CONTROLS, both directions, in the same pass:  the old flat 0.6 estimator must trip FAT on the
// corpus, and the table shaved 5% must trip UNDER.  A gate whose mutant still passes is not a gate.
//
//   node tests/figure-text-width.js

if (process.stdout && process.stdout.setEncoding) process.stdout.setEncoding('utf8');
const fs = require('fs');
const path = require('path');
const { genTargets } = require('../build/figure-gen.js');
const { estimateTextWidth, GLYPH_ADVANCE, WIDTH_MARGIN, SVG_FONT_FAMILY } = require('../build/figure-tokens.js');

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) {
  try { chromium = require('playwright-core').chromium; }
  catch (e2) { console.error('figure-text-width: neither "playwright" nor "playwright-core" is installed.'); process.exit(2); }
}

const ROOT = path.join(__dirname, '..');
const FAT_BOUND = 1.10;          // measured max 1.069 (kerned short numerals like "11");  0.6 flat ran to 1.86
const CALIBRATION = 'Hamburgefonstiv WAVE 0123456789, "quoted" and the fourth chair';
const CALIBRATION_TOL = 0.005;   // the environment font must match the table to half a percent

// Every pack in the manifest, plus the two fixture packs the derive gate regenerates, so a fixture
// figure is held to the same standard as a shipped one.
function sources() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'manifest.json'), 'utf8'));
  const list = manifest.packs.map((e) => ({ label: e.id, pack: path.join(ROOT, 'packs', `${e.id}.json`) }));
  list.push({ label: 'fixture:figure-docs', pack: path.join(ROOT, 'tests', 'fixtures', 'figure-docs', 'pack.json') });
  list.push({ label: 'fixture:vis-demo', pack: path.join(ROOT, 'tests', 'fixtures', 'vis-demo', 'pack.json') });
  const figs = [];
  for (const s of list) {
    if (!fs.existsSync(s.pack)) continue;
    const pack = JSON.parse(fs.readFileSync(s.pack, 'utf8'));
    for (const f of genTargets(pack)) {
      const src = path.join(path.dirname(s.pack), f.src);
      figs.push({ where: `${s.label}/${f.id}`, file: fs.existsSync(src) ? src : path.join(ROOT, f.src) });
    }
  }
  return figs;
}

(async () => {
  const figs = sources();
  if (!figs.length) { console.error('figure-text-width: found zero generated figures -- refusing to report clean on nothing'); process.exit(1); }

  const launchOpts = { args: ['--disable-gpu', '--disable-gpu-compositing'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  // ---- the environment ----
  const cal = await page.evaluate(([txt, fam]) => {
    // Kerning OFF for the calibration only:  it checks the font's ADVANCES, which is what the table
    // is, and a kerned pair ("WA", "AV") narrows a run by up to a percent (measured 0.99% on this
    // very string with kerning on).  The labels below are measured kerned, exactly as they ship.
    document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="100" font-family="${fam.replace(/"/g, '&quot;')}"><text x="0" y="50" font-size="20" style="font-kerning:none;font-feature-settings:'kern' 0"></text></svg>`;
    const t = document.querySelector('text');
    t.textContent = txt;
    return t.getComputedTextLength();
  }, [CALIBRATION, SVG_FONT_FAMILY]);
  const calTable = estimateTextWidth(CALIBRATION, 20) / WIDTH_MARGIN;
  const calOff = Math.abs(cal / calTable - 1);
  console.log(`environment: calibration string drawn ${cal.toFixed(2)}px against a table width of ${calTable.toFixed(2)}px (${(100 * calOff).toFixed(2)}% off)`);
  if (calOff > CALIBRATION_TOL) {
    console.error(`figure-text-width: this browser has no font metric-compatible with the table (${SVG_FONT_FAMILY}).`);
    console.error('  Every comparison would be against the wrong font, so nothing is reported.  Install Times New Roman');
    console.error('  or Liberation Serif (Debian/Ubuntu: fonts-liberation) and re-run.');
    await browser.close();
    process.exit(1);
  }

  // ---- every run in every generated figure ----
  const runs = [];
  for (const f of figs) {
    const svg = fs.readFileSync(f.file, 'utf8');
    const got = await page.evaluate((markup) => {
      document.body.innerHTML = markup;
      const out = [];
      for (const t of document.querySelectorAll('svg text')) {
        const size = parseFloat(t.getAttribute('font-size'));
        const spans = t.querySelectorAll('tspan');
        for (const e of (spans.length ? [...spans] : [t])) {
          out.push({ text: e.textContent, size: parseFloat(e.getAttribute('font-size')) || size, drawn: e.getComputedTextLength() });
        }
      }
      return out;
    }, svg);
    for (const r of got) if (r.text && r.drawn > 0) runs.push({ where: f.where, ...r });
  }
  await browser.close();

  const problems = [];
  const judge = (estOf) => {
    const under = [], fat = [];
    for (const r of runs) {
      const est = estOf(r.text, r.size);
      if (r.drawn > est + 0.01) under.push({ r, est });
      else if (est > r.drawn * FAT_BOUND) fat.push({ r, est });
    }
    return { under, fat };
  };

  const live = judge(estimateTextWidth);
  for (const { r, est } of live.under) problems.push(`UNDER  ${r.where}: "${r.text}" draws ${r.drawn.toFixed(2)}px, estimated ${est.toFixed(2)}px`);
  for (const { r, est } of live.fat) problems.push(`FAT    ${r.where}: "${r.text}" draws ${r.drawn.toFixed(2)}px, estimated ${est.toFixed(2)}px (${(est / r.drawn).toFixed(3)}x, bound ${FAT_BOUND})`);
  const unknown = new Map();
  for (const r of runs) for (const ch of r.text) if (GLYPH_ADVANCE[ch] === undefined) unknown.set(ch, r.where);
  for (const [ch, where] of unknown) problems.push(`UNKNOWN  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(ch)} is drawn (${where}) but is not in build/tnr-advances.json;  add it to build/measure-tnr.py`);

  const ratios = runs.map((r) => estimateTextWidth(r.text, r.size) / r.drawn).sort((a, b) => a - b);
  const q = (f) => ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))];
  console.log(`measured ${runs.length} label run(s) in ${figs.length} generated figure(s)`);
  console.log(`  estimate / drawn:  min ${q(0).toFixed(3)}  median ${q(0.5).toFixed(3)}  max ${q(1).toFixed(3)}   (bounds: never under 1, never over ${FAT_BOUND})`);

  // ---- controls ----
  const flat = judge((t, s) => [...t].length * 0.6 * s);
  if (flat.fat.length === 0) problems.push('NEGATIVE CONTROL did not fire: the old flat 0.6 estimator passes the FAT bound, so this gate cannot see the defect it exists for');
  else console.log(`  control: the old flat 0.6 estimator trips FAT on ${flat.fat.length} of ${runs.length} runs and UNDER on ${flat.under.length}  (fired)`);
  const shaved = judge((t, s) => estimateTextWidth(t, s) * 0.95);
  if (shaved.under.length === 0) problems.push('NEGATIVE CONTROL did not fire: a table shaved 5% passes the UNDER bound, so this gate cannot see a clipping estimate');
  else console.log(`  control: the table shaved 5% trips UNDER on ${shaved.under.length} of ${runs.length} runs  (fired)`);

  if (problems.length) {
    console.log(`\n=== figure-text-width: ${problems.length} problem(s) ===`);
    problems.slice(0, 60).forEach((p) => console.log('  ' + p));
    if (problems.length > 60) console.log(`  ... and ${problems.length - 60} more`);
    console.log('\nRESULT: FAILED');
    process.exit(1);
  }
  console.log('\nRESULT: ALL CLEAN');
})().catch((e) => { console.error('figure-text-width: harness error:', e && e.stack || e); process.exit(2); });
