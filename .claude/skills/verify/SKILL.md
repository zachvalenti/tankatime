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
  `ftn-lyric`, `ftn-bone`, `ftn-title`, plus the two second classes —
  `ftn-caps` on the lines the app shouts for you, `ftn-dual` on a speech
  set alongside its neighbour. Assert `#gutter` is `hidden` with no spans,
  and that the total never reaches the syllable face.

  **Typing `/fountain` into an empty page now seeds a cover**, so a fixture
  laid down keystroke by keystroke lands inside it. Use a helper that sets
  the whole script at once (`setText` + `refresh`): the mode flag then
  flips against a body that is already written, and the seed declines. Keep
  real typing for the seed and suggestion flows themselves.

  Things worth driving:
  - **Context**, the reason `ftnKinds()` reads the document instead of the
    line. A cue *always* needs a blank line above it — `MAYA` under
    `He turns.` or under a slugline is `ftn-action`, and `@MAYA` is the
    only way round it. A cue with nothing under it is action too. This is
    strict on purpose: the editor and screenplain apply the same rule, so
    a script that reads right here reads right there.
  - **A speech runs to the next blank line.** Consecutive lines under a cue
    are all `ftn-dialogue`; `(beat)` between them is `ftn-paren`. Only a
    blank line returns you to action.
  - **The cover.** `/fountain` into an empty page seeds Title/Author/Draft
    date/Contact as *real text*, in one undo step, ending on the blank line
    that terminates a Fountain title page. Delete it and it must stay
    deleted; a page with writing in it must never get one.
  - **`FADE IN:` is marked in the editor, not at export** — `ftnFade()`
    writes the `>` into the line, and never into the line the caret is on.
    Check `getText()`, not just the class.
  - **Suggestions are a pseudo-element.** `data-ghost` on the line div,
    painted by CSS `::after`. The assertions that matter are that
    `getText()` never contains it and that repeated `refresh()` doesn't
    change `editor.innerHTML` — real text on the line would fail both.
    Ambiguous prefixes must show nothing; a name must stop being offered
    once its last cue is deleted; and a caret that moves *inside* the line
    (arrow key, a tap into the word) must take the suggestion down —
    `openCaretLine()` returns early for the same row, so that clearing is
    its own branch and easy to lose.
  - **A suggestion is taken by Tab or by a tap**, and both go through
    `takeGhost()`, which rewrites the line *whole*: a cue only reads as one
    if it shouts (`isShout`), the match is case-blind, and appending the
    tail to a lowercase prefix produced `maYA` — right letters, wrong case,
    not a cue. Drive it in lower case, and check `getText()`, not the class.
    A leading `@` is matched *past* — `@ma` is offered the same name `MA` is,
    and taking it writes `@MAYA`, mark kept (forcing is asked before the
    shout rule, so dropping it would change what the line is). A lone `@`
    must offer nothing.
    The tap region is geometric (`inGhostRegion()`) because a pseudo-element
    cannot be hit-tested: rebuild it in-page from the line's
    `Range.getClientRects()` to find a point. Test it in a touch context
    (`hasTouch`, `isMobile`) *and* with `page.mouse.click` — the handlers
    are `touchstart` and `mousedown` separately, and each cancels the
    default the other doesn't. Assert focus never leaves the editor
    (a dropped soft keyboard is the whole failure being avoided) and that
    the coarse-pointer chip leaves every line's `offsetTop` untouched.
  - **Dual dialogue layout needs a width assertion, not just a class one.**
    "Indented further right" passes happily while the speech has collapsed
    to one character per line. Compare usable width against the plain
    dialogue line, and check the line hasn't grown taller.
  - **Caps**: type `int. kitchen - night` and `cut to:` in lower case. Both
    must be recognised, both must compute to `text-transform: uppercase`,
    the *draft* must keep your casing, and the exported file must not —
    check the download body, not just the filename. Forced `.` and `>`
    lines keep whatever case you gave them; a forced cue (`@maya`) does
    **not** — it wears `ftn-caps` like any other cue, so it shouts on the
    page and in the file, and `ftnNames()` hands its name back in capitals
    so completing it writes a line that is a cue on its own. That is the
    one place forcing is overruled, and the trade (no mixed-case cue —
    `@McCLANE` exports `@MCCLANE`) is deliberate; see the FTN_CAPS note in
    `fountain.js`.
  - ⌘U writes `_x_` here and `__x__` in poem mode; ⌘K shouts the word under
    the caret and toggles back; ⌘\ wraps a line in `> <` and is inert
    outside a script; ⌘D puts the `^` on the *second* cue in the selection
    (`ftnDual()`, the one shortcut that reads the whole document); Tab
    takes a suggestion (see above) and is otherwise left alone.
  - `localStorage['tanka-time-total']` is *unchanged* by the mode — the
    face is borrowed, not overwritten.
- **The bar and the soft keyboard** (`barLift()`, `placeBar()`, `barAside()` in
  `app.js`). A phone keyboard shrinks the visual viewport and leaves the layout
  viewport alone, so `position: fixed; bottom: 0` lands behind it and iOS drags
  the bar about as you scroll. Headless Chromium reproduces none of that —
  what *is* testable here is the arithmetic (`barLift(844, 400, 100) === 344`;
  anything under `KEY_MIN` is `0`), that the whole mechanism stays inert with
  no keyboard (`bar.style.transform === ''`, no `lifted`/`away`), and the
  stepping-aside wiring: `lifted` is the state, so add it by hand, dispatch a
  `scroll`, and the bar takes `away` and settles back after `SETTLE_MS`. The
  fade must be opacity only — the transform is busy holding the lift, and two
  rules on one property is where a stutter comes from. Everything else about
  this needs a real phone.
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
