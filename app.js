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
// the opaque layer over the whole viewport — see paintBase()
const baseLayer = document.querySelector('.base');

// the tanka form: five lines of 5-7-5-7-7 syllables — and the older,
// shorter one the first three of them came from, which /haiku asks for.
// Everything else about the room is the same either way: the slots are
// just filled sooner.
const TARGETS = [5, 7, 5, 7, 7];
const HAIKU_TARGETS = [5, 7, 5];
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
  setImport(modes.import);
  // decorate before measuring: a heading stands taller than a line of
  // poem, so every offsetTop read below has to be the settled one
  for (let i = 0; i < rows.length; i++)
    decorate(rows[i], i < modes.lines, modes.simple, kinds && kinds[i]);
  measure(rows, src, modes, kinds);
  setGhost(rows, src, modes, kinds);
  setRelease(rows, src, modes);

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
// the whole matched name, not only the dim part of it. A variable rather
// than a second data-* attribute: data-ghost is already in the editor's
// markup, and every attribute that goes in there is one more thing a
// repeated refresh() has to reproduce exactly.
let ghostName = '';

function clearGhost() {
  if (ghostLine) ghostLine.removeAttribute('data-ghost');
  ghostLine = null;
  ghostName = '';
}

function setGhost(rows, src, modes, kinds) {
  clearGhost();
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

  /* '@' forces a line to be a cue, and it is a mark rather than a letter
   * of anybody's name — no name has one in it. So it is set aside for the
   * comparison and put back on what gets written, and typing @ma is
   * offered the same MAYA that typing MA is. It stays on the line, too:
   * forcing is asked before the shout rule, so an '@' line is a cue even
   * with nothing written under it yet, which is exactly where the caret
   * is at the end of a draft. Dropping the mark on the way in would
   * change what the line is out from under the writer.
   *
   * A lone '@' has named nobody yet, and is passed over for the same
   * reason an empty line is.
   */
  const at = t.startsWith('@') ? '@' : '';
  const typed = t.slice(at.length);
  if (!typed) return;

  const up = typed.toUpperCase();
  const hits = ftnNames(src, modes.lines, kinds)
    .filter(n => n.length > typed.length && n.toUpperCase().startsWith(up));
  // two candidates and a ghost would be a lie about what Tab will do
  if (hits.length !== 1) return;

  ghostLine = openLine;
  ghostName = at + hits[0];
  openLine.dataset.ghost = hits[0].slice(typed.length);
}

/* The /version readout — see the note in modes.js for what it is for.
 *
 * Painted with the same pseudo-element trick as the suggestion above, and
 * for the same reasons: a ::after has no child node, so getText() can't
 * see it, the draft and the export can't contain it, currentRuns() can't
 * call it foreign and repaint forever, and the caret cannot land inside
 * it. Everything else a mode line gets — dimmed, uncounted, dropped from
 * the export — it gets by being a mode line, which is the whole reason
 * /version is one rather than a command of its own.
 *
 * Only refresh() calls this. The caret-move path deliberately doesn't:
 * the readout depends on the mode words and nothing else, and those
 * cannot change without an edit.
 */
let releaseLine = null;
let release = null; // null until first asked; a string from then on

function clearRelease() {
  if (releaseLine) releaseLine.removeAttribute('data-release');
  releaseLine = null;
}

/* Re-measure without redrawing the page.
 *
 * setRelease() runs from refresh(), and a theme switch is not a redraw — so
 * the readout sat there reporting the theme it was written under while the
 * page around it had changed. That is not a small thing for an instrument
 * whose whole job is to say what colour the page currently is: the one
 * screenshot taken to answer that question showed `theme paper` over a page
 * that was plainly not paper. Anything that moves what geometry() measures
 * has to call this. */
function refreshRelease() {
  if (releaseLine) releaseLine.setAttribute('data-release', release + geometry());
}

function setRelease(rows, src, modes) {
  clearRelease();
  if (!modes.version) return;
  // lazy, and once: the lookup costs a network request, and a page that
  // never asks the question should never pay for it
  if (release === null) { release = ' reading…'; askRelease(); }
  // on the line that asked, which need not be the first — mode words may
  // be spread over as many leading lines as the writer likes
  let i = -1;
  for (let n = 0; n < modes.lines && n < src.length; n++)
    if (/\/version\b/i.test(src[n])) { i = n; break; }
  if (i < 0 || !rows[i]) return;
  releaseLine = rows[i];
  releaseLine.setAttribute('data-release', release + geometry());
}

/* What a safe-area inset actually resolves to, in CSS px.
 *
 * A custom property comes back exactly as written, so env() cannot be read
 * through one — it has to be spent on a real length and that length asked
 * what it became. Cached per edge and cleared on resize, because a rotation
 * changes every one of them.
 */
const insetCache = {};
function insetPx(edge) {
  if (edge in insetCache) return insetCache[edge];
  if (!insetPx.cell) {
    insetPx.cell = document.createElement('div');
    insetPx.cell.style.cssText = 'position:absolute;visibility:hidden;width:0';
    document.body.appendChild(insetPx.cell);
  }
  insetPx.cell.style.height = `env(safe-area-inset-${edge})`;
  const v = parseFloat(getComputedStyle(insetPx.cell).height);
  return (insetCache[edge] = Number.isFinite(v) ? v : 0);
}
addEventListener('resize', () => { for (const k in insetCache) delete insetCache[k]; });
addEventListener('orientationchange', () => { for (const k in insetCache) delete insetCache[k]; });

/* The geometry the water depends on, measured where the water lives.
 *
 * This exists because probe.html cannot answer for the installed app. A
 * standalone window is not the Safari window — on the phone that reported
 * this, Safari already disagreed with itself by the top inset (clientHeight
 * 797 against innerHeight 844, svh against lvh) — and there is no way to
 * navigate to the probe from inside an installed app. So the one measurement
 * that matters is taken here: the flood canvas's own box, against the
 * screen it is supposed to cover.
 *
 * `reach` is the whole question. If the canvas bottom sits at or past
 * screen.height and a dry strip is still visible, then the box is not what
 * is wrong and no height rule will fix it.
 */
