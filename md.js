'use strict';

/* Markdown — the grammar only, no DOM.
 *
 * Tanka Time writes Markdown the way Ulysses does: the markup
 * characters stay on the page, dimmed, and the text around them takes
 * its styling as you type. Nothing is ever hidden or rewritten, so the
 * document you save is exactly the document you see.
 *
 * That habit rests on one promise this file has to keep:
 *
 *     mdRuns(text).map(r => r.text).join('') === text
 *
 * The runs are a coat of paint over the source, never a translation of
 * it. app.js turns each run into a <span> inside the line, so the
 * line's textContent still reads back as plain Markdown — which is why
 * getText(), autosave, and export need to know nothing about any of
 * this.
 *
 * Like count.js, this file lives in two worlds: the browser loads it as
 * a plain <script> (its names join app.js's globals), and the
 * module.exports guard at the foot lets Node load it too.
 */

/* ---------- block prefixes ---------- */

// One prefix per line, matched at column zero. The whitespace after the
// symbol is mandatory, and it is the whole reason #hashtag is ordinary
// text: a heading is a mark and then a breath, not a mark stuck to a
// word. Same rule keeps a line opening on *italic* from reading as a
// bullet.
const MD_HEADING = /^(#{1,6})[ \t]+/;
const MD_QUOTE   = /^>[ \t]?/;
const MD_UL      = /^[-*+][ \t]+/;
const MD_OL      = /^\d+\.[ \t]+/;

// → { kind, cls, prefix } where prefix is how many characters the
// marker occupies. cls names the line's shape for style.css; '' is an
// ordinary line of poem.
function mdBlock(text) {
  let m;
  if ((m = MD_HEADING.exec(text)))
    return { kind: 'heading', cls: 'md-h' + m[1].length, prefix: m[0].length };
  if ((m = MD_QUOTE.exec(text)))
    return { kind: 'quote', cls: 'md-quote', prefix: m[0].length };
  if ((m = MD_UL.exec(text)) || (m = MD_OL.exec(text)))
    return { kind: 'list', cls: 'md-list', prefix: m[0].length };
  return { kind: 'text', cls: '', prefix: 0 };
}

// the one question refresh() asks of every line: does this stand
// outside the form? A title takes no syllable count and opens a new
// tanka beneath it.
function mdIsHeading(text) {
  return MD_HEADING.test(text);
}

/* ---------- inline marks ---------- */

// **bold**, __underline__, *italic* — Ulysses' Markdown XL, where a
// double underscore underlines rather than bolds. A single underscore
// means nothing here on purpose: it would set fire to every snake_case
// word a poem ever borrowed.
//
// The lookahead after each opener, and the \S before each closer, are
// what keep "5 * 7" and a lone asterisk from italicizing half a poem:
// a mark has to hug the text it marks.
const MD_INLINE = new RegExp(
  '(?<strong>\\*\\*(?=\\S).*?\\S\\*\\*)' +
  '|(?<u>__(?=\\S).*?\\S__)' +
  '|(?<em>\\*(?=\\S)[^*]*?\\S\\*)', 'g');

/* Three kinds of mark, because they don't all deserve the same fate on
 * a line that isn't the one being written (style.css decides):
 *
 *   md-mark    ** * __ — decoration of words
 *   md-hash    the #s of a heading — the size already says "title" more
 *              plainly than the hashes do
 *   md-prefix  > and - and 1. — these *are* the shape of the line, and
 *              a list stripped of its bullet reads as broken, not tidy
 *
 * The rule of thumb: marks that decorate words are one thing, marks
 * that are the shape of a line are another.
 */
// every class mdRuns() hands out. app.js keeps this to tell its own
// decoration apart from markup a browser invented on its own
const MD_CLASSES = ['md-mark', 'md-hash', 'md-prefix', 'md-strong', 'md-em',
                    'md-u', 'md-odd', 'md-mode'];

// Runs are flat: the outermost mark wins, and a nested one shows as
// ordinary dim marks inside it. Flat runs are what let app.js compare
// what a line *should* look like against what it *does* look like, run
// for run — the comparison that keeps the caret still while you type.
function mdRuns(text) {
  const runs = [];
  // adjacent runs of one class merge, so the same text always produces
  // the same shape and the comparison in app.js can trust it
  const push = (t, cls) => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) last.text += t;
    else runs.push({ text: t, cls });
  };

  const block = mdBlock(text);
  if (block.prefix)
    push(text.slice(0, block.prefix),
         block.kind === 'heading' ? 'md-hash' : 'md-prefix');

  const rest = text.slice(block.prefix);
  let at = 0;
  MD_INLINE.lastIndex = 0;
  for (let m; (m = MD_INLINE.exec(rest)); ) {
    push(rest.slice(at, m.index), '');
    const g = m.groups;
    const cls = g.strong ? 'md-strong' : g.u ? 'md-u' : 'md-em';
    const n = g.em ? 1 : 2; // how many characters the mark itself takes
    const s = m[0];
    push(s.slice(0, n), 'md-mark');
    push(s.slice(n, s.length - n), cls);
    push(s.slice(s.length - n), 'md-mark');
    at = m.index + s.length;
  }
  push(rest.slice(at), '');

  return runs;
}

