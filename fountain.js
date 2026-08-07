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

/* A caret at the end of a cue puts that speech alongside the one before
 * it rather than under it — two people talking at once. Fountain's own
 * mark, and the only one that trails instead of leading, which is why it
 * isn't up with the forced marks above.
 */
const FTN_DUAL = /[ \t]*\^[ \t]*$/;

/* The title page: Key: value pairs at the very top of the file, ended by
 * the first blank line. Other Fountain readers turn them into a cover.
 *
 * The keys are listed rather than matched as "any word then a colon",
 * and that is load-bearing: a script opening on CUT TO: would otherwise
 * disappear into the title page, since it is a word and a colon at the
 * top of a document too.
 */
const FTN_TITLE = /^(title|credit|authors?|source|draft date|date|contact|copyright|notes?)[ \t]*:/i;

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

/* FADE IN: and its relatives read as transitions to a screenwriter and
 * as plain action to Fountain — none of them ends in "TO:", which is the
 * only shape the format recognises unaided. The fix is the forced mark,
 * '>', and the app writes it into the line for you.
 *
 * Into the *line*, not into the export. This is a plain-text format and
 * the point of one is that the text is the whole truth: a writer who
 * learns the mark here can open a script in Notes or a Google Doc and
 * still write something a renderer will read. Hiding the '>' until
 * export would teach the opposite lesson, and teach it silently.
 */
const FTN_FADE = /^(fade in:|fade out\.|fade to black\.)[ \t]*$/i;

