'use strict';
// figure-gen.js -- deterministic SVG chart generator for `gen: true` chart figures (Task 9,
// fix round 1). genSvg(dataTable, accentColor) is a PURE function of its two arguments: no Date,
// no Math.random, no locale-dependent number formatting (toFixed, never toLocaleString), no
// object-key iteration that could vary, and every computed coordinate is rounded to 2 decimals
// via n2() before it is written into the string. Same inputs -> byte-identical output, every run,
// every platform, forever.
//
// FIX ROUND 1 framing (task-9-fix-round-1.md): the derive gate proves REPRODUCIBILITY, not
// TRUTHFULNESS -- both sides of its byte-compare come from this same generator, so a bug IN this
// file reproduces perfectly and the gate stays green while the picture disagrees with its own
// dataTable. This file is the load-bearing one for that guarantee: every function below exists to
// make what genSvg DRAWS provably match what dataTable SAYS, not just to match itself twice.
//
// Layout is centralized in layout(dataTable): it is the ONE place margins, domains, ticks, and
// scales are computed, called by genSvg to draw and exported so tests/figure-derive.js can assert
// geometry (e.g. "every bar's box lies inside the plot rect") against the SAME numbers the
// generator actually used, never a second, independently-guessed copy that could drift.
//
// FONT SIZING -- the 15px floor is a RENDERED floor, not an authored one. A static SVG loaded via
// <img> scales UNIFORMLY with its CSS box. At the strip (.mv-fig-img, 128x96, object-fit: contain
// against an 800x450 native chart) and the item rail (.mv-item-fig, 128x72, same aspect) the scale
// is 128/800 = 0.16x regardless of authored size -- no font size survives there, matching how
// every other figure kind's readable text (caption, credit) already lives outside the image. The
// lightbox (.mv-lb-img, max-width:94vw/max-height:74vh, no explicit width/height) is the one
// context this generator sizes text for: at the project's reference viewport (1024x768) the chart
// renders at its full native 1.0x; at the iPad 6's PORTRAIT viewport (768 CSS px) 94vw=721.92px is
// narrower than the native 800px width, so it renders at 721.92/800 = 0.9024x. Every font size
// below clears 15/0.9024 = 16.62px with margin (18-22px authored).
//
// PANELS MODE (Task 4, V2): `dataTable.panels` is an additive, opt-in second shape -- a chart with
// two data series whose UNITS differ (ppm vs percent) or whose comparison is naturally two
// side-by-side sub-charts (rainfall vs temperature swing, both by post) must never share one
// y-scale, per the standing figure-truth rule, and the single-series refusal a few lines below is
// deliberately NOT relaxed for that case: a shared scale would flatten one series onto the floor,
// which is worse than refusing. Panels mode draws exactly TWO vertically-stacked mini-charts
// (`layoutPanels`/`genSvgPanels`), each with its OWN y-axis and y-scale, sharing left/right margins
// (so the two plots line up) and a single shared x-axis at the bottom. Every panel is individually
// validated by the SAME `validateTable()` a normal single-series chart uses, so a panel can never
// smuggle in a second series or a non-finite point -- this is genuinely two independent charts
// stacked in one canvas, not a new multi-series drawing primitive. `genSvg()` dispatches to it when
// `dataTable.panels` is present; the ORIGINAL `dataTable.type`/`.series` path below is completely
// untouched, so every existing chart and every existing test keeps its original behavior byte for
// byte. Bar-type panels additionally support `dataTable.categoryLabels` (an array of strings) so an
// axis comparing named things ("Sable Flats" vs "Cairn Bay") is not forced to fall back to the
// numeric `n2()` formatting the plain bar path uses for its category axis.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// ---- fixed geometry ----
const VB_W = 800, VB_H = 450;
const TOP = 48, RIGHT = 48;          // the brief's literal 48px margin: nothing competes here
const MIN_LEFT = 48;                 // floor matching the brief's literal margin for short labels
const BASE_BOTTOM = 74;              // x tick-label row + x axis-title row
const NOTE_ROW = 24;                 // one row of bottom margin per authored footer note
const MAX_NOTES = 4;                 // fix round 1, item 10: clamp so the bottom band cannot grow
                                      // without limit and invert the plot; extra notes are dropped
const MIN_PLOT_H = 120;              // stated invariant; unreachable given MAX_NOTES (worst case
                                      // bottom band = 74 + 4*24 = 170, plot height = 450-48-170 =
                                      // 232), kept and asserted rather than left implicit
