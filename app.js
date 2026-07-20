'use strict';

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
  const rows = [...editor.children];
  const blank = rows.map(d => !d.textContent.replace(/\u00a0/g, ' ').trim());
  let pos = 0, total = 0, any = false;

  for (let i = 0; i < rows.length; i++) {
    if (blank[i]) {
      // two blank lines in a row \u2014 or one once the five slots are
      // filled \u2014 start a new tanka; a lone blank inside an unfinished
      // tanka keeps its slot and counts as 0
      if (blank[i - 1] || blank[i + 1] || pos >= TARGETS.length) { pos = 0; continue; }
      const span = document.createElement('span');
      span.textContent = '0';
      span.style.top = rows[i].offsetTop + 'px';
      span.dataset.state = 'under';
      frag.appendChild(span);
      pos++;
      continue;
    }
    any = true;
    const n = countLine(rows[i].textContent.replace(/\u00a0/g, ' '));
    total += n;
    const target = pos < TARGETS.length ? TARGETS[pos] : null;
    const span = document.createElement('span');
    span.textContent = n;
    span.style.top = rows[i].offsetTop + 'px';
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

  function fit() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (flood.width !== w || flood.height !== h) { flood.width = w; flood.height = h; }
    return dpr;
  }

  function frame(now) {
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
  try { clearBtn.setPointerCapture(e.pointerId); } catch (_) {}
  startHold();
});
clearBtn.addEventListener('pointerup', cancelHold);
clearBtn.addEventListener('pointercancel', cancelHold);
// a five-second press is a long-press to the browser; keep its menu away
clearBtn.addEventListener('contextmenu', e => e.preventDefault());

clearBtn.addEventListener('keydown', e => {
  if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
  e.preventDefault();
  startHold();
});
clearBtn.addEventListener('keyup', cancelHold);
clearBtn.addEventListener('blur', cancelHold);

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

const aboutBtn = document.getElementById('context');
const about    = document.getElementById('about');

aboutBtn.addEventListener('click', () => about.showModal());
document.getElementById('aboutClose').addEventListener('click', () => about.close());
document.getElementById('aboutGo').addEventListener('click', () => about.close());
// Esc closes natively; a click on the backdrop closes too
about.addEventListener('click', e => {
  const r = about.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right ||
      e.clientY < r.top || e.clientY > r.bottom) about.close();
});
// whichever way it closes, hand the pen back
about.addEventListener('close', focusEnd);

// keep the caret where it is when a toolbar button is clicked,
// and acknowledge every press with a tick where haptics exist
for (const btn of [clearBtn, exportBtn, themeBtn, fsBtn, aboutBtn]) {
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('pointerdown', () => buzz(10));
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
  // when an updated worker takes over, reload once so the new version
  // shows on the first visit instead of the second (draft is in
  // localStorage, so nothing is lost)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; save(); location.reload(); }
  });
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
