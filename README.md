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
- Syllables are counted with an English heuristic — treat the numbers as a
  companion, not a judge.

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
- `sw.js` — offline cache
- `manifest.webmanifest`, `icon.svg`, `icon-*.png`, `apple-touch-icon.png` — PWA install assets
