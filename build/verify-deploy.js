'use strict';
// verify-deploy.js -- byte-verify what GitHub Pages is actually serving against a committed SHA.
//
// WHY THIS IS COMMITTED. Program constraint 14 requires every deploy to be byte-verified against
// the merged sha, and that check has now been hand-rolled five times, once per phase, as a
// throwaway script that was never kept. Each rewrite is a chance to get the comparison subtly
// wrong, and the failure it guards against is silent: Pages happily keeps serving the previous
// build while the repo says the new one shipped.
//
// The Pages STATUS FIELD is not evidence and this tool deliberately ignores it. It has reported
// `building` for a commit Pages does not serve at all (a workflow-only change), and it reported
// `building` for a full ten minutes after the deploy job had already failed. What settles the
// question is comparing the bytes on the wire against the bytes in the commit.
//
//   node build/verify-deploy.js <sha> [--base <url>] [--file path ...]
//
// Exit 0 only if every checked file matches. Line endings are normalised (and ONLY line endings),
// because .gitattributes pins the checkout form and a CRLF/LF difference is not a content
// difference; nothing else about the bytes is touched.
const { execFileSync } = require('child_process');
const https = require('https');

const DEFAULT_BASE = 'https://jssnorcal-lihtc.github.io/math-multiverse';
// The surfaces a deploy can silently miss: the shell, every engine file, and every pack.
const DEFAULT_FILES = [
  'Math-Multiverse.html',
  'engine/engine.css', 'engine/figures.js', 'engine/runner.js', 'engine/items.js', 'engine/pack.js',
  'packs/manifest.json',
  // The shell fetches this at boot for the lesson pointer. It is not a content pack, so the
  // manifest sweep below never reaches it and nothing else checked it on the deploy.
  'packs/curriculum-cc1.json',
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve({ status: res.statusCode, body: null }); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: 200, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

const norm = (b) => b.toString('utf8').replace(/\r\n/g, '\n');

async function main(argv) {
  const args = argv.slice(2);
  const sha = args[0];
  if (!sha || sha.startsWith('--')) {
    console.error('usage: node build/verify-deploy.js <sha> [--base <url>] [--file <path> ...]');
    return 2;
  }
  const bi = args.indexOf('--base');
  const base = bi !== -1 ? args[bi + 1] : DEFAULT_BASE;
  const extra = args.reduce((acc, a, i) => (a === '--file' && args[i + 1] ? acc.concat(args[i + 1]) : acc), []);

  // Every pack the manifest declares, so a new pack cannot be added and then silently not checked.
  let packs = [];
  try {
    const manifest = JSON.parse(execFileSync('git', ['show', `${sha}:packs/manifest.json`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
    packs = (manifest.packs || []).map((p) => `packs/${p.id}.json`);
    // ...AND every figure those packs reference. A stale deploy serves a stale figure beside a
    // fresh item, which is a drawing that disagrees with the question next to it: the exact defect
    // tests/figure-reconcile.js exists to prevent locally, arriving through the deploy instead.
    // Read from the pack at the verified SHA, so the list cannot be taken from a dirty checkout.
    // Iterate a SNAPSHOT: pushing figures into the same array a for...of is walking would feed the
    // SVGs back through JSON.parse on the next turn of the loop.
    const packFiles = packs.slice();
    for (const rel of packFiles) {
      const pack = JSON.parse(execFileSync('git', ['show', `${sha}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
      for (const f of pack.figures || []) if (f.src) packs.push(f.src);
    }
  } catch (e) {
    console.error(`verify-deploy: could not read packs/manifest.json at ${sha}: ${e.message}`);
    return 2;
  }
  const files = [...new Set(DEFAULT_FILES.concat(packs, extra))];

  let bad = 0;
  console.log(`verify-deploy: ${files.length} file(s) against ${sha}\n`);
  console.log(`${'FILE'.padEnd(42)}${'LIVE'.padStart(10)}${'COMMITTED'.padStart(11)}  VERDICT`);
  for (const f of files) {
    let committed;
    try { committed = execFileSync('git', ['show', `${sha}:${f}`], { maxBuffer: 1 << 28 }); }
    catch { console.log(`${f.padEnd(42)}${'-'.padStart(10)}${'-'.padStart(11)}  NOT IN ${sha}`); bad++; continue; }
    const live = await get(`${base}/${f}`);
    if (live.status !== 200) { console.log(`${f.padEnd(42)}${'-'.padStart(10)}${'-'.padStart(11)}  HTTP ${live.status}`); bad++; continue; }
    const same = norm(live.body) === norm(committed);
    if (!same) bad++;
    console.log(`${f.padEnd(42)}${String(live.body.length).padStart(10)}${String(committed.length).padStart(11)}  ${same ? 'IDENTICAL' : 'MISMATCH'}`);
  }

  console.log('');
  if (bad) {
    console.log(`=== verify-deploy: ${bad} file(s) DID NOT match ${sha} ===`);
    console.log('The deploy is stale or partial. Do not trust the Pages status field; re-check the');
    console.log('pages build-and-deployment run, whose deploy job can fail while the build succeeds.');
  } else {
    console.log(`=== verify-deploy: every file matches ${sha} ===`);
  }
  return bad ? 1 : 0;
}

module.exports = { norm, DEFAULT_FILES };
if (require.main === module) {
  main(process.argv).then((c) => process.exit(c)).catch((e) => { console.error(`verify-deploy: ${e.message}`); process.exit(2); });
}
