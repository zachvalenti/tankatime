'use strict';

/* What the keyboard shortcuts do to a line of text.
 *
 * Pure string arithmetic — no DOM, no selection, no grammar. Every
 * function here takes a line and a range [s, e) and returns
 *
 *     { text, s, e }
 *
 * the new line and where the selection should land on it. app.js hands
 * the result to the editor and puts the caret back; nothing in this file
 * knows a caret exists.
 *
 * It serves both grammars, which is the reason it isn't inside either
 * one. markToggle() doesn't care whether the mark it is laying down
 * means bold in Markdown or bold in Fountain — it cares that the mark is
 * two characters wide and that there might already be a pair around the
 * word. The only thing the grammars disagree about is which characters
 * to use, and that's the two tables at the top.
 */

// Markdown here is Ulysses' flavor: a double underscore underlines
// rather than bolds, and a single one means nothing at all, because it
// would set fire to every snake_case word a poem ever borrowed.
const MD_MARKS = { b: '**', i: '*', u: '__' };

// Fountain reverses exactly that: the single underscore *is* the
// underline, and the double means nothing. The rule that protects a poem
// is the one a script can't have — which is as good an argument for two
// grammars as any.
const FTN_MARKS = { b: '**', i: '*', u: '_' };

/* ---------- ⌘B / ⌘I / ⌘U ---------- */

// Work out what a line should become when a mark is toggled over
// [s, e). Returns { text, s, e }: the new line and where the selection
// lands.
function markToggle(text, s, e, mark) {
  const n = mark.length;
  // is there a standalone `mark` at i? A one-character mark has to check
  // its neighbours: a third asterisk alongside means these characters
  // belong to a **bold** pair instead. (Two-character marks can't be
  // mistaken for anything, so they skip the test.)
  const c = mark[0];
  const at = i => i >= 0 && text.slice(i, i + n) === mark &&
    (n > 1 || (text[i - 1] !== c && text[i + 1] !== c));

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
  const [a, b] = wordAt(text, s);
  if (a < b) {
    const w = markToggle(text, a, b, mark);
    // the caret returns to the letter it was on, which has shifted by
    // one mark's width in whichever direction the edit went
    const i = s + (w.text.length > text.length ? n : -n);
    const held = Math.min(Math.max(i, w.s), w.e);
    return { text: w.text, s: held, e: held };
  }

  // open space: lay down the pair and wait between them
  return { text: text.slice(0, s) + mark + mark + text.slice(s), s: s + n, e: s + n };
}

// the run of non-space around an offset — [s, s) when the caret is
// sitting in open space, which every caller reads as "nothing here"
function wordAt(text, s) {
  let a = s, b = s;
  while (a > 0 && /\S/.test(text[a - 1])) a--;
  while (b < text.length && /\S/.test(text[b])) b++;
  return [a, b];
}

/* ---------- ⌘K: shout ---------- */

/* A screenplay is written in capitals more than anything else is —
 * every slugline, every name over a line of dialogue — and holding
 * shift through all of them is a poor way to spend a draft.
 *
 * It toggles, because a shout typed by mistake needs a way back, and
 * lowercasing is the only inverse available: the original casing of
 * "MAYA" is gone the moment it's uppercased, and remembering it would
 * mean the app carrying a shadow copy of every word you ever shouted.
 * So the second press gives back lowercase, and the shift key gives
 * back the rest. Unlike the marks, this one really does change the
 * text — there's no notation for "said loudly", only the letters.
 */
function upperToggle(text, s, e) {
  if (s === e) [s, e] = wordAt(text, s);
  if (s === e) return { text, s, e }; // open space: nothing to shout
  const cut = text.slice(s, e);
  const said = cut === cut.toUpperCase() ? cut.toLowerCase() : cut.toUpperCase();
  // same length either way, so the selection needs no arithmetic
  return { text: text.slice(0, s) + said + text.slice(e), s, e };
}

/* ---------- ⌘\ : center ---------- */

/* Fountain centers a line by pointing at it from both sides:
 *
 *     > THE END <
 *
 * A whole-line mark, so it ignores the selection entirely and answers
 * for the line it was given. The caret comes back to the same character
 * it was on, shifted by however much the mark added or took away.
 */
// every piece is captured, opener and closer included, so taking the
// mark back off is arithmetic on real lengths rather than on an assumed
// one — "> " is two characters and ">" is one, and guessing gets the
// caret wrong by exactly the space
const CENTERED = /^([ \t]*)(>[ \t]?)(.*?)([ \t]?<)([ \t]*)$/;

function centerToggle(text, s) {
  const m = CENTERED.exec(text);
  if (m) {
    const [, lead, open, body, , tail] = m;
    const out = lead + body + tail;
    // the caret keeps the character it was on; if it was sitting in the
    // mark itself, it lands at the head of the words instead
    const at = Math.min(Math.max(s - open.length, lead.length), lead.length + body.length);
    return { text: out, s: at, e: at };
  }
  const t = text.trim();
  if (!t) return { text, s, e: s }; // nothing to point at
  const lead = text.length - text.trimStart().length;
  const out = text.slice(0, lead) + '> ' + t + ' <';
  const at = Math.min(s + 2, out.length);
  return { text: out, s: at, e: at };
}

// Node (a test run, or a future build tool) sees module; the browser
// doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { MD_MARKS, FTN_MARKS, markToggle, upperToggle, centerToggle, wordAt };
}