const PANEL_GAP = 40;                // vertical gap between the two stacked panels in panels mode;
                                      // sized so a panel's own yLabel (drawn just above its plot,
                                      // LABEL_FONT=22, ascent ~18px) never overlaps the panel ABOVE
                                      // it: the label sits at (panelTop - 12), 10px+ clear of the
                                      // previous panel's plotBottom even at the tightest notes case
const MIN_PANEL_H = 90;              // floor for EACH panel's own plot height (roughly half of
                                      // MIN_PLOT_H, since two panels split one canvas); worst case
                                      // with 4 notes: (450-48-(74+96)-40)/2 = 96, still above floor
const TICKS_TARGET = 5;              // even divisions, both axes (nice-rounded, see niceTicks)
const GLYPH_W = 0.6;                 // width-per-character estimate at font-size 1 (the brief's own
                                      // "glyph count times about 0.6 times the font" heuristic);
                                      // shared by the left-margin sizing below AND the text-bbox
                                      // assertion in tests/figure-derive.js, so the two can never
                                      // disagree about how wide a label is estimated to be
const LABEL_AXIS_GAP = 10;           // gap between a right-anchored tick label and the axis line
const MARKER_R = 4;

const BG = '#0f1218';
const INK = '#e8eef7';                    // MVFigures.TOKENS.ink -- twin-checked in tests
const GRID = 'rgba(255,255,255,0.12)';    // MVFigures.TOKENS.grid -- CHROME ONLY (axis border);
                                           // twin-checked in tests
// Fix round 1, item 9: the value-bearing gridlines measured at ~1.1-1.4:1 contrast against BG
// (imperceptible). PLOT_GRID is a NEW, higher-contrast value (~4.7:1, see task-9-report.md for the
// computed WCAG relative-luminance ratio) used only for gridlines that align to a specific
// readable tick value; TOKENS.grid stays reserved for structural chrome (the axis border), per the
// brief's own "keeping TOKENS.grid for chrome" instruction.
const PLOT_GRID = 'rgba(232,238,247,0.5)';
const DEFAULT_ACCENT = '#7aa8ff';

const LABEL_FONT = 22, TICK_FONT = 20, NOTE_FONT = 18;
const TICK_Y_OFF = 24, TITLE_Y_OFF = 50, NOTES_Y_START = 74;
const Y_LABEL_ROW = 28;
const TICK_LABEL_H = TICK_FONT * 1.1; // vertical extent of a horizontally-set tick label's own
                                       // box at TICK_FONT -- 22px at TICK_FONT=20, confirmed with
                                       // a real browser's getBBox() against this generator's own
                                       // committed SVG output, not a guess. A full-height chart's
                                       // plot easily clears MIN_PLOT_H/TICKS_TARGET against this;
                                       // a panels-mode panel, at roughly a third the height, does
                                       // not -- see niceTicksFit below, used only by layoutPanels().
const MIN_TICK_GAP = 6;               // required CLEAR space between two adjacent tick labels'
                                       // boxes, on top of TICK_LABEL_H itself -- team-lead finding:
                                       // capping divisions at panelH/TICK_LABEL_H alone reserves
                                       // nothing BETWEEN labels, so it permits exact-touching (0px
                                       // clear), which dome-drift's CO2 panel landed on precisely.
                                       // Zero clear gap measures clean in one engine (Chromium) but
                                       // the delivery target is iPad Safari, whose font metrics will
                                       // not be pixel-identical; this buffer is the margin against
                                       // that variance, not an aesthetic preference.

function n2(x) {
  // Fixed 2-decimal formatting with trailing zeros stripped. toFixed is spec-defined (not
  // locale-dependent, unlike toLocaleString), so this is the same string on every platform for
  // the same float. Used for BOTH pixel coordinates and tick/category value labels.
  let s = (Math.round(x * 100) / 100).toFixed(2);
  if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-0' ? '0' : s;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hp(v) {
  // Half-pixel snap for STROKED GRIDLINE coordinates only (fix round 1, item 9): a 1px stroke
  // centered on an integer coordinate straddles two device pixel rows and blurs; offsetting by
  // 0.5 lands it on exactly one row. Never applied to plotted DATA geometry (polyline points, bar
  // boxes, markers), which must stay exactly proportional to the data, not pixel-snapped.
  return Math.round(v) + 0.5;
}