function geometry() {
  const r = flood.getBoundingClientRect();
  const bottom = Math.round(r.bottom);
  const inset = env => insetPx(env) + 'px';
  /* Where the viewport's bottom edge really sits depends on the status
   * bar style. black-translucent shifted the view up under the clock and
   * left a dead strip below the viewport that no page paint could reach —
   * the v53–v59 chase. The opaque bar sits the view below the clock, so
   * the viewport's bottom IS the screen's bottom. Judge against the
   * viewport, and name the dead strip when the geometry says it exists. */
  /* the LAYOUT viewport, not innerHeight: a soft keyboard shrinks
   * innerHeight to the visual viewport (675 against 797 on the reading that
   * made this obvious) and the band has nothing to do with the keyboard */
  const vp = document.documentElement.clientHeight;
  const below = screen.height - vp;
  const verdict = bottom < vp ? `${vp - bottom} SHORT of viewport`
    : below > 0 && inset('top') !== '0px'
      ? `covers viewport; ${below}px below it is iOS's`
      : 'covers viewport';
  return '\n' +
    `flood ${Math.round(r.top)}→${bottom} vp ${vp} screen ${screen.height}` +
    ` ${verdict}\n` +
    // fit() only runs while water is on screen, so before the first hold
    // this is a canvas's untouched default and says nothing about the app
    `bitmap ${flood.width}×${flood.height}` +
    `${flood.width === 300 && flood.height === 150 ? ' (idle)' : ''}` +
    ` box ${Math.round(r.width)}×${Math.round(r.height)}\n` +
    `inner ${innerHeight} clientH ${document.documentElement.clientHeight}` +
    ` screen ${screen.height}` +
    `${innerHeight < document.documentElement.clientHeight ? ' (keyboard)' : ''}\n` +
    `sa-top ${inset('top')} sa-bot ${inset('bottom')}` +
    ` ${navigator.standalone ? 'standalone' : 'browser'}` +
    `${matchMedia('(display-mode: standalone)').matches ? '+dm' : ''}\n` +
    /* The colour channel, on the device, in the app.
     *
     * Measured on-device with probe.html: this phone's Safari does not read
     * the theme-color tag at all while a manifest is linked — it reads the
     * document's own background colour, and it reads it live. So the line
     * that matters for the chrome is `page`, and `tag` is here only to show
     * that the two agree.
     *
     * PINNED is the failure this exists to catch. --screen is written as an
     * inline property on the root while the water is up, inline beats every
     * stylesheet rule, and dryChrome() is the only thing that takes it off
     * again. If it is ever still there at rest, the document's background
     * colour is frozen on a literal hex — and a theme switch then moves the
     * tag, moves .base, and cannot move the one channel the chrome reads. */
    `theme ${document.documentElement.dataset.theme || 'room'}` +
    ` page ${hex(getComputedStyle(document.documentElement).backgroundColor)}` +
    ` tag ${document.querySelector('meta[name="theme-color"]')?.content || '(none)'}` +
    `${document.documentElement.style.getPropertyValue('--screen') ? ' PINNED' : ''}`;
}

// rgb(10, 12, 10) -> #0a0c0a, so the readout can be compared with the meta
// and with THEMES by eye on a phone
function hex(rgb) {
  const n = String(rgb).match(/\d+/g);
  return n ? '#' + n.slice(0, 3)
    .map(v => (+v).toString(16).padStart(2, '0')).join('') : String(rgb);
}

/* Two questions, because on a cache-first app they have different
 * answers: what this copy is *running*, and what the server would hand a
 * fresh one. A worker serves its own cache until a new one activates, so
 * an installed app can sit a release behind indefinitely and look fine
 * doing it — which is exactly the doubt this mode exists to remove.
 */
async function askRelease() {
  const PREFIX = 'tanka-time-';
  let here = '(unreadable)', there = '';
  try {
    if (!window.caches) here = '(no cache API)';
    else {
      const names = (await caches.keys()).filter(n => n.startsWith(PREFIX));
      here = names.length
        ? names.map(n => n.slice(PREFIX.length)).join(' + ')
        : '(not installed)';
    }
  } catch (e) { /* leave it unreadable */ }
  try {
    // no-store to get past both the HTTP cache and the worker itself
    const res = await fetch('sw.js', { cache: 'no-store' });
    const m = (await res.text()).match(/tanka-time-(v\d+)/);
    if (m) there = m[1];
  } catch (e) { /* offline, which is an answer too */ }

  // kept short on purpose: this sits on the line the writer typed, on a
  // phone, and a readout that wraps starts to look like writing
  release = ' ' + (!there ? here + ' · offline'
    : there === here ? here + ' · latest'
    : here + ' · server has ' + there + ', reopen twice');
  refresh();
}

/* Taking the name.
 *
 * The line is rewritten whole rather than having the dim tail appended to
 * it, and that isn't tidiness — it is the difference between a cue and a
 * line of action. A cue is a cue because it shouts (isShout), the editor
 * turns autocapitalize off, and the match above is deliberately case-blind,
 * so a writer typing "ma" on a phone was being handed "maYA": the right
 * letters in a case Fountain cannot read. Writing the matched name in full
 * puts the capitals back where the rest of the script already keeps them —
 * and it disposes of a trailing space, which appending couldn't ("ma " + a
 * tail is two words, and neither of them is anybody's name).
 *
 * The name goes in exactly as ftnNames() spells it, which is capitals —
 * every cue in this editor shouts, the forced ones because the app puts
 * the capitals on. So this doesn't have to know the rule, only to trust
 * the list.
 */