// → the line with its mark, or null if it doesn't need one. Called only
// for lines the caret has left, so nothing is ever rewritten under a
// writer mid-word.
function ftnFade(text) {
  const t = text.trim();
  // shouted as well as marked: this is a fixed piece of screenplay
  // furniture rather than a sentence, and it is written in capitals
  // everywhere it appears
  return FTN_FADE.test(t) ? '> ' + t.toUpperCase() : null;
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

// the other second class: a speech set alongside its neighbour rather
// than under it, worn by the cue and by everything it says
const FTN_DUAL_CLS = 'ftn-dual';

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
  // the title page runs from the top to the first blank line, and only
  // from the top — a Key: value line further down is ordinary writing
  let title = true;

  for (let i = 0; i < src.length; i++) {
    if (i < (start || 0)) { out.push(kind('ftn-action')); continue; }

    const text = src[i];
    const t = text.trim();
    const prevBlank = i === 0 || !src[i - 1].trim();
    const nextBlank = i + 1 >= src.length || !src[i + 1].trim();
    // `after` asks the list rather than the string: a line can wear two
    // names now (ftn-caps, ftn-dual), and comparing the whole className
    // would quietly answer no to every one of these
    const after = c => isKind(out[i - 1], c);

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

    // 2. a blank line is a blank line; it ends whatever came before —
    //    the title page, a speech, and both of them for good
    if (!t) { title = false; out.push(kind('')); continue; }

    // 3. the cover. Fountain reads these as the title page only while
    //    they run unbroken from the very top of the file.
    if (title) {
      if (FTN_TITLE.test(t)) { out.push(kind('ftn-title')); continue; }
      title = false;
    }

    // 4. the writer's scaffolding
    let m;
    if ((m = FTN_SECTION.exec(text)))  { out.push(kind('ftn-section', m[0].length)); continue; }
    if ((m = FTN_SYNOPSIS.exec(text))) { out.push(kind('ftn-synopsis', m[0].length)); continue; }
    if (FTN_LYRIC.test(text))          { out.push(kind('ftn-lyric', 1)); continue; }

    /* A cue may end in a caret, which sets that whole speech alongside
     * the one before it. The flag doesn't need carrying by hand: the
     * previous line's own class already says whether we are in a dual
     * speech, so it resets itself the moment anything else interrupts.
     */
    const cue = () => FTN_DUAL.test(t) ? 'ftn-character ' + FTN_DUAL_CLS : 'ftn-character';
    const said = c => after(FTN_DUAL_CLS) ? c + ' ' + FTN_DUAL_CLS : c;

    // 5. the forced marks, which outrank everything they overrule.
    //    Centered is asked before transition: both open with '>', and
    //    only the closing '<' tells them apart.
    if (FTN_ACTION_F.test(text)) { out.push(kind('ftn-action', 1)); continue; }
    if (FTN_CHAR_F.test(text))   { out.push(kind(cue(), 1)); continue; }
    if (FTN_SCENE_F.test(text))  { out.push(kind('ftn-scene', 1)); continue; }
    if (FTN_CENTERED.test(text)) { out.push(kind('ftn-centered', 1)); continue; }
    if (FTN_TRANS_F.test(text))  { out.push(kind('ftn-transition', 1)); continue; }

    // is this line already inside somebody's speech? Asked twice below,
    // and the answer is what keeps a shouted line of dialogue from
    // being mistaken for the scenery around it
    const speaking = after('ftn-character') || after('ftn-paren') || after('ftn-dialogue');

    // 6. a slugline. Written where a scene starts, so it wants air
    //    above it — but a writer mid-draft often hasn't left any, and
    //    refusing the line then would be pedantry.
    if (FTN_SCENE.test(t)) { out.push(kind(shouted('ftn-scene'))); continue; }

    // 7. CUT TO: — anywhere a character isn't already talking
    if (FTN_TRANS.test(t) && !speaking) {
      out.push(kind(shouted('ftn-transition')));
      continue;
    }

    /* 8. the cue, and the reason this whole pass exists: a shout with a
     *    gap above it and a voice below. Take either away and the same
     *    characters are a line of action.
     *
     *    The gap is not negotiable, and that is the point. Fountain's own
     *    rule is exactly this, so a script that reads correctly here reads
     *    correctly in screenplain or Highland — and a script that doesn't
     *    is wrong on screen too, where you can see it, rather than wrong
     *    later in a file you've already sent. An editor may be lenient
     *    about what it accepts; an editor whose output is the deliverable
     *    cannot be, because the leniency is invisible until it costs
     *    something. A cue that needs to break the rule says so with @.
     */
    if (isShout(t) && prevBlank && !nextBlank) {
      out.push(kind(cue()));
      continue;
    }

    // 9. what follows a cue. A parenthetical can sit between the cue and
    //    the words, or between one breath and the next, and a speech runs
    //    on until a blank line stops it.
    if (speaking) {
      out.push(kind(said(FTN_PAREN.test(t) ? 'ftn-paren' : 'ftn-dialogue')));
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

  // Two marks trail instead of leading, and both are dimmed the same way
  // the leading ones are. Centered text is the one mark with two ends —
  // its '<' has to go the way its '>' goes, or a finished page reads
  // "THE END <" — and a dual cue's caret is a mark, not part of the name.
  let suffix = 0;
  if (isKind(kind, 'ftn-centered')) {
    const m = /<[ \t]*$/.exec(text);
    if (m && m.index >= prefix) suffix = text.length - m.index;
  } else if (isKind(kind, FTN_DUAL_CLS) && isKind(kind, 'ftn-character')) {
    const m = FTN_DUAL.exec(text);
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

/* ---------- who is in this script ---------- */

/* The name inside a cue: no forcing '@', no dual caret, and no (V.O.)
 * or (CONT'D) hanging off the end. Those extensions are real Fountain
 * and belong in the file, but they aren't the character — MAYA and
 * MAYA (V.O.) are one person, and offering both as separate names to
 * complete would be offering a choice that isn't one.
 */
function cueName(text) {
  return text.trim()
    .replace(/^@/, '')
    .replace(FTN_DUAL, '')
    .replace(/\([^)]*\)[ \t]*$/, '')
    .trim();
}

/* → every character who speaks in this document, first appearance first.
 *
 * Worked out fresh from the page each time rather than remembered, which
 * is the whole reason a name stops being offered once its last line is
 * deleted: there is no list to fall out of date, only the script. The
 * cost is a pass per repaint, and the pass is already being made.
 */
function ftnNames(src, start, kinds) {
  const ks = kinds || ftnKinds(src, start);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (!isKind(ks[i], 'ftn-character')) continue;
    const name = cueName(src[i]);
    const key = name.toUpperCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/* ---------- ⌘D: two people at once ---------- */

/* → { line, text } for the one cue whose caret should go on or come off,
 * or null if the selection has nothing to do with a speech.
 *
 * Unlike everything in marks.js this needs the whole document — a cue is
 * only a cue because of its neighbours, and "the second one" is a
 * question about the page rather than about a line. That is why it lives
 * here and not there.
 *
 * Three ways to aim it, in the order they're asked:
 *   two cues in the selection  → the second one, which is the speech
 *                                being set alongside the first
 *   one cue in the selection   → that one
 *   none                       → walk up from the caret to the cue whose
 *                                speech it is sitting in
 */
function ftnDual(src, a, b, start) {
  const kinds = ftnKinds(src, start);
  const cues = [];
  for (let i = Math.max(a, 0); i <= b && i < src.length; i++)
    if (isKind(kinds[i], 'ftn-character')) cues.push(i);

  let at = cues.length >= 2 ? cues[cues.length - 1]
         : cues.length === 1 ? cues[0] : -1;

  if (at < 0) {
    for (let i = Math.min(a, src.length - 1); i >= 0; i--) {
      if (isKind(kinds[i], 'ftn-character')) { at = i; break; }
      // only a parenthetical or the speech itself sits under a cue;
      // anything else means the caret isn't in a speech at all
      if (!isKind(kinds[i], 'ftn-dialogue') && !isKind(kinds[i], 'ftn-paren')) break;
    }
  }
  if (at < 0) return null;

  const text = src[at];
  return { line: at, text: FTN_DUAL.test(text)
    ? text.replace(FTN_DUAL, '')
    : text.replace(/[ \t]*$/, '') + ' ^' };
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
  module.exports = { ftnKinds, ftnRuns, ftnText, ftnNames, ftnDual, ftnFade,
                     cueName, isKind, FTN_CLASSES, FTN_CAPS, FTN_DUAL_CLS, isShout };
}
