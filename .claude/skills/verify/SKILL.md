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

  **Bump `CACHE` for any change to a shipped file, including a probe-only
  one.** Shipping `probe.html` on its own without a bump was tried and was a
  mistake: the change was live and correct, and the stamp still read the old
  release, so there was no way to tell the new probe from the old one — which
  is the exact doubt this whole apparatus exists to remove. The number is the
  only handle anyone has on "did it land"; a release that doesn't move it is
  invisible to the instrument built to see it. iOS gives an installed PWA its
  own storage partition, so the probe opened in Safari comes from the network
  and is fresh regardless — but "fresh" and "identifiable" are not the same
  thing, and only the second one settles an argument.
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
  replacing the element during a rise: replacing it restarts that ease at every
  step. (Which mutation each *event* wants is its own long story — see the
  manifest entry near the end.)

  **`floodChrome()` writes two things in a browser tab**, from the one hex: the
  meta, and `--screen`. Safari does not read the tag live and does read the
  document background, so the second write is the one its bars actually follow.
  In the installed app it writes only the meta and leaves `--screen` to
  `floodBand()`. Both halves are load-bearing; see the `--screen` entry below.

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
- **An installed iOS app clips elements to a viewport shorter than the screen,
  and that is the dry strip at the foot of the water.** This cost four
  releases, three of them aimed at the wrong thing, so the shape of the
  evidence matters more than the fix.

  With `apple-mobile-web-app-status-bar-style: black-translucent` (present
  since the first commit), iOS gives a standalone window a layout viewport of
  screen minus the status bar and moves it up under the clock. On a 390×844
  phone: `innerHeight` 797, `screen.height` 844, `env(safe-area-inset-top)`
  47px — and the missing 47 land at the *foot* of the screen. **Elements are
  clipped to that viewport.** The flood canvas measured 831 tall (`100%` plus a
  34px overdraw) and still stopped painting at 797.

  Two things identify it, and neither is the canvas:
  - The about dialog's `::backdrop` covers the viewport *by definition* and is
    cut on the same line as the water. Two unrelated full-viewport mechanisms
    stopping together is the viewport, not either mechanism.
  - The same window in **Safari** reports `innerHeight` 844 and every fixed box
    reaches the bottom, including a bare `height: 100%`. Standalone and Safari
    are different windows; a probe run in one says nothing about the other.

  **So no paint fixes this — none.** Every height rule was driven (`100%`,
  `100% + env(...)`, `vh`, `dvh`, `lvh`, bottom-anchored, a stretched div, a
  canvas inside a stretched div) and all nine reached `screen.height` in
  Safari, which is exactly why testing there was worthless. Then the root's
  own `background-color` — the lowest-level paint a page has, the one that
  covers the whole canvas rather than the root's box — was pointed at the
  strip (v59) and *that* failed on the device too. That failure is the
  identification: the strip is not part of the page at all. The web view
  itself is 47px short and shifted up under the clock; the strip below it
  belongs to iOS.

  **The constraint, and it is not negotiable.** iOS gives a standalone page
  **797px of an 844 screen** and never more. `black-translucent` positions that
  box at the top, under the clock, leaving a 47px band at the **foot**; every
  opaque style (`black`, `default`) positions it below the clock, leaving the
  band at the **top**. The page paints one band and iOS paints the other —
  there is no configuration that gets both, and v53–v59 exist because that was
  not understood. Stop looking for one.

  **Which band to keep is a design choice, and it is made.** `black-translucent`:
  the writing and the water really run under the clock, and the band iOS keeps
  is at the foot where **iOS paints it from the document's background colour**
  — cream under the paper theme, measured on-device at v55. `black`/`default`
  shipped as v60/v61 to prove the opposite geometry and did (`covers viewport`,
  `sa-top 0px`, water to the true bottom) — but iOS painted the clock band
  black regardless of theme, which is the worse half to lose.

  **So the frames are separated** (v64). Two custom properties, two jobs:
  - `--bg` is the **page**: the paper the writing sits on. `.base` paints it —
    a fixed, unmasked, viewport-sized layer under the writing. Changes with the
    theme only.
  - `--screen` is the **band iOS owns**. `html` and `body` carry it and nothing
    else does; both sit behind `.base` inside the viewport, so moving it is
    invisible to the page and visible only in the band. `floodChrome()` drives
    it with the tide.

  Flat in the band rather than waves, and flat is correct: the water is at full
  tide by the time it reaches the bottom of the screen, so a solid band of the
  flooded colour is what the crests above resolve to anyway.

  **Do not model where the water is. Take the water's own bottom row.** Two
  models shipped and both left a seam:
  - v64 ramped the band off the whole-screen `cover`, so it faded across all
    three seconds — reported, correctly, as the wash not beginning at the very
    bottom of the screen.
  - v65 ramped it off the surface's distance below the page. Closer, still
    wrong: the surface enters the band ~70 ms in and does not reach the
    canvas's last row until ~210 ms, so for that window a tinted band sat
    under a dry page. A full hold floods over it unseen; **a short press
    releases inside it** and the seam then holds for the whole 700 ms fall,
    which is how it was found.

  v67 has no model. Each layer counts what fraction of the canvas's last row it
  covered while being drawn — free, inside the loop that was already walking the
  surface — and those compose exactly the way the layers do
  (`1 - Π(1 - alpha·cover)`). The band cannot disagree with the water because it
  comes from the numbers that drew it. Quantised to 16 steps and, unlike the
  chrome, **deliberately not time-throttled**: the whole arrival is a couple of
  hundred milliseconds and a throttle there is what puts the lag back.

  With no model, the band needs no height, so `env(safe-area-inset-top)` is no
  longer load-bearing for colour — but `/version` still reports the **layout**
  viewport rather than `innerHeight`, because a soft keyboard shrinks
  `innerHeight` to the visual viewport (675 against a clientHeight of 797 on the
  reading that made this plain) and the band has nothing to do with the
  keyboard. The readout flags `(keyboard)` when the two disagree.

  **`--screen` has two drivers, and which one writes it is the whole story.**
  Both a tab and the installed app need the channel moved; they need *different
  numbers* in it, and three releases were spent learning that the hard way.

  - **Standalone: `floodBand()`, off the canvas's last row.** The band is a
    standalone artefact — the status-bar height that black-translucent pushed
    off the bottom of the web view — and it must be the water's own bottom
    edge, per everything above.
  - **A tab: `floodChrome()`, off the whole-screen `cover`.** Safari's own bars
    sit outside the viewport at both ends and want the page's average, not its
    last row. `floodChrome` already computes exactly that colour for
    `theme-color`, so it writes the same hex into `--screen` when `!inApp` —
    one number, two roads.

  `floodBand()` is gated on `navigator.standalone || (display-mode: standalone)`;
  prefer `navigator.standalone` first, since the media query has answered "no"
  from inside an installed app before (see the probe's own note).

  **Two reports, one after the other, and the second is the trap.** From v64 to
  v67 `floodBand` ran in a tab too, so Safari's bars wore the colour of the
  water's *bottom row* while the page around them was barely wet — right
  channel, wrong number. Gating it (v68/v69) fixed the colour and stopped the
  bars following *at all*, because `theme-color` on its own cannot move them
  live (see the manifest note below) — the channel was the only thing that ever
  had. So do not "simplify" this back to a single writer, in either direction:
  turning the channel off in a tab kills the live follow, and letting the band's
  number reach a tab brings the bottom-row colour back.

  **Which means every band test needs `addInitScript` to claim standalone**:
  `Object.defineProperty(navigator, 'standalone', { get: () => true })` before
  `goto`. Chromium is a tab, so without it `floodBand` correctly returns early
  and five suites fail at once for the right reason — the tests lost their
  premise, not the code. **And every hold needs text on the page**: `startHold()`
  bails on `!getText().trim()`, so a suite that presses `#clear` on an empty
  draft measures a canvas that never sized itself off 300x150 and passes every
  colour assertion by comparing two theme colours.

  Assert the tab case in the same run, and assert it against the *previous*
  tree: `body` and `html` walk eleven distinct values through a hold and equal
  `theme-color`'s hex at every single sample, while `.base` never moves; on the
  v69 tree the same hold gives `body` exactly one value, which is the reported
  regression reproduced. In standalone, assert the opposite — `body` and the
  meta stay tens of steps apart (44/255 at full tide), which is what proves
  `floodChrome` is keeping its hands off the band.

  **Composite before you average, not after.** `getImageData` is
  *un-premultiplied*, so averaging the row's RGB and its alpha separately and
  compositing the two means is not the colour anyone sees — it read 617/255 off
  a build whose real gap was 2/255. Composite each pixel over `--bg` first, then
  average.

  **Test it against press length, and against the previous release.** Sample the
  canvas's real last row (averaged across x, composited over `--bg`) against
  `getComputedStyle(body).backgroundColor` every frame, for presses of ~150 ms,
  300 ms, 900 ms and a full hold. v67 holds ≤3/255 at every length; the v66 tree
  gives 26-43/255 on the short ones. Serve the previous tree from
  `git archive HEAD` on another port for the contrast — a test that only sees
  the current build cannot tell you the seam is gone.

  **`dryChrome()` is the only path that ends a flood.** It resets both step
  counters, restores `theme-color`, and *removes* the `--screen` override
  (removing, not resetting, so `var(--bg)` governs again and the dialog rule can
  still win). The edit that rewrote `floodBand` deleted it: `stop()` then threw
  on every release, the water cleared and nothing else did, and `--screen` froze
  on whatever theme was live — which outranks `var(--bg)`, so themes stopped
  changing too. Four suites caught it at once. If several unrelated colour
  assertions fail together, look here first.

  **Never let the channel ease.** `body` shipped with
  `transition: background-color .25s ease` from long before any of this, to
  soften a theme swap. The moment body became the channel that ease turned into
  a quarter-second of lag on the band: `floodBand()` steps in ~190ms and
  `FALL_MS` is 700, so on release the water drained and the band stayed lit —
  a solid bar along the foot, reported and real. The palette ease belongs to
  `.base`, the layer a theme swap is actually seen on, where it cannot lag
  anything. Body keeps the `color` ease for the ink.

  **Test the rendered colour, not the property.** The property was correct the
  whole time this bug was visible; the *transition* was the bug, so any
  assertion reading `--screen` or the inline style passes straight through it.
  Composite the canvas's last row over `--bg` and compare it against
  `getComputedStyle(body).backgroundColor` through the fall — the fix holds a
  gap of 1/255, the old rule 39/255. Keep a contrast case that restores the
  transition: a test that only ever sees the fixed rule cannot tell you it is
  fixed.

  **The card's `::backdrop` cannot reach the band either** — same boundary, and
  that is how the band was identified in the first place. So
  `html:has(dialog[open])` dims `--screen` to `--screen-dim`, `--bg` at 45%,
  the light the backdrop leaves. Otherwise the card opens over a dimmed screen
  with a bright strip along the foot. **Write `--screen-dim` out per theme; do
  not reach for `color-mix()`.** It is Safari 16.2+, it serialises to `oklab()`,
  and a custom property holding a function the engine cannot parse stays
  invalid at computed-value time — which takes `background: var(--screen)` down
  with it and blanks the band outright. A hex cannot fail.

  Two things this refactor removed, both cargo:
  - `.room` had a background for exactly one release (v63). **The mask fades
    whatever `.room` is given**, so the moment the flood made that colour differ
    from body's it laid a visible seam across both edges. The mask is for the
    writing; the page is `.base`.
  - `.flood` is plain `height: 100%` again. **Paint clips to the viewport
    whatever the box says**, so the `env()` sums and `max()` overdraws stacked
    up across v54–v59 were buying nothing. `/version` still prints the box, and
    `covers viewport` is the only verdict that means anything.

  Assert: at rest `html`, `body` and `.base` all compute to the theme and
  `.room` paints nothing; at full flood `--screen` equals the meta's flooded
  value with `html`/`body` following and `.base` untouched; `removeProperty` on
  stop rather than an overwrite; a theme switch lands on both; and the canvas
  has ink in its first and last row.

- **The manifest must declare no `theme_color`.** Safari tints its own toolbar
  from `theme-color`, and `manifest.webmanifest` deliberately leaves the field
  out: a manifest is fetched *after* the document parses, and once Safari has
  one it stops listening to the meta tag. The symptom is precise and worth
  recognising, because it sends you looking in the wrong place — the chrome
  takes whatever colour the app *loaded* on and holds it through every theme
  switch, then updates on reload and sticks again. That reads exactly like "the
  meta isn't being re-read", and it is not: the meta is fine.

  Removing that field is necessary and, it turns out, **not sufficient — and
  the note that used to sit here was wrong about why.** It claimed rewriting
  `.content` "was checked directly on a phone with probe.html rather than
  assumed". It was checked there, but the probe reports `manifest linked: no`
  unless its own toggle is on, and **the app always links one**. So the check
  ran in a state the app never occupies. Reported symptom, later: Safari's bars
  follow on a manual reload and never in between — a tint read once at parse and
  then ignored, which is what having a manifest at all appears to cause.

  **So the two mutations are not interchangeable, and each event wants a
  different one.** Rewriting `.content` is the light touch; replacing the
  element is the one mutation every engine is obliged to see. `setThemeColor()`
  takes a `fresh` flag:
  - **The flood rewrites.** It writes ten times as the tide rises, and replacing
    the element each time restarts the browser's ease at every step so the tint
    never settles.
  - **A theme switch replaces**, and so does `dryChrome()` at the end of a
    fall. Both are single deliberate events with no ease worth protecting, and
    both are the moments Safari was ignoring.

  **The reported event is a theme switch, and v50 did it right — with the same
  mutation and the same manifest that are in the tree today.** This is the
  finding that should end the guessing, so read it before writing any code:

  - `c3ce34a` (v50) removed `theme_color` from the manifest, shipped a
    `setThemeColor()` that **always replaced** the element, and was verified on
    the phone: the chrome followed the theme. That release is the last known
    good.
  - `manifest.webmanifest` is **byte-identical** between v50 and now. It still
    declares `background_color` and still declares no `theme_color`.
  - `applyTheme()` today calls `setThemeColor(hex, true)`, which replaces the
    element — the *same mutation v50 shipped*.
  - The `<meta name="theme-color">` tag and the rest of `<head>` are unchanged
    between the two.

  So the mutation is not the variable and the manifest is not the variable, and
  v69's theory — "a manifest is linked, therefore Safari reads the tag once" —
  **is contradicted by v50's own on-phone result**. Whatever broke the theme
  switch is in `app.js` or `style.css`, in something that changed after v50:
  `.base` arriving as an opaque fixed layer, `html`/`body` moving from
  `var(--bg)` to `var(--screen)`, `.edges` becoming a mask, or the transitions
  moving off `body`. Do not re-litigate the meta.

  **Watch particularly for a frozen `--screen`.** It is set as an *inline*
  property on `documentElement` and inline beats every stylesheet rule, so if a
  flood ever ends without `dryChrome()` the channel keeps a literal hex and
  `html`/`body` stop following the theme entirely. That has happened once
  already and is documented above; it is also the shape of failure that would
  look exactly like "the chrome stopped following a theme switch".

  **v70 tried the document's background colour, and the phone said no.** The
  reasoning was sound and the result was negative: `floodChrome()` writes the
  flooded hex into `--screen` in a tab, `body` and `html` demonstrably walk
  eleven values through a hold in Chromium — and on the device Safari's bars
  still do not follow the tide. Everything else in that release was reported
  correct (water, band, themes, the theme switch), so this is not a release
  that failed to land; it is a channel that does not work.

  So **both roads are now known dead in a tab under the app's own conditions**:
  the meta rewrite (v69's finding) and the document's background colour (v70's).
  Do not ship a third guess. What is still unseparated, and what `probe.html`
  now exists to separate:

  - **Does Safari sample rendered pixels rather than reading a colour?** If it
    does, `.base` — opaque, fixed, `inset: 0` — stands in front of `--screen`
    permanently, no amount of writing that property can reach the bars, and the
    v64-v67 "bars wore the water's bottom row" report was the *canvas's own
    pixels* being sampled at the foot rather than anything `--screen` did.
    That reading fits every symptom so far and would mean the whole `--screen`
    channel is the wrong instrument for a tab.
  - **Does linking a manifest freeze the tint outright**, colour or no colour?
    The app's manifest declares no `theme_color`; the probe's only manifest
    declared a loud red, so "a manifest is linked" and "the manifest names a
    colour" were never separated.
  - **Did the bars ever actually follow the tide live?** "The way they had since
    v52" is an inference written down as history, and nothing in this file
    records anyone watching that happen. Worth asking outright before spending
    another release restoring it.

  **MEASURED ON THE DEVICE, and it overturns this whole entry. Read this
  before anything else here.** Three readings from `probe.html`, all under the
  app's own conditions (the app's manifest linked, document locked):

  | test | what moved | Safari's bars |
  |---|---|---|
  | 1 | only the `theme-color` tag | **did not follow** |
  | 2 | only the page's background colour, no tag at all | **followed** |
  | 3 | both, plus an opaque fixed layer over the background | **followed** |

  So on this phone, with a manifest linked:

  - **`theme-color` does nothing at all.** Not "is read once at parse", not
    "needs a replace rather than a rewrite" — nothing. Test 1 replaced the
    element on every cycle and the bars never moved. Every release from v52 on
    that reasoned about which *mutation* the tag wants was reasoning about a
    lever that is not connected.
  - **The document's background colour is the channel, and it is live.**
  - **An opaque fixed layer over it does not block it** (test 3 followed the
    cycling background, not the constant violet pane). So Safari reads the
    document's background *colour*, not sampled pixels, and `.base` standing
    over `html` costs nothing.

  Which means `floodChrome()`'s `--screen` write — v70 — is the right
  mechanism after all, and `setThemeColor()` is decorative on iOS and load
  bearing only for engines that honour the tag. Keep it; do not reason from it.

  **The reading that survived all of that, and the one difference still
  standing.** The app moves the page colour on every theme switch — measured
  here, `room #0a0c0a / paper #f6f1e3 / dusk #171321`, on `html`, `body` and
  `.base` alike — and on the phone the bars do not follow it until a manual
  reload. Under the table above that should be impossible. What is left is
  *how* the colour moves:

  - `probe.html` has always written `root.style.background = hex` — **one
    inline property, a literal colour**.
  - The app never does that. `html { background: var(--screen) }`, `--screen`
    resolves through `--bg`, `--bg` is redeclared per theme, and the theme
    changes by **setting an attribute on `<html>`**.

  Same computed colour, a completely different route to it, and nothing in the
  probe could tell the two apart. **Test 4 is that comparison**: test 2's shape
  exactly (no tag, only the page colour moving) with the colour moved the app's
  way instead. Test 2 following and test 4 not following localises the bug to
  the route, and the fix is then to write the colour where WebKit will notice
  it rather than to keep reasoning about which element holds it.

  **And an instrument that does not re-measure is worse than none.** `/version`
  shipped reporting `page` and `tag` — and `setRelease()` only runs from
  `refresh()`, which a theme switch is not. The one screenshot taken to answer
  "does the page colour move?" showed `theme paper` over a page that was
  plainly not paper, because the readout was written before the tap and never
  rewritten. `applyTheme()` calls `refreshRelease()` now. Anything else that
  moves what `geometry()` measures must do the same.

  **Cleared on the device, under the app's own conditions:** replacing the
  element, the app's manifest, a locked document and an opaque fixed layer over
  the background. The probe was set to all four at once and Safari's bars
  followed the cycle. So none of those is the blocker — which also means the
  device is not simply refusing to move its bars, and the remaining difference
  is something the app has and the probe does not.

  **But that reading moved the tag and the page colour together, so it does not
  say which one Safari read.** That confound is the single reason this page has
  produced so little in so many rounds, and it is now split into three named
  tests rather than a set of toggles a reader has to decode:

  - **test 1 — only the tag moves.** `replace element`, page pinned to one
    colour. Bars follow ⇒ Safari reads `theme-color`.
  - **test 2 — only the page moves.** No meta in the document at all, page
    colour cycling. Bars follow ⇒ Safari reads the page.
  - **test 3 — both, the app's shape.** The control; the bars are known to
    follow here.

  Each writes its state, reloads (a manifest is only read at load), and prints
  in plain words on the page what it is doing and what a following bar means.
  **Ask for a reading in those terms** — "test 1: no, test 2: yes" — not in
  terms of the toggles.

  **The probe reproduces a theme switch in one tap now.** `set every condition
  to the app's` sets `replace element` — the mutation `applyTheme()` makes —
  plus the app's manifest, the locked document and the opaque pane, so pressing
  `cycle` from there is as near as another page can get to tapping the theme
  button. The manifest control is four-way, because "a manifest is linked",
  "it declares a `background_color`" (the app does) and "it declares a
  `theme_color`" (the app doesn't) are three separate variables and only the
  last was ever on offer here.

  **The probe answers the first two now.** `opaque layer over it (violet)` puts
  an opaque fixed layer in a colour that appears in no cycle colour between the
  document background and any sampler, so one press of `cycle` gives three
  distinguishable answers: the bar cycles (it reads the document's background),
  the bar turns violet (it samples pixels), the bar holds still (neither, and
  the manifest is the remaining variable). The manifest control is three-way —
  none / no `theme_color` / red — and `set every condition to the app's` puts
  all of it into the app's exact shape in one tap and reload.

  **Which leaves the tide with no lever on Safari at all, and that is the point
  to hold on to.** A rise is ten rewrites, and a Safari with a manifest linked
  reads none of them — so `theme-color` moves the bars on a theme switch, on
  `dryChrome()`, and never once while the water is climbing. The thing that
  *does* follow live is the document's background colour, which `html` and
  `body` carry as `--screen`; that is why `floodChrome()` writes both, and why
  the tab half of the `--screen` note above is not an optimisation to be tidied
  away. Every "fix the live follow by replacing the element on every step"
  instinct has to answer the ease problem first, and the channel already
  answers it for free.

  **A replace orphans anything holding that node.** `setThemeColor()` re-queries
  on every call for exactly this reason, and so does the probe's `tcMeta()`.
  A MutationObserver bound to the *element* goes deaf the moment it is
  detached — which is how `chrome2` reported `writes=0` after this landed, its
  premise broken rather than the code. Observe `document.head` with `subtree`
  instead.

  Assert per event, not just per value: a theme switch produces a childList
  mutation adding a new `theme-color` node and lands the theme exactly; the rise
  produces several attribute rewrites and **zero** replaces; the fall ends on a
  replace; and there is exactly one meta in `<head>` throughout. Also assert
  `manifest.webmanifest` still has no `theme_color` key at all. In a tab, assert
  the meta and `body` hold the *same* hex at every sample of a rise — the tag is
  for the engines that read it, the channel is for the one that doesn't, and
  they are never allowed to disagree.

  None of this is visible in Chromium, which does not tint anything. Reproduce
  it on a phone with `probe.html`, whose experiment varies each candidate
  independently and links a manifest whose `theme_color` is a red that appears
  nowhere else, so the source being listened to is never in doubt.
  **`/version` reports the channel now, in the app, on the device**, because
  the theory above says the bars follow `page` and the app moves `page` on
  every theme switch — so if the bars still do not follow in the app, the app
  is not doing on the phone what it does here. The last line reads
  `theme <name> page #rrggbb tag #rrggbb`, and **`PINNED`** if `--screen` is
  still set as an inline property on the root at rest. That last flag is the
  failure worth catching: inline beats every stylesheet rule and `dryChrome()`
  is the only thing that removes it, so a `--screen` left behind freezes the
  document's background colour on a literal hex — a theme switch then moves
  the tag, moves `.base`, and cannot move the one channel the chrome reads.
  Assert it appears during a flood and is gone after, and that none of it
  reaches `getText()`.

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
