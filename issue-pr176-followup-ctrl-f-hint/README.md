# Status bar search hint shows Ctrl+F on Linux

Follow-up to [fabimc/garia#176](https://github.com/fabimc/garia/pull/176). The status bar said `⌘F search`, the last macOS glyph in the Linux-only UI. It now says `Ctrl+F search`, matching `modGlyph()`.

Browser-dev (mock aria2, `?platform=linux`): the hint reads `Ctrl+F search`, and pressing Ctrl+F focuses "Search downloads…".

![Status bar with Ctrl+F hint](statusbar-ctrl-f.png)
