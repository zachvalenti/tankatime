'use strict';

/* Syllable counting.
 *
 * A word's count is resolved in three tiers, best knowledge first:
 *
 *   1. SPECIAL — a few hand-set counts; the final say on any word
 *   2. DICT    — real pronunciations from the CMU Pronouncing
 *                Dictionary, shipped in syllables.json and loaded by
 *                app.js after startup
 *   3. rules   — a spelling heuristic for words nobody listed
 *
 * The tiers exist because English spelling hides sound: "creature" and
 * "creative" share the letters c-r-e-a-t yet split differently, so no
 * rule that only reads letters can count every word. A pronunciation
 * dictionary settles the words it knows; the rules give a fair guess
 * for the rest (names, coinages, brand-new words).
 *
 * This file runs in two worlds: the browser loads it as a plain
 * <script> (its top-level names are shared with app.js), and the build
 * tool loads it in Node via the module.exports guard at the bottom, so
 * the app and the tool can never disagree about the heuristic.
 */

// tier 1: hand overrides. Kept above the dictionary on purpose — when a
// pronunciation database and a poet disagree, the poet wins here.
const SPECIAL = {
  quiet: 2, quietly: 3, poem: 2, poems: 2, poet: 2, poets: 2,
  poetry: 3, idea: 3, ideas: 3, ideal: 3, area: 3, aria: 3,
};

// tier 2: word → count, filled by loadSyllableDict once syllables.json
// arrives. Starts empty, so the app works before (and without) it.
const DICT = new Map();

// syllables.json groups words by count — {"2": "fire flower ...var"} —
// because one shared number per group compresses better than repeating
// it per word. Unpack it into the flat Map the lookup wants.
function loadSyllableDict(groups) {
  for (const [count, words] of Object.entries(groups)) {
    for (const word of words.split(' ')) DICT.set(word, +count);
  }
}

function countWord(token) {
  const w = token.toLowerCase();
  // normalize to bare letters: apostrophes first ("don't" → "dont"),
  // then anything else that isn't a-z. All three tiers key on this.
  const letters = w.replace(/[’']/g, '').replace(/[^a-z]/g, '');
  if (!letters) return 0;
  if (SPECIAL[letters] != null) return SPECIAL[letters];
  const known = DICT.get(letters);
  if (known != null) return known;

  // tier 3: the heuristic. Start from runs of vowel letters — "beat"
  // has one run (ea), "be-at" would still be one, which is exactly the
  // ambiguity the dictionary tier exists to fix — then patch the
  // spelling patterns that reliably mislead the count.
  let n = (letters.match(/[aeiouy]+/g) || []).length;
  if (n === 0) return 1;

  // silent trailing e ("time"), but keep syllabic -le ("table")
  if (n > 1 && /[^aeiouy]e$/.test(letters) && !/[^aeiouy]le$/.test(letters)) n--;
  else if (n > 1 && /[^aeiouy]es$/.test(letters) && !/[^aeiouy]les$/.test(letters)
           && !/(?:[sxz]|[cs]h)es$/.test(letters)) n--;
  // silent -ed ("walked"), but not after t/d ("created", "loaded")
  if (n > 1 && /[^aeiouytd]ed$/.test(letters)) n--;

  // hiatus: consonant + i + vowel usually splits ("di-et", "li-on")
  n += (letters.match(/[^aeiouy]i[aeiou]/g) || []).length;
  // ...except fused endings ("na-tion", "spe-cial", "o-cean")
  n -= (letters.match(/[cstgxn]ion|[cst]i(?:al|an|ou|en)/g) || []).length;

  // vowel + ing is two beats ("be-ing", "go-ing", "fly-ing")
  if (/[aeiouy]ing$/.test(letters)) n++;
  // syllabic n't ("isn't", "didn't"), but not "don't", "can't"
  if (/n[’']t$/.test(w) && /[^aeiouy]nt$/.test(letters)) n++;

  // every word that reached here has at least one beat
  return Math.max(1, n);
}

function countLine(text) {
  // split on every run of non-word characters; apostrophes stay so
  // "isn't" arrives as one token
  let total = 0;
  for (const token of text.split(/[^a-zA-Z'’]+/)) total += countWord(token);
  return total;
}

// same tokenization, simpler question: how many words?
function countWords(text) {
  let n = 0;
  for (const token of text.split(/[^a-zA-Z'’]+/)) if (token) n++;
  return n;
}

// Node (the build tool) sees module; the browser doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { SPECIAL, DICT, loadSyllableDict, countWord, countLine, countWords };
}
