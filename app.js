'use strict';

/* Tanka Time — the editor. No framework, no build step.
 *
 * index.html loads six small files before this one, and every one of
 * them is pure strings: give it text, get text back. count.js counts
 * syllables and words, simple.js holds the thousand plain words,
 * modes.js reads what the first line of the page asked for, markdown.js
 * and fountain.js are the two grammars, and marks.js is what the
 * keyboard shortcuts do to a line. None of them knows a page exists.
 *
 * This file is where a page appears, and it does everything that needs
 * one: the editor, the numbers in the margin, undo, autosave, themes,
 * export, the clear-hold flood, offline support. Top to bottom it
 * follows the page's life — grab elements, define behavior, attach
 * listeners, restore saved state.
 */

// every element the script touches, grabbed once by id
const page    = document.getElementById('page');
const doc     = document.getElementById('doc');
const editor  = document.getElementById('editor');
const gutter  = document.getElementById('gutter');
const totalEl = document.getElementById('total');
const fsBtn   = document.getElementById('fs');
const exportBtn = document.getElementById('export');
const themeBtn  = document.getElementById('theme');
const clearBtn  = document.getElementById('clear');
const flood     = document.getElementById('flood');

// the tanka form: five lines of 5-7-5-7-7 syllables
const TARGETS = [5, 7, 5, 7, 7];
const STORE_KEY = 'tanka-time-doc';
const THEME_KEY = 'tanka-time-theme';
const TOTAL_KEY = 'tanka-time-total';
const THEMES = { room: '#0a0c0a', paper: '#f6f1e3', dusk: '#171321' };

/* ---------- editor structure ---------- */

function makeLine(text) {
  const d = document.createElement('div');
  if (text) d.textContent = text;
  // an empty line still needs height and a place for the caret; a lone
  // <br> is how contenteditable represents "blank line"
  else d.appendChild(document.createElement('br'));
  return d;
}

// keep the editor as one <div> per line; browsers mostly do this on
// their own once seeded, but repair stray nodes after odd edits
// (contenteditable is loosely specified — every browser improvises)
function normalize() {
  if (!editor.firstChild) {
    editor.appendChild(makeLine(''));
    return;
  }
  const isDiv = n => n.nodeType === 1 && n.tagName === 'DIV';
  if ([...editor.childNodes].every(isDiv)) return;

  // remember the caret — moving nodes around would otherwise drop it
  const sel = document.getSelection();
  const saved = sel.rangeCount && editor.contains(sel.anchorNode)
    ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset]
    : null;

  // sweep loose text nodes into fresh <div> lines, splitting at <br>s
  let run = null;
  for (const node of [...editor.childNodes]) {
    if (isDiv(node)) { run = null; continue; }
    if (node.nodeType === 1 && node.tagName === 'BR') {
      if (run) run.appendChild(node);
      else {
        const d = document.createElement('div');
        editor.replaceChild(d, node);
        d.appendChild(node);
      }
      run = null;
      continue;
    }
    if (!run) {
      run = document.createElement('div');
      editor.insertBefore(run, node);
    }
    run.appendChild(node);
  }
  if (saved) {
    try { sel.setBaseAndExtent(saved[0], saved[1], saved[2], saved[3]); } catch (_) {}
  }
}

// contenteditable pads with non-breaking spaces ( ); treat them
// as ordinary spaces everywhere text leaves the editor
function plain(text) {
  return text.replace(/\u00a0/g, ' ');
}

function getText() {
  return [...editor.children].map(d => plain(d.textContent)).join('\n');
}

function setText(text) {
  editor.replaceChildren(...text.split('\n').map(makeLine));
}

/* ---------- markdown decoration ---------- */

/* Each line is painted with <span>s naming what its Markdown means —
 * character for character, so the line's textContent still reads back
 * as plain source and getText() never learns any of this happened.
 *
 * The hazard in decorating a contenteditable is rebuilding a line on
 * every keystroke: it shoves the caret about, and it drops the edit
 * outside the browser's own undo. So a line is repainted only when its
 * runs actually change shape. Typing a letter into the middle of a bold
 * word leaves the runs identical, and the browser's edit simply stands.
 */

// an IME composition is a half-typed character; rebuilding underneath
// one destroys it, so decoration waits for the end
let composing = false;

/* The open line: the one the caret rests on. Its marks show; every other
 * line keeps them out of sight, so a page you aren't touching reads as
 * the poem rather than as its notation. Only paint — the text of every
 * line is the same whichever one is open, and so is anything you copy.
 *
 * This is read from the selection rather than remembered, and that is
 * load-bearing. 'selectionchange' arrives a beat late, so a line that
 * has just taken the caret can still look closed when it is repainted —
 * and a caret cannot live inside display:none. Chrome drops it to the
 * editor instead, and the next character lands outside every line.
 */
let openLine = null;

function caretLine() {
  const sel = document.getSelection();
  return sel && sel.rangeCount ? lineOf(sel.focusNode) : null;
}

function runNode(run) {
  if (!run.cls) return document.createTextNode(run.text);
  const s = document.createElement('span');
  s.className = run.cls;
  s.textContent = run.text;
  return s;
}

// the classes decorate() writes, and a name no run can ever carry —
// used below to mark markup this file didn't put there. Both grammars
// are listed: a class missing from here is named FOREIGN below, and a
// line wearing it repaints on every keystroke forever.
const MD_OURS = new Set([...MD_CLASSES, ...FTN_CLASSES]);
const FOREIGN = '/not ours';

