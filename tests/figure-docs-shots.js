'use strict';
// figure-docs-shots.js -- renders each committed document fixture at LIGHTBOX SCALE and writes a
// PNG, so a human can LOOK at it before the .svg is trusted as an expected value.
//
// This is not a gate and it is not run by npm test. It exists because a byte-compare cannot see a
// defect in the renderer that made both sides of the comparison: two of the four defects that
// shipped on 26-0822 were green in every gate and were found only by rendering the figure and
// looking at it. Plan W0.1 step 3 makes this step mandatory before the fixtures are committed.
//
// usage: node tests/figure-docs-shots.js [outdir]
// Headless with --disable-gpu (constraint 9, the Intel TDR machine); falls back to the installed
// Chrome via PLAYWRIGHT_EXECUTABLE_PATH when the bundled Chromium is absent.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FIX = path.join(__dirname, 'fixtures', 'figure-docs');
const OUT = process.argv[2] || path.join(__dirname, '..', 'handoffs', 'renders-26-0901', 'w0-fixtures');

// The lightbox is the one context these figures are sized for: .mv-lb-img at max-width 94vw against
// an 800px native width. 1024 CSS px of viewport gives 962px, so the figure renders at its full
// native 1.0x; this shoots at exactly that, which is what a reader sees when they tap a figure.
const SCALE = 1;

async function main() {
  const bases = fs.readdirSync(FIX).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, '')).sort();
  if (!bases.length) { console.error('no fixture SVGs to shoot'); return 2; }
  fs.mkdirSync(OUT, { recursive: true });

  const launch = { args: ['--disable-gpu'] };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 800 * SCALE, height: 450 * SCALE } });

  const written = [];
  for (const base of bases) {
    const svg = fs.readFileSync(path.join(FIX, base + '.svg'), 'utf8');
    // Inline the SVG rather than loading it by URL: this is exactly how the lightbox paints it, and
    // it keeps the shot free of any file:// chrome.
    await page.setContent('<body style="margin:0;background:#0f1218">' + svg + '</body>');
    const target = path.join(OUT, base + '.png');
    await page.screenshot({ path: target });
    written.push(target);
    console.log('shot ' + base + ' -> ' + target);
  }

  // One contact sheet so all eight can be taken in at a glance.
  const grid = written.map((p, i) => {
    const b64 = fs.readFileSync(p).toString('base64');
    return '<figure style="margin:0"><figcaption style="font:13px system-ui;color:#e8eef7;padding:4px 2px">'
      + bases[i] + '</figcaption><img src="data:image/png;base64,' + b64 + '" style="width:100%;display:block"></figure>';
  }).join('');
  await page.setViewportSize({ width: 1640, height: 1400 });
  await page.setContent('<body style="margin:0;background:#05070a"><div style="display:grid;'
    + 'grid-template-columns:1fr 1fr;gap:10px;padding:10px">' + grid + '</div></body>');
  const sheet = path.join(OUT, 'contact-sheet.png');
  await page.screenshot({ path: sheet, fullPage: true });
  console.log('contact sheet -> ' + sheet);

  await browser.close();
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(2); });
