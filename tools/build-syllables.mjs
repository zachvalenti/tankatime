#!/usr/bin/env node
/* Builds syllables.json — the word list count.js consults before
 * falling back to its spelling heuristic.
 *
 *   usage: node tools/build-syllables.mjs path/to/cmudict.dict
 *
 * cmudict.dict is the CMU Pronouncing Dictionary's plain-text release:
 * one entry per line, "word PH ON EMES", where every vowel phoneme
 * carries a stress digit (hello  HH AH0 L OW1). Counting those digits
 * counts the syllables. Get a copy from the CMU Sphinx project, or the
 * cmu-pronouncing-dictionary package on npm.
 *
 * Two ideas keep the output small and honest:
 *
 * 1. Ship only the disagreements. The heuristic in count.js already
 *    gets most words right; running it here over all ~135k entries and
 *    keeping only the words it gets wrong shrinks the file by an order
 *    of magnitude. The cost: rerun this script whenever the heuristic
 *    changes, or the list drifts out of sync with it.
 *
 * 2. Fold the fire-glide back in. CMUdict has no single symbol for the
 *    gliding vowel of "fire", so it spells it as two phones (F AY1 ER0)
 *    — one beat more than most ears, dictionaries, and poets give it.
 *    The same phones can be a true second syllable though ("sour" and
 *    "flower" end identically), so the fix keys on spelling: only the
 *    classic -ire / -yre / -our endings are compressed.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// count.js is browser-first with a CommonJS escape hatch; createRequire
// lets this ES module borrow it, so both sides share one heuristic
const { SPECIAL, countWord } = createRequire(import.meta.url)('../count.js');

const src = process.argv[2];
if (!src) {
  console.error('usage: node tools/build-syllables.mjs path/to/cmudict.dict');
  process.exit(1);
}

// phones ending in "...AY1 ER0" (+ at most a consonant or two: "tired",
// "fires"), paired with spellings ending -ire/-yre/-our (+ -s/-d/-ed)
const GLIDE_PHONES = /(?:AY|AW)\d ER0(?: [A-Z]+){0,2}$/;
const GLIDE_LETTERS = /(?:ire|yre|our)(?:s|d|ed)?$/;

const words = new Map(); // letters-only key → { count, raw, pure }
let entries = 0;

for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line || line.startsWith(';;;')) continue; // header comments
  const sp = line.indexOf(' ');
  if (sp < 1) continue;
  const head = line.slice(0, sp).toLowerCase();
  const phones = line.slice(sp + 1).split('#')[0].trim(); // strip notes

  // keep plain words and contractions; skip alternate pronunciations
  // ("fire(2)" — the first listed is the common one) and abbreviations
  // with digits or periods ("a.d." would collide with "ad")
  if (/[^a-z’']/.test(head)) continue;
  entries++;

  // one syllable per stress digit
  let count = (phones.match(/\d/g) || []).length;
  if (!count) continue;
  if (GLIDE_PHONES.test(phones) && GLIDE_LETTERS.test(head)) count--;

  // key exactly the way count.js normalizes tokens
  const key = head.replace(/[’']/g, '');
  const pure = key === head; // had no apostrophe
  const prev = words.get(key);
  // "its" and "it's" share a key; the plain spelling outranks the
  // contraction, and otherwise first entry (CMUdict order) wins
  if (!prev || (pure && !prev.pure)) words.set(key, { count, raw: head, pure });
}

// keep only the words the app would otherwise get wrong
let kept = 0;
const groups = {};
for (const [key, { count, raw }] of words) {
  if (SPECIAL[key] != null) continue;  // hand overrides win at runtime
  if (countWord(raw) === count) continue; // heuristic already agrees
  (groups[count] ??= []).push(key);
  kept++;
}

// group words by count and sort them — near-identical neighbours make
// the file diff cleanly and compress well over the wire
for (const k of Object.keys(groups)) groups[k] = groups[k].sort().join(' ');

const out = new URL('../syllables.json', import.meta.url);
writeFileSync(out, JSON.stringify(groups));
console.log(`${entries} words checked, ${kept} exceptions → syllables.json`);