// what a line shows now, in the shape mdRuns() describes it: adjacent
// nodes of one class merged, empties and the trailing <br> dropped — so
// the two can be compared without trusting the browser to have kept its
// nodes tidy, or to have spelled its spaces the same way
function currentRuns(line) {
  const runs = [];
  for (const n of line.childNodes) {
    if (n.nodeType === 1 && n.tagName === 'BR') continue;
    // A browser carries the styling around the caret into whatever you
    // type next: delete a dimmed title and Chrome will wrap the next
    // word in a <font> holding that gray. Such an element has no class,
    // so it would otherwise pass for ordinary text and never be cleaned
    // up. Anything we didn't write is named FOREIGN instead, which no
    // run from mdRuns() can match — so the line gets repainted and the
    // stray markup swept out. Same spirit as normalize(), one level in.
    // a flagged word carries two classes at once ("md-strong md-odd"),
    // so this asks of each name in turn. Comparing the whole string would
    // call every flagged word foreign and repaint its line forever.
    const cls = n.nodeType !== 1 ? ''
      : n.tagName === 'SPAN' && n.attributes.length === 1 &&
        n.className.split(' ').every(c => MD_OURS.has(c))
        ? n.className : FOREIGN;
    const text = plain(n.textContent);
    if (!text) continue;
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) last.text += text;
    else runs.push({ text, cls });
  }
  return runs;
}

function sameRuns(a, b) {
  return a.length === b.length &&
    a.every((r, i) => r.cls === b[i].cls && r.text === b[i].text);
}

// an empty line is a lone <br> — contenteditable's way of holding height
function isBare(line) {
  return line.childNodes.length === 1 && line.firstChild.nodeName === 'BR';
}

// The caret's place in a line, counted in characters rather than nodes,
// so it survives the line being rebuilt underneath it.
function offsetIn(line, node, offset) {
  // a selection anchored on the line itself counts children, not text
  if (node === line) {
    let n = 0;
    for (let i = 0; i < offset && i < line.childNodes.length; i++)
      n += line.childNodes[i].textContent.length;
    return n;
  }
  let n = 0;
  const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let t; (t = walk.nextNode()); ) {
    if (t === node) return n + offset;
    n += t.data.length;
  }
  return n;
}

// null when there's nothing to hold on to: no caret, a caret in another
// line, or a selection mid-drag — decoration catches up on the next edit
function caretOffset(line) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
  const node = sel.focusNode;
  if (!node || node === editor || !line.contains(node)) return null;
  return offsetIn(line, node, sel.focusOffset);
}

// the inverse: a character offset back into the [node, offset] pair the
// Selection API wants
function offsetToPoint(line, off) {
  const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let n = 0, last = null;
  for (let t; (t = walk.nextNode()); ) {
    if (off <= n + t.data.length) return [t, off - n];
    n += t.data.length;
    last = t;
  }
  return last ? [last, last.data.length] : [line, 0];
}

function placeCaret(line, off) {
  const [node, i] = offsetToPoint(line, off);
  try { document.getSelection().collapse(node, i); } catch (_) {}
}

// ** and # and > are not words, so they pass through untouched; every
// other run is cut into words and gaps, and a word the thousand doesn't
// hold picks up md-odd alongside whatever it already wore.
const NO_WORDS = new Set(['md-mark', 'md-hash', 'md-prefix']);

