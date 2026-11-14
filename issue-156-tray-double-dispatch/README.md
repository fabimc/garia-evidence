# Issue #156: Tray menu actions run twice (false pause/resume errors, duplicated Retry Failed)

Fixed by [fabimc/garia#184](https://github.com/fabimc/garia/pull/184).

## Setup

- Native release builds (`tauri build --no-bundle`) on Omarchy (Hyprland 0.56.2), with the Omarchy shell (Quickshell) as the tray host. **Before:** `master` at `cea0c4a`. **After:** PR #184 with `master` at `cea0c4a` merged in (`9e4a87b`).
- Each run used a fresh sandbox: `HOME` and the `XDG_*` data, config, cache, and state directories pointed at an empty temporary folder.
- Garia's own `aria2c` sidecar was wrapped in a two-line shell script that saves its arguments and then runs the real binary. aria2 hides `--rpc-secret` in its process title, and the script needs the secret to read aria2's state. Garia itself is unchanged.
- [`slow_server.py`](slow_server.py) serves a throttled 1 GiB `/big.bin` with Range support. Every other path returns 404.
- [`journey.sh`](journey.sh) follows the issue's reproduction:
  1. Launch Garia and press Enter on **Continue** in the first-run Welcome dialog.
  2. Add `big.bin` (stays active) and `missing.bin` (fails with 404).
  3. Hide the window with the same Hyprland close that Super+W does.
  4. Send a tray menu click over D-Bus: `com.canonical.dbusmenu.Event <id> clicked` on Garia's StatusNotifierItem menu, found by matching the item's owner PID. Wait 1.5–3 s, then take a window screenshot and save aria2's active, waiting, and stopped lists.
  5. Repeat steps 3 and 4 for **Pause All**, **Resume All**, **Retry Failed**, **Show Garia**, and **Quit**.

No mouse was used. The tray menu has the same 10 entries in both builds ([`menu-labels.txt`](after-pr-184/menu-labels.txt)).

## Results

| Tray action | Before (`master`) | After (PR #184) |
| --- | --- | --- |
| Pause All | `big.bin` pauses (16 connections down to 0). **Toast: "Couldn't pause 1 of 1 downloads: aria2 request failed: … status code 400"** ([screenshot](before-master/04-after-pause-all.png)) | Pauses. **No toast.** ([screenshot](after-pr-184/04-after-pause-all.png)) |
| Resume All | Resumes (back to 16 connections). **Toast: "Couldn't resume 1 of 1 downloads: … status code 400"** ([screenshot](before-master/05-after-resume-all.png)) | Resumes. **No toast.** ([screenshot](after-pr-184/05-after-resume-all.png)) |
| Retry Failed | **One failed download becomes two.** aria2 holds two new `missing.bin` entries, and the server got two retry requests in the same 2 ms ([screenshot](before-master/06-after-retry-failed.png), [aria2 state](before-master/06-after-retry-failed.json), [server log](before-master/http-server.log)) | **Retried once.** One new `missing.bin` entry with a new GID, and one retry request ([screenshot](after-pr-184/06-after-retry-failed.png), [aria2 state](after-pr-184/06-after-retry-failed.json), [server log](after-pr-184/http-server.log)) |
| Show Garia | The window comes back on its workspace. | Same. Now handled by the global menu handler. |
| Quit | Garia and its aria2c exit within about 1 s. | Same. Now handled by the global menu handler. |

Each folder also has `steps.log` (timestamped steps and the aria2 summary after each action), `menu-layout.json` (the raw D-Bus `GetLayout` reply), and `garia.log`.

## Other checks

- `npm test` on the merged branch: 79/79 pass. That includes the PR's test, which checks that `lib.rs` has a single `on_menu_event` and that it handles every tray id, including Show Garia and Quit.
- Bugbot review of the PR: no bugs found.