function takeGhost() {
  if (!ghostLine || !ghostName || composing) return;
  const line = ghostLine, name = ghostName;
  const src = plain(line.textContent);
  const t = src.trim();
  // the ghost can be a beat out of date — a selection dragged about inside
  // one line never re-runs setGhost() — so ask the line again
  if (!t || t.length >= name.length ||
      !name.toUpperCase().startsWith(t.toUpperCase())) return;

  // collapse first: editLines() reads the selection to find its lines, and
  // a selection whose far end is on another line would hand the name to
  // every line in between
  placeCaret(line, src.length);
  const text = src.match(/^[ \t]*/)[0] + name;
  editLines(() => ({ text, s: text.length, e: text.length }));
}

/* Where the suggestion is painted, in viewport coordinates.
 *
 * A pseudo-element has no node to hit-test, so the region is worked out
 * from the line instead: the last of the rects the line's own text covers
 * gives the point the writing stops at and the row it stopped on, and the
 * ghost is drawn from there rightwards.
 *
 * The whole of that trailing run counts, not just the two or three glyphs
 * of the tail — a suggestion is narrower than a fingertip, and this is the
 * gesture a fingertip has. Nothing is taken away by claiming it: a name is
 * only ever offered while the caret is already at the end of that line, so
 * a tap out there was putting the caret where it already was.
 *
 * The rect a Range hands back is the height of the glyphs rather than of
 * the row they sit in, so it is grown back out to the row — a thumb landing
 * in the leading above the letters is still aiming at them. The one place
 * this misses is a ghost long enough to wrap onto the next line; Tab still
 * reaches it, and a character name that long is its own problem.
 */
function inGhostRegion(x, y) {
  if (!ghostLine) return false;
  const r = document.createRange();
  r.selectNodeContents(ghostLine);
  const rects = [...r.getClientRects()];
  if (!rects.length) return false;
  // decoration cuts a line into spans, so one row is several rects: the end
  // of the text is the lowest of them, and the rightmost of those
  const end = rects.reduce((a, b) =>
    b.bottom > a.bottom || (b.bottom === a.bottom && b.right > a.right) ? b : a);
  const box = ghostLine.getBoundingClientRect();
  const row = parseFloat(getComputedStyle(ghostLine).lineHeight) || end.height;
  const mid = (end.top + end.bottom) / 2;
  return x >= end.right && x <= box.right &&
         y >= mid - row / 2 && y <= mid + row / 2;
}

// the caret moved on its own — no edit, so nothing needs repainting
// beyond which line wears the class
function openCaretLine() {
  const row = caretLine();
  if (row === openLine) {
    /* The caret can move about inside a line without changing which line
     * is open, and this is where that arrives — an arrow key, a tap into
     * the middle of a word, a selection dragged across it. Nothing needs
     * repainting for any of those, but a suggestion is only true while the
     * caret is at the end of the text it completes, so a stale one is
     * taken down here. Reading one offset is cheap; a full readDoc() on
     * every caret move inside a line would not be.
     */
    if (ghostLine && caretOffset(ghostLine) !== plain(ghostLine.textContent).length)
      clearGhost();
    return;
  }
  openLine?.classList.remove('open');
  row?.classList.add('open');
  openLine = row;
  // marks appearing widen the line they are on, which can shift every
  // number below it
  const { rows, src, modes, kinds } = readDoc();
  measure(rows, src, modes, kinds);
  setGhost(rows, src, modes, kinds);
}

// the margin numbers and the total. The new spans collect in a
// DocumentFragment first so the page reflows once, and each is pinned to
// its line's offsetTop — the gutter is a separate absolutely-positioned
// column that shadows the editor. Reads the editor, never writes to it.
function measure(rows, src, modes, kinds) {
  const frag = document.createDocumentFragment();
  const blank = src.map(t => !t.trim());
  const head = src.map(mdIsHeading);
  let pos = 0, total = 0, words = 0, any = false;
  // a script's own measure is how long it runs, and that is a question
  // about the whole document rather than about any line in it — worked
  // out in one pass here off the kinds this repaint already has
  const pages = modes.fountain ? ftnPages(src, modes.lines, kinds) : 0;
  // which form the page is holding itself to. Only the length differs —
  // every rule below counts slots, not lines, so three of them behave
  // exactly as five do and nothing else here has to know the difference.
  const targets = modes.haiku ? HAIKU_TARGETS : TARGETS;

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
      // once the slots are filled — each starts a new poem; a lone
      // blank inside an unfinished one keeps its slot and counts as 0
      // in free mode there are no slots to hold, so a blank line is
      // only ever a gap between one thought and the next
      if (modes.free || blank[i - 1] || blank[i + 1] || head[i - 1] ||
          head[i + 1] || pos >= targets.length) { pos = 0; continue; }
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
      : pos < targets.length ? targets[pos] : null;
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
  totals = { syllables: total, words, pages };
  renderTotal();
  scheduleSave();
}

/* ---------- the total: syllables · words · timer ---------- */

// the number at the bottom is secretly a button: a click cycles it
// through three faces. The chosen face is remembered like the theme.
const MODES = ['syllables', 'words', 'timer'];
let totalMode = MODES.includes(localStorage.getItem(TOTAL_KEY))
  ? localStorage.getItem(TOTAL_KEY) : 'syllables';
let totals = { syllables: 0, words: 0, pages: 0 };

/* /fountain swaps one of the three faces, and the swap has to be
 * temporary in a way the stored setting is not.
 *
 * The face is a setting: global, remembered, chosen once and kept. The
 * mode is a property of the document: it lives in the first line, and
 * deleting that line has to give everything back. So writing another
 * face into storage the moment a script starts would be the wrong kind
 * of permanent — a poem opened afterwards would have lost its syllables,
 * with nothing on the page to explain why.
 *
 * Instead the stored face is left exactly as it was and read through
 * here. Syllables become pages while a script is open, and the poem's
 * own setting is still underneath when the script closes.
 *
 * Pages rather than words, because they are the same kind of number:
 * the count the form itself keeps. A tanka is measured in syllables and
 * a screenplay in pages — near enough a minute of screen each — and
 * both are the thing you glance at to know where you are.
 */
let fountain = false;

function faces() { return fountain ? ['pages', 'words', 'timer'] : MODES; }

