'use strict';

/* The thousand words — the data behind /simple.
 *
 * tenhundred.txt holds a thousand plain English words, and /simple marks
 * anything else, in the spirit of xkcd's Up Goer Five. This file answers
 * one question — is this a plain word? — and knows nothing about
 * Markdown, screenplays, or the page.
 *
 * The file is left exactly as it came, which is what makes the matching
 * below have to be generous: it lists base forms only, so "walk" is on it
 * and "walks", "walked" and "walking" are not. Marking those would make
 * the mode unusable rather than strict.
 *
 * So a word passes if any plausible base of it is on the list.
 */

const TEN = new Set();

function loadSimpleWords(text) {
  for (const w of text.split(/\s+/)) if (w) TEN.add(w.toLowerCase());
}

/* The words English refuses to conjugate politely. No suffix rule gets
 * from "be" to "is", and those are the commonest words there are — left
 * out, half of every line would be marked. Only forms of words already on
 * the list appear here; the list itself is not added to. Same spirit as
 * SPECIAL in count.js, where the poet outranks the database.
 */
const FORMS = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be',
  has: 'have', had: 'have', does: 'do', did: 'do', done: 'do',
  says: 'say', said: 'say', goes: 'go', went: 'go', gone: 'go',
  got: 'get', gotten: 'get', came: 'come', saw: 'see', seen: 'see',
  took: 'take', taken: 'take', made: 'make', knew: 'know', known: 'know',
  thought: 'think', felt: 'feel', found: 'find', gave: 'give', given: 'give',
  told: 'tell', became: 'become', left: 'leave', kept: 'keep',
  began: 'begin', begun: 'begin', brought: 'bring', bought: 'buy',
  caught: 'catch', chose: 'choose', chosen: 'choose', drew: 'draw',
  drawn: 'draw', drank: 'drink', drunk: 'drink', drove: 'drive',
  driven: 'drive', ate: 'eat', eaten: 'eat', fell: 'fall', fallen: 'fall',
  fed: 'feed', fought: 'fight', flew: 'fly', flown: 'fly', forgot: 'forget',
  forgotten: 'forget', hung: 'hang', heard: 'hear', held: 'hold',
  hid: 'hide', hidden: 'hide', laid: 'lay', led: 'lead', lain: 'lie',
  lost: 'lose', meant: 'mean', met: 'meet', paid: 'pay', rode: 'ride',
  ridden: 'ride', rang: 'ring', rung: 'ring', rose: 'rise', risen: 'rise',
  ran: 'run', sold: 'sell', sent: 'send', shook: 'shake', shaken: 'shake',
  shot: 'shoot', shown: 'show', sang: 'sing', sung: 'sing', sat: 'sit',
  slept: 'sleep', slid: 'slide', spoke: 'speak', spoken: 'speak',
  spent: 'spend', spun: 'spin', stood: 'stand', stole: 'steal',
  stolen: 'steal', stuck: 'stick', struck: 'strike', swung: 'swing',
  taught: 'teach', tore: 'tear', torn: 'tear', threw: 'throw',
  thrown: 'throw', understood: 'understand', woke: 'wake', woken: 'wake',
  wore: 'wear', worn: 'wear', won: 'win', wrote: 'write', written: 'write',
  children: 'child', feet: 'foot', men: 'man', women: 'woman',
  teeth: 'tooth', worse: 'bad', worst: 'bad', further: 'far',
  furthest: 'far', least: 'less',
};

// walk → walks, walked, walking; and the spellings that shift a letter
// on the way: hope→hoping, run→running, happy→happier, try→tried
function bases(w) {
  const out = [w];
  if (FORMS[w]) out.push(FORMS[w]);
  for (const suf of ['s', 'es', 'ed', 'ing', 'er', 'est']) {
    if (!w.endsWith(suf) || w.length <= suf.length + 1) continue;
    const stem = w.slice(0, -suf.length);
    out.push(stem, stem + 'e');
    if (/(.)\1$/.test(stem)) out.push(stem.slice(0, -1));      // runn → run
    if (stem.endsWith('i')) out.push(stem.slice(0, -1) + 'y'); // happi → happy
  }
  return out;
}

// true until the list arrives, so nothing is marked on a first visit
// offline, or in the moment before the fetch lands
function isSimpleWord(token) {
  if (!TEN.size) return true;
  const w = token.toLowerCase().replace(/[’']s$/, '').replace(/[^a-z]/g, '');
  if (!w) return true;
  return bases(w).some(b => TEN.has(b));
}

// Node (a test run, or a future build tool) sees module; the browser
// doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { TEN, FORMS, bases, loadSimpleWords, isSimpleWord };
}