function refuse(reason) {
  // Fix round 1, item 8: genSvg REFUSES shapes it cannot draw truthfully rather than drawing
  // something off-canvas or silently misleading. The figure id is added by renderFigure() below,
  // which is the layer that actually has one; genSvg's own interface (dataTable, accentColor) does
  // not carry a figure id and is not changed here, per the locked test interface.
  throw new Error(reason);
}

function paddedExtent(values) {
  let lo = Infinity, hi = -Infinity;
  values.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; });
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  const rawLo = lo;   // the ACTUAL data minimum, captured before the flat-data widening below ever
                       // touches lo, since the zero-floor rule below must judge the real values, not
                       // an artificially widened stand-in
  if (lo === hi) { lo -= 1; hi += 1; }   // flat data: still a real, non-zero range to scale against
  const pad = (hi - lo) * 0.08;
  const paddedLo = lo - pad;
  // Team-lead fix round: a quantity whose real data never goes negative (rainfall, a temperature
  // swing, a season number) must never be OFFERED a negative axis floor just because the 8% pad
  // pushed under zero. Clamp the floor to zero whenever the series' own minimum was already >= 0;
  // a genuinely negative series (e.g. the bar-goes-below-zero test fixture) is untouched, since its
  // rawLo is itself negative and the clamp condition never fires for it.
  const clampedLo = rawLo >= 0 ? Math.max(0, paddedLo) : paddedLo;
  return [clampedLo, hi + pad];
}

function scaleFn(domainLo, domainHi, rangeLo, rangeHi) {
  const span = (domainHi - domainLo) || 1;
  return (v) => rangeLo + ((v - domainLo) / span) * (rangeHi - rangeLo);
}

// Fix round 1, item 9: "nice" tick steps (1, 2 or 5 times a power of ten) so ticks land on round,
// readable values instead of the raw 8%-padded extremes. integerOnly forces a whole-number step
// (>= 1), used for line-chart x ticks when every input x value is itself an integer.
function niceStep(range, targetCount, integerOnly) {
  const rawStep = range / Math.max(targetCount, 1);
  let mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  if (integerOnly) mag = Math.max(1, mag);
  const norm = rawStep / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * mag;
}

function niceTicks(lo, hi, targetCount, integerOnly) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, targetCount, integerOnly);
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  const n = Math.max(1, Math.round((niceHi - niceLo) / step));
  const ticks = [];
  for (let i = 0; i <= n; i++) ticks.push(niceLo + i * step);
  return { ticks, lo: niceLo, hi: niceHi };
}

// Panel tick density fix: a height-aware wrapper around niceTicks(), used only where the available
// plot height is short enough that the flat TICKS_TARGET can produce labels too dense to avoid
// overlapping each other (panels mode -- see layoutPanels). maxDivisions is the most divisions
// TICK_LABEL_H-tall labels can occupy in a plot of the caller's own height with zero label-to-
// label overlap (panelH / TICK_LABEL_H). targetCount is capped to it going in, but niceStep's own
// ceil/floor widening of [lo,hi] out to a round number can still add a division beyond whatever
// target was asked for -- dome-drift's own CO2 panel does exactly this today, asking for 5 and
// getting 6 -- so the actual result is verified after the fact and backed off further only if it
// still does not fit, rather than trusting the target as a hard cap.
function niceTicksFit(lo, hi, targetCount, integerOnly, maxDivisions) {
  let target = Math.min(targetCount, maxDivisions);
  let nice = niceTicks(lo, hi, target, integerOnly);
  while (nice.ticks.length - 1 > maxDivisions && target > 1) {
    target -= 1;
    nice = niceTicks(lo, hi, target, integerOnly);
  }
  return nice;
}

function estimateTextWidth(text, fontSize) {
  return String(text).length * GLYPH_W * fontSize;
}

// Fix round 1, item 4: sized from the ACTUAL widest tick label rather than a fixed guess. The
// original fixed-72px margin clipped any label wider than ~5 glyphs off the left edge of the
// canvas, which is a data-truth defect (the chart then DISPLAYS a value differing from the
// dataTable), not a cosmetic one.
function leftMarginFor(tickLabels) {
  const widest = tickLabels.reduce((m, s) => Math.max(m, estimateTextWidth(s, TICK_FONT)), 0);
  return Math.max(MIN_LEFT, Math.ceil(widest) + LABEL_AXIS_GAP + LABEL_AXIS_GAP);
}