function flagWords(runs) {
  const out = [];
  const push = (text, cls) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.text += text;
    else out.push({ text, cls });
  };
  for (const r of runs) {
    if (NO_WORDS.has(r.cls)) { push(r.text, r.cls); continue; }
    // the capture group keeps the gaps, so the pieces still spell the run
    for (const piece of r.text.split(/([A-Za-z\u2019']+)/)) {
      const odd = /[A-Za-z]/.test(piece) && !isSimpleWord(piece);
      push(piece, odd ? (r.cls ? r.cls + ' md-odd' : 'md-odd') : r.cls);
    }
  }
  return out;
}

// one line: name its shape for style.css, then repaint it if — and only
// if — the runs have moved.
//
// `kind` is the line's answer from ftnKinds(), or null in poem mode —
// Fountain can't read a line without its neighbours, so the shape is
// worked out for the whole document up in readDoc() and handed down
// here rather than asked for a line at a time.
function decorate(line, isMode, simple, kind) {
  if (composing) return;
  const text = plain(line.textContent);
  // the block class names the line's shape; 'open' rides along with it,
  // because writing className outright would otherwise wipe it
  const shape = isMode ? 'md-mode' : kind ? kind.cls : mdBlock(text).cls;
  const cls = [shape, line === openLine ? 'open' : ''].filter(Boolean).join(' ');
  if (line.className !== cls) line.className = cls;

  // a mode line is not poem, so its words are nobody's business
  const runs = kind && !isMode ? ftnRuns(text, kind) : mdRuns(text);
  const want = simple && !isMode ? flagWords(runs) : runs;
  if (want.length ? sameRuns(want, currentRuns(line)) : isBare(line)) return;

  const off = caretOffset(line);
  line.replaceChildren(...(want.length
    ? want.map(runNode)
    : [document.createElement('br')]));
  if (off !== null) placeCaret(line, off);
}

/* ---------- render ---------- */

// one pass repaints the Markdown and then remeasures. Kept apart
// because a caret moving between lines needs the second half only —
// and calling the first half at that moment would have normalize()
// tidying a DOM the browser is still in the middle of building.
// the document as plain lines, plus whatever its first line asked for
function readDoc() {
  const rows = [...editor.children];
  const src = rows.map(d => plain(d.textContent));
  const modes = readModes(src);
  // Fountain is the one grammar here that can't be read a line at a
  // time — a shout is a character cue or a line of action depending
  // entirely on what sits above and below it. So the shapes are worked
  // out for the whole document in one pass, once, and decorate() is
  // handed each line's answer. In poem mode there is nothing to work
  // out ahead: mdBlock() reads a line on its own.
  const kinds = modes.fountain ? ftnKinds(src, modes.lines) : null;
  return { rows, src, modes, kinds };
}

function refresh() {
  normalize();
  // ask where the caret is now rather than trusting the last event to
  // have told us — see the note on openLine
  openLine = caretLine();
  const { rows, src, modes, kinds } = readDoc();
  const flipped = setFountain(modes.fountain);
  // decorate before measuring: a heading stands taller than a line of
  // poem, so every offsetTop read below has to be the settled one
  for (let i = 0; i < rows.length; i++)
    decorate(rows[i], i < modes.lines, modes.simple, kinds && kinds[i]);
  measure(rows, src, modes);
  setGhost(rows, src, modes, kinds);

  // Both of these rewrite the document, so they go last and each starts
  // a fresh refresh() of its own rather than trying to patch this one.
  if (flipped && modes.fountain) seedScript(modes.lines);
  else if (modes.fountain) tidyFades();
}

/* ---------- the two things that write to the page ---------- */

/* A script opens on a cover. Fountain's title page is Key: value lines
 * at the top of the file, and every renderer that reads the format turns
 * them into one, so a script that leaves without them is a script that
 * arrives anonymous.
 *
 * Real text, not a placeholder: it saves, it exports, it deletes, and
 * backspace is the only thing you need to know to be rid of it.
 */
// The blank after Contact: is the title page's terminator — Fountain
// reads the cover as running from the top until the first empty line —
// and the one after that is somewhere to start writing.
const COVER = ['Title:', 'Author:', 'Draft date:', 'Contact:', '', ''];

/* Seeded on the one keystroke that turns the mode on, and only into a
 * page with nothing under that line. Delete the cover and it stays
 * deleted — the flag doesn't flip twice.
 */
function seedScript(modeLines) {
  const rows = [...editor.children];
  for (let i = modeLines; i < rows.length; i++)
    if (plain(rows[i].textContent).trim()) return;

  commit(); // the cover is one undo step, not seven
  const keep = rows.slice(0, modeLines);
  editor.replaceChildren(...keep, ...COVER.map(makeLine));
  const first = editor.children[keep.length];
  if (first) placeCaret(first, plain(first.textContent).length);
  refresh();
  commit();
}

/* FADE IN: is a transition to a screenwriter and plain action to
 * Fountain — it doesn't end in "TO:", which is the only shape the format
 * knows unaided. So the app writes the forcing '>' into the line.
 *
 * Into the line, where you can see it. This is a plain-text format and
 * the whole value of one is that the text is the truth: a writer who
 * meets the mark here can open a draft in Notes or a Google Doc and
 * still write something a renderer will read correctly. Adding it
 * silently at export would teach the opposite, and teach it invisibly.
 *
 * Never on the line the caret is on. A writer mid-word is not asking for
 * help, and rewriting underneath them is how an editor loses their
 * trust — so the line is tidied once they've left it.
 */
let fixing = false;

function tidyFades() {
  if (fixing) return;
  const jobs = [];
  for (const row of editor.children) {
    if (row === openLine) continue;
    const src = plain(row.textContent);
    const out = ftnFade(src);
    if (out !== null && out !== src) jobs.push([row, out]);
  }
  if (!jobs.length) return;

  fixing = true;
  commit();
  for (const [row, text] of jobs) row.textContent = text;
  refresh();
  commit();
  fixing = false;
}

/* ---------- who's speaking ---------- */

/* The dim rest of a character's name, offered on a line that is shaping
 * up to be a cue. Tab takes it.
 *
 * Drawn by style.css as ::after from this attribute, and that is the
 * whole design rather than a detail of it. A pseudo-element is not a
 * child node, so getText() can't see it, the draft and the export can't
 * contain it, currentRuns() can't call it foreign and repaint forever,
 * and the caret cannot land inside it. Every one of those is a bug that
 * putting real text on the line would have had to solve.
 */
let ghostLine = null;

function setGhost(rows, src, modes, kinds) {
  if (ghostLine) { ghostLine.removeAttribute('data-ghost'); ghostLine = null; }
  if (!modes.fountain || !openLine) return;

  const i = rows.indexOf(openLine);
  if (i < 0) return;
  const t = src[i].trim();
  // a cue needs a blank line above it, so a line without one isn't one
  // yet and shouldn't be offered a name
  if (!t || (i > modes.lines && src[i - 1].trim())) return;
  // and the caret has to be at the end, or the suggestion would be about
  // text the writer has already moved past
  if (caretOffset(openLine) !== src[i].length) return;

  const up = t.toUpperCase();
  const hits = ftnNames(src, modes.lines, kinds)
    .filter(n => n.length > t.length && n.toUpperCase().startsWith(up));
  // two candidates and a ghost would be a lie about what Tab will do
  if (hits.length !== 1) return;

  ghostLine = openLine;
  openLine.dataset.ghost = hits[0].slice(t.length);
}

// the caret moved on its own — no edit, so nothing needs repainting
// beyond which line wears the class
function openCaretLine() {
  const row = caretLine();
  if (row === openLine) return;
  openLine?.classList.remove('open');
  row?.classList.add('open');
  openLine = row;
  // marks appearing widen the line they are on, which can shift every
  // number below it
  const { rows, src, modes, kinds } = readDoc();
  measure(rows, src, modes);
  setGhost(rows, src, modes, kinds);
}

// the margin numbers and the total. The new spans collect in a
// DocumentFragment first so the page reflows once, and each is pinned to
// its line's offsetTop — the gutter is a separate absolutely-positioned
// column that shadows the editor. Reads the editor, never writes to it.
function measure(rows, src, modes) {
  const frag = document.createDocumentFragment();
  const blank = src.map(t => !t.trim());
  const head = src.map(mdIsHeading);
  let pos = 0, total = 0, words = 0, any = false;

  for (let i = 0; i < rows.length; i++) {
    // whatever the first line asked for is scaffolding, not poem: no
    // number beside it and nothing of it in either total. 'any' still
    // turns true so the 5·7·5·7·7 hint doesn't sit on top of it.
    if (i < modes.lines) { any = true; continue; }
    // a script has no form to hold it to. Counting the syllables in a
    // line of dialogue would produce a number about nothing, so it
    // isn't counted at all — no margin, no target, no total. Words
    // still add up, because that face of the total is the one left.
    if (modes.fountain) {
      if (src[i].trim()) { any = true; words += countWords(src[i]); }
      continue;
    }
    // a title stands outside the form: nothing in the margin, no
    // syllables in the total, and a fresh tanka opens beneath it
    if (head[i]) {
      any = true;
      words += countWords(src[i]);
      pos = 0;
      continue;
    }
    if (blank[i]) {
      // two blank lines in a row, a blank alongside a title, or one
      // once the five slots are filled — each starts a new tanka; a
      // lone blank inside an unfinished tanka keeps its slot and
      // counts as 0
      // in free mode there are no slots to hold, so a blank line is
      // only ever a gap between one thought and the next
      if (modes.free || blank[i - 1] || blank[i + 1] || head[i - 1] ||
          head[i + 1] || pos >= TARGETS.length) { pos = 0; continue; }
      const span = document.createElement('span');
      span.textContent = '0';
      span.style.top = rows[i].offsetTop + 'px';
      span.dataset.state = 'under';
      frag.appendChild(span);
      pos++;
      continue;
    }
    any = true;
    const text = src[i];
    const n = countLine(text);
    total += n;
    words += countWords(text);
    // free mode counts without judging: no target means no green and
    // no amber, just the number, for an ear working outside 31
    const target = modes.free ? null
      : pos < TARGETS.length ? TARGETS[pos] : null;
    const span = document.createElement('span');
    span.textContent = n;
    span.style.top = rows[i].offsetTop + 'px';
    // data-state drives the color in style.css: hit green, over amber
    span.dataset.state =
      target === null ? 'free' :
      n === target    ? 'hit'  :
      n > target      ? 'over' : 'under';
    frag.appendChild(span);
    pos++;
  }

  // until the first real character, the 5·7·5·7·7 hint stands alone —
  // no margin counts
  if (any) gutter.replaceChildren(frag);
  else gutter.replaceChildren();
  doc.classList.toggle('empty', !any);
  totals = { syllables: total, words };
  renderTotal();
  scheduleSave();
}

/* ---------- the total: syllables · words · timer ---------- */

// the number at the bottom is secretly a button: a click cycles it
// through three faces. The chosen face is remembered like the theme.
const MODES = ['syllables', 'words', 'timer'];
let totalMode = MODES.includes(localStorage.getItem(TOTAL_KEY))
  ? localStorage.getItem(TOTAL_KEY) : 'syllables';
let totals = { syllables: 0, words: 0 };

/* /fountain removes one of the three faces, and the removal has to be
 * temporary in a way the stored setting is not.
 *
 * The face is a setting: global, remembered, chosen once and kept. The
 * mode is a property of the document: it lives in the first line, and
 * deleting that line has to give everything back. So writing 'words'
 * into storage the moment a script starts would be the wrong kind of
 * permanent — a poem opened afterwards would have lost its syllables,
 * with nothing on the page to explain why.
 *
 * Instead the stored face is left exactly as it was and read through
 * here. Syllables become words while a script is open, and the poem's
 * own setting is still underneath when the script closes.
 */
let fountain = false;

function faces() { return fountain ? ['words', 'timer'] : MODES; }

function shownMode() {
  return fountain && totalMode === 'syllables' ? 'words' : totalMode;
}

// the timer counts this sitting only: it starts when the page loads,
// so a refresh or a fresh launch starts it over. No clock state is
// saved anywhere — that keeps it honest and the display small.
const SESSION_T0 = Date.now();
let clockTimer = 0;

// 3:07, then 1:02:07 past the hour — never wider than a few characters
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const pad = n => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return (h ? h + ':' + pad(Math.floor(s / 60) % 60) : Math.floor(s / 60))
    + ':' + pad(s % 60);
}

function renderTotal() {
  const mode = shownMode();
  if (mode === 'timer') {
    totalEl.textContent = fmtClock(Date.now() - SESSION_T0);
    return;
  }
  const n = totals[mode];
  const noun = mode === 'words' ? 'word' : 'syllable';
  totalEl.textContent = n ? `${n} ${noun}${n === 1 ? '' : 's'}` : '';
}

// everything the chosen face changes on the page. Kept apart from the
// remembering below because the mode can take the choice away without
// the writer having chosen anything.
function applyTotal() {
  const mode = shownMode();
  // the margin numbers are syllable counts; on the other faces they'd
  // contradict the total, so the gutter rests until syllables return.
  // (the native hidden attribute is display:none without any CSS)
  gutter.hidden = mode !== 'syllables';
  // the once-a-second tick exists only while the timer face is up
  clearInterval(clockTimer);
  clockTimer = mode === 'timer' ? setInterval(renderTotal, 1000) : 0;
  renderTotal();
}

function setTotalMode(mode) {
  totalMode = mode;
  try { localStorage.setItem(TOTAL_KEY, mode); } catch (_) {}
  applyTotal();
}

/* Called from every refresh, which is why it does nothing at all unless
 * the answer has changed. applyTotal() restarts the clock's once-a-
 * second tick, and running it on each keystroke would mean the second
 * never finishes: a writer typing steadily would watch a timer that
 * never moved.
 */
// → true if the mode actually changed, which is the moment the cover
// page gets seeded and the only moment it does
function setFountain(on) {
  if (on === fountain) return false;
  fountain = on;
  // the file the export writes is a different file now. Outside a
  // script it depends on whether any marks were used, which changes as
  // you type — so the title names both rather than chase it.
  exportBtn.title = on ? 'Export as .fountain' : 'Export as .md or .txt';
  applyTotal();
  return true;
}

totalEl.addEventListener('click', () => {
  const f = faces();
  // from a face the mode has taken away, the next click lands on the
  // first one it left
  const i = f.indexOf(shownMode());
  setTotalMode(f[(i + 1) % f.length]);
});

/* ---------- persistence ---------- */

// debounce: writing localStorage on every keystroke would be wasteful,
// so the save fires 400ms after the typing pauses
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
function save() {
  // try/catch: storage can be full or blocked (private browsing)
  try { localStorage.setItem(STORE_KEY, getText()); } catch (_) {}
}

/* ---------- undo ---------- */

/* The app keeps its own history, and it has to.
 *
 * A browser's undo remembers the nodes it edited. Decoration rewrites
 * those nodes — the same characters, new spans — so by the time you
 * press ⌘Z the browser's record points at nodes that have been replaced,
 * and it either does nothing or pastes the old text back alongside the
 * new. There is no way to both repaint a contenteditable and keep the
 * native stack; every editor that highlights as you type ends up here.
 *
 * So: a list of whole-document snapshots instead. Text and caret only —
 * the DOM is rebuilt from the text, which is the same thing a reload
 * does, and the decoration follows from it.
 */

const HISTORY_MAX = 200;
let history = [];   // steps behind us, oldest first
let future = [];    // steps undone, most recent last
let base = { text: '', caret: 0 };
let commitTimer = 0;

// the caret as a single offset into getText(), newlines counted — the
// one coordinate that still means something after the DOM is rebuilt
function caretPoint() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const p = pointAt(sel.focusNode, sel.focusOffset, false);
  if (!p) return 0;
  let n = 0;
  for (const row of editor.children) {
    if (row === p[0]) return n + p[1];
    n += plain(row.textContent).length + 1;
  }
  return n;
}

