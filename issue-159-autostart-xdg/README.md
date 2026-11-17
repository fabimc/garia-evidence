# Issue #159: Autostart entry ignores XDG_CONFIG_HOME and overwrites the real entry from test runs

Fixed by [fabimc/garia#171](https://github.com/fabimc/garia/pull/171), with `master` at `da0eff9` merged in plus review fixes (`8a02088`).

## Setup

- **Before:** `master` (`da0eff9`). **After:** PR #171 head `8a02088`. Both are `cargo build` debug binaries, built on Ubuntu 24.04 with stub sidecars (autostart doesn't touch aria2).
- [`harness/startup.sh`](harness/startup.sh) launches the real binary under `xvfb-run` for 12 s, with a throwaway `HOME` (and, in scenario 2, a throwaway `XDG_CONFIG_HOME`), then reads the autostart entry. Paths in the logs are redacted to `<repo>` / `$TMP`.
- The Settings toggle (`set_autostart` via Tauri `invoke`) wasn't clicked in a native window: there is no session bus or compositor in the container. The unit tests below cover it, calling the same `enable_at` / `disable_at` / `enabled_at` with explicit paths.

## Results: startup

| Scenario | Before (master) | After (PR #171) |
| --- | --- | --- |
| 1. Legacy entry `Exec=/usr/bin/garia ` (no flag), `XDG_CONFIG_HOME` unset | Rewritten to **`Exec=<repo>/…/target-master/debug/garia --garia-background`**: the test binary took over the login entry | `Exec=/usr/bin/garia --garia-background`: only the flag was added, the path was kept |
| 2. The issue's case: user entry in `~/.config/autostart`, test run with `XDG_CONFIG_HOME=$TMP/xdg` | Entry in `~/.config` **rewritten** to the test binary | User entry **byte-identical** (sha256 unchanged); nothing created in `$XDG_CONFIG_HOME/autostart` |

Logs: [`before-master/startup.log`](before-master/startup.log), [`after-pr-171/startup.log`](after-pr-171/startup.log).

## Results: tests (after)

- [`after-pr-171/rust-autostart-tests.log`](after-pr-171/rust-autostart-tests.log): 5 autostart tests pass. They cover XDG path selection, enable/disable touching only the selected entry, Exec quoting, `Hidden=true` / `X-GNOME-Autostart-enabled=false` counting as off, and the flag-only migration (idempotent, keeps the path, handles the plugin's old entry with no trailing newline).
- [`after-pr-171/rust-all-tests.log`](after-pr-171/rust-all-tests.log): all 133 lib tests pass.
- [`after-pr-171/js-tests.log`](after-pr-171/js-tests.log): `npm test`, 80/80 pass.

## Review fixes on top of the original PR

- Removed `tauri-plugin-autostart` and the `autostart:default` capability. The plugin was a second writer that ignored `XDG_CONFIG_HOME`.
- Kept the upgrade migration from `cd4651f`, limited to appending a missing `--garia-background`.
- Used Tauri's resolved AppImage path; wrote `Terminal=false` and `StartupNotify=false` again.
- Entries the desktop switched off now read as off in Settings.
- Tests no longer `set_var` process env, and they clean up their temp dirs.
