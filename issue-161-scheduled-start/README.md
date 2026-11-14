# Issue #161: Download added with "Start at a time" never starts

Fixed by [fabimc/garia#169](https://github.com/fabimc/garia/pull/169).

## Setup

- A real aria2c 1.37.0, built from the pinned source by `scripts/build-aria2-sidecar.sh`. The mock RPC can't reproduce this issue: the cause is that aria2 refuses `forcePause` on a download that is already paused (HTTP 400, `cannot be paused now`). One deviation: on this Arch host the script's portability check rejects the build because the system OpenSSL links brotli and zstd. So the binary came from the same script with only that check skipped. Portability doesn't matter for a local run.
- **Before:** master's hold logic (hold only if `forcePause` succeeds). **After:** PR #169 with `master` at `88ddf03` merged in (`61e5cb3`). The PR changes only `src-tauri/src/lib.rs`, so both runs use the same `src/` frontend.
- **Why not the native window:** the desktop session was locked, and no nested or headless compositor was available, so a native Tauri window could not be driven. Instead, the frontend ran in headless Chromium at 1280×800 with `window.__TAURI__.core.invoke` routed to a small bridge ([`harness/live_verify.rs`](harness/live_verify.rs), `live_bridge`). The bridge is compiled inside Garia's lib crate, so it calls the real code:
  - `aria2_rpc` goes straight to aria2c through Garia's `aria2_request`.
  - `set_download_start` runs the same steps as `set_download_start_blocking`: `Schedule::set_start`, then either master's hold or the PR's `hold_for_start`.
  - A loop runs once a second and applies `schedule::allowed` and `schedule::decide` the way `schedule_tick` does: unpause, release, and drop the spent start time.

  This stands in for `schedule_tick` itself, which needs a running Tauri app. Everything else is real.
- [`harness/journey.mjs`](harness/journey.mjs) follows the issue's steps. It enters a URL, opens Options, ticks **Start at a time** and sets it 40 s ahead, then clicks Download. The file server logs every request, so the claim that nothing was fetched before the start time is measured. [`harness/run.sh`](harness/run.sh)` before|after <dir>` runs one mode.
- The status bar's "aria2 · 127.0.0.1:6800" is the default port from the settings Garia was given. The bridge's aria2c actually listened on 6810.

## Results

| Step | Before (master) | After (PR #169) |
| --- | --- | --- |
| 1. Add dialog, Start at a time set 40 s ahead | Same dialog | Same dialog |
| 2. Right after Download | Row says **"0% · Paused"**. `schedule.json` has the gid in `starts` but `"held": []`. The `forcePause` call got HTTP 400. | Row says **"Scheduled"**. `schedule.json` has the gid in `starts` and in `held`. `forcePause` got HTTP 400, then `tellStatus` returned `paused`. |
| 3. About 5 s before the start time | "0% · Paused". No requests to the file server. | "Scheduled". No requests to the file server. |
| 4. About 8 s after the start time | **Still "0% · Paused"**. `schedule.json` is `{"starts": {}, "held": []}` and the start time is used up. No request ever reached the server, and the downloads folder is empty. | **"Done", 8.0 MB.** The first GET arrived exactly at the start time. `schedule.json` is `{"starts": {}, "held": []}`. |

The "before" run matches the issue's report exactly. Each folder ([`before-master/`](before-master/), [`after-pr-169/`](after-pr-169/)) contains:
- a screenshot for each step
- `results.json`, with the rows, status bar, `schedule.json`, file-server requests and aria2's lists at each step
- `bridge-log.jsonl`, with each `set_download_start` call, its RPC answers, and each tick's decision (`Leave` and then `Leave` before the fix; `Leave` and then `Release` after it)
- `downloads-dir.txt`

## Direct aria2 check

[`live-aria2-transcript.md`](live-aria2-transcript.md) skips the UI and calls the PR's `hold_for_start` and master's logic directly against the real aria2c. It confirms the following:
- `forcePause` on a download added with `pause=true` fails.
- Master records no hold. The PR records the hold, and it survives reloading `schedule.json` from disk, which is what a relaunch does.
- At the start time `decide` returns `Release` with the PR and `Leave` with master. The PR's download completes (1 MiB) and master's stays paused.

## Other checks

- `cargo test --lib` on the merged branch passes 128 of 128, including the PR's two new `hold_for_start` tests ([`checks/cargo-test-summary.txt`](checks/cargo-test-summary.txt)).
- `npm test` passes 80 of 80 ([`checks/npm-test.txt`](checks/npm-test.txt)).
- TLA+/TLC (`formal-verify-garia-schedule`): `run-tlc full` and `run-tlc passing` both pass, with all four invariants holding over 81 distinct states. The scratch-break self-check fails on `UserPauseSafety` as it should ([`checks/`](checks/)). The model's `AssignFutureStart` already assumed that a start time always ends with the row paused and held, and the PR makes the code match that. The skill's sync commit moved to `61e5cb3`.
- Bugbot review of the PR: no bugs found.