function placeAt(off) {
  const rows = [...editor.children];
  let n = 0;
  for (const row of rows) {
    const len = plain(row.textContent).length;
    if (off <= n + len) { placeCaret(row, off - n); return; }
    n += len + 1;
  }
  const end = rows[rows.length - 1];
  if (end) placeCaret(end, plain(end.textContent).length);
}

const snapshot = () => ({ text: getText(), caret: caretPoint() });

// A run of ordinary editing is one step. What ends a run is the question
// below; this just closes whatever is open.
function commit() {
  clearTimeout(commitTimer);
  const now = snapshot();
  if (now.text === base.text) { base = now; return; }
  history.push(base);
  if (history.length > HISTORY_MAX) history.shift();
  future.length = 0; // a fresh edit abandons whatever was undone
  base = now;
}

// the backstop: a run also ends when the typing simply stops
function noteChange() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(commit, 500);
}

/* Where one step ends and the next begins.
 *
 * A clock alone makes for blocky undo: type a word, backspace over it,
 * and both land in the same step. Lexical's history plugin answers this
 * by classifying each change — insert a character, delete before the
 * caret, delete after it, or something else entirely — and merging only
 * when the kind matches the last one and the selection is where that
 * edit left it; paste and cut are forced to "other" so they can never
 * merge. Elapsed time is one signal among several rather than the only
 * one. Same idea here, in a few lines rather than a dependency.
 */
