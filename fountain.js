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
const FTN_CHAR_F   = /^@/;          // @maya — and the app shouts it for you
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

/* ---------- the title page's own tidy ---------- */

/* `Title:Midnight Snack` is a title page line to every Fountain reader
 * there is, and a typo to every human one. The colon there is a key's
 * punctuation rather than a word's, and the space after it is what tells
 * an eye where the key stops — so the app puts it in, the way it puts the
 * '>' in front of FADE IN:, and for the same reason: it is what the line
 * meant, written the way the format writes it.
 *
 * → the line with its space, or null if it needs none. Called only for
 * lines ftnKinds() has already called a title, so the colon it finds is a
 * key's and not a piece of somebody's dialogue, and — like ftnFade —
 * only for lines the caret has left, so nothing is rewritten under a
 * writer mid-word.
 *
 * A key with nothing after it is left alone: the space would be invisible
 * and the edit unasked-for. The seeded cover writes its own (see COVER in
 * app.js), where it is the difference between typing a title and typing
 * it up against the colon.
 */
function ftnTitleSpace(text) {
  const at = text.indexOf(':');
  if (at < 0) return null;
  const rest = text.slice(at + 1);
  if (!rest.trim() || /^[ \t]/.test(rest)) return null;
  return text.slice(0, at + 1) + ' ' + rest;
}

/* A title page written down the page, folded back onto one line a key.
 *
 * Fountain lets a key's value sit on the lines beneath it, indented, and
 * Highland writes every title page that way:
 *
 *     TITLE:
 *         Midnight Snack
 *
 * This room reads a title line as a key and its value together, and the
 * indented line under a bare key is not a title line at all — so a cover
 * written that way arrives as a row of empty keys with the title itself
 * demoted to action, and the page count starts counting the cover. The
 * fold is therefore not a nicety: it is the difference between a title
 * page and a mess.
 *
 * A value spread over several indented lines comes back as one, joined by
 * spaces. That loses the break in a deliberately two-line title, and it
 * is the honest trade — there is no shape here that keeps one, so the
 * choice is a title on one line or a title that isn't a title.
 *
 * Only ever the top of the file, and only while what is up there is keys
 * and their continuations. The first line that is neither ends the fold,
 * and everything from it down goes through untouched — a script that
 * opens on a slugline is returned exactly as it came.
 */
