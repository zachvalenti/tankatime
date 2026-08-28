'use strict';

/* What the first line can ask for.
 *
 * A line at the very top made of nothing but these words changes what
 * the room is. Leading lines are taken for as long as each holds only
 * mode words, so they may share one line or take one apiece, in
 * whatever order.
 *
 *   /free     the counts stop judging. No target, no green, no amber —
 *             just the number, for a syllabic ear working outside 31.
 *   /simple   every word is held against a thousand-word list, and the
 *             ones that aren't on it are marked.
 *   /haiku    the older, shorter form: three slots of 5-7-5 instead of
 *             five of 5-7-5-7-7. The same room in every other respect —
 *             a title still stands outside it, and a blank line still
 *             starts the next poem on the same terms.
 *   /fountain the room becomes a screenplay: Fountain notation instead
 *             of Markdown, and no syllables at all — a count of beats in
 *             a line of dialogue would be a number about nothing. The
 *             total falls to words, or the clock.
 *   /import   the export button becomes an import button, and the room
 *             takes a .txt, .md, .fountain or .highland file in place
 *             of what is on the page. An instrument rather than a room, like
 *             /version below: it says what the one button on the bar
 *             does next, and the file that arrives decides the room —
 *             a screenplay comes in under a /fountain line of its own,
 *             which is also what spends the word that asked for it.
 *   /version  which release this app is actually running, printed on the
 *             line itself. It answers the one question a cache-first
 *             offline app makes hard to ask: an installed copy serves
 *             whatever it cached, so "is my fix on this phone?" is
 *             otherwise a guess. Overrides every mode above it — nothing
 *             else is asked for by a page whose whole purpose is to be
 *             read once and cleared. Deliberately absent from the ? card:
 *             it is an instrument, not a feature.
 *
 * They are scaffolding rather than writing: no count in the margin,
 * nothing in the total, and the export leaves them behind.
 *
 * This file is deliberately the only one that knows the whole list. It
 * came out of the Markdown grammar, where it had grown up by accident —
 * which left markdown.js as the file that knew screenplays existed, and
 * a reader of it rightly asking why. Nothing here knows what any mode
 * *does*; that's app.js's business, and each grammar's. This only reads
 * the top of the page and reports what it was asked for.
 */

const MODE_WORDS = ['free', 'simple', 'fountain', 'haiku', 'import', 'version'];
const MODE_WORD = new RegExp('^/(' + MODE_WORDS.join('|') + ')$');

// the mode words on a line, or null if the line is a line of writing —
// one ordinary word anywhere on it and it stops being scaffolding
function modeWords(text) {
  const t = text.trim();
  if (!t) return null;
  const out = [];
  for (const w of t.split(/\s+/)) {
    const m = MODE_WORD.exec(w.toLowerCase());
    if (!m) return null;
    out.push(m[1]);
  }
  return out;
}

// → { free, simple, fountain, haiku, import, version, lines }, lines being how
// many the modes occupy at the top, which is also how many the export drops
function readModes(src) {
  const on = new Set();
  let n = 0;
  while (n < src.length) {
    const words = modeWords(src[n]);
    if (!words) break;
    for (const w of words) on.add(w);
    n++;
  }
  /* Every pair of these can be asked for together except one. A script
   * has no syllable form to hold it to — /fountain turns the counting
   * off entirely — so there is no shorter form for /haiku to ask for,
   * and asking for both is a contradiction rather than a combination.
   * Fountain wins, and haiku comes back off rather than merely inert:
   * a caller reading this should never have to know which of the two
   * takes precedence, only what the room is.
   */
  /* /version outranks all of them, and unlike the pair above this is
   * not a contradiction being resolved — it is a different kind of page.
   * The others ask for a room to write in; this one asks the app to say
   * what it is, is read once, and is cleared. Combining it with a
   * screenplay grammar would mean something, but nothing worth having,
   * so the same treatment applies: the others come back *off* rather
   * than merely inert, and a caller never has to know the order.
   */
  /* /import is the one instrument that combines with everything. It
   * asks nothing of the room — no counting changes, no grammar changes
   * — only that the button on the bar reads the other way for as long
   * as the word is there. So it rides alongside /free, /simple, /haiku
   * and /fountain untouched, and falls to /version with the rest of
   * them, a page being asked what it is having no room to import into.
   */
  const version = on.has('version');
  const fountain = !version && on.has('fountain');
  return { free: !version && on.has('free'),
           simple: !version && on.has('simple'),
           fountain, haiku: !version && on.has('haiku') && !fountain,
           import: !version && on.has('import'),
           version, lines: n };
}

// Node (a test run, or a future build tool) sees module; the browser
// doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { MODE_WORDS, modeWords, readModes };
}