// ---- refusals (fix round 1, items 5 and 8): genSvg REFUSES what it cannot draw truthfully ----
function validateTable(dt, type) {
  const series = Array.isArray(dt.series) ? dt.series : [];
  if (series.length === 0) refuse('dataTable has no series to plot');

  if (series.length > 1) {
    if (type === 'bar') {
      const counts = series.map((s) => (Array.isArray(s.points) ? s.points.length : 0));
      if (!counts.every((c) => c === counts[0])) {
        refuse(`bar chart series have unequal point counts (${counts.join(', ')}); no multi-series convention exists yet`);
      }
    }
    refuse(`chart declares ${series.length} series; multi-series charts are refused for now (every series would paint in the same accent with no legend, and series[].label is never rendered, so the picture could not state which series is which)`);
  }

  const points = Array.isArray(series[0].points) ? series[0].points : [];
  if (points.length === 0) refuse('series has no points to plot');

  points.forEach((p, i) => {
    const x = p && p[0], y = p && p[1];
    if (typeof x !== 'number' || !Number.isFinite(x)) refuse(`series point ${i} has a non-finite x value (${JSON.stringify(x)}); refusing rather than fabricating a domain around it`);
    if (typeof y !== 'number' || !Number.isFinite(y)) refuse(`series point ${i} has a non-finite y value (${JSON.stringify(y)}); refusing rather than fabricating a domain around it`);
  });

  return points;
}

// Computes every layout decision genSvg needs to draw, and the ONLY place that math lives:
// tests/figure-derive.js calls this directly to assert geometry (bar boxes inside the plot rect,
// etc.) against the SAME numbers genSvg used, so the two can never independently drift. Throws
// (via refuse()) exactly when genSvg itself would refuse to draw the table.
function layout(dataTable) {
  const dt = dataTable || {};
  const type = dt.type === 'bar' ? 'bar' : 'line';
  const points = validateTable(dt, type);

  const notes = (Array.isArray(dt.notes) ? dt.notes : []).slice(0, MAX_NOTES);
  const plotT = TOP;
  const plotB = VB_H - (BASE_BOTTOM + notes.length * NOTE_ROW);
  if (plotB - plotT < MIN_PLOT_H) {
    refuse(`too many footer notes; the plot area would collapse to ${n2(plotB - plotT)}px, below the ${MIN_PLOT_H}px minimum`);
  }

  const allY = points.map((p) => p[1]);
  const yDomainRaw = type === 'bar'
    ? paddedExtent([Math.min(0, ...allY), Math.max(0, ...allY)])   // item 2: bar spans zero
    : paddedExtent(allY);
  const yNice = niceTicks(yDomainRaw[0], yDomainRaw[1], TICKS_TARGET, false);
  const yTickLabels = yNice.ticks.map((v) => n2(v));
  const plotL = leftMarginFor(yTickLabels);
  const plotR = VB_W - RIGHT;
  const yScale = scaleFn(yNice.lo, yNice.hi, plotB, plotT);

  let xScale = null, xTicks = null, categories = null;
  if (type === 'line') {
    const allX = points.map((p) => p[0]);
    const xIsInt = allX.every((v) => Number.isInteger(v));
    const xDomainRaw = paddedExtent(allX);
    const xNice = niceTicks(xDomainRaw[0], xDomainRaw[1], TICKS_TARGET, xIsInt);
    xTicks = xNice.ticks;
    xScale = scaleFn(xNice.lo, xNice.hi, plotL, plotR);
  } else {
    categories = points.map((p) => p[0]);
  }

  return { type, points, notes, plotL, plotR, plotT, plotB, yTicks: yNice.ticks, yTickLabels, yScale, xScale, xTicks, categories };
}

// ---- panels mode (see file header): two independently-scaled mini-charts stacked in one canvas ----

