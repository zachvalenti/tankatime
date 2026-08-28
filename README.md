# Tanka Time

A quiet room for tanka. WriteRoom inspired full-screen writing with a syllable count in the margin beside every line.

- Counts follow the tanka form: lines that hit their 5-7-5-7-7 target glow
  green; lines that run over turn amber.
- Targets follow line position and re-flow as you edit; an empty line
  keeps its slot and shows a 0. Two blank lines in a row — or one after a
  finished five-line verse — start a new tanka and reset the targets.
- Markdown, live as you type. The marks show on the line you're writing —
  dimmed, so nothing shifts under the caret — and step out of the way on
  every other line, so a finished page reads as the poem rather than as its
  notation. A list keeps its bullet and a quote its `>`; those are the shape
  of the line rather than decoration on a word. `# ` (with
  the space — `#hashtag` stays a word) makes a title, which sits outside the
  form: no count in the margin, and the tanka below it starts again at five.
  A blank line beside a title is breathing room, not a slot. `**bold**`,
  `*italic*`, `__underline__`, `> quotes`, `- lists`; ⌘/Ctrl+B, I and U
  toggle the marks on a selection, on the word under the cursor, or on
  nothing at all.
- `/fountain` on the first line turns the room into a screenplay. Once a
  character has spoken, starting their name again offers the rest of it in
  dim type: press Tab to take it, or tap it — a phone keyboard has no Tab
  key, so on a touch screen the suggestion wears a chip and is the target.
  Taking a name writes the name, so a lowercase start still lands a cue,
  which have to shout to be cues at all. `@` in front of a line makes it a
  cue whatever it looks like, and the app shouts that one for you — `@maya`
  is MAYA on the page and in the file, which is the short way to name a
  speaker without hunting for caps lock. The draft keeps your typing, and
  `@ma` completes the same way `MA` does — the mark isn't part of the name,
  so it's matched past and left where you put it. The price is that there
  is no mixed-case cue here: `@McCLANE` exports as `@MCCLANE`.
- In a script the count in the margin gives way to a **page count** —
  `12.40 pages` — because that is the number a screenplay keeps about
  itself, near enough a minute of screen each, the way syllables are the
  number a tanka keeps. It measures the script's own length at the
  standard geometry (Courier, a six-inch column, fifty-five lines to the
  page, cues and parentheticals at their proper widths), with the title
  page and the writer's scaffolding left out. It is not a promise about
  where any one program will break its pages: renderers disagree with
  each other by whole pages over a feature. Against one that fills its
  pages properly it lands within about a tenth of a page on
  dialogue-forward writing, and runs up to a page short on a very long
  action-heavy script, where a renderer loses a little at every break.
- Undo is the app's own, because highlighting as you type rewrites the very
  nodes a browser's undo remembers. A run of typing is one step, ended when
  the typing becomes deleting, when the caret moves elsewhere, when a word
  is finished, or when the typing stops.
- Everything autosaves to the browser (localStorage). No accounts, no cloud.
- `export` saves the page: Markdown if you used any, plain text if you
  didn't — a poem with no marks in it isn't a Markdown file. `◐` cycles
  themes (green room → creme paper → dusk).
- `/import` on the first line points that button the other way: it reads
  `import`, and it takes a `.txt`, `.md`, `.fountain` or `.highland` file
  in place of what is on the page. The file decides the room — a
  screenplay arrives under a `/fountain` line written for it, a poem needs
  no line at all — and either way the word that asked for the import goes
  with the page it replaced, so the button says `export` again the moment
  the file lands. The import is one undo step: ⌘Z gives the old page back.
  Like the other modes it rides with them, so `/fountain /import` is a
  script that can open one.
- A `.highland` is not a text file: it is a zip archive holding the
  screenplay beside a heap of Highland's own JSON — character counts,
  sidebar widths, an entire base64 copy of the last revision. The import
  opens the archive, takes the script out of it and leaves the rest, so
  what lands on the page is the writing and nothing else. Highland's one
  addition to Fountain, a note fenced by `%%`, becomes Fountain's own
  boneyard: the research is kept, struck from the script, and out of the
  page count — the same thing said in a way every other Fountain program
  can read.
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

- `index.html`, `style.css` — the page and its themes
- `app.js` — the editor: decoration, the margin, undo, autosave, export
  and import, the clear-hold flood. The only file with a DOM in it
- `count.js` — syllable counting: hand overrides → dictionary → heuristic
- `simple.js` — the thousand plain words, and how generously to match them
- `modes.js` — what the first line of the page can ask for
- `markdown.js` — the Markdown grammar: what a line is, and where the
  marks fall
- `fountain.js` — the same job for Fountain, the screenplay notation.
  Unlike Markdown it can't read a line without its neighbours, so this
  one reads the whole page in a pass
- `highland.js` — Highland's `.highland` file: a zip with a screenplay
  inside it, and the two characters Highland spells its notes with
- `marks.js` — what ⌘B/I/U/K/\ do to a line of text
- `syllables.json` — generated word list: the CMU dictionary words the
  heuristic would get wrong (don't edit by hand)

Everything but `app.js` is pure strings: give it text, get text back.
None of them knows a page exists, which is why they can be read — and
tested — on their own.
- `tools/build-syllables.mjs` — regenerates `syllables.json`; see its
  header comment for where to get the CMU dictionary source
- `sw.js` — offline cache
- `manifest.webmanifest`, `icon.svg`, `icon-*.png`, `apple-touch-icon.png` — PWA install assets

The code is commented as a guided tour. If you're learning to code, the
intended path is the order `index.html` loads them in — what a word is,
then what a line is, then what the page does with them:

```
count.js → simple.js → modes.js → markdown.js → fountain.js → marks.js → app.js
```

`app.js` is the long one and can be read top to bottom on its own; it
follows the page's life, from grabbing elements to restoring the draft.
The comments explain why a thing is done that way, not what the line
says — the interesting parts are usually the ones that look like they
could be simpler.

## Rebuilding the word list

`syllables.json` is derived from the heuristic in `count.js`: it holds
only the words the heuristic miscounts. If the heuristic changes, rerun

```sh
node tools/build-syllables.mjs path/to/cmudict.dict
```
