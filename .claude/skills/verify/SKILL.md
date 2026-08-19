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
- `/haiku` is the same room with three slots instead of five: assert 5-7-5 by
  gutter state, that a title and a blank line reset the count on exactly the
  same terms as tanka, and that the sixth line onward reads `free`. Interop is
  the part worth guarding — it rides with `/free` and `/simple`, but `readModes`
  must return `haiku: false` when `/fountain` is also present, **in either
  order**, because a script has no syllable form for the shorter one to shorten.
  Check a plain tanka page in the same run: the targets are shared code.
- **Bump `PROBE_BUILD` in `probe.html` with every `CACHE` bump.** The probe
  reports which release is on the server against which one this device has
  actually installed, so that "did my merge go live?" is a readout rather than
  a guess — most merges change nothing you could spot from across the room. The
  two can legitimately differ for a minute while a new worker downloads; a
  stamp that never matches means someone forgot to bump it. Nothing enforces
  that — check it by hand on every release; there is no test suite in this
  repo (see **What is and isn't automated** at the end).

  Worth knowing: `sw.js` caches **every** GET it serves, not only the files it
  precaches, so `probe.html` is itself held until the next `CACHE` bump. It is
  not a live-editable page. If its stamp is behind the release, the rest of
  what it says may be stale too.
- **The chrome floods with the page** (`floodChrome()` in the water module).
  On a phone the page is not the screen: Safari keeps a strip at each end for
  its address bar and toolbar, and the installed app keeps the status bar. No
  page can paint into any of it. So the clear-hold tide filled the writing area
  and stopped dead at its edges, leaving a band of theme colour above and below
  — reported as "not starting from bottom nor going to top, banded" from a
  Safari screenshot, *after* the page itself had been proved to flood edge to
  edge. Worth recognising, because it looks exactly like the water being
  clipped and it is nothing of the kind.

  `theme-color` is the only lever a page has on that strip, and it takes a
  colour, not a layer — so it is handed the colour the page has actually
  become: `--tide` mixed into the theme background by how much of the screen
  the water has taken, times the three layers' combined opacity (computed from
  their own alphas, so retuning them keeps this honest). At the full flood the
  chrome equals the flooded page.

  **Stepped and throttled on purpose** — ten steps, 180 ms apart. Browsers ease
  this tint over a couple of hundred milliseconds rather than snapping it, so
  writing it every frame leaves the chrome chasing a value it never reaches.
  For the same reason `setThemeColor()` rewrites the attribute rather than
  replacing the element: replacing it restarts that ease at every step.

  Assert the walk has several distinct values but not dozens, that it never
  overshoots the flooded colour, that `stop()` returns it *exactly* to the
  theme, and that only one meta exists afterwards.
- **The water canvas is measured off its own box, never off the window**
  (`fit()` in the water module). `.flood` is `position: fixed; inset: 0` at
  `100%`, and on a phone that box and `innerHeight` are not the same number: a
  fixed element's `100%` resolves against the *large* viewport — the one you get
  with the browser's bars hidden — while `innerHeight` reports the viewport you
  can currently see. iOS Safari therefore disagrees with itself by the height of
  its own toolbars, permanently.

  Sizing the bitmap from the window handed the compositor a short bitmap to
  stretch over a tall box. The stretch is the bug, and it is quiet: every
  wavelength and amplitude comes out scaled by a factor no part of `app.js`
  knows about, and the headroom that holds the surface below the bottom edge at
  rest is scaled with them, so the tide spends longer than it should climbing to
  the edge before any water appears. Which reads, from across the room, as the
  water not starting at the bottom.

  Assert `flood.width/height` equal the element's own `clientWidth/clientHeight`
  times the capped dpr, and that the ratio of box to bitmap is exactly `1` — in
  a viewport where the two agree *and* in one where they don't. Force the
  disagreement the way the phone does, with `.flood { height: <taller> }`, and
  drive a hold in both: the ink must reach the canvas's bottom row throughout.

  What this does *not* fix, because no page can: in Safari the box's bottom
  genuinely sits below the visible screen, behind the toolbar. The water reaches
  the bottom of everything it owns; the strip past that is the chrome, and the
  chrome is `floodChrome()`'s job. Don't reach for `visualViewport` here — see
  the two entries below on where that road goes.

  **And the box has to actually be pinned to the bottom, which `inset: 0` does
  not do here.** `.flood` read `inset: 0; width: 100%; height: 100%` for a long
  time, which looks like four pinned edges and is not: give a positioned box
  `top`, `bottom` *and* a height and it is over-constrained, so `bottom` is
  discarded (CSS 2.1 §10.6.4, and `right` likewise in §10.3.7). The canvas hung
  from the top and sized itself by a percentage.

  In an installed iOS app that percentage leaves out the home-indicator strip,
  so the tide rose over the whole page, stopped ~34 px short, and left a dry
  band of `--bg` along the very bottom with the flooded page directly above it.
  Reported twice as "not starting from the bottom", and it looks nothing like a
  canvas bug in a screenshot — the band is the theme colour, so it reads as
  chrome. It isn't: the root background paints the whole viewport canvas
  regardless of what the elements do, which is why that strip had colour at all.
  The height is `calc(100% + env(safe-area-inset-bottom))` now; `env()` is `0`
  wherever there is no inset, so nothing else changed.

  Chromium reports every inset as `0`, so drive this with the numbers restated,
  and keep a contrast case that reproduces the shortfall (`height: calc(100% -
  34px)`) — a test that only ever sees the fixed rule cannot tell you the fix
  was needed.
