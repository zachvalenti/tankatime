---
name: verify
description: Build/launch/drive recipe for verifying Tanka Time changes end-to-end in a headless browser.
---

# Verifying Tanka Time

Static PWA, no build step. Serve and drive with Playwright.

## Launch

```sh
python3 -m http.server 8471 --bind 127.0.0.1   # from the repo root
```

## Drive (headless Chromium)

`npm install playwright` in a scratch dir, then launch with the
pre-installed browser — the pinned download will be missing:

```js
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

- Reset between runs with `page.evaluate(() => { setText(''); refresh(); save(); })`.
  Clearing localStorage and reloading does *not* work: the `pagehide` flush
  writes the old draft straight back over the cleared store.
- `page.click('.page')` focuses the editor; type with `page.keyboard`.
- Gutter state: `page.$$eval('#gutter span', els => els.map(s => s.textContent + ':' + s.dataset.state))`
  — states are `hit` / `over` / `under` / `free`. Headings and separator
  blanks emit no span, so pair each span with its line by matching
  `parseFloat(s.style.top)` against the line's `offsetTop` rather than
  trusting span order.
- Clear-hold: `page.mouse.down()` over `#clear`, wait, sample, `mouse.up()`.
  Full hold is 3 s (`HOLD_MS`). The water is drawn on the `#flood` canvas;
  sample it with `getImageData` — find the surface via the first row with
  nonzero alpha in a column, and check layer stacking via alpha depth.

## Flows worth driving

- Syllable gutter: type lines, check counts/targets (5-7-5-7-7 by line
  position; lone blank line = 0 placeholder; double blank or blank after a
  finished verse = separator that resets targets).
- Clear hold: early release cancels and keeps text; 3 s hold clears.
- Reload after a 500 ms pause to check the debounced localStorage save.
- Markdown: `# ` heading (blank gutter, resets the 5-7-5-7-7 targets below
  it) vs `#hashtag` (an ordinary counted line); `**bold**`, `*italic*`,
  `__underline__`, `> quote`, `- list`. Line classes are on the line divs
  (`md-h1`, `md-quote`, `md-list`), the marks are `.md-mark` spans inside.
  `getText()` must round-trip the source exactly — decoration is only paint.
- Undo is the app's own (`app.js`), not the browser's — decoration rewrites
  the nodes a native undo would need. Steps coalesce on a 500 ms pause, and
  each ⌘B/I/U toggle is its own step. Worth re-checking after any change to
  `decorate()`: type, toggle a mark, then undo/redo and confirm the text
  doesn't duplicate.