function editKind(type) {
  if (type === 'insertText') return 'insert';
  if (type === 'deleteContentBackward') return 'back';
  if (type === 'deleteContentForward') return 'forward';
  // a paste, a cut, a new line, a drop: each stands on its own
  return 'other';
}

let lastKind = '', lastCaret = -1;

// after a jump — an undo, a mark, a clear — the next keystroke starts
// fresh instead of merging into whatever came before it
function resetRun() {
  lastKind = '';
  lastCaret = caretPoint();
}

function breaksRun(kind, caret, data) {
  return kind === 'other'          // never merges
    || kind !== lastKind           // typing became deleting, or changed direction
    || caret !== lastCaret         // the caret was moved between edits
    || (kind === 'insert' && /\s/.test(data || '')); // a finished word
}

function restore(state) {
  setText(state.text);
  refresh();
  placeAt(state.caret);
  openCaretLine();
  base = snapshot();
  resetRun();
}

function undo() {
  commit(); // fold any typing still in progress into a step of its own
  if (!history.length) return;
  future.push(snapshot());
  restore(history.pop());
}

function redo() {
  if (!future.length) return;
  clearTimeout(commitTimer);
  history.push(snapshot());
  restore(future.pop());
}

/* ---------- events ---------- */

// 'input' fires on every edit, whatever caused it — keys, drag, paste.
// Recording where the edit left the caret is what lets the next one
// notice that you moved somewhere else in between.
editor.addEventListener('input', () => {
  refresh();
  lastCaret = caretPoint();
  noteChange();
});

// the browser's own undo can't survive decoration (see above), so take
// the keys and answer them from our history instead
editor.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  e.preventDefault();
  // ⇧⌘Z on a Mac, Ctrl+Y on Windows — both mean redo
  if (k === 'y' || e.shiftKey) redo();
  else undo();
});

// 'beforeinput' fires while the document still holds the state *before*
// the edit — which is exactly the state a step being closed should end
// on. Deciding here means commit() needs no shadow copy of the past.
editor.addEventListener('beforeinput', e => {
  // undo reached another way — a trackpad gesture, or the editing menu —
  // arrives as an input type rather than a key
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    e.preventDefault();
    if (e.inputType === 'historyUndo') undo();
    else redo();
    return;
  }
  // an IME composition is one thought however many events it takes;
  // compositionend closes it
  if (e.inputType.startsWith('insertComposition')) return;
  const kind = editKind(e.inputType);
  if (lastKind && breaksRun(kind, caretPoint(), e.data)) commit();
  lastKind = kind;
});