function shownMode() {
  return fountain && totalMode === 'syllables' ? 'pages' : totalMode;
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
  // Pages come with two decimals and no rounding to a whole one. A script
  // is 3.40 pages the way a board is 3.4 metres — the fraction is the
  // useful part, and a page of screenplay is about a minute of screen, so
  // the tenths are minutes. The hundredth is there to stop the number
  // twitching between two tenths on a single keystroke, not because
  // anyone can know a script's length that well: see ftnPages().
  if (mode === 'pages') {
    totalEl.textContent = n ? `${n.toFixed(2)} pages` : '';
    return;
  }
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
  // the file the export writes is a different file now
  labelFile();
  applyTotal();
  return true;
}

/* The one button on the bar that changes what it says.
 *
 * Two things move it: the grammar, which decides what an export would
 * write, and /import, which points the whole button the other way. Both
 * come from the first line, so they can change on the same keystroke —
 * which is why neither writes the label itself. They set their flag and
 * ask here, and the label is worked out from both at once rather than
 * from whichever ran last.
 */
let importing = false;

function labelFile() {
  exportBtn.textContent = importing ? 'import' : 'export';
  // outside a script the export's file depends on whether any marks were
  // used, which changes as you type — so the title names both rather
  // than chase it
  exportBtn.title = importing ? 'Import a .txt, .md or .fountain file'
    : fountain ? 'Export as .fountain' : 'Export as .md or .txt';
  exportBtn.setAttribute('aria-label', importing ? 'Import a file' : 'Export');
}

