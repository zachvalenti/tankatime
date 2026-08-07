'use strict';

/* Fountain — the screenplay grammar, no DOM.
 *
 * What md.js is to a poem, this file is to a script. /fountain on the
 * first line swaps one for the other, and app.js calls whichever the
 * mode asked for.
 *
 * It keeps the same promise md.js keeps:
 *
 *     ftnRuns(text, kind).map(r => r.text).join('') === text
 *
 * — paint over the source, never a translation of it — and it borrows
 * md.js's run classes wholesale, so the CSS that dims a mark and hides
 * it on a line you aren't writing needs no fountain of its own.
 *
 * One thing here is unlike anything in md.js, and it shapes the whole
 * file: Fountain cannot be read a line at a time. mdBlock() decides a
 * line's shape from that line alone, and every Markdown element obeys
 * that. Fountain doesn't. A character cue is all-caps text *with a
 * blank line above it and a written line below*; a parenthetical is
 * (this) *after a cue*; dialogue is whatever follows a cue until the
 * next blank. The same six words are a cue in one place and a line of
 * action in another, and only their neighbours can say which.
 *
 * So the entry point is ftnKinds(), which reads the whole document in
 * one forward pass and hands back a kind per line. app.js calls it once
 * per repaint and gives each line its own answer.
 *
 * Like count.js and md.js this file lives in two worlds: a plain
 * <script> in the browser, and the module.exports guard at the foot for
 * Node.
 */

/* ---------- the forced marks ---------- */

/* Fountain lets you insist. A line that would be read as one thing
 * takes a leading character to make it another — useful when a
 * character is called ED and every reader thinks it's a scene heading.
 * Each of these is matched at column zero, and each is one character
 * wide, which is what `prefix` below counts.
 */
const FTN_SCENE_F  = /^\.(?!\.)/;   // .INT SOMEWHERE — but ".." is ellipsis, left alone
const FTN_CHAR_F   = /^@/;          // @McCLANE
const FTN_ACTION_F = /^!/;          // !INT. NOT A SCENE HEADING
const FTN_LYRIC    = /^~/;          // ~Happy birthday to you
const FTN_TRANS_F  = /^>/;          // > BURN TO PINK.
const FTN_CENTERED = /^>.*<[ \t]*$/;// > THE END <

/* ---------- the unforced ones ---------- */

// INT. / EXT. / EST. / INT./EXT. / I/E — the openers a slugline is
// allowed. The separator afterwards is required for the same reason a
// Markdown heading needs its space: "INTERIOR" and "EXTRAORDINARY" are
// words, not sluglines.
const FTN_SCENE = /^(?:int|ext|est|int\.?\/ext|i\/e)[.\s]/i;

// A transition is a line that lands on "TO:" — CUT TO:, DISSOLVE TO:,
// MATCH CUT TO:. Read without regard to case, because the caps are put
// on for you (see FTN_CAPS below) and a writer shouldn't have to shout
// before the app will listen. What keeps a line of dialogue ending
// "...give it to:" out of this is the caller, which asks the question
// only when the line isn't already inside somebody's speech.
const FTN_TRANS = /\bto:[ \t]*$/i;

// a parenthetical is a line that is nothing but a parenthesis pair
const FTN_PAREN = /^\(.*\)[ \t]*$/;