// Follow the caret from line to line. This fires on every caret move,
// and it can fire in the middle of an edit the browser is still carrying
// out — so it touches nothing but the class and the margin. No
// normalize(), no repaint, no moving the caret: any of those would be
// tidying a room while someone is still furnishing it.
document.addEventListener('selectionchange', openCaretLine);

// an IME composition is a character still being spelled out; let it
// finish before the line is repainted underneath it
editor.addEventListener('compositionstart', () => { composing = true; });
editor.addEventListener('compositionend', () => { composing = false; refresh(); });

/* ---------- ⌘B, ⌘I, ⌘U ---------- */

// Without this handler the browser answers these itself and injects
// <b>/<i>/<u> into the line — markup that looks right until getText()
// flattens it away on the next save. Here they write Markdown instead.
// (⌘U is the one that differs: Markdown underlines with two
// underscores here and Fountain with one, so the table is chosen by
// mode. markToggle() does the string arithmetic for both unchanged.)
//
// ⌘K shouts a word and ⌘\ centers a line. Both are here for the script
// — a screenplay is written in capitals more than anything else is —
// but only the centering is Fountain's own notation, so ⌘K is left
// available to a poem and ⌘\ isn't.
editor.addEventListener('keydown', e => {
  // Tab takes the suggested name, and only when one is showing —
  // otherwise Tab is left doing whatever it did before
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && ghostLine) {
    const rest = ghostLine.dataset.ghost;
    e.preventDefault();
    editLines(t => ({ text: t + rest, s: t.length + rest.length, e: t.length + rest.length }));
    return;
  }

  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  const mark = (fountain ? FTN_MARKS : MD_MARKS)[key];
  if (mark) { e.preventDefault(); editLines((t, s, x) => markToggle(t, s, x, mark)); return; }
  if (key === 'k') { e.preventDefault(); editLines(upperToggle); return; }
  if (key === '\\' && fountain) { e.preventDefault(); editLines((t, s) => centerToggle(t, s)); return; }
  // ⌘D is the browser's bookmark; preventDefault takes it back, the same
  // way ⌘K takes back the address bar
  if (key === 'd' && fountain) { e.preventDefault(); editDoc(ftnDual); }
});

/* ⌘D is the one shortcut that isn't about a line.
 *
 * "The second cue" is a question about the page, not about the text
 * under the caret, so ftnDual() is handed the whole document and answers
 * with the single line to change. Everything else here — closing the
 * undo step, writing, putting the caret back — is what editLines() does,
 * minus the per-line loop.
 */
function editDoc(fn) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const start = pointAt(r.startContainer, r.startOffset, false);
  const end = pointAt(r.endContainer, r.endOffset, true);
  if (!start || !end) return;

  const { rows, src, modes } = readDoc();
  const a = rows.indexOf(start[0]), b = rows.indexOf(end[0]);
  if (a < 0 || b < 0 || b < a) return;

  const job = fn(src, a, b, modes.lines);
  if (!job || job.text === src[job.line]) return;

  commit();
  rows[job.line].textContent = job.text;
  refresh();
  const [n, o] = offsetToPoint(rows[job.line], job.text.length);
  try { sel.setBaseAndExtent(n, o, n, o); } catch (_) {}
  openCaretLine();
  commit();
  resetRun();
}

// the line div a node sits in, or null for anything outside the editor
function lineOf(node) {
  if (!node || node === editor || !editor.contains(node)) return null;
  let n = node;
  while (n.parentNode && n.parentNode !== editor) n = n.parentNode;
  return n.parentNode === editor ? n : null;
}

// resolve one end of a selection to [line, character offset]. A range
// can also be anchored on the editor itself — select-all does that —
// in which case it lands on the first or last line whole
function pointAt(container, offset, atEnd) {
  if (container === editor) {
    const kids = [...editor.children];
    const row = atEnd ? kids[Math.max(0, Math.min(offset, kids.length) - 1)]
                      : kids[Math.min(offset, kids.length - 1)];
    return row ? [row, atEnd ? plain(row.textContent).length : 0] : null;
  }
  const row = lineOf(container);
  return row ? [row, offsetIn(row, container, offset)] : null;
}

/* Every shortcut works a line at a time. That isn't only the simpler
 * path — emphasis can't cross a line break in either notation, so a
 * mark per line is what any later reader of the source would need
 * anyway.
 *
 * `fn` is the whole difference between one shortcut and the next: it
 * takes a line and a range and answers with the new line and where the
 * selection lands, and every one of them lives in marks.js knowing
 * nothing about the DOM. This function does the rest — reading the
 * selection, closing off the undo step, writing the lines back to
 * front, and putting the caret where fn asked for it.
 */
function editLines(fn) {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const start = pointAt(r.startContainer, r.startOffset, false);
  const end = pointAt(r.endContainer, r.endOffset, true);
  if (!start || !end) return;

  const rows = [...editor.children];
  const a = rows.indexOf(start[0]), b = rows.indexOf(end[0]);
  if (a < 0 || b < 0 || b < a) return;

  commit(); // close off whatever typing came before; the mark is its own step

  // work out every line before touching any of them: the first edit
  // invalidates the range the offsets came from
  const jobs = [];
  for (let i = a; i <= b; i++) {
    const src = plain(rows[i].textContent);
    // a blank line swept up by a multi-line selection is left alone,
    // rather than handed a pair of marks with nothing between them
    if (a !== b && !src.trim()) { jobs.push({ row: rows[i], src, text: src, s: 0, e: 0 }); continue; }
    const s = i === a ? start[1] : 0;
    const e = i === b ? end[1] : src.length;
    jobs.push({ row: rows[i], src, ...fn(src, s, e) });
  }

  // back to front, so the offsets measured above stay true. Writing the
  // line's text outright is safe here because the history above is ours,
  // not the browser's — there is no native record left to disturb
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].text !== jobs[i].src) jobs[i].row.textContent = jobs[i].text;
  }

  refresh();
  const head = jobs[0], tail = jobs[jobs.length - 1];
  const [n1, o1] = offsetToPoint(head.row, head.s);
  const [n2, o2] = offsetToPoint(tail.row, tail.e);
  try { sel.setBaseAndExtent(n1, o1, n2, o2); } catch (_) {}
  openCaretLine();
  commit(); // refresh() above already scheduled the save
  resetRun();
}

