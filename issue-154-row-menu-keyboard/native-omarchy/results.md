# Issue #154: native check on Omarchy

All nine checks pass in the native app. WebKitGTK delivers Shift+F10 and the Menu key to the page as `keydown` events, and the handler from [fabimc/garia#186](https://github.com/fabimc/garia/pull/186) opens `#row-menu` from them. The same keys on the pre-fix build open nothing, so this setup reproduces the original bug.

## Setup

- **Build:** `origin/master` at `20c76b1` (merge of PR #186), `mise x rust@stable -- npx tauri build --debug --no-bundle`, run as `src-tauri/target/debug/garia` with the bundled aria2c sidecar.
- **Control build:** `eeed365` (`20c76b1^1`, master before PR #186), same build and the same data.
- **Desktop:** Omarchy, Hyprland 0.56.2, WebKitGTK 2.54.1 (webkit2gtk-4.1), GTK 3.24.52, Dell Inspiron 15 3520 at 1920×1080, scale 1.5.
- **Data:** `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `XDG_STATE_HOME` pointed at folders under `/tmp` for the app process only. Downloads went to `/tmp`. Everything was deleted afterwards.
- **Downloads:** `1Mb.dat` and `10Mb.dat` from proof.ovh.net completed. `100Mb.dat` stayed active under the "Light" (512 KB/s) speed limit. See [`0-setup-downloads.png`](0-setup-downloads.png).
- **Input:** keys were sent with `wtype`, which uses Hyprland's virtual-keyboard protocol. GTK receives them as ordinary `wl_keyboard` key events on the focused window. Clicks used a small `zwlr_virtual_pointer_v1` client. Before every key, the script checked that `hyprctl activewindow` was the Garia window and refused to send otherwise.
- **Menu key:** the laptop's built-in keyboard has no Menu key, as far as its layout shows, and no other keyboard is attached. The Menu key was sent as the `Menu` keysym through the same virtual keyboard. It wasn't pressed on physical hardware.
- **Screenshots:** `grim`, cropped to the Garia window. The pointer was parked over the sidebar during keyboard steps, so menu highlights come from focus, not hover. With no DOM access in the native app, focus and selection are judged from the screenshots.

## Results

| Step | Expected | Actual | Screenshot |
| --- | --- | --- | --- |
| 1. Completed view, Ctrl+F, Tab, Tab, Shift+F10 | `#row-menu` opens directly under the row, the row is selected, the first item has focus. | Tab, Tab puts focus on `1Mb.dat`. Shift+F10 opens the menu with its top-left corner at the row's bottom-left. The row is highlighted as selected and "Show in folder" (the first item) is focused. | [`1a`](1a-focus-row.png), [`1b`](1b-shift-f10.png) |
| 2. ArrowDown, ArrowUp, End, Home | Focus moves between menu items. | Down moves to Copy URL, Up back to Show in folder, End to Delete…, Home back to Show in folder. The selection behind the menu doesn't change. | [`2a`](2a-arrow-down.png), [`2b`](2b-arrow-up.png), [`2c`](2c-end.png), [`2d`](2d-home.png) |
| 3. Escape | Menu closes, focus back on the row. | Menu closes. The `1Mb.dat` row has the focus ring and stays selected. | [`3`](3-escape.png) |
| 4. Menu key | Same as step 1. | Same as step 1. | [`4`](4-menu-key.png) |
| 5. Tab with the menu open | Menu closes, focus back on the row. | Menu closes. Focus ring back on the `1Mb.dat` row. | [`5`](5-tab.png) |
| 6. Plain F10 | Row menu doesn't open. | Row menu doesn't open. GTK activates the native menu bar and drops down the "Garia" menu (About, Check for Updates…, Settings…, Quit), with the row still focused underneath. Escape from the virtual keyboard didn't close that dropdown, even twice. A click on the page did. | [`6a`](6a-plain-f10.png), [`6b`](6b-escape-leaves-gtk-menu-open.png), [`6c`](6c-click-away.png) |
| 7. Two rows selected, Shift+F10 on one | Both rows stay selected, plural items. | Shift+ArrowDown selects `1Mb.dat` and `10Mb.dat` and focuses `10Mb.dat`. Shift+F10 opens the menu under `10Mb.dat`. Both rows stay selected, and the items read "Copy URLs", "Copy File Paths", "Add Tag to Selection…" and "New Package from Selection". | [`7a`](7a-two-selected.png), [`7b`](7b-shift-f10-two-selected.png) |
| 8. Active row, Shift+F10, Enter on Pause | Row pauses and keeps focus. | All Downloads view, active `100Mb.dat` row: Shift+F10 opens the menu with Pause focused. Enter pauses it. The row moves to the Paused section ("8% · Paused"), the status bar reads "1 paused", and the row keeps the focus ring. | [`8a`](8a-shift-f10-active-row.png), [`8b`](8b-enter-pause.png) |
| 9. Right-click an unselected row | Menu at the pointer, row selected. | With `100Mb.dat` selected, right-clicking `1Mb.dat` opens the menu at the pointer. `1Mb.dat` becomes the only selected row. | [`9`](9-right-click.png) |

## Control: pre-fix build

Same data and input, built from `eeed365`. Completed view, Ctrl+F, Tab, Tab, then Shift+F10, then the Menu key. Neither key opens anything, and focus stays on the `1Mb.dat` row. This matches the issue report and shows the scripted keys hit the original failure.

[`control-before-fix/1-focus-row.png`](control-before-fix/1-focus-row.png), [`2-shift-f10.png`](control-before-fix/2-shift-f10.png), [`3-menu-key.png`](control-before-fix/3-menu-key.png)

## Other observations (outside #154)

- **Quit is disabled in the native "Garia" menu.** The app menu uses muda's predefined `.quit()` item, which GTK shows greyed out on Linux, so clicking it does nothing (`src-tauri/src/lib.rs` ≈4385). The tray menu has its own Quit. For this run the app was stopped with SIGTERM, and the orphaned aria2c sidecar was stopped separately.
