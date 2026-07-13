# TankaTime

A minimalist, distraction-free writing app for iPhone, iPad, and Mac —
one shared SwiftUI codebase, no accounts, no proprietary file format.
Every document is a plain `.md`/`.txt` file.

Design inspiration: **WriteRoom**'s commitment to a bare fullscreen page,
**iA Writer**'s typography and focus mode, **Highland**'s respect for
plain text as the source of truth, and **Ulysses**'s calm, single-purpose
chrome.

**Killer feature:** a discreet syllable count in the margin next to every
line, live as you type — built for tanka, haiku, and any writer who
thinks in meter.

## How the syllable gutter works

`Packages/TankaTimeCore/Sources/TankaTimeCore/SyllableCounter.swift` counts
syllables with a vowel-group heuristic (the same approach used by most
lightweight syllable counters), with a short hand-verified exception list
for common words the heuristic gets wrong (`poet`, `idea`, `create`,
`business`, `evening`, ...). It's an estimate, not a dictionary lookup —
English spelling doesn't fully disambiguate diphthongs ("boat") from
hiatus ("po-et"), so edge cases exist. `SyllableCounterTests.swift` has
extensive coverage of both.

The gutter itself is drawn directly with TextKit
(`App/Sources/TankaTime/TextKit/SyllableGutterTextView+iOS.swift` and
`...+macOS.swift`): a small companion view enumerates the text view's
line fragments via `NSLayoutManager`, counts syllables for each line's
text, and draws the number aligned to that exact line, staying in sync
as you scroll and type. This — rather than a SwiftUI `Text` overlay —
is what keeps the numbers pixel-locked to their lines.

## Project layout

```
Packages/TankaTimeCore/     Cross-platform Swift package (no UIKit/AppKit)
  SyllableCounter.swift       the syllable-estimation engine
  TankaDocument.swift         FileDocument for plain-text/Markdown files
  EditorSettings.swift        theme, typeface, layout preferences

App/Sources/TankaTime/      The app target (shared by all three platforms)
  TankaTimeApp.swift           DocumentGroup-based entry point
  Views/EditorView.swift       centered column, toolbar, focus mode
  Views/EditorSettingsView.swift
  TextKit/SyllableGutterTextView+iOS.swift    UITextView + gutter
  TextKit/SyllableGutterTextView+macOS.swift  NSTextView + gutter

project.yml                 XcodeGen config that assembles the .xcodeproj
```

## Opening the project

This repo doesn't check in a generated `.xcodeproj` (those don't diff or
review well). Generate it with [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
brew install xcodegen
cd tankatime
xcodegen generate
open TankaTime.xcodeproj
```

Two schemes are generated: **TankaTime-iOS** (iPhone/iPad) and
**TankaTime-macOS**. Both build from the same `App/Sources/TankaTime`
directory and the same `TankaTimeCore` package.

## Current state / known limitations

This was scaffolded in a Linux sandbox with no Swift toolchain available,
so **none of this code has been compiled or run** — there was no `swiftc`,
Xcode, or simulator to verify against. The syllable-counting logic in
`SyllableCounter.swift` has been hand-traced against ~50 test words (see
the test file), but the SwiftUI/UIKit/AppKit code has only been reviewed,
not built. Treat this as a from-scratch draft to open in Xcode, fix any
compiler errors, and run on a simulator/device before trusting it.

Known gaps for a v2:
- Focus mode currently only hides/shows the toolbar chrome (WriteRoom-style).
  iA Writer-style per-sentence/paragraph dimming would need the gutter's
  text view to report cursor position back to SwiftUI and re-color text
  ranges — not yet implemented.
- No iCloud/document syncing beyond whatever `DocumentGroup` + the Files
  app provide by default.
- No syntax highlighting for Markdown emphasis (bold/italic/headings).
- The syllable gutter recomputes all line fragments on every redraw
  rather than caching — fine for typical documents, would want
  incremental updates for very long ones.
