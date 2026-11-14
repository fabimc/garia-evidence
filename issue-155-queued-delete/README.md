# Issue #155: Deleting a never-started queued download shows a false "GID is not found" error

Fixed by [fabimc/garia#185](https://github.com/fabimc/garia/pull/185).

## Setup

- A real aria2c 1.37.0 (Garia's built sidecar), not the mock RPC. The mock answers `removeDownloadResult` with a different error than aria2 does, so it cannot reproduce this issue. Each run starts a fresh aria2c on `127.0.0.1:6800` with an empty temporary download folder and no session.
- The `src/` frontend is served over HTTP and driven in headless Chromium at 1280×800, the same way the verify-garia browser-dev harness does it.
- **Before:** `src/` from `master` at `20c76b1`. **After:** PR #185 with `master` at `20c76b1` merged in (`fc32cf8`).
- [`journey.mjs`](journey.mjs) follows the issue's reproduction. It adds `https://proof.ovh.net/files/1Mb.dat` with **Add to queue**, selects the row, and presses Ctrl+Delete, then Tab and Enter on **Delete**. It records the rows, the notice banner, every mutating RPC call, and aria2's active, waiting, and stopped lists after each step.

## Results

| Step | Before (`master`) | After (PR #185) |
| --- | --- | --- |
| 1. Add download, URL entered, Add to queue selected | Dialog open. aria2 is empty. | Same. |
| 2. Add to queue | `aria2.addUri` with `pause: "true"`. One row, "paused", in aria2's waiting list. | Same. |
| 3. Select the row, Ctrl+Delete | The Delete download sheet opens with focus on Cancel. | Same. |
| 4. Tab to Delete, Enter | `aria2.remove`, then three `aria2.removeDownloadResult` calls. The row leaves the list and aria2's lists are all empty. The banner says **"Couldn't delete 1 of 1 downloads: GID 3e03bc2ec51655d4 is not found"**. | The same RPC calls, and the row leaves both the list and aria2. **No banner.** |

The step numbers match the files in [`before-master/`](before-master/) and [`after-pr-185/`](after-pr-185/). Each folder has a screenshot per step and a `results.json` with the rows, notice, RPC calls, and aria2 state for each step.

## What aria2 answers

Each folder's `aria2-probe.json` asks aria2 directly, without Garia. It adds a paused download, then calls `aria2.remove` and `aria2.removeDownloadResult`. `remove` succeeds, and the paused download is not filed as a stopped result. `removeDownloadResult` then fails with `GID <gid> is not found` and all three lists are empty. This confirms the issue's hypothesis, and it is the exact message the PR accepts after a successful removal.

## Other checks

- `npm test` on the merged branch: 78/78 pass. That includes the PR's two `purgeFailures` tests: a missing result is accepted only on the final attempt and only for a gid whose `aria2.remove` succeeded, and other errors still count as failures in mixed batches.
- Bugbot review of the PR: no bugs found.
