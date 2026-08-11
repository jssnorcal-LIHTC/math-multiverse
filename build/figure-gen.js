'use strict';
// figure-gen.js -- deterministic SVG chart generator for `gen: true` chart figures (Task 9).
//
// genSvg(dataTable, accentColor) is a PURE function of its two arguments: no Date, no
// Math.random, no locale-dependent number formatting (toFixed, never toLocaleString), no
// object-key iteration that could vary (every field is read by its own fixed literal name), and
// every computed coordinate is rounded to 2 decimals via n2() before it is written into the
// string. Same inputs -> byte-identical output, every run, every platform, forever. The derive
// gate (tests/figure-derive.js) depends on exactly that: it re-derives from a pack's own
// dataTable and byte-compares against the committed SVG src.
//
// FONT SIZING -- the 15px floor is a RENDERED floor, not an authored one (see task-9-report.md
// "rendered-px analysis" for the full walk). A static SVG loaded via <img> scales UNIFORMLY with
// its CSS box; it cannot resize its own text based on how large that box is. This chart is shown
// in three contexts (engine/engine.css): the passage strip (.mv-fig-img, 128x96, object-fit:
// contain -> the 800x450 native aspect is wider than the box, so it is width-bound: 128/800 =
// 0.16x native), the item rail (.mv-item-fig, 128x72 -- same 800:450 aspect as the box, also
// 0.16x), and the lightbox (.mv-lb-img, max-width:94vw / max-height:74vh, no explicit
// width/height, so it renders at its own intrinsic 800x450 UNLESS that exceeds the vw/vh caps).
// At the strip and rail, 0.16x scale means NO authored font size survives at a readable size
// (even at 96px authored the box is under 16px effective) -- exactly the class of defect the
// 26px-box/15px-text badge bug already exposed once in this phase. That is not a bug to fix here:
// every other figure kind's readable text (caption, credit) already lives OUTSIDE the image, in
// DOM text the strip never renders at all, so the strip/rail thumb has never been a "read this"
// surface for any figure kind. The lightbox is. At the project's landscape reference viewport
// (1024x768, the VIEWPORT every render-smoke gate in this repo already uses) 94vw=962px and
// 74vh=568px both exceed 800x450, so the chart renders at its full native size, 1.0x. In the
// iPad 6's PORTRAIT orientation (768 CSS px wide) 94vw=721.92px is narrower than the native
// 800px width, so the image is width-bound at 721.92/800 = 0.9024x. To clear the 15px floor at
// THAT worst case, authored text needs >= 15/0.9024 = 16.62px; every font size below is set well
// above that (18-22px), not just at the landscape-only minimum.
//
// CLI:
//   node build/figure-gen.js <pack.json> --outdir <dir>
//     Regenerates every `gen: true` chart figure declared in <pack.json> from its own dataTable,
//     writing <outdir>/<figureId>.svg for each. The accent color is resolved from a
//     manifest.json living in the SAME DIRECTORY as <pack.json> (the real packs/ layout and the
//     tests/fixtures/vis-demo/ layout both already put pack.json and manifest.json side by side),
//     matched by the pack's own meta.id against manifest.packs[].id, falling back to a fixed
//     default when no manifest or no matching color is found.

const fs = require('fs');
const path = require('path');

// ---- fixed geometry (see file header for why LEFT/BOTTOM grow past the nominal 48px margin) ----
const VB_W = 800, VB_H = 450;
const TOP = 48, RIGHT = 48;          // the brief's literal 48px margin: no competing content here
const LEFT = 72;                     // 48px + room for right-anchored y tick numbers at floor-size fonts
const BASE_BOTTOM = 74;              // room for the x tick-label row + the x axis-title row
const NOTE_ROW = 24;                 // one additional row of bottom margin per authored footer note
const TICKS = 5;                     // even divisions, both axes

const BG = '#0f1218';
const INK = '#e8eef7';               // MVFigures.TOKENS.ink
const GRID = 'rgba(255,255,255,0.12)'; // MVFigures.TOKENS.grid
const DEFAULT_ACCENT = '#7aa8ff';

