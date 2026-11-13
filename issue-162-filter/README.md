# Issue #162: search and filter stuck half-applied on large lists

Fixed by [fabimc/garia#167](https://github.com/fabimc/garia/pull/167).

## Setup

- verify-garia browser-dev harness: the mock aria2 RPC server and the `src/` frontend in Playwright Chromium.
- 500 paused downloads (`file-0.bin` … `file-499.bin`) were added over `aria2.addUri`, on top of the mock's 24 seeded rows, for 524 rows in total.
- The CPU was slowed 6x through Chrome DevTools (`Emulation.setCPUThrottlingRate`). At full speed on this machine, one filter pass over 524 rows finishes within the 1 s poll interval, so the bug doesn't appear. The slowdown recreates the timing seen on WebKitGTK.
- **Before:** `src/main.js` from `master` at `03c6d20`. **After:** `master` with PR #167 merged.
- After each step, [`journey.mjs`](journey.mjs) waits up to 30 s. A step counts as settled once the visible rows and the header count match the expected result for 3 seconds in a row.

## Results

| Step | Expected | Before (`master`) | After (PR #167) |
| --- | --- | --- | --- |
| 1. Ctrl+F, type `file-49` | 11 rows, "11 items" | Settled after 14.3 s | Settled after 22.0 s |
| 2. Escape (clear search) | 524 rows, "524 items" | **Stuck after 30 s:** 342 rows, header "11 items" | Settled after 16.9 s |
| 3. Sidebar **Active** | 6 rows, "6 items" | **Stuck after 30 s:** 208 rows, header "11 items" | Settled after 9.6 s |
| 4. Sidebar **All Downloads** | 524 rows, "524 items" | **Stuck after 30 s:** 342 rows, header "11 items" | Settled after 5.5 s |

Settle times vary from run to run with machine load. In an earlier run at the same slowdown, the fixed build settled each step in 4.9–6.7 s. What matters is the result: `master` never recovers within 30 s, and the fixed build always settles.

The step numbers and names match the files in [`before-master/`](before-master/) and [`after-pr-167/`](after-pr-167/). Each folder has a screenshot per step and a `results.json` with the final rows and counts for each step.