- **The manifest must declare no `theme_color`.** Safari tints its own toolbar
  from `theme-color`, and `manifest.webmanifest` deliberately leaves the field
  out: a manifest is fetched *after* the document parses, and once Safari has
  one it stops listening to the meta tag. The symptom is precise and worth
  recognising, because it sends you looking in the wrong place — the chrome
  takes whatever colour the app *loaded* on and holds it through every theme
  switch, then updates on reload and sticks again. That reads exactly like "the
  meta isn't being re-read", and it is not: the meta is fine.

  Two dead ends, both walked, neither of them the cause. Rewriting `.content`
  in place works in Safari — it is what the app did from its first commit, and
  what `setThemeColor()` went back to doing. Replacing the element works too,
  and shipped for one release on the theory that Safari watched the node; it
  fixed nothing and it restarts the tint's ease, which the flood cannot afford.
  Neither is the fix, so don't reach for either when this
  recurs; check the manifest. Assert the meta's colour tracks the computed page
  background across a theme switch, exactly one in `<head>`, and that
  `manifest.webmanifest` has no `theme_color` key at all.

  None of this is visible in Chromium, which does not tint anything. Reproduce
  it on a phone with `probe.html`, whose experiment varies each candidate
  independently and links a manifest whose `theme_color` is a red that appears
  nowhere else, so the source being listened to is never in doubt.
- **`/version`** (`modes.js`, `setRelease()`/`askRelease()` in `app.js`). Rides
  the mode machinery, which is the whole reason it is a mode: dimmed, uncounted,
  dropped from the export, all for free. It **overrides every other mode in
  either order** — a page whose purpose is to be read once and cleared is not
  also a screenplay.

  **Deliberately absent from the `?` card and the README.** It is an instrument,
  not a feature; the only documentation is the comment in `modes.js`. Don't
  "fix" that by writing it up.

  The readout is a `::after` on the mode line, same trick as the Fountain
  suggestion and for the same reasons — `getText()`, the draft and the export
  cannot contain it and the caret cannot land in it. Assert exactly that:
  `getText()` is only what was typed, repeated `refresh()` leaves
  `editor.innerHTML` byte-identical, the gutter emits no span, and the export
  drops the line. The lookup is lazy — a page without `/version` must make no
  request at all.