// Validates the panels shape, refusing anything genSvgPanels could not draw truthfully. Each panel
// is checked by the EXACT SAME validateTable() a normal chart uses, so a panel-level multi-series
// or non-finite-point slip is refused with the identical, already-tested message.
function validatePanelsTable(dt) {
  const panels = Array.isArray(dt.panels) ? dt.panels : null;
  if (!panels) refuse('dataTable has no panels array');
  if (panels.length !== 2) refuse(`panels: exactly 2 panels are supported, got ${panels.length}`);

  const type = (panels[0] && panels[0].type === 'bar') ? 'bar' : 'line';
  panels.forEach((p, i) => {
    const pt = (p && p.type === 'bar') ? 'bar' : 'line';
    if (pt !== type) refuse(`panels[${i}].type ("${pt}") does not match panels[0].type ("${type}"); mixed-type panels are refused`);
  });

  const pointsPerPanel = panels.map((p, i) => {
    try { return validateTable(p, type); }
    catch (e) { refuse(`panels[${i}]: ${e.message}`); }
  });

  if (type === 'bar') {
    const labels = Array.isArray(dt.categoryLabels) ? dt.categoryLabels : null;
    if (!labels || !labels.length) refuse('panels: bar-type panels require dataTable.categoryLabels');
    pointsPerPanel.forEach((pts, i) => {
      if (pts.length !== labels.length) refuse(`panels[${i}]: has ${pts.length} point(s) but categoryLabels has ${labels.length} entr(y/ies)`);
    });
  } else {
    // A SHARED x-axis only means something if every panel plots the same x values; refuse rather
    // than silently drawing two panels whose day-90/104/118 columns do not actually line up.
    const xs0 = pointsPerPanel[0].map((p) => p[0]);
    pointsPerPanel.forEach((pts, i) => {
      const xs = pts.map((p) => p[0]);
      const mismatch = xs.length !== xs0.length || xs.some((v, j) => v !== xs0[j]);
      if (mismatch) refuse(`panels[${i}]: x-values (${JSON.stringify(xs)}) do not match panels[0]'s (${JSON.stringify(xs0)}); a shared x-axis requires identical x values across panels`);
    });
  }

  return { type, pointsPerPanel };
}

// Mirrors layout(): the ONE place panels-mode margins, per-panel y-domains, and the shared x-domain
// are computed, exported so tests/figure-derive.js can assert panel geometry against these same
// numbers. Throws exactly when genSvgPanels would refuse.
function layoutPanels(dataTable) {
  const dt = dataTable || {};
  const { type, pointsPerPanel } = validatePanelsTable(dt);
  const panels = dt.panels;

  const notes = (Array.isArray(dt.notes) ? dt.notes : []).slice(0, MAX_NOTES);
  const outerT = TOP;
  const outerB = VB_H - (BASE_BOTTOM + notes.length * NOTE_ROW);
  const availH = outerB - outerT - PANEL_GAP;
  const panelH = availH / 2;
  if (panelH < MIN_PANEL_H) {
    refuse(`too many footer notes; each panel would collapse to ${n2(panelH)}px, below the ${MIN_PANEL_H}px minimum`);
  }

  // Panel tick density fix: cap divisions to what panelH can actually hold at TICK_LABEL_H PLUS a
  // required MIN_TICK_GAP clear space before computing each panel's own ticks, rather than handing
  // every panel the same flat TICKS_TARGET a full-height chart uses. A panels-mode panel is roughly
  // a third the height of a full plot, so the flat target can (and, pre-fix, did -- fig-climographs'
  // rainfall panel) ask for more labels than the panel's own height can hold without their boxes
  // overlapping. Dividing by TICK_LABEL_H alone would reserve nothing BETWEEN labels and permit
  // exact-touching (dome-drift's CO2 panel landed on precisely that, 0px clear, before this second
  // pass); the +MIN_TICK_GAP margin exists for that reason. maxTickDivisions only ever REDUCES from
  // TICKS_TARGET, never grows past it, so a panel tall enough to clear the flat default at the
  // required gap renders byte-identical to before.
  const maxTickDivisions = Math.max(1, Math.floor(panelH / (TICK_LABEL_H + MIN_TICK_GAP)));

  // Per-panel y-domain/ticks first, THEN a single shared left margin sized from the widest tick
  // label across BOTH panels, so the two plots' left edges line up vertically.
  const panelYNice = pointsPerPanel.map((points) => {
    const allY = points.map((p) => p[1]);
    const yDomainRaw = type === 'bar'
      ? paddedExtent([Math.min(0, ...allY), Math.max(0, ...allY)])
      : paddedExtent(allY);
    return niceTicksFit(yDomainRaw[0], yDomainRaw[1], TICKS_TARGET, false, maxTickDivisions);
  });
  const plotL = panelYNice.reduce((m, yNice) => Math.max(m, leftMarginFor(yNice.ticks.map((v) => n2(v)))), MIN_LEFT);
  const plotR = VB_W - RIGHT;

  const plotTs = [outerT, outerT + panelH + PANEL_GAP];
  const plotBs = [outerT + panelH, outerB];

  const panelLayouts = panels.map((p, i) => {
    const yNice = panelYNice[i];
    const yScale = scaleFn(yNice.lo, yNice.hi, plotBs[i], plotTs[i]);
    return {
      points: pointsPerPanel[i],
      yTicks: yNice.ticks,
      yTickLabels: yNice.ticks.map((v) => n2(v)),
      yScale,
      plotT: plotTs[i],
      plotB: plotBs[i],
      yLabel: p.yLabel,
    };
  });

  let xScale = null, xTicks = null, categories = null;
  if (type === 'line') {
    const allX = pointsPerPanel[0].map((p) => p[0]);
    const xIsInt = allX.every((v) => Number.isInteger(v));
    const xDomainRaw = paddedExtent(allX);
    const xNice = niceTicks(xDomainRaw[0], xDomainRaw[1], TICKS_TARGET, xIsInt);
    xTicks = xNice.ticks;
    xScale = scaleFn(xNice.lo, xNice.hi, plotL, plotR);
  } else {
    categories = pointsPerPanel[0].map((p) => p[0]);
  }

  return { type, notes, plotL, plotR, panelLayouts, xScale, xTicks, categories };
}

