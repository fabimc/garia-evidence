# PR #181: row menu stays inside a short window

[fabimc/garia#181](https://github.com/fabimc/garia/pull/181) (for [#127](https://github.com/fabimc/garia/issues/127)), at PR head `16f2b9c` after merging master.

Browser-dev with the mock aria2 RPC, driven by `verify-garia`'s `control-garia` (`browser viewport --width 900 --height 300`, Linux copy), keyboard only: focus an active row, press Shift+F10, then End, then Escape.

| File | What it shows |
| --- | --- |
| `before-master.png` | Master before the fix: the menu opens at top -58px, so **Pause** and **Show in folder** are cut off above the window and can't be reached. |
| `after-open.png`, `after-open.aria.txt` | After: the menu opens at top 8px, fits the window, and the first enabled item (Pause) has focus. |
| `after-end.png` | After End: the menu scrolled (`scrollTop` 66), Delete is focused and visible, and the menu stayed open while it scrolled. Escape then returned focus to the row. |

At 1280x800 the menu opens beside the row without scrolling, so the normal-size layout is unchanged.

Not covered here: the native file manager on Omarchy. Folder opening now uses master's `open_folder` command, proven in [`issue-124-open-folder/`](../issue-124-open-folder/).