const LABEL_FONT = 22;  // axis titles (xLabel/yLabel)
const TICK_FONT = 20;   // tick value labels
const NOTE_FONT = 18;   // footer notes
// Row offsets, measured DOWN from the plot's bottom edge (plotB), inside the bottom margin band:
const TICK_Y_OFF = 24, TITLE_Y_OFF = 50, NOTES_Y_START = 74;
const Y_LABEL_ROW = 28; // y-axis title sits horizontally in the (otherwise empty) top margin band

function n2(x) {
  // Fixed 2-decimal formatting with trailing zeros stripped. toFixed is spec-defined (not
  // locale-dependent, unlike toLocaleString), so this is the same string on every platform for
  // the same float, and it never emits a raw, arbitrarily-long float representation.
  let s = (Math.round(x * 100) / 100).toFixed(2);
  if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-0' ? '0' : s;
}

function fmtTick(v) {
  // Tick/category display values: rounded to 1 decimal, printed bare when that rounds to a whole
  // number ("452", not "452.0"). Same toFixed-based, locale-independent rule as n2.
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extent(values) {
  let lo = Infinity, hi = -Infinity;
  values.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; });
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }   // flat data: still a real, non-zero range to scale against
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

function scaleFn(domainLo, domainHi, rangeLo, rangeHi) {
  const span = (domainHi - domainLo) || 1;
  return (v) => rangeLo + ((v - domainLo) / span) * (rangeHi - rangeLo);
}

function tickValues(lo, hi, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(lo + (hi - lo) * (i / (count - 1)));
  return out;
}

// genSvg(dataTable, accentColor) -> string. See file header for the determinism and font-floor
// guarantees; this function trusts its dataTable (validate-pack.js already requires chart
// figures to carry one) and does not re-validate shape beyond simple Array.isArray guards.
function genSvg(dataTable, accentColor) {
  const dt = dataTable || {};
  const type = dt.type === 'bar' ? 'bar' : 'line';
  const series = Array.isArray(dt.series) ? dt.series : [];
  const notes = Array.isArray(dt.notes) ? dt.notes : [];
  const accent = accentColor || DEFAULT_ACCENT;

  const plotL = LEFT, plotR = VB_W - RIGHT, plotT = TOP;
  const plotB = VB_H - (BASE_BOTTOM + notes.length * NOTE_ROW);

  const allY = [];
  series.forEach((s) => (s.points || []).forEach((p) => allY.push(p[1])));
  const [yLo, yHi] = extent(allY);
  const yScale = scaleFn(yLo, yHi, plotB, plotT);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}" role="img">`);
  out.push(`<rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="${BG}" />`);
  // Left axis border only. The bottom border is NOT drawn separately here: yScale maps the
  // lowest y tick exactly onto plotB by construction, so the y-tick loop below already emits a
  // gridline at that exact position -- an explicit second line at the same y would be a byte-for-
  // byte duplicate, not a visual difference, so it is left out rather than shipped as dead ink.
  out.push(`<line x1="${plotL}" y1="${plotT}" x2="${plotL}" y2="${n2(plotB)}" stroke="${GRID}" stroke-width="1" />`);

  tickValues(yLo, yHi, TICKS).forEach((v) => {
    const py = n2(yScale(v));
    out.push(`<line x1="${plotL}" y1="${py}" x2="${plotR}" y2="${py}" stroke="${GRID}" stroke-width="1" />`);
    out.push(`<text x="${n2(plotL - 10)}" y="${py}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="end" dominant-baseline="middle">${esc(fmtTick(v))}</text>`);
  });

  let xScale = null, categories = null;
  if (type === 'bar') {
    const n = series.length ? (series[0].points || []).length : 0;
    categories = [];
    for (let i = 0; i < n; i++) categories.push((series[0].points[i] || [i])[0]);
  } else {
    const allX = [];
    series.forEach((s) => (s.points || []).forEach((p) => allX.push(p[0])));
    const [xLo, xHi] = extent(allX);
    xScale = scaleFn(xLo, xHi, plotL, plotR);
    tickValues(xLo, xHi, TICKS).forEach((v) => {
      const px = n2(xScale(v));
      out.push(`<text x="${px}" y="${n2(plotB + TICK_Y_OFF)}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="middle">${esc(fmtTick(v))}</text>`);
    });
  }

  if (type === 'bar') {
    const n = categories.length;
    const groupW = n ? (plotR - plotL) / n : 0;
    const gap = groupW * 0.18;
    const barW = series.length ? (groupW - gap * 2) / series.length : 0;
    series.forEach((s, si) => {
      (s.points || []).forEach((p, i) => {
        const groupX = plotL + i * groupW + gap;
        const bx = groupX + si * barW;
        const topY = yScale(p[1]);
        out.push(`<rect x="${n2(bx)}" y="${n2(topY)}" width="${n2(barW)}" height="${n2(plotB - topY)}" fill="${accent}" />`);
      });
    });
    categories.forEach((c, i) => {
      const cx = plotL + (i + 0.5) * groupW;
      out.push(`<text x="${n2(cx)}" y="${n2(plotB + TICK_Y_OFF)}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="middle">${esc(fmtTick(c))}</text>`);
    });
  } else {
    series.forEach((s) => {
      const pts = (s.points || []).map((p) => `${n2(xScale(p[0]))},${n2(yScale(p[1]))}`).join(' ');
      out.push(`<polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="3" />`);
    });
  }

  if (dt.yLabel) {
    out.push(`<text x="${plotL}" y="${Y_LABEL_ROW}" font-size="${LABEL_FONT}" fill="${INK}">${esc(dt.yLabel)}</text>`);
  }
  if (dt.xLabel) {
    const cx = n2((plotL + plotR) / 2);
    out.push(`<text x="${cx}" y="${n2(plotB + TITLE_Y_OFF)}" font-size="${LABEL_FONT}" fill="${INK}" text-anchor="middle">${esc(dt.xLabel)}</text>`);
  }

  notes.forEach((noteText, i) => {
    const ny = n2(plotB + NOTES_Y_START + i * NOTE_ROW);
    out.push(`<text x="${plotL}" y="${ny}" font-size="${NOTE_FONT}" fill="${INK}" fill-opacity="0.82">${esc(String(noteText))}</text>`);
  });

  out.push('</svg>');
  return out.join('\n') + '\n';
}

