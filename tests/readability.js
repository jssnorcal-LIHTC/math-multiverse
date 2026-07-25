'use strict';
// readability.js -- Flesch-Kincaid and Coleman-Liau grade levels, zero dependencies and no
// data files. Coleman-Liau is used instead of Dale-Chall on purpose: Dale-Chall requires a
// 3,000-word "easy word" list, and shipping that list into a hermetic harness buys nothing
// that a second letter-based index does not already give us.

// Heuristic English syllable count.  Exact counting needs a pronunciation dictionary; for a
// grade-band gate over 400-word passages the error averages out.
//
// KNOWN AND ACCEPTED: adjacent vowels that belong to different syllables are undercounted,
// because the vowel-group regex lumps them.  Measured misses: radio and idea and area return 2
// (truly 3), science returns 1 (truly 2), courier returns 2 (truly 3).  Do NOT "fix" this by
// splitting every vowel pair; that breaks the far more common single-syllable pairs (meeting,
// reasons, people) and would push whole passages out of band.  If exactness is ever needed,
// add a dictionary, do not tune the regex.
function countSyllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;

  // Strip a silent trailing e, -es or -ed. `l` is NOT protected here on purpose: leaving it in
  // the class stopped "-le" from stripping, so the consonant+le bonus below double-counted and
  // table, little, cradle and simple all came back as 3 instead of 2.
  let s = w
    .replace(/(?:[^aeiouy]es|ed|[^aeiouy]e)$/, '')
    .replace(/^y/, '');

  const groups = s.match(/[aeiouy]{1,2}/g);
  let n = groups ? groups.length : 0;

  // "-le" after a consonant is its own syllable: table, little, cradle.
  if (/[^aeiouy]le$/.test(w)) n += 1;

  return Math.max(1, n);
}

function textStats(text) {
  const t = String(text || '');

  // A sentence boundary is terminal punctuation followed by whitespace and a capital or quote,
  // or the end of the string. This keeps "approx. ten" from splitting.
  const trimmed = t.trim();
  let sentences = 0;
  if (trimmed) {
    const boundaries = trimmed.match(/[.!?]+(?=\s+["'“(]?[A-Z0-9])/g);
    sentences = (boundaries ? boundaries.length : 0) + 1;
  }

  const wordTokens = trimmed ? trimmed.match(/[A-Za-z][A-Za-z'-]*/g) || [] : [];
  const words = wordTokens.length;
  const syllables = wordTokens.reduce((a, w) => a + countSyllables(w), 0);
  const letters = (trimmed.match(/[A-Za-z]/g) || []).length;

  return { words, sentences, syllables, letters };
}

function fleschKincaid(text) {
  const { words, sentences, syllables } = textStats(text);
  if (!words || !sentences) return 0;
  return 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
}

function colemanLiau(text) {
  const { words, sentences, letters } = textStats(text);
  if (!words) return 0;
  const L = (letters / words) * 100;          // letters per 100 words
  const S = (sentences / words) * 100;        // sentences per 100 words
  return 0.0588 * L - 0.296 * S - 15.8;
}

module.exports = { countSyllables, textStats, fleschKincaid, colemanLiau };
