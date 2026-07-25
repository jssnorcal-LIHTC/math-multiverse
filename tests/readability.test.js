'use strict';
// Plain-node assertions; no test framework is installed and none is being added.
const assert = require('assert');
const { countSyllables, textStats, fleschKincaid, colemanLiau } = require('./readability');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); }
}

check('countSyllables handles single syllables', () => {
  assert.strictEqual(countSyllables('cat'), 1);
  assert.strictEqual(countSyllables('through'), 1);
});

check('countSyllables handles silent trailing e', () => {
  assert.strictEqual(countSyllables('make'), 1);
  assert.strictEqual(countSyllables('table'), 2);    // consonant + le is its own syllable
  assert.strictEqual(countSyllables('little'), 2);
  assert.strictEqual(countSyllables('simple'), 2);
});

check('countSyllables handles multisyllables', () => {
  assert.strictEqual(countSyllables('attention'), 3);
  assert.strictEqual(countSyllables('everything'), 4);
  assert.strictEqual(countSyllables('ordinary'), 4);
});

check('countSyllables never returns zero for a word with letters', () => {
  assert.strictEqual(countSyllables('rhythm') >= 1, true);
  assert.strictEqual(countSyllables('a'), 1);
});

check('textStats counts words, sentences, letters', () => {
  const s = textStats('The dog ran. The cat slept!');
  assert.strictEqual(s.words, 6);
  assert.strictEqual(s.sentences, 2);
  assert.strictEqual(s.letters, 20);   // Thedogran = 9, Thecatslept = 11; punctuation excluded
});

check('textStats treats a trailing fragment as one sentence', () => {
  assert.strictEqual(textStats('No terminal punctuation here').sentences, 1);
});

check('textStats does not split on an abbreviation period', () => {
  // "approx." must not end a sentence; a period followed by a lowercase letter is not a boundary.
  assert.strictEqual(textStats('It was approx. ten metres away. Then it moved.').sentences, 2);
});

check('fleschKincaid puts simple prose in a low grade', () => {
  const g = fleschKincaid('The dog ran fast. The cat sat down. We had fun.');
  assert.strictEqual(g < 3, true, 'expected under grade 3, got ' + g);
});

check('fleschKincaid puts dense prose in a high grade', () => {
  const g = fleschKincaid('Consequently, the administrative determination necessitated a comprehensive reevaluation of institutional priorities.');
  assert.strictEqual(g > 12, true, 'expected above grade 12, got ' + g);
});

check('colemanLiau puts simple prose below dense prose', () => {
  const easy = colemanLiau('The dog ran. The cat sat. We had fun. It was good.');
  const hard = colemanLiau('Institutional accountability presupposes transparent administrative methodology.');
  assert.strictEqual(easy < hard, true, `easy ${easy} should be below hard ${hard}`);
});

check('both indices return finite numbers on empty input rather than NaN', () => {
  assert.strictEqual(Number.isFinite(fleschKincaid('')), true);
  assert.strictEqual(Number.isFinite(colemanLiau('')), true);
});

console.log(failures ? `\nRESULT: FAIL (${failures})` : '\nRESULT: ALL CLEAN');
process.exit(failures ? 1 : 0);
