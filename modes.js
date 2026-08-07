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
 *   /fountain the room becomes a screenplay: Fountain notation instead
 *             of Markdown, and no syllables at all — a count of beats in
 *             a line of dialogue would be a number about nothing. The
 *             total falls to words, or the clock.
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

const MODE_WORDS = ['free', 'simple', 'fountain'];
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

// → { free, simple, fountain, lines }, lines being how many the modes
// occupy at the top, which is also how many the export drops
function readModes(src) {
  const on = new Set();
  let n = 0;
  while (n < src.length) {
    const words = modeWords(src[n]);
    if (!words) break;
    for (const w of words) on.add(w);
    n++;
  }
  return { free: on.has('free'), simple: on.has('simple'),
           fountain: on.has('fountain'), lines: n };
}

// Node (a test run, or a future build tool) sees module; the browser
// doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { MODE_WORDS, modeWords, readModes };
}