// Sections and synopses — a writer's scaffolding, not the script.
// `# ` keeps the app's standing rule that a mark is a mark and then a
// breath (Fountain would allow "#Act One"; one rule across both modes
// is worth more than the character saved). `=` is a synopsis, but three
// or more is a page break, so the lookahead holds it back.
const FTN_SECTION  = /^(#{1,6})[ \t]+/;
const FTN_SYNOPSIS = /^=(?!=)[ \t]?/;

// the boneyard: everything between these is struck from the script but
// kept in the file. Unlike every other mark here, it spans lines.
const FTN_BONE_OPEN  = '/*';
const FTN_BONE_CLOSE = '*/';

/* A line is a cue only if it shouts. Uppercasing has to change nothing,
 * and there has to be a letter in it to begin with — otherwise "..." and
 * "1985" would qualify, and a scene would sprout characters named after
 * its own punctuation.
 */
function isShout(text) {
  return /[A-Za-z]/.test(text) && text === text.toUpperCase();
}

// a name shouted on its own line — the shape a character cue takes, and
// the one case where the app will take a cue without a gap above it
function isOneWord(text) {
  return !/\s/.test(text);
}

/* The kinds a line can be. Held here rather than spelled out at each
 * call so the class names and the prefix widths stay in one place.
 */
function kind(cls, prefix) { return { cls, prefix: prefix || 0 }; }

/* Sluglines and transitions are written in capitals — that is simply
 * what a screenplay looks like, and more than a convention: a Fountain
 * reader that meets "cut to:" in lower case will not know it is a
 * transition at all. So the app puts the capitals on, in the margin and
 * again on the way out to a file, and the writer types whichever case
 * is nearest to hand.
 *
 * It rides along as a second class on the line, so style.css can
 * uppercase the display and the export can ask the same question of the
 * same function. Only lines the app worked out for itself get it: a
 * forced heading or transition is a writer overruling the app, and
 * overruling it only to be overruled back would be a poor trade.
 */
const FTN_CAPS = 'ftn-caps';
function shouted(cls) { return cls + ' ' + FTN_CAPS; }

// a line can wear two names now, so asking what it is means asking the
// list rather than the string
function isKind(kind, name) {
  return !!kind && kind.cls.split(' ').includes(name);
}

/* ---------- the document pass ---------- */

/* → one { cls, prefix } per line of src, starting at `start` (the mode
 * lines above it are scaffolding and get a kind of their own from
 * app.js). Lines before `start` come back as action so the array still
 * lines up index for index with the document.
 *
 * The pass carries three things forward: whether the previous line was
 * blank, what kind it was, and whether we are inside a boneyard. That is
 * the whole of the context Fountain needs.
 *
 * It also has to look one line *ahead*, for the cue: THE END with
 * nothing under it is the end of a scene, not somebody about to speak.
 */
function ftnKinds(src, start) {
  const out = [];
  let bone = false;

  for (let i = 0; i < src.length; i++) {
    if (i < (start || 0)) { out.push(kind('ftn-action')); continue; }

    const text = src[i];
    const t = text.trim();
    const prevBlank = i === 0 || !src[i - 1].trim();
    const nextBlank = i + 1 >= src.length || !src[i + 1].trim();
    const prev = out[i - 1] ? out[i - 1].cls : null;
    const after = c => prev === c;

    // 1. the boneyard swallows whole lines, so it is asked first and
    //    answered before anything else gets a look
    if (bone) {
      out.push(kind('ftn-bone'));
      if (t.includes(FTN_BONE_CLOSE)) bone = false;
      continue;
    }
    if (t.includes(FTN_BONE_OPEN)) {
      // a boneyard that opens and closes on one line doesn't carry over
      const open = t.lastIndexOf(FTN_BONE_OPEN);
      if (!t.includes(FTN_BONE_CLOSE, open + 2)) bone = true;
      out.push(kind('ftn-bone'));
      continue;
    }

    // 2. a blank line is a blank line; it ends whatever came before
    if (!t) { out.push(kind('')); continue; }

    // 3. the writer's scaffolding
    let m;
    if ((m = FTN_SECTION.exec(text)))  { out.push(kind('ftn-section', m[0].length)); continue; }
    if ((m = FTN_SYNOPSIS.exec(text))) { out.push(kind('ftn-synopsis', m[0].length)); continue; }
    if (FTN_LYRIC.test(text))          { out.push(kind('ftn-lyric', 1)); continue; }

    // 4. the forced marks, which outrank everything they overrule.
    //    Centered is asked before transition: both open with '>', and
    //    only the closing '<' tells them apart.
    if (FTN_ACTION_F.test(text)) { out.push(kind('ftn-action', 1)); continue; }
    if (FTN_CHAR_F.test(text))   { out.push(kind('ftn-character', 1)); continue; }
    if (FTN_SCENE_F.test(text))  { out.push(kind('ftn-scene', 1)); continue; }
    if (FTN_CENTERED.test(text)) { out.push(kind('ftn-centered', 1)); continue; }
    if (FTN_TRANS_F.test(text))  { out.push(kind('ftn-transition', 1)); continue; }

    // is this line already inside somebody's speech? Asked twice below,
    // and the answer is what keeps a shouted line of dialogue from
    // being mistaken for the scenery around it
    const speaking = after('ftn-character') || after('ftn-paren') || after('ftn-dialogue');

    // 5. a slugline. Written where a scene starts, so it wants air
    //    above it — but a writer mid-draft often hasn't left any, and
    //    refusing the line then would be pedantry.
    if (FTN_SCENE.test(t)) { out.push(kind(shouted('ftn-scene'))); continue; }

    // 6. CUT TO: — anywhere a character isn't already talking
    if (FTN_TRANS.test(t) && !speaking) {
      out.push(kind(shouted('ftn-transition')));
      continue;
    }

    // 7. the cue, and the reason this whole pass exists.
    //
    //    The strict reading is a shout with a gap above it and a voice
    //    below: take either away and the same characters are a line of
    //    action. That is Fountain's own rule, and it is what lets
    //    "MAYA (V.O.)" and "THE TWO BROTHERS" be names at all.
    //
    //    A single shouted word is let through without the gap, because
    //    a name on its own line is unmistakable and a draft in progress
    //    rarely has its blank lines in place yet. Two words still need
    //    the gap — otherwise the sign reading NO ENTRY in the middle of
    //    a paragraph of action would start speaking.
    if (isShout(t) && !nextBlank && (prevBlank || isOneWord(t))) {
      out.push(kind('ftn-character'));
      continue;
    }

    // 8. what follows a cue. A parenthetical can sit between the cue and
    //    the words, or between one breath and the next.
    if (speaking) {
      out.push(kind(FTN_PAREN.test(t) ? 'ftn-paren' : 'ftn-dialogue'));
      continue;
    }

    // 9. everything else is action
    out.push(kind('ftn-action'));
  }

  return out;
}

/* ---------- inline marks ---------- */

/* *italic*, **bold**, _underline_, [[a note to yourself]].
 *
 * Note the underscore. md.js refuses to give a single one any meaning,
 * on the grounds that it would set fire to every snake_case word a poem
 * ever borrowed — but in Fountain a single underscore *is* the
 * underline, and the double means nothing at all. So the rule that
 * protects a poem is exactly the rule a script can't have, which is as
 * good an argument for two grammars as any.
 *
 * The lookahead after each opener and the \S before each closer are
 * md.js's guard, kept: a mark has to hug the text it marks, or one
 * stray asterisk italicises the rest of the line.
 */
const FTN_INLINE = new RegExp(
  '(?<note>\\[\\[.*?\\]\\])' +
  '|(?<strong>\\*\\*(?=\\S).*?\\S\\*\\*)' +
  '|(?<em>\\*(?=\\S)[^*]*?\\S\\*)' +
  '|(?<u>_(?=\\S)[^_]*?\\S_)', 'g');

// The one class md.js doesn't already own. Everything else here paints
// with md-mark, md-strong, md-em and md-u, which means the rules in
// style.css that dim a mark and hide it on a closed line cover Fountain
// without knowing Fountain exists.
const FTN_CLASSES = ['md-note'];

/* → the same flat runs mdRuns() returns, for the same reason: app.js
 * compares what a line should look like against what it does look like,
 * run for run, and repaints only when they differ. That comparison is
 * what keeps the caret still while you type.
 *
 * `kind` comes from ftnKinds() above — this function is handed its
 * line's answer rather than working it out, because it can't.
 */
function ftnRuns(text, kind) {
  const runs = [];
  const push = (t, cls) => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) last.text += t;
    else runs.push({ text: t, cls });
  };

  // A boneyard line is struck through entire; there is no markup inside
  // something that isn't in the script. The strike and the dimming are
  // the line's own class in style.css — deliberately *not* md-mark,
  // which would hide the line outright on every line but the one you're
  // writing, and cut text should be visibly cut, not gone.
  if (isKind(kind, 'ftn-bone')) {
    push(text, '');
    return runs;
  }

  /* The forcing character goes out as md-mark, which means style.css
   * hides it on every line but the one you're writing — the same fate
   * the hashes of a heading get in md.js, and for the same reason: the
   * line's own shape already says what it is far more plainly than a
   * lone '@' does. The parentheses of a parenthetical are *not* marked,
   * because they are the words themselves, and a script that loses them
   * reads wrong.
   */
  const prefix = kind ? kind.prefix : 0;
  if (prefix) push(text.slice(0, prefix), 'md-mark');

  // Centered text is the one mark with two ends. Its '<' has to go the
  // same way its '>' goes, or a finished page reads "THE END <".
  let suffix = 0;
  if (isKind(kind, 'ftn-centered')) {
    const m = /<[ \t]*$/.exec(text);
    if (m && m.index >= prefix) suffix = text.length - m.index;
  }

  const rest = text.slice(prefix, text.length - suffix);
  let at = 0;
  FTN_INLINE.lastIndex = 0;
  for (let m; (m = FTN_INLINE.exec(rest)); ) {
    push(rest.slice(at, m.index), '');
    const g = m.groups;
    const s = m[0];
    if (g.note) {
      // a note is dim from bracket to bracket — it is already an aside,
      // and picking its brackets out would be an aside about an aside
      push(s, 'md-note');
    } else {
      const cls = g.strong ? 'md-strong' : g.u ? 'md-u' : 'md-em';
      const n = g.strong ? 2 : 1; // how wide the mark itself is
      push(s.slice(0, n), 'md-mark');
      push(s.slice(n, s.length - n), cls);
      push(s.slice(s.length - n), 'md-mark');
    }
    at = m.index + s.length;
  }
  push(rest.slice(at), '');
  if (suffix) push(text.slice(text.length - suffix), 'md-mark');

  return runs;
}

/* ---------- on the way out to a file ---------- */

/* The capitals the app puts on are on the page and in the file both,
 * and this is the half that makes the file. It matters more than it
 * looks: an unforced transition or slugline in lower case is not a
 * transition or a slugline to any other Fountain program, so a script
 * exported as typed could open somewhere else with its scenes turned
 * into ordinary paragraphs. The one place the original casing survives
 * is the draft in the browser, which nothing ever reads back to you.
 */
function ftnText(src, start) {
  const kinds = ftnKinds(src, start);
  return src.map((line, i) => isKind(kinds[i], FTN_CAPS) ? line.toUpperCase() : line);
}

// Node (a test run, or a future build tool) sees module; the browser
// doesn't and skips this
if (typeof module !== 'undefined') {
  module.exports = { ftnKinds, ftnRuns, ftnText, isKind, FTN_CLASSES, FTN_CAPS, isShout };
}