function setImport(on) {
  if (on === importing) return;
  importing = on;
  labelFile();
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
    e.preventDefault();
    takeGhost();
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

/* Tapping the name, because a phone keyboard has no Tab key.
 *
 * Two listeners rather than one, and each is the event that carries the
 * default we need to refuse. On a desktop the caret is placed from
 * mousedown — the same event the toolbar buttons cancel to keep the caret
 * where it was — and a mouse's mousedown is the real event rather than a
 * replay of the pointer one, so cancelling pointerdown wouldn't stop it.
 * On a phone it is touchstart that decides focus, caret and scroll, and
 * cancelling that also suppresses the mouse events the tap would otherwise
 * be replayed as — so one finger reaches exactly one of these handlers and
 * neither needs to know about the other.
 *
 * preventDefault is the whole exercise. Focus never leaves the editor, so
 * the keyboard never drops and the writer never loses the line they were in
 * the middle of. The price is that a scroll begun inside the region won't
 * take: a band one line tall, at the end of the line the caret is already
 * in, and only while a name is being offered.
 */
editor.addEventListener('mousedown', e => {
  if (!ghostLine || e.button || !inGhostRegion(e.clientX, e.clientY)) return;
  e.preventDefault();
  takeGhost();
});

editor.addEventListener('touchstart', e => {
  if (!ghostLine || e.touches.length !== 1) return;
  const touch = e.touches[0];
  if (!inGhostRegion(touch.clientX, touch.clientY)) return;
  e.preventDefault();
  buzz(10); // the same tick every other press in the app answers with
  takeGhost();
}, { passive: false });

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

// the bar's one file button, pointed by /import — see labelFile()
exportBtn.addEventListener('click', () => {
  if (importing) askForFile();
  else exportDoc();
});

// no server to download from: build the .txt in memory as a Blob,
// point a throwaway <a> at it, and click the link on the user's behalf
function exportDoc() {
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
}

/* ---------- import ---------- */

/* The export, run backwards: a file off the disk becomes the page.
 *
 * There is no server here either, so this is the file input every
 * browser already has — kept out of index.html because it is not part
 * of the room. It is made on the first import and lives hidden in the
 * body from then on, which is one element rather than one per click and
 * costs nothing to leave there. (A detached input is enough in most
 * browsers and not in all of them; the export's throwaway <a> gets away
 * with it because a download is not a permission the way a file picker
 * is.)
 *
 * No `accept` on it, deliberately, and the one place that is worth
 * arguing with. A filter of `.txt,.md,.fountain` is what this wants to
 * say and what a desktop picker would honour — but iOS turns an accept
 * list into file types it knows, and `.fountain` is not one: a phone
 * would grey out the very file the mode exists to take. An unfiltered
 * picker on every platform beats a tidy one that can't open a script,
 * so the filtering happens after the file is read (see takeFile) rather
 * than in a dialog that would refuse it.
 */
let filePicker = null;

function askForFile() {
  if (!filePicker) {
    filePicker = document.createElement('input');
    filePicker.type = 'file';
    filePicker.hidden = true;
    filePicker.addEventListener('change', () => {
      const file = filePicker.files && filePicker.files[0];
      // clearing the value is what lets the same file be chosen twice:
      // an input that still holds it fires no second change event
      filePicker.value = '';
      if (!file) return;
      // FileReader rather than file.text(), which is the newer and
      // shorter of the two and absent from the older phones this app is
      // meant to keep working on
      const reader = new FileReader();
      reader.onload = () => takeFile(file.name, String(reader.result || ''));
      reader.readAsText(file);
    });
    document.body.appendChild(filePicker);
  }
  filePicker.click();
}

/* What arrives is text from somewhere else, so it is met the way the
 * paste handler meets the clipboard: line endings normalised, and the
 * byte-order mark some editors write dropped rather than left to sit in
 * the first line as an invisible character the counts would have to
 * explain.
 *
 * The name decides the room, and only the name. A .fountain file comes
 * in under a /fountain line written for it — the room has to be a
 * screenplay before the page can be read as one — and the mode word
 * that asked for the import is spent doing it, so the button says
 * export again the moment the file lands. A .txt or .md file needs no
 * line at all: the room it wants is the room this already is, and the
 * /import line simply goes with the page it was standing on.
 *
 * Sniffing the contents was the alternative and is worse. A screenplay
 * saved as .txt would sometimes be recognised and sometimes not, and a
 * poem with a line in capitals would sometimes be taken for a script;
 * an extension is a thing the writer can see and change.
 */
function takeFile(name, raw) {
  const text = raw.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  // nothing in it: keep the page that is there rather than trade a
  // draft for an empty file chosen by accident
  if (!text.trim()) return;
  /* The picker shows every file, so this is where a photo or a PDF is
   * turned away — read as text, one arrives as NUL bytes and replacement
   * characters, neither of which a writer ever typed. A tenth of the
   * page being nonsense is nonsense; a stray U+FFFD in a file that lost
   * an accent somewhere is not, and still opens.
   */
  const junk = (text.match(/[\u0000\ufffd]/g) || []).length;
  if (junk > text.length / 10) return;

  const script = /\.(fountain|spmd)$/i.test(name);
  const head = script ? '/fountain\n' : '';

  commit();                 // the page being replaced is a step behind us
  setText(head + text);
  refresh();
  editor.focus();
  // the caret goes to the top of the writing, not the top of the file:
  // the mode line, where there is one, is scaffolding to write past
  placeAt(head.length);
  openCaretLine();
  commit();                 // and the import is a step of its own to undo
  resetRun();
  save();
  // placeCaret has scrolled the caret into view, which on a long script
  // is somewhere near the top already — but the room keeps whatever
  // scroll the old page left, so say it outright
  const room = document.getElementById('room');
  if (room) room.scrollTop = 0;
}

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
  // how opaque the three layers come to when stacked, worked out from
  // their own alphas so it stays true if they are ever retuned
  let tideAlpha = 0.25;

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
    // three washes over one another: what's left of the page underneath
    // is the product of what each one lets through
    tideAlpha = 1 - layers.reduce((a, L) => a * (1 - L.alpha), 1);
  }

  /* The browser's own chrome, flooded along with the page.
   *
   * On a phone the page is not the screen. In Safari the address bar and
   * the toolbar own a strip at each end, and in the installed app the
   * status bar owns the top; a page cannot paint into any of it. So the
   * tide would climb the page, stop dead at the top of the writing area,
   * and leave a band of theme colour above and below it — banded, however
   * completely the page itself is covered.
   *
   * theme-color is the one lever a page has on that strip, and it takes a
   * colour rather than a layer, so it is given the colour the page has
   * actually become: the tide's own hue, mixed into the background by as
   * much of the screen as the water has taken. At the full flood the
   * chrome is exactly the flooded page and the whole screen is one thing.
   *
   * On iOS that lever turns out to be half a lever. Safari reads
   * theme-color once, at parse, and a document with a manifest linked never
   * gets it read again — the tag lands the launch colour and nothing after
   * it. What Safari does keep following is the document's own background
   * colour, which html and body carry as --screen. So in a tab the two are
   * written together from the same number: the tag for every engine that
   * honours it, the channel for the one that doesn't.
   *
   * The channel takes `cover` here, the whole-screen average — not the
   * band's last-row alpha. That distinction is the whole of the v64-v67
   * bug: the band's number went into --screen in a tab as well, so Safari's
   * bars wore the colour of the water's bottom row while the page around
   * them was barely wet. Right channel, wrong number. Gating the band off
   * in a tab fixed the colour and cost the live follow with it; writing the
   * channel from here is what gives both back. Standalone still takes the
   * band's number — see floodBand().
   *
   * Stepped and throttled deliberately. Browsers ease this tint over a
   * couple of hundred milliseconds rather than snapping it, so writing it
   * every frame would leave the chrome chasing a value it never reaches.
   * Ten steps over three seconds is under one change per ease. The channel
   * rides the same steps: it is the same colour arriving by another road,
   * and two rates would be two colours.
   */
  const CHROME_STEPS = 10, CHROME_MS = 180;
  let chromeStep = -1, chromeAt = 0;

  const HEX = /^#[0-9a-f]{6}$/i;
  function mixHex(from, to, t) {
    const read = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
    const a = read(from), b = read(to);
    return '#' + a.map((v, i) =>
      Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  function themeBg() {
    return THEMES[document.documentElement.dataset.theme || 'room'];
  }

  /* Standalone or a tab, which decides who writes --screen.
   *
   * navigator.standalone is the one iOS answers honestly here; the
   * display-mode query has reported "no" from inside an installed app
   * before, which is what the probe's own note about it is for.
   */
  const inApp = !!navigator.standalone ||
    matchMedia('(display-mode: standalone)').matches;

  // cover: how much of the screen the water has taken, 0 to 1
  function floodChrome(cover, now) {
    if (!HEX.test(tide) || !HEX.test(themeBg())) return;
    const step = Math.round(cover * CHROME_STEPS);
    if (step === chromeStep || now - chromeAt < CHROME_MS) return;
    chromeStep = step; chromeAt = now;
    const hex = mixHex(themeBg(), tide, (step / CHROME_STEPS) * tideAlpha);
    setThemeColor(hex);
    // and in a tab, the channel Safari is actually still listening to
    if (!inApp) {
      document.documentElement.style.setProperty('--screen', hex);
      paintScreen(hex);
    }
  }

  /* The band iOS keeps below the page, and the one rule that makes it
   * seamless: it is not a model of where the water is, it *is* the water's
   * own bottom edge.
   *
   * black-translucent moves the web view up under the status bar without
   * making it taller, so the status bar's height reappears as a band at the
   * FOOT, outside the viewport. Nothing in the page can paint it — proven by
   * the about dialog's ::backdrop, which covers the viewport by definition
   * and stops on the same line. What iOS does do is paint it from the
   * document's background colour, so --screen carries that colour and
   * nothing else does (html and body take it; .base takes --bg and is what
   * the eye reads).
   *
   * Two wrong versions are worth remembering, because each looked right in
   * the test that was aimed at it:
   *   - v64 ramped this off the whole-screen `cover`, so it faded across all
   *     three seconds instead of filling as the water arrived.
   *   - v65 ramped it off the surface's distance below the page. Closer, and
   *     still wrong: it lit the band while the canvas was painting nothing.
   *     The surface enters the band about 70ms in and does not reach the
   *     canvas's last row until about 210ms, so for that window there was a
   *     tinted band under a dry page. A full hold floods over it and nobody
   *     sees it; a short press releases inside it and the seam then sits
   *     there for the whole 700ms fall. Which is exactly how it was found.
   *
   * So: no model. Each layer reports what fraction of the canvas's last row
   * it actually covered while being drawn, those compose the same way the
   * layers themselves do, and the band takes the result. It cannot disagree
   * with the water because it comes from the numbers that drew the water —
   * nothing at rest, faint while the water is faint, full tide at full tide,
   * and true through every frame of the fall.
   */
  const BAND_STEPS = 16;
  let bandStep = -1;

  /* And only where the band exists.
   *
   * The band is a standalone artefact: it is the status bar's height that
   * black-translucent pushed off the bottom of the web view, and a browser
   * tab has nothing of the kind. A tab's chrome is Safari's own bars, which
   * sit outside the viewport at both ends and want the whole-screen
   * average — so floodChrome writes --screen there and this does not.
   *
   * Which channel is right was never the question; the number was. From v64
   * to v67 this ran in a tab too, and Safari's bars wore the colour of the
   * water's *bottom row* instead of the page's. Reported, and a real
   * regression. Gating it here fixed the colour and stopped the bars
   * following at all, because theme-color alone cannot move them — that was
   * reported in its turn, and floodChrome carries the tab now.
   */
  function floodBand() {
    if (!inApp) return;
    if (!HEX.test(tide) || !HEX.test(themeBg())) return;
    // what is left of the page through every layer at that last row
    let clear = 1;
    for (const L of layers) clear *= 1 - L.alpha * (L.cover || 0);
    const alpha = 1 - clear;
    /* Quantised, so a phone's status bar is not asked to repaint sixty times
     * a second. Sixteen steps across a quarter-opacity wash is finer than
     * the eye, and unlike the chrome this takes no time throttle: the whole
     * arrival happens inside a couple of hundred milliseconds, and a
     * throttle there is what would put the lag back. */
    const step = Math.round((alpha / tideAlpha) * BAND_STEPS);
    if (step === bandStep) return;
    bandStep = step;
    const hex = mixHex(themeBg(), tide, (step / BAND_STEPS) * tideAlpha);
    document.documentElement.style.setProperty('--screen', hex);
    paintScreen(hex);
  }

  // Everything the flood touched outside the canvas, put back. Called from
  // stop(), so it is the only path that ends a flood: if it goes missing the
  // water still clears and nothing else does — the chrome keeps its last
  // tint and --screen keeps its last value, which then outranks var(--bg)
  // and freezes the band on whatever theme was live. (It did go missing once,
  // in the edit that rewrote floodBand, and the suite caught it here.)
  function dryChrome() {
    chromeStep = -1;
    bandStep = -1;
    // the tide is over, so the ease is no longer worth protecting: land the
    // theme colour the way a theme switch does, with a replace
    setThemeColor(themeBg(), true);
    // removed rather than reset, so the stylesheet's var(--bg) governs again
    // and the dialog's own --screen rule can still win
    document.documentElement.style.removeProperty('--screen');
    paintScreen(themeBg());
  }

  /* Size the canvas in device pixels, capped at 2× — sharp on phone
   * screens without quadrupling the pixels to fill.
   *
   * Measured off the canvas's own box, not off the window. Those are the
   * same number on a desktop and they are not the same number on a
   * phone: a fixed element's 100% resolves against the *large* viewport,
   * the one you get with the browser's bars hidden, while innerHeight
   * reports the viewport you can currently see. Sizing the bitmap from
   * the window then hands the compositor a short bitmap to stretch over
   * a tall box, and the stretch is the bug — every wavelength and
   * amplitude comes out scaled by a factor no part of this file knows
   * about, and the headroom that keeps the surface below the bottom edge
   * at rest grows with it, so the tide spends longer than it should
   * climbing to the edge before any water shows.
   *
   * A canvas measures 0 when it isn't laid out, which would divide by
   * zero downstream; the window is a good enough answer for that frame.
   */
  function fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const boxW = flood.clientWidth || innerWidth;
    const boxH = flood.clientHeight || innerHeight;
    const w = Math.round(boxW * dpr), h = Math.round(boxH * dpr);
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
    // the chrome averages the whole screen; the band is handled after the
    // draw, from what the water actually put on its last row
    floodChrome(Math.max(0, Math.min(1, (h - base) / h)), now);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = tide;
    for (const L of layers) {
      ctx.globalAlpha = L.alpha;
      ctx.beginPath();
      ctx.moveTo(0, h);
      const step = 8 * dpr;
      // and while walking the surface anyway: how much of the canvas's very
      // last row this layer covers. floodBand() needs it, and counting it
      // here is free where measuring it afterwards would not be
      let wet = 0, seen = 0;
      for (let x = 0; x <= w + step; x += step) {
        let y = base + L.sink * dpr;
        for (const wv of L.waves) {
          y += wv.amp * dpr * swell * Math.sin(x / (wv.len * dpr) * TAU + wv.ph);
        }
        ctx.lineTo(x, y);
        seen++;
        if (y <= h) wet++;
      }
      L.cover = seen ? wet / seen : 0;
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      for (const wv of L.waves) wv.ph += wv.spd * rush * dt;
    }
    ctx.globalAlpha = 1;
    // the band continues the water's bottom edge — see floodBand()
    floodBand();
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
    dryChrome(); // and the chrome comes back to the theme it belongs to
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
/* A theme change is one moment, not a quarter of a second with two
 * palettes in the room at once.
 *
 * The page eases its background and its ink, which is lovely on its own
 * and was lovely when the background was the only thing there. The faded
 * edges are gradients built from --bg, and a gradient cannot be
 * interpolated: it snaps to the new colour on the frame it changes,
 * while the body behind it is still a quarter second from arriving. What
 * you see is a band of the new theme at the top and foot of a page still
 * wearing the old one — a flash at the edges of the frame.
 *
 * So the swap is made atomic: every transition in the room is frozen for
 * the frame the palette changes on, and let go again once it has. The
 * easing is still there for what it was for — a count changing colour as
 * a line lands, a button lighting under the pointer — and the theme
 * simply arrives all at once, the way it looks like it should.
 */
/* A browser that tints its own chrome to match the page reads theme-color,
 * and there are two ways to change it: rewrite this element's content, or
 * replace the element. They are not equivalent, and which one is needed
 * has been got wrong here twice.
 *
 * First it was blamed for a bug it wasn't causing. The tint stopped
 * following a theme change, the meta looked like the suspect, and a version
 * that replaced the whole element shipped on the theory that Safari watched
 * the node. It fixed nothing, because the actual cause was
 * manifest.webmanifest declaring a theme_color of its own: a manifest is
 * fetched after the document parses and takes the tint over from the tag.
 * That field is gone, and the light touch went back in.
 *
 * Then the light touch was over-trusted. The note here claimed rewriting
 * was "checked directly on a phone with probe.html" — but the probe's own
 * readout says `manifest linked: no` unless its manifest toggle is on, and
 * the app *always* links one. So the check was run in a state the app never
 * occupies, and removing theme_color never removed the manifest. Reported
 * symptom: Safari's bars follow on a manual reload and never in between,
 * which is a tint read once at parse and then ignored.
 *
 * So: the flood keeps the light touch, because it writes ten times as the
 * tide rises and replacing the element each time would restart the
 * browser's ease at every step and never settle. A theme switch — one
 * deliberate event, no ease worth protecting — replaces the element, which
 * is the one mutation every engine is obliged to see. `fresh` picks.
 */
/* The colour the chrome actually reads, written where WebKit will see it
 * change.
 *
 * Measured on the phone with probe.html, four readings under the app's own
 * conditions. Only the theme-color tag moving: the bars ignored it. Only the
 * page's background colour moving, written as a direct style on the root:
 * the bars followed. Both moving, with an opaque fixed layer over the
 * background: they followed, and wore the background's colour rather than the
 * layer's. And then the one that named the bug — the same test again with the
 * colour moved *the way this app moves it*, through a custom property
 * redeclared per theme and selected by an attribute on <html>: the bars did
 * not follow.
 *
 * Same element, same computed colour, different route, opposite result. So
 * `html { background: var(--screen) }` is enough to paint the page and not
 * enough to tell the browser its colour has changed; a direct write to the
 * element's own style is. That is the whole bug, and it is why five releases
 * of reasoning about *which mutation the meta wants* got nowhere: the meta
 * was never connected to anything on this phone.
 *
 * So --screen stays exactly as it is — body takes it, the dialog rule dims
 * it, floodBand() steps it — and this mirrors whatever it currently resolves
 * to onto the root's inline background-color, which outranks the stylesheet
 * and is the write the chrome notices. Every path that moves the effective
 * colour calls this: a theme switch, each flood step, dryChrome() at the end
 * of a fall, and the card opening and closing.
 *
 * Pass the hex when the caller already knows it. Omitting it reads the
 * computed --screen instead, which is the right answer in every case
 * including the ones CSS decides on its own — but it forces a style recalc,
 * so it is not for the per-frame paths.
 */
function paintScreen(hex) {
  const root = document.documentElement;
  const v = hex || getComputedStyle(root).getPropertyValue('--screen').trim();
  if (!v) return;
  root.style.backgroundColor = v;
  document.body.style.backgroundColor = v;
}

/* And the layer standing in front of it.
 *
 * v76 wrote the root's own colour directly and the bars still did not move,
 * which took a while to make sense of and then made complete sense: `.base`
 * is `position: fixed; inset: 0`, so it covers the whole viewport including
 * the two strips at the ends that Safari looks at — and its colour arrives by
 * `var(--bg)` selected by `[data-theme]`, which is exactly the route test 4
 * measured as invisible. The root was fixed underneath an opaque layer whose
 * own change nothing could see.
 *
 * So every surface that can be sampled changes by a direct write now: the
 * root and body through paintScreen(), and this one here. The value is the
 * same value the stylesheet would have computed, the .25s ease still applies
 * to an inline change, and nothing about the page looks different.
 *
 * The tide does not come through here. `.base` is the page, not the screen —
 * the water is a canvas painted over it, and a flood that moved this would
 * darken every line of writing on it. Theme only.
 */
function paintBase(hex) {
  if (baseLayer) baseLayer.style.backgroundColor = hex;
}

/* Safari, and a browser tab rather than the installed app — the one place
 * this is still broken, and the only place the reload below happens.
 *
 * navigator.vendor is 'Apple Computer, Inc.' on Safari and nothing else that
 * matters; Chrome and Firefox report their own or an empty string. The
 * standalone check is navigator.standalone first, since the display-mode
 * query has answered "no" from inside an installed app before.
 */
const APPLE = /Apple/.test(navigator.vendor || '');
const IN_APP = !!navigator.standalone ||
  matchMedia('(display-mode: standalone)').matches;

/* v77 removed this tag on Apple engines, on the theory that its presence was
 * what stopped Safari sampling the page. It did not fix the bars, and it does
 * change what a *reload* sees — which is now the mechanism being relied on. So
 * the tag is written on every engine again, exactly as v76 wrote it, and a
 * reload lands the colour the way it always has. */
function setThemeColor(hex, fresh) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && !fresh) { meta.setAttribute('content', hex); return; }
  const made = document.createElement('meta');
  made.setAttribute('name', 'theme-color');
  made.setAttribute('content', hex);
  if (meta) meta.replaceWith(made); else document.head.appendChild(made);
}

