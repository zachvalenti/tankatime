'use strict';

const page    = document.getElementById('page');
const doc     = document.getElementById('doc');
const editor  = document.getElementById('editor');
const gutter  = document.getElementById('gutter');
const totalEl = document.getElementById('total');
const fsBtn   = document.getElementById('fs');
const exportBtn = document.getElementById('export');
const themeBtn  = document.getElementById('theme');

const TARGETS = [5, 7, 5, 7, 7];
const STORE_KEY = 'tanka-time-doc';
const THEME_KEY = 'tanka-time-theme';
const THEMES = { room: '#0a0c0a', paper: '#f6f1e3', dusk: '#171321' };

/* ---------- syllable counting ---------- */

// words the heuristic gets wrong
const SPECIAL = {
  quiet: 2, quietly: 3, poem: 2, poems: 2, poet: 2, poets: 2,
  poetry: 3, idea: 3, ideas: 3, ideal: 3, area: 3, aria: 3,
};

function countWord(token) {
  const w = token.toLowerCase();
  const letters = w.replace(/[’']/g, '').replace(/[^a-z]/g, '');
  if (!letters) return 0;
  if (SPECIAL[letters] != null) return SPECIAL[letters];

  let n = (letters.match(/[aeiouy]+/g) || []).length;
  if (n === 0) return 1;

  // silent trailing e ("time"), but keep syllabic -le ("table")
  if (n > 1 && /[^aeiouy]e$/.test(letters) && !/[^aeiouy]le$/.test(letters)) n--;
  else if (n > 1 && /[^aeiouy]es$/.test(letters) && !/[^aeiouy]les$/.test(letters)
           && !/(?:[sxz]|[cs]h)es$/.test(letters)) n--;
  // silent -ed ("walked"), but not after t/d ("created", "loaded")
  if (n > 1 && /[^aeiouytd]ed$/.test(letters)) n--;

  // hiatus: consonant + i + vowel usually splits ("di-et", "li-on")
  n += (letters.match(/[^aeiouy]i[aeiou]/g) || []).length;
  // ...except fused endings ("na-tion", "spe-cial", "o-cean")
  n -= (letters.match(/[cstgxn]ion|[cst]i(?:al|an|ou|en)/g) || []).length;

  // vowel + ing is two beats ("be-ing", "go-ing", "fly-ing")
  if (/[aeiouy]ing$/.test(letters)) n++;
  // syllabic n't ("isn't", "didn't"), but not "don't", "can't"
  if (/n[’']t$/.test(w) && /[^aeiouy]nt$/.test(letters)) n++;

  return Math.max(1, n);
}

function countLine(text) {
  let total = 0;
  for (const token of text.split(/[^a-zA-Z'’]+/)) total += countWord(token);
  return total;
}

/* ---------- editor structure ---------- */

function makeLine(text) {
  const d = document.createElement('div');
  if (text) d.textContent = text;
  else d.appendChild(document.createElement('br'));
  return d;
}

// keep the editor as one <div> per line; browsers mostly do this on
// their own once seeded, but repair stray nodes after odd edits
function normalize() {
  if (!editor.firstChild) {
    editor.appendChild(makeLine(''));
    return;
  }
  const isDiv = n => n.nodeType === 1 && n.tagName === 'DIV';
  if ([...editor.childNodes].every(isDiv)) return;

  const sel = document.getSelection();
  const saved = sel.rangeCount && editor.contains(sel.anchorNode)
    ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset]
    : null;

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

function getText() {
  return [...editor.children]
    .map(d => d.textContent.replace(/\u00a0/g, ' '))
    .join('\n');
}

function setText(text) {
  editor.replaceChildren(...text.split('\n').map(makeLine));
}

/* ---------- render ---------- */

function refresh() {
  normalize();
  const frag = document.createDocumentFragment();
  let pos = 0, total = 0, any = false;

  for (const line of editor.children) {
    const text = line.textContent.replace(/\u00a0/g, ' ');
    if (!text.trim()) { pos = 0; continue; } // blank line starts a new tanka
    any = true;
    const n = countLine(text);
    total += n;
    const target = pos < TARGETS.length ? TARGETS[pos] : null;
    const span = document.createElement('span');
    span.textContent = n;
    span.style.top = line.offsetTop + 'px';
    span.dataset.state =
      target === null ? 'free' :
      n === target    ? 'hit'  :
      n > target      ? 'over' : 'under';
    frag.appendChild(span);
    pos++;
  }

  gutter.replaceChildren(frag);
  doc.classList.toggle('empty', !any);
  totalEl.textContent = total ? `${total} syllable${total === 1 ? '' : 's'}` : '';
  scheduleSave();
}

/* ---------- persistence ---------- */

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
function save() {
  try { localStorage.setItem(STORE_KEY, getText()); } catch (_) {}
}

/* ---------- events ---------- */

editor.addEventListener('input', refresh);

editor.addEventListener('paste', e => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  text.replace(/\r\n?/g, '\n').split('\n').forEach((ln, i) => {
    if (i) document.execCommand('insertParagraph');
    if (ln) document.execCommand('insertText', false, ln);
  });
});

// click anywhere in the room to write
page.addEventListener('mousedown', e => {
  if (editor.contains(e.target)) return;
  e.preventDefault();
  editor.focus();
  const sel = document.getSelection();
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
});

fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else (document.documentElement.requestFullscreen?.() || Promise.resolve()).catch(() => {});
});

exportBtn.addEventListener('click', () => {
  const text = getText();
  if (!text.trim()) return;
  const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tanka-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

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

// keep the caret where it is when a toolbar button is clicked
for (const btn of [exportBtn, themeBtn, fsBtn]) {
  btn.addEventListener('mousedown', e => e.preventDefault());
}

let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refresh, 100);
});
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

/* ---------- init ---------- */

applyTheme(THEMES[localStorage.getItem(THEME_KEY)] ? localStorage.getItem(THEME_KEY) : 'room');
setText(localStorage.getItem(STORE_KEY) || '');
refresh();
editor.focus();
document.fonts?.ready.then(refresh);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
