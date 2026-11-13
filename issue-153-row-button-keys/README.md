# Issue #153: Enter/Space on a row's action buttons is swallowed by the list keyboard handler

Fixed by [fabimc/garia#187](https://github.com/fabimc/garia/pull/187).

## Setup

- verify-garia browser-dev harness: the mock aria2 RPC server and the `src/` frontend in Playwright Chromium, viewport 1280×800.
- **Before:** `src/main.js` from `master` at `e3bfa00`. **After:** PR #187 with `master` at `e3bfa00` merged in.
- [`journey.mjs`](journey.mjs) follows the issue's reproduction. It selects the active "Ubuntu 24.04 Desktop.iso" row, presses Ctrl+F, and Tabs from the search field to a row button. Then it presses Enter or Space and records the inspector, the selected row's status, the notice banner, and every mutating RPC call.
- Show in folder needs Tauri's opener, which browser-dev lacks. Activation shows up as the "Couldn't show in folder" notice, not a file manager window.

## Results

| Step | Before (`master`) | After (PR #187) |
| --- | --- | --- |
| 1. Ctrl+F, Tab to broken-mirror.tar.xz › Retry | Focus ring on Retry (64 presses). | Same. |
| 2. Enter on Retry | The inspector opens on the Ubuntu row. No RPC call is made. | `aria2.addUri` and `aria2.removeDownloadResult` re-queue the download. The inspector stays closed. |
| 3. Tab to half-written.iso › Retry, Space | `aria2.pause`: the selected Ubuntu row pauses. Nothing is retried. | `aria2.addUri` re-queues the download. The Ubuntu row stays active. |
| 4. Tab to annual-report.pdf › Show in folder, Enter | The inspector stays open and no notice appears, so the button never ran. | The button runs and shows the browser-dev "Couldn't show in folder" notice. The inspector stays closed. |
| 5. Space with the Ubuntu row focused | Toggles pause (`aria2.unpause`, since step 3 paused it). | Toggles pause (`aria2.pause`). |
| 6. Enter with the Ubuntu row focused | Opens the inspector. | Opens the inspector. |

The step numbers and names match the files in [`before-master/`](before-master/) and [`after-pr-187/`](after-pr-187/). Each folder has a screenshot per step and a `results.json` with the focused element, inspector state, selection, notice, and RPC calls for each step.

After a retry, focus drops to `<body>` because the failed row is replaced. That happens on `master` too and is not part of this issue.

## Other checks

- `npm test` on the merged branch: 76/76 pass.
- `node --test .agent/skills/verify-garia/helpers/keyboard-activation.test.mjs` (the PR's regression test) passes on the merged branch. With the two-line fix removed from `src/main.js`, it fails with a timeout waiting for the row to pause.
