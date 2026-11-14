# Issue #157: "Clear completed" confirmation text is garbled

Fixed by [fabimc/garia#168](https://github.com/fabimc/garia/pull/168).

## Setup

- The verify-garia browser-dev harness: the mock aria2 JSON-RPC (`mock-rpc.js`) on `127.0.0.1:6800` and the `src/` frontend served over HTTP, driven in headless Chromium at 1280×800. The fix only changes dialog text in the frontend, so the mock is a faithful boundary here.
- **Before:** `master` at `ab7a938`. **After:** PR #168 with `master` at `ab7a938` merged in (`30d5279`).
- [`journey.mjs`](journey.mjs) uses the toolbar buttons a user would click. It opens **Clear completed** and **Clear failed** with several entries and with one entry, confirms **Remove** once, and opens an ordinary row **Delete** for comparison. To get the one-entry cases, it purges the other finished or failed results through RPC before clicking. It records the dialog title, body text, button label, whether the Trash option shows, the visible rows, and every mutating RPC call.

## Results

| Step | Before (`master`) | After (PR #168) |
| --- | --- | --- |
| 1. Completed view, Clear completed (4 entries) | "Remove **4 finished downloads leave the list. The files stay on disk.** from the list?" | "Remove **4 downloads** from the list?" then "The files stay on disk." |
| 2. Completed view, Clear completed (1 entry) | "Remove **annual-report.pdf leaves the list. The file stays on disk.** from the list?" | "Remove **annual-report.pdf** from the list?" then "The file stays on disk." |
| 3. Remove | One `aria2.removeDownloadResult` call. The Completed view is empty. | Same. |
| 4. Failed view, Clear failed (6 entries) | "Remove **6 failed downloads leave the list. The files stay on disk.** from the list?" | "Remove **6 downloads** from the list?" then "The files stay on disk." |
| 5. Failed view, Clear failed (1 entry) | "Remove **broken-mirror.tar.xz leaves the list. The file stays on disk.** from the list?" | "Remove **broken-mirror.tar.xz** from the list?" then "The file stays on disk." |
| 6. All Downloads, row Delete on an active download | "Remove Ubuntu 24.04 Desktop.iso from the list?" with the Trash option and a **Delete** button. | Same. The keep-files line stays hidden. |

The step numbers match the files in [`before-master/`](before-master/) and [`after-pr-168/`](after-pr-168/). Each folder has a screenshot per step and a `results.json` with the dialog, rows, and RPC calls for each step.

## Other checks

- `npm test` on the merged branch: 80/80 pass. That includes the PR's test for both clear actions with one and several entries, and for ordinary deletion.
- Bugbot review of the PR: no bugs found.
- Not covered here: the tray and Download menu entry points for Clear Completed are native-only. They call the same function as the toolbar button.
