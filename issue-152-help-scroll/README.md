# Issue #152: Help sheet is clipped and can't scroll at 720 px logical height

Fixed by [fabimc/garia#188](https://github.com/fabimc/garia/pull/188).

## Setup

- verify-garia browser-dev harness: the mock aria2 RPC server and the `src/` frontend in Playwright Chromium.
- Viewport 1256×670, the tiled window size on a 1280×720 logical display from the issue.
- The `in-app` class is added to `<html>` after load. The Tauri webview sets it at boot; browser-dev has no `__TAURI__`, so without it the sheet isn't height-bounded at all.
- **Before:** `src/` from `master` at `deb5a62`, the parent of the merge. **After:** `master` at `e3bfa00`, with PR #188 merged.
- [`journey.mjs`](journey.mjs) follows the issue's reproduction: open Help with Ctrl+Shift+/, press Page Down and End, then Tab from the close button until **Done** is focused, then Escape.

## Results

| Step | Before (`master`) | After (PR #188) |
| --- | --- | --- |
| 1. Ctrl+Shift+/ | Text runs past the sheet's bottom edge (y=650). **Done** is off-screen. Focus lands on the close button. | Sheet ends at y=650 and **Done** is visible. Focus lands on the Help body. |
| 2. Page Down | Nothing scrolls. | Help body scrolls by 448 px. |
| 3. End | Nothing scrolls. "Set up Garia again" is never visible. | Help body scrolls to the bottom (1033 px). "Set up Garia again" is visible. |
| 4. Tab until **Done** | 8 presses. None of the focused links, "Set up Garia again", or **Done** are on screen. | 9 presses: the Help body, 6 Docs links, "Set up Garia again", then **Done**. Every one is on screen when focused. |
| Escape | Closes the sheet. | Closes the sheet. |

The step numbers and names match the files in [`before-master/`](before-master/) and [`after-pr-188/`](after-pr-188/). Each folder has a screenshot per step and a `results.json` with the sheet, body, and button positions for each step, plus the full Tab walk.

`npm test` on the merged `master`: 76/76 pass.