function ftnTitleFold(text) {
  const src = text.split('\n');
  const out = [];
  let key = -1, i = 0;
  for (; i < src.length; i++) {
    const line = src[i];
    if (!line.trim()) break;                  // the blank line ends the cover
    const indented = /^[ \t]/.test(line);
    if (!indented && FTN_TITLE.test(line)) {
      out.push(line);
      key = out.length - 1;
      continue;
    }
    // an indented line under a key is that key's value; anything else is
    // not the title page, and neither it nor what follows is ours to touch
    if (key < 0 || !indented) break;
    out[key] = out[key].replace(/[ \t]+$/, '') + ' ' + line.trim();
  }
  return key < 0 ? text : out.concat(src.slice(i)).join('\n');
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
 * same function. A forced heading or transition doesn't get it: forcing
 * is a writer overruling the app, and overruling it only to be overruled
 * back would be a poor trade.
 *
 * A forced *cue* is the one exception, and it is deliberate. A cue is
 * capitals in every screenplay ever printed, '@' is the shortest way to
 * say "this is a person speaking", and it is one character where the
 * alternative is holding a shift key down through a whole name — which
 * on a phone means a caps-lock hunt on a keyboard that puts it two
 * layers deep. So @maya is a cue, and it is MAYA. The cost is real and
 * worth naming: Fountain's own use for '@' is the name that can't shout,
 * McCLANE, and this spends it outright. There is now no cue in mixed
 * case here — an unforced one has to shout to be read as a cue at all,
 * and a forced one gets shouted. MCCLANE is what this editor writes.
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
    // the forced cue is the one forced mark the app shouts for you; see
    // the note on FTN_CAPS for what that spends and why
    if (FTN_CHAR_F.test(text))   { out.push(kind(shouted(cue()), 1)); continue; }
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
    // the name as the page spells it, which is capitals either way now:
    // an unforced cue had to shout to be one, and a forced cue is shouted
    // for you. Offering @maya's name back as "maya" would complete a line
    // that isn't a cue — the same trap the tail-append used to set.
    const name = cueName(src[i]).toUpperCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/* ---------- how long is it? ---------- */

/* A screenplay page is a fixed thing: Courier at ten characters to the
 * inch, a six-inch column, fifty-five lines from the top margin to the
 * bottom. That is why a page of script is a minute of screen and why
 * anyone can say "we're at ninety" and be understood. The number is
 * worth having in the margin for the same reason the syllable count is:
 * it is the form telling you where you are.
 *
 * These are the column widths in characters, and they are the standard
 * ones — not the widest a renderer could allow. A cue is thirty-three
 * columns and a parenthetical twenty-six because that is what a
 * screenplay page looks like; a tool that lets them run to the full
 * sixty-one is being generous with something that isn't its to give.
 */
const PAGE_LINES = 55;
const FTN_COLS = {
  'ftn-scene': 61, 'ftn-action': 61, 'ftn-transition': 61, 'ftn-centered': 61,
  'ftn-lyric': 61, 'ftn-character': 33, 'ftn-paren': 26, 'ftn-dialogue': 36,
};

// two people talking at once share the width, and each column keeps a
// little less than half of what it had
const FTN_DUAL_COLS = 0.75;

// the blank line a shape wants above it. Dialogue and a parenthetical sit
// straight under the cue they belong to; everything else gets air.
const FTN_SPACE = {
  'ftn-scene': 1, 'ftn-action': 1, 'ftn-transition': 1, 'ftn-centered': 1,
  'ftn-lyric': 0, 'ftn-character': 1, 'ftn-paren': 0, 'ftn-dialogue': 0,
};

/* How many rows a line of text takes in a column that wide.
 *
 * Greedy word wrap, the way every renderer breaks a line — dividing the
 * characters by the width would pack them perfectly and quietly lose the
 * ragged end of every row.
 */
function ftnRows(text, cols) {
  const t = text.trim();
  if (!t) return 1;
  let rows = 1, at = 0;
  for (const word of t.split(/\s+/)) {
    if (at === 0) { at = word.length; }
    else if (at + 1 + word.length <= cols) { at += 1 + word.length; }
    else { rows++; at = word.length; }
    while (at > cols) { rows++; at -= cols; }  // a word longer than the column
  }
  return rows;
}

/* → the length of the script in pages, as a fraction.
 *
 * What this measures is the script's own length: how much page the
 * writing occupies at the standard geometry. It is not a promise about
 * where any particular program will break its pages — every renderer
 * makes its own choices at a page bottom, and they disagree with each
 * other by whole pages over a feature. Held against a renderer that
 * fills its pages properly this lands within a third of a page at forty,
 * and drifts to about a page by a hundred and twenty. Two decimals
 * because a fifth of a page is a real amount of writing; the third
 * decimal would be a lie about how well anyone knows this.
 *
 * The title page doesn't count — it isn't the script. Neither do
 * sections and synopses, which are the writer's scaffolding and which no
 * renderer prints by default, nor the boneyard, which is cut.
 */
function ftnPages(src, start, kinds) {
  const ks = kinds || ftnKinds(src, start);

  // 1. gather the lines into elements — a run of the same shape, broken
  //    by the blank lines between them. Dialogue is the exception: each
  //    of its lines is its own paragraph, which is how a renderer lays
  //    a speech out and how it is allowed to break one.
  const els = [];
  for (let i = start || 0; i < src.length; i++) {
    const kind = ks[i];
    if (!src[i].trim()) { els.push(null); continue; }
    const cls = Object.keys(FTN_COLS).find(c => isKind(kind, c));
    if (!cls) continue;  // title page, boneyard, scaffolding: not the script
    const dual = isKind(kind, FTN_DUAL_CLS);
    const runs = cls !== 'ftn-dialogue' && cls !== 'ftn-paren';
    const last = els[els.length - 1];
    if (last && runs && last.cls === cls && last.dual === dual) last.lines.push(src[i]);
    else els.push({ cls, dual, lines: [src[i]] });
  }

  // 2. gather elements into blocks: a speech is a cue and everything it
  //    says, because a dual speech is measured against the whole of the
  //    one beside it rather than line for line
  const blocks = [];
  for (const el of els) {
    if (!el) continue;
    const last = blocks[blocks.length - 1];
    const said = el.cls === 'ftn-dialogue' || el.cls === 'ftn-paren';
    if (said && last && last.speech && last.dual === el.dual) last.els.push(el);
    else blocks.push({ speech: el.cls === 'ftn-character', dual: el.dual, els: [el] });
  }

  // 3. add it up
  const high = (block, cols) => block.els.reduce((n, el, i) =>
    n + (i ? FTN_SPACE[el.cls] : 0) +
    el.lines.reduce((r, ln) => r + ftnRows(ln, Math.floor(FTN_COLS[el.cls] * cols)), 0), 0);

  let lines = 0, open = false;
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    const next = blocks[b + 1];
    // a speech with a dual speech behind it: the two stand side by side,
    // so the pair costs whichever of them is taller, not both
    if (block.speech && next && next.dual && !block.dual) {
      lines += (open ? 1 : 0) +
        Math.max(high(block, FTN_DUAL_COLS), high(next, FTN_DUAL_COLS));
      open = true;
      b++;
      continue;
    }
    lines += (open ? FTN_SPACE[block.els[0].cls] : 0) + high(block, 1);
    open = true;
  }

  return lines / PAGE_LINES;
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
  module.exports = { ftnKinds, ftnRuns, ftnText, ftnNames, ftnDual, ftnFade, ftnPages,
                     ftnTitleSpace, ftnTitleFold,
                     cueName, isKind, FTN_CLASSES, FTN_CAPS, FTN_DUAL_CLS, isShout };
}