// genSvgPanels(dataTable, accentColor) -> string. Same determinism/font-floor guarantees as
// genSvg(); draws the two panels top to bottom, then one shared x-axis/xLabel/notes band at the
// very bottom, using the LAST panel's plotB exactly the way the single-chart path uses its own.
function genSvgPanels(dataTable, accentColor) {
  const dt = dataTable || {};
  const g = layoutPanels(dt);
  const accent = accentColor || DEFAULT_ACCENT;
  const { type, notes, plotL, plotR, panelLayouts, xScale, xTicks, categories } = g;
  const lastPlotB = panelLayouts[panelLayouts.length - 1].plotB;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}" role="img">`);
  out.push(`<rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="${BG}" />`);

  let groupW = 0, gap = 0, barW = 0;
  if (type === 'bar') {
    const n = categories.length;
    groupW = n ? (plotR - plotL) / n : 0;
    gap = groupW * 0.18;
    barW = groupW - gap * 2;
  }

  panelLayouts.forEach((panel) => {
    out.push(`<line x1="${hp(plotL)}" y1="${panel.plotT}" x2="${hp(plotL)}" y2="${n2(panel.plotB)}" stroke="${GRID}" stroke-width="1" />`);

    panel.yTicks.forEach((v, i) => {
      const isZeroBaseline = type === 'bar' && Math.abs(v) < 1e-9;
      const stroke = isZeroBaseline ? INK : PLOT_GRID;
      const py = hp(panel.yScale(v));
      out.push(`<line x1="${plotL}" y1="${py}" x2="${plotR}" y2="${py}" stroke="${stroke}" stroke-width="${isZeroBaseline ? 1.5 : 1}" />`);
      out.push(`<text x="${n2(plotL - LABEL_AXIS_GAP)}" y="${n2(panel.yScale(v))}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="end" dominant-baseline="middle">${esc(panel.yTickLabels[i])}</text>`);
    });

    if (panel.yLabel) {
      out.push(`<text x="${plotL}" y="${n2(panel.plotT - 12)}" font-size="${LABEL_FONT}" fill="${INK}">${esc(panel.yLabel)}</text>`);
    }

    if (type === 'line') {
      const pts = panel.points.map((p) => `${n2(xScale(p[0]))},${n2(panel.yScale(p[1]))}`).join(' ');
      out.push(`<polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="3" />`);
      panel.points.forEach((p) => {
        out.push(`<circle cx="${n2(xScale(p[0]))}" cy="${n2(panel.yScale(p[1]))}" r="${MARKER_R}" fill="${accent}" />`);
      });
    } else {
      const zeroY = panel.yScale(0);
      panel.points.forEach((p, i) => {
        const x = plotL + i * groupW + gap;
        const valY = panel.yScale(p[1]);
        const top = Math.min(zeroY, valY);
        const h = Math.abs(valY - zeroY);
        out.push(`<rect x="${n2(x)}" y="${n2(top)}" width="${n2(barW)}" height="${n2(h)}" fill="${accent}" />`);
      });
    }
  });

  if (type === 'line') {
    xTicks.forEach((v) => {
      out.push(`<text x="${n2(xScale(v))}" y="${n2(lastPlotB + TICK_Y_OFF)}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="middle">${esc(n2(v))}</text>`);
    });
  } else {
    categories.forEach((c, i) => {
      const cx = plotL + (i + 0.5) * groupW;
      const label = (Array.isArray(dt.categoryLabels) && dt.categoryLabels[i] !== undefined) ? dt.categoryLabels[i] : n2(c);
      out.push(`<text x="${n2(cx)}" y="${n2(lastPlotB + TICK_Y_OFF)}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="middle">${esc(label)}</text>`);
    });
  }

  if (dt.xLabel) {
    const cx = n2((plotL + plotR) / 2);
    out.push(`<text x="${cx}" y="${n2(lastPlotB + TITLE_Y_OFF)}" font-size="${LABEL_FONT}" fill="${INK}" text-anchor="middle">${esc(dt.xLabel)}</text>`);
  }
  notes.forEach((noteText, i) => {
    const ny = n2(lastPlotB + NOTES_Y_START + i * NOTE_ROW);
    out.push(`<text x="${plotL}" y="${ny}" font-size="${NOTE_FONT}" fill="${INK}" fill-opacity="0.82">${esc(String(noteText))}</text>`);
  });

  out.push('</svg>');
  return out.join('\n') + '\n';
}