// pasted content arrives as styled HTML; take the plain text instead
// and rebuild it line by line through the same commands typing uses
editor.addEventListener('paste', e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  text.replace(/\r\n?/g, '\n').split('\n').forEach((ln, i) => {
    if (i) document.execCommand('insertParagraph');
    if (ln) document.execCommand('insertText', false, ln);
  });
});

// place the caret after the last character (Range + Selection API)
function focusEnd() {
  editor.focus();
  const sel = document.getSelection();
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
  openCaretLine();
}

// click anywhere in the room to write
page.addEventListener('mousedown', e => {
  if (editor.contains(e.target)) return;
  e.preventDefault();
  focusEnd();
});

fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else (document.documentElement.requestFullscreen?.() || Promise.resolve()).catch(() => {});
});

// no server to download from: build the .txt in memory as a Blob,
// point a throwaway <a> at it, and click the link on the user's behalf
exportBtn.addEventListener('click', () => {
  // whatever the first line asked for was for the room, not the file
  const all = getText().split('\n');
  const modes = readModes(all);
  // the capitals a script wears on the page go into the file too — see
  // ftnText(), and the note there about what a lowercase slugline costs
  const lines = (modes.fountain ? ftnText(all, modes.lines) : all).slice(modes.lines);
  const text = lines.join('\n').replace(/^\n+/, '');
  if (!text.trim()) return;

  /* Three files, and the page decides which by what's actually on it.
   *
   * A script is Fountain. A page that reached for a mark is Markdown.
   * A page that never did is neither: a tanka with no notation in it is
   * a poem, and handing it over as .md tells the next program to go
   * looking for a grammar that was never used. So it leaves as .txt,
   * which is the truth about it.
   */
  const script = modes.fountain;
  const marked = !script && mdUsed(lines);
  const name = script ? 'script' : 'tanka';
  const ext = script ? 'fountain' : marked ? 'md' : 'txt';
  const type = marked ? 'text/markdown' : 'text/plain';
  const blob = new Blob([text + '\n'], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// a soft tick where the platform allows it (Android Chrome; iOS Safari
// exposes no vibration API to web pages)
function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch (_) {}
}

// clearing is destructive, so the button only fires after an
// unbroken three-second hold; releasing early cancels
const HOLD_MS = 3000;
const FALL_MS = 700;
let holdTimer = 0;

// the water: three translucent layers drawn on the flood canvas, each
// a sum of sines travelling at its own speed, so the crests deform as
// they drift instead of sliding by as one rigid silhouette. Layers
// alternate drift direction, and everything swells and speeds up the
// longer the hold survives.
// (Wrapped in an IIFE — an inline function called at once — so all its
// working state stays private; only rise() and fall() escape.)
const water = (() => {
  const TAU = Math.PI * 2;
  const ctx = flood.getContext('2d');
  let raf = 0, mode = 'idle'; // idle | rising | falling
  let riseT0 = 0, riseP0 = 0, fallT0 = 0, fallP0 = 0;
  let p = 0, lastNow = 0, tide = '#58a6c8';
  let layers = [];

  // fresh randomized layers each hold, so no two floods are the same
  function build() {
    layers = [];
    for (let i = 0; i < 3; i++) {
      const dir = i % 2 ? -1 : 1;
      const waves = [];
      for (let k = 0; k < 3; k++) waves.push({
        amp: 4 + Math.random() * 6,               // px, before fury
        len: 130 + Math.random() * 320,           // wavelength, px
        spd: dir * (0.5 + Math.random() * 1.1) * (1 + k * 0.6),
        ph: Math.random() * TAU,                  // running phase
      });
      layers.push({ waves, sink: i * 12, alpha: 0.105 - i * 0.015 });
    }
  }

  // size the canvas in device pixels, capped at 2× — sharp on phone
  // screens without quadrupling the pixels to fill
  function fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (flood.width !== w || flood.height !== h) { flood.width = w; flood.height = h; }
    return dpr;
  }

  // one animation frame: advance the tide, redraw all three layers
  function frame(now) {
    // dt is clamped so a backgrounded tab doesn't lurch on return
    const dt = Math.min((now - lastNow) / 1000, 0.1);
    lastNow = now;

    if (mode === 'rising') {
      p = Math.min(riseP0 + (1 - riseP0) * ((now - riseT0) / HOLD_MS), 1);
    } else {
      const q = Math.min((now - fallT0) / FALL_MS, 1);
      p = fallP0 * (1 - q * q); // gravity: slow release, quick drop
      if (q >= 1) { stop(); return; }
    }
    const fury = p * p; // calm at first, frantic by the end

    const dpr = fit();
    const w = flood.width, h = flood.height;
    // surface travels from safely under the page to well over the top,
    // with headroom for the biggest full-fury crests
    const base = (h + 70 * dpr) - (h + 170 * dpr) * p;
    const swell = 1 + fury * 1.5;
    const rush = 1 + fury * 3;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = tide;
    for (const L of layers) {
      ctx.globalAlpha = L.alpha;
      ctx.beginPath();
      ctx.moveTo(0, h);
      const step = 8 * dpr;
      for (let x = 0; x <= w + step; x += step) {
        let y = base + L.sink * dpr;
        for (const wv of L.waves) {
          y += wv.amp * dpr * swell * Math.sin(x / (wv.len * dpr) * TAU + wv.ph);
        }
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      for (const wv of L.waves) wv.ph += wv.spd * rush * dt;
    }
    ctx.globalAlpha = 1;
    // requestAnimationFrame: the browser calls frame() again right
    // before the next repaint — the loop only runs while water shows
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
    mode = 'idle';
    p = 0;
    ctx.clearRect(0, 0, flood.width, flood.height);
  }

  return {
    rise() {
      // read the theme's water color off the CSS custom property
      tide = getComputedStyle(document.documentElement)
        .getPropertyValue('--tide').trim() || tide;
      if (mode === 'idle') build();
      riseP0 = p; // a re-press mid-fall picks up from the current level
      riseT0 = lastNow = performance.now();
      mode = 'rising';
      if (!raf) raf = requestAnimationFrame(frame);
    },
    fall() {
      if (mode === 'idle') return;
      fallP0 = p;
      fallT0 = performance.now();
      mode = 'falling';
    },
  };
})();

function startHold() {
  if (holdTimer || !getText().trim()) return;
  clearBtn.classList.add('holding');
  water.rise();
  holdTimer = setTimeout(() => {
    holdTimer = 0;
    clearBtn.classList.remove('holding');
    water.fall();
    setText('');
    refresh();
    commit(); // a three-second hold is deliberate, but still undoable
    resetRun();
    save();
    editor.focus();
    buzz([40, 60, 40]);
  }, HOLD_MS);
}

function cancelHold() {
  if (!holdTimer) return;
  clearTimeout(holdTimer);
  holdTimer = 0;
  clearBtn.classList.remove('holding');
  water.fall();
}

clearBtn.addEventListener('pointerdown', e => {
  // pointer capture: the button keeps receiving events even if the
  // finger drifts off it mid-hold, so the release always lands here
  try { clearBtn.setPointerCapture(e.pointerId); } catch (_) {}
  startHold();
});
clearBtn.addEventListener('pointerup', cancelHold);
clearBtn.addEventListener('pointercancel', cancelHold);
// a five-second press is a long-press to the browser; keep its menu away
clearBtn.addEventListener('contextmenu', e => e.preventDefault());

// keyboard parity: space or enter can hold the button down too
clearBtn.addEventListener('keydown', e => {
  if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
  e.preventDefault();
  startHold();
});
clearBtn.addEventListener('keyup', cancelHold);
clearBtn.addEventListener('blur', cancelHold);

// themes are sets of CSS custom properties keyed off data-theme on
// <html> (see style.css); the meta tag recolors the browser chrome
function applyTheme(name) {
  if (name === 'room') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = name;
  document.querySelector('meta[name="theme-color"]').content = THEMES[name];
  try { localStorage.setItem(THEME_KEY, name); } catch (_) {}
}

themeBtn.addEventListener('click', () => {
  const names = Object.keys(THEMES);
  const cur = names.indexOf(document.documentElement.dataset.theme || 'room');
  applyTheme(names[(cur + 1) % names.length]);
});

// the context card is a native <dialog>; showModal() gives focus
// trapping, an Esc-to-close, and a ::backdrop for free
const aboutBtn = document.getElementById('context');
const about    = document.getElementById('about');

aboutBtn.addEventListener('click', () => about.showModal());
document.getElementById('aboutClose').addEventListener('click', () => about.close());
document.getElementById('aboutGo').addEventListener('click', () => about.close());
// Esc closes natively; a click on the backdrop closes too (a backdrop
// click reports the dialog as its target, so test the coordinates)
about.addEventListener('click', e => {
  const r = about.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right ||
      e.clientY < r.top || e.clientY > r.bottom) about.close();
});
// whichever way it closes, hand the pen back
about.addEventListener('close', focusEnd);

// keep the caret where it is when a toolbar button is clicked,
// and acknowledge every press with a tick where haptics exist
for (const btn of [clearBtn, exportBtn, themeBtn, fsBtn, aboutBtn, totalEl]) {
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('pointerdown', () => buzz(10));
}

// resize re-wraps the text, so the margin numbers need re-pinning;
// wait for the flurry of events to settle first
let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refresh, 100);
});
// mobile browsers discard tabs without warning — save on every hide
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