- **A page cannot read the server's `sw.js` through its own worker**, and this
  cost real time. `fetch('sw.js', { cache: 'no-store' })` gets past the HTTP
  cache and **not** past the service worker: a page-initiated fetch runs through
  the worker's fetch handler, which was cache-first and had cached that very
  file. So "what does the server have?" returned the release *this device* was
  on, the two always agreed, and `probe.html` reported "live — you are testing
  the latest" no matter how far behind the app was. A cache-buster is no escape
  either: `caches.match` here passes `ignoreSearch: true`.

  `sw.js` from v55 excludes its own path from the fetch handler, which is the
  fix for both readers at once. Two things follow. Against an **older** worker
  still in charge the old lie persists, so a "live" verdict from a pre-v55
  install proves nothing. And when a release seems not to have landed, believe
  `caches.keys()` — what this copy is *running* — over any claim about the
  server.

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
  - **The page count** (`ftnPages()` in `fountain.js`). In a script the
    syllable face becomes `12.40 pages`; the stored setting is still
    `syllables` underneath, so a poem opened afterwards is unchanged — assert
    both directions. The gutter stays hidden (pages is not the syllable face).

    It measures the script's *content* length at standard geometry: 55 lines
    a page, 61-column action, 36 dialogue, **33 character, 26 parenthetical**,
    dual columns at 0.75. Those last three are the industry widths, not
    frame-minus-indent — screenplain leaves them unconstrained at 42/48 and is
    wrong to. Title page, sections, synopses and the boneyard are all out.

    Validated by rendering a generated corpus with **afterwriting** (npm,
    `--setting print_title_page=false`) and bisecting for the prefix where it
    flips N→N+1 pages, which is the only place the true length is exactly
    N.00. Worst error over 17 such points was **0.09 pages**; a stitched
    120-page action-heavy script came in 0.89 low. Do not calibrate against
    screenplain: its paginator wastes ~11% of every page (47 rows of content
    spilling out of a 55-line frame), which is a deficiency, not a standard.

    The dual-dialogue trap: two speeches side by side cost the *taller* of
    them, at 0.75 width — counting both stacked overstates by a full page per
    dual-heavy page, which is what the first draft did.
- **The document does not scroll; `.room` does.** This is load-bearing and easy
  to undo by accident. A phone's keyboard shrinks the *visual* viewport and
  leaves the layout viewport alone, then slides the visual one about to keep
  the caret in view — so anything `position: fixed` travels with it. The bar
  wandered for that reason, and once the faded edges were added they wandered
  too (they were a fixed layer then; they are a mask on `.room` now). Pinning harder never works; the frame itself has to hold still, so
  `html, body { overflow: hidden }` and the writing scrolls inside `.room`.

  Assert all four: the document cannot scroll (`scrollY === 0`, `scrollHeight`
  no greater than `clientHeight`), `.room` can, scrolling `.room` leaves the
  `.room` and `.bar` bounding rects **unchanged**, and the writing underneath
  them did move — otherwise the third assertion proves nothing. Note that
  `window.scrollTo` is inert now: test fixtures and screenshot scripts must
  set `room.scrollTop` instead.

- **One thing does watch the keyboard: the fade** (`edgeTop()`,
  `placeEdges()`). Giving the document no scroll stopped the *toolbar*
  wandering but could not stop iOS sliding the visible box inside the layout
  box to hold the caret above the keys — which put the writing under the
  clock. There is no CSS for "the part you can see", so the fade is told:
  `placeEdges()` writes `visualViewport.offsetTop` to `--view-top` on
  `:root`, and the mask's two *top* stops add it.

  **Only the fade.** The toolbar is deliberately left to iOS, which lifts it
  above the keyboard by itself; two attempts to improve on that both made it
  worse. Nothing here may move a control or shift the writing — the worst
  failure allowed is a fade arriving a frame late.

  **Only the *top* stops**, and this is the trap: moving the whole fade to the
  visible box was tried and shipped and was worse — it drags the foot up above
  the keyboard, laying a washed-out stripe across the middle of the writing
  instead of hiding an edge. Down there the keyboard *is* the edge. Assert
  that `--show-bot` contains no reference to `--view-top`, that `.room` never
  acquires an inline style or moves, and that only `--view-top` changes.
  `edgeTop()` is the arithmetic — 0 for no offset, the rounded offset
  otherwise, 0 for sub-pixel noise or a missing number.

- **The bar ignores the soft keyboard, on purpose.** A phone keyboard shrinks
  the visual viewport and leaves the layout viewport alone, so
  `position: fixed; bottom: 0` sits behind it. Two fixes were tried on a real
  phone and both were reverted: lifting the bar above the keyboard from
  `visualViewport` (it stops drifting and starts *hovering*), and hiding the
  bar outright (it leaned on a tap-to-dismiss gesture that didn't reliably
  fire on iOS). The bar now stays where it is and the keyboard covers it.

  **Do not reinvent this.** If you find yourself reaching for `visualViewport`,
  `interactive-widget`, or a scroll listener that repositions the bar, that
  road has been walked twice. Check the absence by hand: `keyboardUp`,
  `placeBar` and `barLift` must all be `undefined`, and a `resize` on
  `visualViewport` must leave the bar's class list, inline style and computed
  `bottom` untouched. The accepted cost is that the toolbar and the running
  total are behind the keyboard while you type, with no way to dismiss it.

