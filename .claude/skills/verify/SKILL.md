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

- Start each run with `page.evaluate(() => localStorage.clear())` + reload;
  the doc autosaves and leaks between runs otherwise.
- `page.click('.page')` focuses the editor; type with `page.keyboard`.
- Gutter state: `page.$$eval('#gutter span', els => els.map(s => s.textContent + ':' + s.dataset.state))`
  — states are `hit` / `over` / `under` / `free`.
- Clear-hold: `page.mouse.down()` over `#clear`, wait, sample, `mouse.up()`.
  Full hold is 3 s (`HOLD_MS`). Wave churn state:
  `flood.getAnimations({subtree:true})` playbackRates + computed `--amp`.

## Flows worth driving

- Syllable gutter: type lines, check counts/targets (5-7-5-7-7 by line
  position; lone blank line = 0 placeholder; double blank or blank after a
  finished verse = separator that resets targets).
- Clear hold: early release cancels and keeps text; 3 s hold clears.
- Reload after a 500 ms pause to check the debounced localStorage save.