function applyTheme(name) {
  const root = document.documentElement;
  root.classList.add('swapping');
  if (name === 'room') delete root.dataset.theme;
  else root.dataset.theme = name;
  // the writes the chrome reads — the attribute above moves every colour on
  // the page and, on iOS, tells the browser nothing at all
  paintScreen(THEMES[name]);
  paintBase(THEMES[name]);
  // a replace, not a rewrite: this is the event Safari was ignoring
  setThemeColor(THEMES[name], true);
  try { localStorage.setItem(THEME_KEY, name); } catch (_) {}
  // two frames: one for the new palette to paint, one to be sure it has
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.classList.remove('swapping');
    // and the /version readout is measuring the colour that just moved
    refreshRelease();
  }));
}

/* A theme tap in a Safari tab reloads the page, and it is worth saying plainly
 * why a writing app does something that blunt.
 *
 * Safari's own bars will not follow this app's colour while the page is live.
 * Eight releases went into finding a write it would notice — the meta by
 * rewrite and by replace, the root's background through a variable and then
 * directly, body, the opaque layer over them, an eased colour instead of a
 * snapped one. Every one of them was verified moving the right colour and none
 * of them moved the bars. A reload always has, every single time, because
 * Safari reads the page's colour when it parses it.
 *
 * So this is not a workaround for a bug still being looked for; it is the only
 * path the device has ever confirmed. It costs a flash on a deliberate,
 * occasional tap and nothing else: the draft is already in localStorage — the
 * service worker's own update path below reloads on exactly these terms — the
 * theme is saved by applyTheme() just above, and the scroll position is carried
 * across so a long poem comes back where it was.
 *
 * Nowhere else. The installed app's bands already follow a theme switch, and
 * every other engine tints from the meta, which works. A tab in Safari is the
 * only case, so it is the only case that pays.
 */
