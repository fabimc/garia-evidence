# Issue #129: keep large download lists smooth (keyboard selection)

Checked for [fabimc/garia#183](https://github.com/fabimc/garia/pull/183).

## What PR #183 changes after merging master

PR #183 was opened before [#167](https://github.com/fabimc/garia/pull/167) merged. Both fixed the half-applied filter bug, in different ways. Combined, the PR's version re-ran clean filter passes and failed #167's regression test. The merge keeps #167's fix and drops the PR's filter changes, so the PR now only changes keyboard selection:

- ArrowUp / ArrowDown move to the next visible row by walking sibling rows, instead of collecting every visible row on each key press.
- `paintSelection`, plain clicks and Ctrl+A list the visible rows only when they need them. Shift selection still lists them.

## Setup

- verify-garia browser-dev harness: the mock aria2 RPC server and the `src/` frontend in Playwright Chromium.
- 500 paused rows (`file-0.bin` … `file-499.bin`) added over `aria2.addUri`, plus the mock's 24 seeded rows, for 524 rows.
- One live page, with `main.js` swapped through a Playwright route. **Before:** `master` at `cea0c4a`. **After:** PR #183 at `88bcaea` (merged with `cea0c4a`).
- CPU slowed 6x through Chrome DevTools, as in [`issue-162-filter`](../issue-162-filter/), to approach WebKitGTK speeds.
- [`journey.mjs`](journey.mjs) records each run's results in `results.json`. The script was run once more in reverse order; that second run is in `results-repeat.json`.

## Selection behavior (same on both builds)

| Check | Before | After |
| --- | --- | --- |
| All Downloads: 30× ArrowDown from row 0 crosses section headers to row 30 | pass | pass |
| ArrowUp past the top stays on row 0 | pass | pass |
| Shift+ArrowDown selects the anchor and the next row | pass | pass |
| Ctrl+A selects all 524 visible rows | pass | pass |
| Search `file-49`: 5× ArrowDown skips hidden rows to match 5 | pass | pass |
| Search `file-49`: ArrowDown past the end stays on the last match, focus follows | pass | pass |
| 200× ArrowDown lands on row 200 | pass | pass |

Shift+ArrowDown keeps the anchor fixed, so holding it does not grow the range past one row. That happens on `master` too, and this PR doesn't change it.

## ArrowDown handler time (524 rows, 6x CPU slowdown, 200 presses)

The time from the first `keydown` listener to the last one, for each press:

| Run | Build | Median | p95 | Max |
| --- | --- | --- | --- | --- |
| 1 | Before (`master`) | 23.6 ms | 31.4 ms | 208.7 ms |
| 1 | After (PR #183) | 10.1 ms | 22.5 ms | 194.2 ms |
| 2 | After (PR #183) | 16.6 ms | 24.8 ms | 32.9 ms |
| 2 | Before (`master`) | 23.1 ms | 47.8 ms | 173.8 ms |

On both runs, the median handler time is 30–57% lower. The total time for the 200 presses (`burstMs`) mostly measures Playwright's round trips, so don't read it as an app timing.

## Filter regression check

[`after-pr-183/filter-regression/`](after-pr-183/filter-regression/) reruns the [`issue-162-filter`](../issue-162-filter/) journey on the PR build. Every step settles: search 8.4 s, clear 7.6 s, Active 10.5 s, All 7.8 s.

## Not covered

- Browser-dev runs Chromium, not WebKitGTK. The native Omarchy after-measurement asked for in #129 (scroll and selection with 500+ rows) still needs a desktop run.
