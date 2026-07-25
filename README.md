# Tanka Time

A quiet room for tanka. WriteRoom inspired full-screen writing with a syllable count in the margin beside every line.

- Counts follow the tanka form: lines that hit their 5-7-5-7-7 target glow
  green; lines that run over turn amber.
- Targets follow line position and re-flow as you edit; an empty line
  keeps its slot and shows a 0. Two blank lines in a row — or one after a
  finished five-line verse — start a new tanka and reset the targets.
- Everything autosaves to the browser (localStorage). No accounts, no cloud.
- `txt` exports the page as a plain-text file; `◐` cycles themes
  (green room → creme paper → dusk).
- `?` (bottom left) opens a short note on the tanka form and why the
  app exists.
- `clear` wipes the page — hold it while the color rises for three
  seconds; letting go early cancels.
- Installable PWA; works fully offline after the first visit.
- Syllables are counted from real pronunciations (the CMU Pronouncing
  Dictionary, shipped as a compact word list) with an English spelling
  heuristic covering words the dictionary doesn't know. Some words have
  no single true count — "fire" is one syllable or two depending on the
  voice — so treat the numbers as a companion, not a judge. The `?` card
  explains.

## Run

Any static file server works, e.g.:

```sh
python3 -m http.server 8471
```

then open <http://localhost:8471>. (Serving over HTTP/HTTPS is required for
the service worker and install prompt; opening `index.html` directly still
works as a plain page.)

## Files

- `index.html`, `style.css`, `app.js` — the whole app, no dependencies
- `count.js` — syllable counting: hand overrides → dictionary → heuristic
- `syllables.json` — generated word list: the CMU dictionary words the
  heuristic would get wrong (don't edit by hand)
- `tools/build-syllables.mjs` — regenerates `syllables.json`; see its
  header comment for where to get the CMU dictionary source
- `sw.js` — offline cache
- `manifest.webmanifest`, `icon.svg`, `icon-*.png`, `apple-touch-icon.png` — PWA install assets

The code is commented as a guided tour — if you're learning to code,
reading `app.js` top to bottom is the intended path.

## Rebuilding the word list

`syllables.json` is derived from the heuristic in `count.js`: it holds
only the words the heuristic miscounts. If the heuristic changes, rerun

```sh
node tools/build-syllables.mjs path/to/cmudict.dict
```
