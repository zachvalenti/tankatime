'use strict';

/* Tanka Time — the whole app in one file, no framework, no build step.
 *
 * index.html loads count.js (syllable counting) and then this file,
 * which wires up everything else: the editor, the numbers in the
 * margin, autosave, themes, export, the clear-hold flood, and offline
 * support. Top to bottom it follows the page's life — grab elements,
 * define behavior, attach listeners, restore saved state.
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

function runNode(run) {
  if (!run.cls) return document.createTextNode(run.text);
  const s = document.createElement('span');
  s.className = run.cls;
  s.textContent = run.text;
  return s;
}

// what a line shows now, in the shape mdRuns() describes it: adjacent
// nodes of one class merged, empties and the trailing <br> dropped — so
// the two can be compared without trusting the browser to have kept its
// nodes tidy, or to have spelled its spaces the same way
function currentRuns(line) {
  const runs = [];
  for (const n of line.childNodes) {
    if (n.nodeType === 1 && n.tagName === 'BR') continue;
    const cls = n.nodeType === 1 ? n.className : '';
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

// one line: name its shape for style.css, then repaint it if — and only
// if — the runs have moved
function decorate(line) {
  if (composing) return;
  const text = plain(line.textContent);
  const cls = mdBlock(text).cls;
  if (line.className !== cls) line.className = cls;

  const want = mdRuns(text);
  if (want.length ? sameRuns(want, currentRuns(line)) : isBare(line)) return;

  const off = caretOffset(line);
  line.replaceChildren(...(want.length
    ? want.map(runNode)
    : [document.createElement('br')]));
  if (off !== null) placeCaret(line, off);
}

/* ---------- render ---------- */

// one pass repaints the Markdown, rebuilds every margin number, and
// retotals. The new spans collect in a DocumentFragment first so the
// page reflows once, and each span is pinned to its line's offsetTop —
// the gutter is a separate absolutely-positioned column that shadows
// the editor
function refresh() {
  normalize();
  const rows = [...editor.children];
  // decorate before measuring: a heading stands taller than a line of
  // poem, so every offsetTop read below has to be the settled one
  for (const row of rows) decorate(row);

  const frag = document.createDocumentFragment();
  const src = rows.map(d => plain(d.textContent));
  const blank = src.map(t => !t.trim());
  const head = src.map(mdIsHeading);
  let pos = 0, total = 0, words = 0, any = false;

  for (let i = 0; i < rows.length; i++) {
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
      if (blank[i - 1] || blank[i + 1] || head[i - 1] || head[i + 1] ||
          pos >= TARGETS.length) { pos = 0; continue; }
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
    const target = pos < TARGETS.length ? TARGETS[pos] : null;
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
  if (totalMode === 'timer') {
    totalEl.textContent = fmtClock(Date.now() - SESSION_T0);
    return;
  }
  const n = totals[totalMode];
  const noun = totalMode === 'words' ? 'word' : 'syllable';
  totalEl.textContent = n ? `${n} ${noun}${n === 1 ? '' : 's'}` : '';
}

function setTotalMode(mode) {
  totalMode = mode;
  try { localStorage.setItem(TOTAL_KEY, mode); } catch (_) {}
  // the margin numbers are syllable counts; on the other faces they'd
  // contradict the total, so the gutter rests until syllables return.
  // (the native hidden attribute is display:none without any CSS)
  gutter.hidden = totalMode !== 'syllables';
  // the once-a-second tick exists only while the timer face is up
  clearInterval(clockTimer);
  clockTimer = totalMode === 'timer' ? setInterval(renderTotal, 1000) : 0;
  renderTotal();
}

totalEl.addEventListener('click', () => {
  setTotalMode(MODES[(MODES.indexOf(totalMode) + 1) % MODES.length]);
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

// A run of ordinary typing is one step, closed when the typing pauses —
// coarser than a browser's per-character stack, and steadier to use.
function commit() {
  clearTimeout(commitTimer);
  const now = snapshot();
  if (now.text === base.text) { base = now; return; }
  history.push(base);
  if (history.length > HISTORY_MAX) history.shift();
  future.length = 0; // a fresh edit abandons whatever was undone
  base = now;
}

function noteChange() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(commit, 500);
}

function restore(state) {
  setText(state.text);
  refresh();
  placeAt(state.caret);
  base = snapshot();
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

// 'input' fires on every edit, whatever caused it — keys, drag, paste
editor.addEventListener('input', () => { refresh(); noteChange(); });

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

// and the same again for undo reached another way — a trackpad gesture,
// or the editing menu — which arrives as an input type rather than a key
editor.addEventListener('beforeinput', e => {
  if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
  e.preventDefault();
  if (e.inputType === 'historyUndo') undo();
  else redo();
});

// an IME composition is a character still being spelled out; let it
// finish before the line is repainted underneath it
editor.addEventListener('compositionstart', () => { composing = true; });
editor.addEventListener('compositionend', () => { composing = false; refresh(); });

/* ---------- ⌘B, ⌘I, ⌘U ---------- */

// Without this handler the browser answers these itself and injects
// <b>/<i>/<u> into the line — markup that looks right until getText()
// flattens it away on the next save. Here they write Markdown instead.
editor.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const mark = MD_MARKS[e.key.toLowerCase()];
  if (!mark) return;
  e.preventDefault();
  toggleMark(mark);
});

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

// Marks apply a line at a time. That isn't only the simpler path —
// Markdown emphasis can't cross a line break, so a mark per line is
// what any later reader of the source would need anyway.
function toggleMark(mark) {
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
    jobs.push({ row: rows[i], src, ...mdToggle(src, s, e, mark) });
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
  commit(); // refresh() above already scheduled the save
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
  const text = getText();
  if (!text.trim()) return;
  const blob = new Blob([text + '\n'], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tanka-${new Date().toISOString().slice(0, 10)}.md`;
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