// Resolves accentColor for a pack from a sibling manifest.json (same directory as the pack file),
// matched by meta.id. Shared by the CLI below AND tests/figure-derive.js, so the two can never
// disagree about which color a given pack's charts should use.
function resolveAccent(packDir, pack) {
  const manifestPath = path.join(packDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return DEFAULT_ACCENT;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const id = pack.meta && pack.meta.id;
    const entry = (manifest.packs || []).find((p) => p && p.id === id);
    return (entry && entry.color) || DEFAULT_ACCENT;
  } catch (e) { return DEFAULT_ACCENT; }
}

function main(argv) {
  const args = argv.slice(2);
  const packPath = args[0];
  const outdir = args[args.indexOf('--outdir') + 1];
  if (!packPath || args.indexOf('--outdir') === -1 || !outdir) {
    console.error('usage: node build/figure-gen.js <pack.json> --outdir <dir>');
    return 2;
  }
  const absPack = path.isAbsolute(packPath) ? packPath : path.join(process.cwd(), packPath);
  if (!fs.existsSync(absPack)) { console.error(`figure-gen: pack not found: ${absPack}`); return 2; }
  let pack;
  try { pack = JSON.parse(fs.readFileSync(absPack, 'utf8')); }
  catch (e) { console.error(`figure-gen: invalid JSON in ${absPack}: ${e.message}`); return 2; }

  const packDir = path.dirname(absPack);
  const accent = resolveAccent(packDir, pack);
  const targets = (pack.figures || []).filter((f) => f && f.kind === 'chart' && f.gen === true);
  if (!targets.length) {
    console.log('figure-gen: no gen:true chart figures in this pack; nothing to do');
    return 0;
  }
  fs.mkdirSync(outdir, { recursive: true });
  for (const fig of targets) {
    const svg = genSvg(fig.dataTable, accent);
    const outPath = path.join(outdir, `${fig.id}.svg`);
    fs.writeFileSync(outPath, svg, 'utf8');
    console.log(`figure-gen: wrote ${outPath} (accent ${accent})`);
  }
  return 0;
}

module.exports = { genSvg, resolveAccent };

if (require.main === module) process.exit(main(process.argv));
