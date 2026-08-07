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
- Fountain (`/fountain` on the first line, `fountain.js`): line classes are
  `ftn-scene`, `ftn-character`, `ftn-paren`, `ftn-dialogue`, `ftn-action`,
  `ftn-transition`, `ftn-centered`, `ftn-section`, `ftn-synopsis`,
  `ftn-lyric`, `ftn-bone`, plus `ftn-caps` riding along on the two the app
  shouts for you. Assert `#gutter` is `hidden` with no spans, and that the
  total never reaches the syllable face. Things worth driving:
  - **Context**, the reason `ftnKinds()` reads the document instead of the
    line. Two shouted words need a blank line above to be a cue, so
    `NO ENTRY` mid-paragraph stays `ftn-action`; one shouted word doesn't,
    so `MAYA` under `He turns.` is a cue. A cue with nothing under it is
    action either way.
  - **Caps**: type `int. kitchen - night` and `cut to:` in lower case. Both
    must be recognised, both must compute to `text-transform: uppercase`,
    the *draft* must keep your casing, and the exported file must not —
    check the download body, not just the filename. Forced (`.`/`>`/`@`)
    lines keep whatever case you gave them.
  - ⌘U writes `_x_` here and `__x__` in poem mode; ⌘K shouts the word under
    the caret and toggles back; ⌘\ wraps a line in `> <` and is inert
    outside a script.
  - `localStorage['tanka-time-total']` is *unchanged* by the mode — the
    face is borrowed, not overwritten.
- Export picks its extension from the page: `.fountain` for a script,
  `.md` for a page that used a mark, `.txt` for one that didn't
  (`mdUsed()` in `markdown.js`). Worth asserting all three.
- Undo is the app's own (`app.js`), not the browser's — decoration rewrites
  the nodes a native undo would need. A step ends when the edit kind changes
  (typing → deleting), when the caret moved between edits, on a word
  boundary, on any ⌘B/I/U toggle, or after a 500 ms pause. Worth re-checking
  after any change to `decorate()`: type, toggle a mark, then undo/redo and
  confirm the text doesn't duplicate.
- The **open line** is the one holding the caret; only it shows its `.md-mark`
  and `.md-hash` spans (`.editor > :not(.open)` hides them). Two traps, both
  hit once already:
  - `openLine` must be read from the live selection inside `refresh()`, never
    from the last `selectionchange` — that event lands a beat late, and
    painting the caret's own line as closed hides the span the caret sits in.
    A caret cannot live in `display:none`, so Chrome drops it to the editor
    and the next character lands outside every line div.
  - `selectionchange` can fire mid-edit, so its handler must only toggle the
    class and call `measure()`. Calling `refresh()` there runs `normalize()`
    over a DOM the browser hasn't finished building, which reorders lines.
  - Drive typing with *no* pauses between lines when testing this; a
    `waitForTimeout` between keystrokes hides both races.