// genSvg(dataTable, accentColor) -> string. See file header for the determinism and font-floor
// guarantees. Throws (does not return) for any shape layout()/validateTable() refuses.
function genSvg(dataTable, accentColor) {
  const dt = dataTable || {};
  if (Array.isArray(dt.panels)) return genSvgPanels(dt, accentColor);
  const g = layout(dt);
  const accent = accentColor || DEFAULT_ACCENT;
  const { type, points, notes, plotL, plotR, plotT, plotB, yTicks, yTickLabels, yScale, xScale, xTicks, categories } = g;

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${VB_W}" height="${VB_H}" viewBox="0 0 ${VB_W} ${VB_H}" role="img">`);
  out.push(`<rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="${BG}" />`);
  // Left axis border only (CHROME: TOKENS.grid). The bottom border is NOT drawn separately: the
  // lowest y tick maps exactly onto plotB by construction (niceTicks' own lo IS the scale's
  // domain floor), so the tick loop below already emits a gridline at that exact position -- a
  // second explicit line there would be a byte-for-byte duplicate, not a visual difference.
  out.push(`<line x1="${hp(plotL)}" y1="${plotT}" x2="${hp(plotL)}" y2="${n2(plotB)}" stroke="${GRID}" stroke-width="1" />`);

  yTicks.forEach((v, i) => {
    // Fix round 1, item 2: for a bar chart, whichever tick is (numerically) zero IS the explicit
    // zero-baseline -- niceTicks' own construction guarantees 0 is always exactly one of the
    // generated ticks whenever the domain spans zero, so this recolors that one tick's gridline
    // to full ink contrast rather than drawing a second, overlapping line at the same position.
    const isZeroBaseline = type === 'bar' && Math.abs(v) < 1e-9;
    const stroke = isZeroBaseline ? INK : PLOT_GRID;
    const py = hp(yScale(v));
    out.push(`<line x1="${plotL}" y1="${py}" x2="${plotR}" y2="${py}" stroke="${stroke}" stroke-width="${isZeroBaseline ? 1.5 : 1}" />`);
    out.push(`<text x="${n2(plotL - LABEL_AXIS_GAP)}" y="${n2(yScale(v))}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="end" dominant-baseline="middle">${esc(yTickLabels[i])}</text>`);
  });

  if (type === 'line') {
    xTicks.forEach((v) => {
      out.push(`<text x="${n2(xScale(v))}" y="${n2(plotB + TICK_Y_OFF)}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="middle">${esc(n2(v))}</text>`);
    });
    const pts = points.map((p) => `${n2(xScale(p[0]))},${n2(yScale(p[1]))}`).join(' ');
    out.push(`<polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="3" />`);
    // Fix round 1, item 9: a marker at every data point. Deterministic, byte-stable, and it is
    // also what makes a single-point series visible without a refusal (see validateTable).
    points.forEach((p) => {
      out.push(`<circle cx="${n2(xScale(p[0]))}" cy="${n2(yScale(p[1]))}" r="${MARKER_R}" fill="${accent}" />`);
    });
  } else {
    const n = categories.length;
    const groupW = n ? (plotR - plotL) / n : 0;
    const gap = groupW * 0.18;
    const barW = groupW - gap * 2;
    const zeroY = yScale(0);
    points.forEach((p, i) => {
      const x = plotL + i * groupW + gap;
      const valY = yScale(p[1]);
      const top = Math.min(zeroY, valY);
      const h = Math.abs(valY - zeroY);
      out.push(`<rect x="${n2(x)}" y="${n2(top)}" width="${n2(barW)}" height="${n2(h)}" fill="${accent}" />`);
    });
    categories.forEach((c, i) => {
      const cx = plotL + (i + 0.5) * groupW;
      out.push(`<text x="${n2(cx)}" y="${n2(plotB + TICK_Y_OFF)}" font-size="${TICK_FONT}" fill="${INK}" text-anchor="middle">${esc(n2(c))}</text>`);
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

// Fix round 1, item 8: the layer that actually has a figure id. genSvg's own interface stays
// (dataTable, accentColor) per the locked test contract; every real call site (the CLI and the
// derive gate) goes through this wrapper instead, so a refusal is ALWAYS reported with both the
// figure id and the reason, never just the bare reason.
function renderFigure(fig, accentColor) {
  try { return genSvg(fig.dataTable, accentColor); }
  catch (e) { throw new Error(`figure "${fig && fig.id}": ${e.message}`); }
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

function chartTargets(pack) {
  return (pack.figures || []).filter((f) => f && f.kind === 'chart' && f.gen === true);
}

// Fix round 1, item 6: writes to the figure's OWN DECLARED src, resolved against the repo root --
// i.e. the exact file tests/figure-derive.js compares against -- by default. The original
// behavior (always writing <outdir>/<figureId>.svg) produced an ORPHAN file whenever a figure's id
// did not match its src's basename (true of every real and fixture figure so far: "fig-chart" vs
// "f-chart.svg"), leaving the actually-compared file stale. `opts.outdir`, when given, is an
// explicit DRY-RUN override: it writes `<outdir>/<basename of src>.svg` instead, without touching
// the real committed file.
//
// Returns { written: [{id, path, accent}], refused: [{id, reason}] } -- a REFUSED figure does not
// abort the batch; every other gen:true figure in the pack still gets its chance.
function regenerate(pack, packDir, opts) {
  const accent = resolveAccent(packDir, pack);
  const written = [], refused = [];
  for (const fig of chartTargets(pack)) {
    try {
      const svg = renderFigure(fig, accent);
      const target = (opts && opts.outdir)
        ? path.join(opts.outdir, path.basename(fig.src))
        : path.join(REPO_ROOT, fig.src);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, svg, 'utf8');
      written.push({ id: fig.id, path: target, accent });
    } catch (e) {
      refused.push({ id: fig.id, reason: e.message });
    }
  }
  return { written, refused };
}

function main(argv) {
  const args = argv.slice(2);
  const packPath = args[0];
  const outIdx = args.indexOf('--outdir');
  const outdir = outIdx !== -1 ? args[outIdx + 1] : null;
  if (!packPath || (outIdx !== -1 && !outdir)) {
    console.error('usage: node build/figure-gen.js <pack.json> [--outdir <dir>]');
    return 2;
  }
  const absPack = path.isAbsolute(packPath) ? packPath : path.join(process.cwd(), packPath);
  if (!fs.existsSync(absPack)) { console.error(`figure-gen: pack not found: ${absPack}`); return 2; }
  let pack;
  try { pack = JSON.parse(fs.readFileSync(absPack, 'utf8')); }
  catch (e) { console.error(`figure-gen: invalid JSON in ${absPack}: ${e.message}`); return 2; }

  const packDir = path.dirname(absPack);
  const { written, refused } = regenerate(pack, packDir, { outdir });
  refused.forEach((r) => console.error(`figure-gen: figure "${r.id}" refused: ${r.reason}`));
  written.forEach((w) => console.log(`figure-gen: wrote ${w.path} (figure "${w.id}", accent ${w.accent})`));
  if (!written.length && !refused.length) console.log('figure-gen: no gen:true chart figures in this pack; nothing to do');
  return refused.length ? 1 : 0;
}

module.exports = {
  genSvg, renderFigure, resolveAccent, chartTargets, regenerate, layout,
  layoutPanels, genSvgPanels,
  INK, GRID, PLOT_GRID, DEFAULT_ACCENT, GLYPH_W, VB_W, VB_H, MAX_NOTES, MIN_PLOT_H,
  PANEL_GAP, MIN_PANEL_H, TICK_LABEL_H, MIN_TICK_GAP,
};

if (require.main === module) process.exit(main(process.argv));