- **The faded edges are a `mask-image` on `.room`**, not a layer over it. The
  complaint underneath the whole keyboard saga was writing sharing pixels with
  chrome, and it is answered in paint — but *which* paint matters more than it
  looks.

  The first version was a scrim: an opaque `--bg` band across each edge on a
  fixed `.edges` element. It worked, and it framed the clear-hold water. An
  opaque layer sits between the writing and everything painted after it, and
  what is painted after it is the water, a wash of about a quarter opacity.
  Water over writing is water; water over an opaque band is a dead slab with
  the wave crest cut off flat where the band begins. Fixing *that* took
  `--fade-top`/`--fade-bot` written from JavaScript on every frame of the
  flood to walk the bands out of the tide's way, band heights measured off
  pseudo-elements, and a ramp that is off by one band-height if you write the
  obvious thing.

  Masking deletes all of it. The writing is removed at the edges instead of
  covered, so nothing opaque is left to occlude anything and the water flows
  over the whole screen at every height for free. `.edges`, `stepAside()` and
  the per-frame work are gone. **If either custom property reappears, the
  scrim has come back with it** — check for both by hand.

  Four stops on `:root`, so one declaration serves both edges:
  `--hide-top`/`--show-top`, `--hide-bot`/`--show-bot`. **The foot is on every
  device** — the bar is. **The top is `0px` except under
  `@media (pointer: coarse)`**, because only a phone puts a clock up there;
  a desktop has no top fade to draw. Both `-webkit-mask-image` and
  `mask-image` are set — Safari before 15.4 has only the prefixed one.

  The mask is pure alpha, black and transparent, no palette colour — so a
  theme change cannot make it flash, and the `html.swapping` freeze is now
  very likely inert. It is kept anyway: the flash it fixed was real and
  reported, and one frame without transitions is free.

  What must stay true: the toolbar and the about dialog live **outside**
  `.room` and are never masked — the bar has to stay readable over writing
  fading behind it. Assert the mask in both pointer contexts, the top stops at
  `0px` on a fine pointer, that no `.edges` element exists, and that turning
  the mask off moves no line's `offsetTop`.

  Chromium reports every `env(safe-area-inset-*)` as `0`, so for a picture
  worth judging, restate `--hide-top`/`--show-top` at 59 px and `--foot` at
  34 px — the numbers `probe.html` read off a real iPhone. Scroll the room
  before flooding too: with the page at the top there is no writing under the
  fade to hide, and every version of this looks identical.

  **Not testable here:** whether iOS composites a masked, scrolling
  `contenteditable` smoothly while you type. That needs the phone.

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

## What is and isn't automated

**There is no test suite in this repo, and no build step.** Everything above is
a recipe to be driven by hand — write a throwaway Playwright script in a scratch
dir, per **Drive** at the top, and delete it after. Earlier versions of this
document claimed a suite guarded three of these invariants (the `PROBE_BUILD`
stamp, the absence of `keyboardUp`/`placeBar`/`barLift`, and the absence of
`--fade-top`/`--fade-bot`). It never existed. Nothing here fails on its own; if
you don't check it, it isn't checked.

Adding one would mean a `package.json` and a Playwright dependency in a
repository that is deliberately a folder of static files you can open directly.
That trade hasn't been made. Until it is, treat every "assert" in this document
as an instruction to you, not a description of something already running.

## Reaching an installed PWA

Worth knowing before chasing a phone-only bug that the code looks like it
already fixes: `sw.js` is **cache-first**, so an installed app serves its cached
release and only picks up a new one when `CACHE` changes and the new worker
activates. And GitHub Pages serves the **default branch** — a fix sitting on a
feature branch is not on the phone, however green it is locally.

So when a report and the code disagree, establish *which release the device is
running* before reading another line of the code. That is what `probe.html` is
for, and why `PROBE_BUILD` has to track `CACHE`.
