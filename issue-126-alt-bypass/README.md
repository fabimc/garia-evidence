# Issue #126: Alt-click bypass is overridden by download takeover

Fixed by [fabimc/garia#180](https://github.com/fabimc/garia/pull/180). Review fixes: `5d545b2` (merge with master; bypass also covers Ctrl, is sent on mousedown, and is only spent on a download takeover would have taken).

The handoff-tab half of the issue (Chromium's "Open xdg-open?" prompt vanishing) was already fixed on master by #170; see [`issue-160-handoff-tab/`](../issue-160-handoff-tab/).

## Setup

- Playwright's Chromium, `--headless=new`, fresh profile, unpacked extension loaded with `--load-extension`.
- A local HTTP server serves a page with three links: `archive.zip`, `/get?id=42` (302 → `report.zip`), and `photos.zip`. All return `application/zip` with `Content-Disposition: attachment`.
- Each step clicks one link, waits 1.5 s, then records new tabs and `chrome.downloads.search({})` from the extension's service worker, and erases the download list.
- **Before:** `origin/master` at `677fc52`. **After:** PR head `5d545b2`.
- [`harness/run.cjs`](harness/run.cjs)` <extension dir> <out dir> <label>`.

## Results

| Click | Before (master) | After (PR #180) |
| --- | --- | --- |
| **Alt**+click `archive.zip` | Download `interrupted / USER_CANCELED`, handoff tab opens ([alt-click-handoff](before-master/alt-click-handoff.png)) | Download `complete` in Chromium, no handoff tab |
| **Alt**+click `/get?id=42` (redirect) | `USER_CANCELED`, handoff tab ([alt-click-redirect-handoff](before-master/alt-click-redirect-handoff.png)) | `complete`, `finalUrl` `/files/report.zip`, no handoff tab |
| **Ctrl**+click `photos.zip` | `USER_CANCELED`, handoff tab ([ctrl-click-handoff](before-master/ctrl-click-handoff.png)) | `complete`, no handoff tab |
| Plain click `archive.zip` | Captured: handoff tab, no browser download ([plain-click-handoff](before-master/plain-click-handoff.png)) | Same ([plain-click-handoff](after-pr-180/plain-click-handoff.png)) |

Raw data: [before](before-master/results.json), [after](after-pr-180/results.json).

## Checks

- `npm test` in the garia repo: 86/86 pass, including the new "extension leaves Alt- and Ctrl-clicked file links to the browser" and "a link bypass skips download takeover once, including redirects".
- Not covered: the native `xdg-open` prompt (unchanged by this PR; see issue-160), Firefox.