/* ---------- what the first line can ask for ---------- */

/* A line at the very top made of nothing but these changes what the
 * margin means for everything under it. Leading lines are taken for as
 * long as each holds only mode words, so they may share one line or take
 * one apiece, in whatever order.
 *
 *   /free    the counts stop judging. No target, no green, no amber —
 *            just the number, for a syllabic ear working outside 31.
 *   /simple  every word is held against a thousand-word list, and the
 *            ones that aren't on it are marked.
 *
 * They are scaffolding rather than poem: no count in the margin, nothing
 * in the total, and the export leaves them behind.
 */
const MD_MODES = ['free', 'simple'];
const MD_MODE_WORD = new RegExp('^/(' + MD_MODES.join('|') + ')$');

// the mode words on a line, or null if the line is a line of poem —
// one ordinary word anywhere on it and it stops being scaffolding
function modeWords(text) {
  const t = text.trim();
  if (!t) return null;
  const out = [];
  for (const w of t.split(/\s+/)) {
    const m = MD_MODE_WORD.exec(w.toLowerCase());
    if (!m) return null;
    out.push(m[1]);
  }
  return out;
}

// → { free, simple, lines }, lines being how many the modes occupy at
// the top, which is also how many the export drops
function mdModes(src) {
  const on = new Set();
  let n = 0;
  while (n < src.length) {
    const words = modeWords(src[n]);
    if (!words) break;
    for (const w of words) on.add(w);
    n++;
  }
  return { free: on.has('free'), simple: on.has('simple'), lines: n };
}

/* ---------- the thousand words ---------- */

/* tenhundred.txt holds a thousand plain English words, and /simple marks
 * anything else. The file is left exactly as it came, which is what makes
 * the matching below have to be generous: it lists base forms only, so
 * "walk" is on it and "walks", "walked" and "walking" are not. Marking
 * those would make the mode unusable rather than strict.
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

/* ---------- ⌘B / ⌘I / ⌘U ---------- */

// The marks the shortcuts write. Bold and underline are two characters,
// italic one — a difference the toggle below has to respect on both
// sides of a selection.
const MD_MARKS = { b: '**', i: '*', u: '__' };

// Work out what a line should become when a mark is toggled over
// [s, e). Pure string arithmetic — no DOM, no selection — so app.js can
// hand the result to one execCommand and keep the browser's own undo.
// Returns { text, s, e }: the new line and where the selection lands.
function mdToggle(text, s, e, mark) {
  const n = mark.length;
  // is there a standalone `mark` at i? For italic, a third asterisk
  // alongside means these characters belong to a **bold** pair instead
  const at = i => i >= 0 && text.slice(i, i + n) === mark &&
    (mark !== '*' || (text[i - 1] !== '*' && text[i + 1] !== '*'));

  if (s !== e) {
    // **[word]** — the marks sit just outside the selection
    if (at(s - n) && at(e))
      return { text: text.slice(0, s - n) + text.slice(s, e) + text.slice(e + n),
               s: s - n, e: e - n };
    // [**word**] — the selection swallowed its own marks
    if (e - s >= 2 * n && at(s) && at(e - n))
      return { text: text.slice(0, s) + text.slice(s + n, e - n) + text.slice(e),
               s, e: e - 2 * n };
    // plain text: wrap it, and leave the words themselves selected
    return { text: text.slice(0, s) + mark + text.slice(s, e) + mark + text.slice(e),
             s: s + n, e: e + n };
  }

  // an empty pair the caret is sitting inside comes back off
  if (at(s - n) && at(s))
    return { text: text.slice(0, s - n) + text.slice(s + n), s: s - n, e: s - n };

  // no selection: take the word under the caret, if the caret is on one
  let a = s, b = s;
  while (a > 0 && /\S/.test(text[a - 1])) a--;
  while (b < text.length && /\S/.test(text[b])) b++;
  if (a < b) {
    const w = mdToggle(text, a, b, mark);
    // the caret returns to the letter it was on, which has shifted by
    // one mark's width in whichever direction the edit went
    const i = s + (w.text.length > text.length ? n : -n);
    const held = Math.min(Math.max(i, w.s), w.e);
    return { text: w.text, s: held, e: held };
  }

  // open space: lay down the pair and wait between them
  return { text: text.slice(0, s) + mark + mark + text.slice(s), s: s + n, e: s + n };
}

// Node (a test run, or a future build tool) sees module; the browser
// doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { mdBlock, mdIsHeading, mdRuns, mdToggle, MD_MARKS, MD_CLASSES,
                     mdModes, loadSimpleWords, isSimpleWord, TEN };
}
