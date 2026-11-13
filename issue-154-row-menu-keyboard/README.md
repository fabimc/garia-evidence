# Issue #154: Row context menu can't be opened from the keyboard (Shift+F10 / Menu key)

Fixed by [fabimc/garia#186](https://github.com/fabimc/garia/pull/186).

## Setup

- verify-garia browser-dev harness: the mock aria2 RPC server and the `src/` frontend in Playwright Chromium, viewport 1280×800, `?platform=linux`.
- **Before:** `master` at `eeed365`. **As submitted:** PR #186 with `master` at `eeed365` merged in (`e03a85f`). **After:** that plus the review fix (`a6c87dd`).
- [`journey.mjs`](journey.mjs) follows the issue's reproduction (Completed view, Ctrl+F, Tab, Tab, then Shift+F10 or the Menu key) and goes on to cover menu navigation, plain F10, a multi-selection, running Pause from the menu, and right-click. Each step records focus, whether `#row-menu` is open, its items and position, the selection, and every mutating RPC call.

## Results

| Step | Before (`master`) | As submitted | After (PR #186) |
| --- | --- | --- | --- |
| 2. Shift+F10 | Menu opens through Chromium's own `contextmenu` event, mid-row, with focus left on the row. | Menu opens under the row; first item focused; row selected. | Same as submitted. |
| 3. ArrowDown | Moves the list selection to the next row behind the open menu. | Nothing; focus stays on the first item. | Focus moves to Copy URL. |
| 4. Escape | Menu closes. | Menu closes; focus back on the row. | Same. |
| 5. Menu key | Same as step 2. | Same as step 2. | Same as step 2. |
| 6. Tab | Focus moves to a row button; menu stays open. | Focus moves to Copy URL and the menu stays open. In an exploratory run, tabbing past the last item left focus on `<body>` with the menu still open. | Menu closes; focus back on the row. |
| 7. Plain F10 | Menu stays closed. | Same. | Same. |
| 8. Shift+F10 on one of two selected rows | Both stay selected. | Same, focus in the menu. | Same. |
| 10. Enter on Pause | Can't be reached; focus is on the row. | `aria2.pause` runs; focus drops to `<body>`. | `aria2.pause` runs; focus stays on the paused row. |
| 11. Right-click an unselected row | Menu at the pointer; row selected. | Same. | Same. |

The step numbers and names match the files in [`before-master/`](before-master/), [`pr-186-as-submitted/`](pr-186-as-submitted/), and [`after-pr-186/`](after-pr-186/). Each folder has a screenshot per step and a `results.json` with the full state per step.

**Browser-dev can't reproduce the bug itself.** Chromium turns Shift+F10 and the Menu key into a `contextmenu` event, so `master` opens the menu in this harness. WebKitGTK under Hyprland doesn't, which is the failure the issue reports. The keyboard path the PR adds is what runs in the "after" column (focus lands in the menu and the menu sits under the row, neither of which the `contextmenu` path does). The native WebKitGTK app was not exercised here: the desktop session was locked during this run.

## Other checks

- `npm test` on the merged branch: 76/76 pass.
- `node --test .agent/skills/verify-garia/helpers/keyboard-activation.test.mjs` (the row-control regression test from #187) passes on the merged branch.
