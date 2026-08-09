'use strict';

/* Markdown — the grammar, and nothing else.
 *
 * What a line is, and where the marks fall. No DOM, and no knowledge of
 * any other mode the room can be in: what ⌘B/I/U do to a line lives in
 * marks.js, because that arithmetic is about a mark rather than about
 * Markdown, and Fountain borrows every bit of it.
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

/* ---------- is there any Markdown here at all? ---------- */

/* Asked once, by the export, and the answer picks the extension.
 *
 * A tanka with no marks in it isn't a Markdown file — it's a poem, and
 * calling it .md tells the next program to go looking for a notation
 * that was never used. So a page that never reached for a mark leaves
 * as .txt, which is what it actually is.
 */
function mdUsed(src) {
  for (const line of src) {
    if (mdBlock(line).prefix) return true;
    MD_INLINE.lastIndex = 0;
    if (MD_INLINE.test(line)) return true;
  }
  return false;
}

// Node (a test run, or a future build tool) sees module; the browser
// doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { mdBlock, mdIsHeading, mdRuns, mdUsed, MD_CLASSES };
}