/* ---------- init ---------- */

applyTheme(THEMES[localStorage.getItem(THEME_KEY)] ? localStorage.getItem(THEME_KEY) : 'room');
setText(localStorage.getItem(STORE_KEY) || '');
refresh();
// the restored draft is where history starts; there is nothing behind it
base = snapshot();
resetRun();
setTotalMode(totalMode); // arms the timer tick if that face was saved
editor.focus();
// custom fonts change line metrics; re-pin the numbers once they load
document.fonts?.ready.then(refresh);

// the syllable dictionary is data, not code: fetch it after first
// paint and recount once it lands. Until then — or without it entirely
// (file://, a first visit while offline) — the heuristic in count.js
// carries the count alone
fetch('syllables.json')
  .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
  .then(data => { loadSyllableDict(data); refresh(); })
  .catch(() => {});

// the thousand words, on the same terms: data fetched after first paint,
// and until it lands nothing is marked
fetch('tenhundred.txt')
  .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
  .then(list => { loadSimpleWords(list); refresh(); })
  .catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // the service worker (sw.js) caches every asset, making the app load
  // offline; browsers allow one on https or localhost only.
  // When an updated worker takes over, reload once so the new version
  // shows on the first visit instead of the second (draft is in
  // localStorage, so nothing is lost)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; save(); location.reload(); }
  });
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