const SCROLL_KEY = 'tt-scroll';

/* The reload goes at once, and exactly once.
 *
 * Two wrong versions, both shipped and both reported. Reloading on every tap
 * meant cycling quickly started a new load before the last had painted, so the
 * bars sampled a page mid-navigation and wore its blank black until the
 * pressing stopped. Deferring it 600ms fixed that and made a single tap feel
 * broken instead: the palette turns over, the bars sit wrong for half a second,
 * and then the page throws itself away. Waiting is the worst of both.
 *
 * So it goes immediately, like the version that worked, with a latch so a
 * second tap cannot interrupt the load the first one started. Taps during that
 * load are not lost — applyTheme() still runs and still writes the theme to
 * localStorage, and the page coming in reads it there, so a run of presses
 * lands on the one it ended on with a single navigation.
 */
let reloading = false;

themeBtn.addEventListener('click', () => {
  const names = Object.keys(THEMES);
  const cur = names.indexOf(document.documentElement.dataset.theme || 'room');
  applyTheme(names[(cur + 1) % names.length]);
  if (!APPLE || IN_APP || reloading) return;
  reloading = true;
  save();
  const room = document.getElementById('room');
  try { sessionStorage.setItem(SCROLL_KEY, String(room ? room.scrollTop : 0)); }
  catch (_) {}
  location.reload();
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

/* The card dims the band, and the dimming is a stylesheet rule the browser
 * applies by itself: html:has(dialog[open]) rewrites --screen. paintScreen()
 * has to run on both edges of that or the root's inline colour — which
 * outranks the rule — holds the undimmed value and the strip stays bright.
 *
 * Watched on the element rather than hooked onto the button, because the
 * button is only one way in. Esc closes natively, a backdrop click closes
 * below, and any future caller of showModal() would silently lose the dim.
 * The open attribute is the state itself, so observing it cannot be bypassed.
 */
new MutationObserver(() => paintScreen())
  .observe(about, { attributes: true, attributeFilter: ['open'] });

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
/* ---------- the fade, and what the keyboard does to the view ---------- */

/* The one place this app looks at the keyboard, and it moves paint only.
 *
 * Giving the document no scroll stopped the toolbar wandering, but it
 * could not stop this: with a keyboard up, iOS slides the *visual*
 * viewport — the part you can actually see — around inside the layout
 * viewport to keep the caret above the keys. Everything laid out against
 * the layout viewport slides with it, the room's mask included, and the
 * top of the fade ends up above the screen with the writing running
 * clear under the clock and the battery.
 *
 * There is no CSS for "the part you can see". So the fade is told, and
 * only the fade: where the visible box starts. The toolbar is
 * deliberately left alone — iOS lifts it above the keyboard by itself,
 * which is the behaviour we want, and two earlier attempts to improve on
 * that both made it worse.
 *
 * This is the third pass at keyboard-aware code and the first that
 * should hold, because the ground is different now: the document cannot
 * scroll, so these events fire when the keyboard opens or the caret
 * moves, not continuously under a finger. Nothing here can move a
 * control or shift the writing — at worst a fade arrives a frame late,
 * which is a great deal cheaper than a toolbar that jumps.
 */
/* → how far the top of the fade has to come down to sit on the visible
 * top.
 *
 * A number in, a number out, no DOM — the part of this that can be
 * checked without a phone in your hand.
 */
function edgeTop(offsetTop) {
  return Math.max(0, Math.round(offsetTop || 0));
}

const view = window.visualViewport;

function placeEdges() {
  if (!view) return;
  const top = edgeTop(view.offsetTop);
  // Written on :root, and read only by the mask's two top stops (see the
  // (pointer: coarse) block in style.css). The foot deliberately ignores
  // it: lifting that fade above the keys would lay a washed-out stripe
  // across the middle of the writing instead of hiding its edge, and
  // behind the keyboard is exactly where a fade at the foot belongs.
  document.documentElement.style.setProperty(
    '--view-top', top ? top + 'px' : '0px');
}

if (view) {
  view.addEventListener('resize', placeEdges);
  view.addEventListener('scroll', placeEdges);
  placeEdges();
}

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
/* and land back where the writing was, after the reload above. sessionStorage
   rather than localStorage: this belongs to the tab and to this one trip, and
   it is cleared as it is read so an ordinary visit never inherits it. */
try {
  const y = sessionStorage.getItem(SCROLL_KEY);
  if (y !== null) {
    sessionStorage.removeItem(SCROLL_KEY);
    const room = document.getElementById('room');
    if (room) room.scrollTop = Number(y) || 0;
  }
} catch (_) {}

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
