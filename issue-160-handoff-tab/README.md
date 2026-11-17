# Issue #160: Extension loses the first capture in a fresh Chromium profile

Fixed by [fabimc/garia#170](https://github.com/fabimc/garia/pull/170). Review fixes: `729dd4c`, which updates PRIVACY.md and adds a test for an empty handoff.

## Setup

- Chrome for Testing 153 runs headed on Xvfb (1280×800) with a **fresh profile** for every run and the unpacked extension loaded with `--load-extension`. These are the same flags as the issue's reproduction.
- `garia://` goes to a fake `xdg-open` ([`harness/bin/`](harness/bin/)), which logs every URL it receives to `xdg.log`. A line there means the link reached the desktop handler, which is the boundary the extension controls. Garia's own parsing of the link is unchanged and covered by `catch.rs` tests.
- Clicks and keys come from `xdotool`. Tab lists come from the DevTools `/json/list` endpoint, which is read-only and does not attach a driver, so browser download behavior is untouched. Screenshots show the whole X screen, so Chromium's native "Open xdg-open?" dialog is visible.
- **Before:** `origin/master` at `da0eff9`. **After:** PR head `729dd4c` merged with that master (`7696f8b`).
- [`harness/run.sh`](harness/run.sh)` <extension dir> <out dir> a|c|d`. Before running it, put any `file.zip` in `harness/site/`.

## Results

### Download takeover (open a `.zip` URL)

| Step | Before (master) | After (PR #170) |
| --- | --- | --- |
| 1 s after the download starts | Handoff tab shows "Open xdg-open?" ([1-after-1s](before-master/download-takeover/1-after-1s.png)) | Same prompt |
| 4 s | **Tab gone, prompt gone**. `xdg-open` never called, and the browser download was cancelled ([2-after-4s](before-master/download-takeover/2-after-4s.png)). This matches the issue. | Prompt still up, tab still open ([1-prompt-at-4s](after-pr-170/download-retry-allow/1-prompt-at-4s.png)) |
| Cancel the prompt | — | Tab stays, with a **Try opening Garia again** button ([2-dismissed](after-pr-170/download-retry-allow/2-dismissed.png)) |
| Click retry | — | Prompt comes back ([3-retry-prompt](after-pr-170/download-retry-allow/3-retry-prompt.png)) |
| Tick "Always allow", click Open | — | `xdg-open garia://add?url=…file.zip&from=extension&name=file.zip&confirm=1` ([4-opened](after-pr-170/download-retry-allow/4-opened.png), [xdg.log](after-pr-170/download-retry-allow/xdg.log)) |
| Second download | — | No prompt. `xdg-open` gets `…file.zip%3Fsecond…` within about 3 s. A second handoff tab stays open ([5-second-capture](after-pr-170/download-retry-allow/5-second-capture.png)). |

### Long "Download with Garia" selection (200 URLs, sent in the hash and copied to the clipboard)

| Step | Before (master) | After (PR #170) |
| --- | --- | --- |
| 3 s after the menu click | No handoff tab (it opened in the background and closed after 2 s). **Clipboard empty**, `xdg-open` never called ([2-batch-prompt-at-3s](before-master/batch/2-batch-prompt-at-3s.png), [clipboard.txt](before-master/batch/clipboard.txt)) | Handoff tab in front with the prompt ([2-batch-prompt-at-3s](after-pr-170/batch/2-batch-prompt-at-3s.png)) |
| Open | — | `xdg-open garia://add?from=extension&batch=1&referrer=…`. The clipboard holds all 200 URLs, one per line ([clipboard.txt](after-pr-170/batch/clipboard.txt), [xdg.log](after-pr-170/batch/xdg.log)) |

So master also lost long batches in a fresh profile, and the PR fixes that too. The tab now opens in front, so `navigator.clipboard.writeText` gets a focused document.

## Known trade-off (not changed)

Handoff tabs stay open until the user closes them, including after "Always allow" is set. The review checked whether the page could detect a successful launch and close itself. The [focus probe](checks/focus-probe.log) ([probe script](checks/focus-probe-handoff.js)) shows the page blurs about 20 ms after navigating to `garia://` in both cases, whether the prompt appears or the launch goes straight through. `beforeunload` fires only for user-gesture retries. Neither event tells a successful launch from a pending prompt, so closing the tab automatically could lose a capture, which is the bug being fixed. The tabs therefore stay open.

## Other checks

- `npm test` on the merged tree: 83 of 83 pass, including the three handoff tests ([checks/npm-test-merged.txt](checks/npm-test-merged.txt)).
- `scripts/pack-extension.sh` builds both store zips ([checks/pack-extension.txt](checks/pack-extension.txt)).
- `chrome.log` files contain only container D-Bus noise.
