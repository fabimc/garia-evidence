# Issue #158: Paused row keeps showing its last download speed

Fixed by [fabimc/garia#172](https://github.com/fabimc/garia/pull/172).

## Setup

- The verify-garia browser-dev harness: the `src/` frontend served over HTTP and driven in headless Chromium at 1400×820, against the mock aria2 JSON-RPC on `127.0.0.1:6800`.
- The stock mock zeros a paused row's `downloadSpeed` in `tellWaiting`, so it can't show the bug. Real aria2 can still report the last speed for a moment after a pause. [`mock-stale.patch`](mock-stale.patch) is a one-line change to a scratch copy of `mock-rpc.js` that keeps the speed on paused rows. Every run here uses that copy. The copy's `tellStatus` already returned the stale speed for the torrent row, which is what the inspector reads.
- **Before:** `master` at `da0eff9`. **As submitted:** PR head `32dc105`. **After:** PR #172 with `master` merged in and the review fixes (`838a4b0`).
- [`journey.cjs`](journey.cjs) restarts the mock for each run. It optionally selects **Ubuntu 24.04 Desktop.iso** to open the inspector, clicks the row's Pause button, waits 3.5 s, and then reads the row's status, its Speed cell, and the inspector's Speed fact.

## Results

| Step | Before (`master`) | PR as submitted | After (PR #172 + review fixes) |
| --- | --- | --- | --- |
| 1. Wide list, pause Ubuntu: Speed column | "19% · Paused" with **4.2 MB/s** | — | — |
| 2. Inspector open, pause Ubuntu: Speed fact | **4.2 MB/s** | **4.2 MB/s** (still stale) | — |

Active rows still show their speed, and the seeding row still shows its upload speed (↑ 1.4 MB/s). See `1-list-paused.png`.

Each folder has the screenshots and a `results.json` with the before and after readings. The as-submitted run has only `results.json`. Its screenshots came from the PR's old base and had an unrelated broken grid, which went away once `master` was merged in.

## Review fixes pushed to the PR

- The inspector's Speed fact (`factValues`) now uses `rowDownloadSpeed`, so it clears on pause like the list.
- `rowDownloadSpeed` always returns a number, never aria2's raw string.
- The parity imports are back in alphabetical order.
- The verify-garia `pause-resume` journey now checks for no stale speed.

## Other checks

- `npm test` on the merged branch: 81/81 pass.
- Not covered: the native Tauri app. Its pause goes through the same row-render and inspector code.
