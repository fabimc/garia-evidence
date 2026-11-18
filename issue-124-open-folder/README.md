# Issue #124 / PR #178: open download and containing folders

[fabimc/garia#124](https://github.com/fabimc/garia/issues/124), fixed by [fabimc/garia#178](https://github.com/fabimc/garia/pull/178).

Browser-dev with the mock aria2 RPC, driven by `verify-garia`'s `control-garia`, at PR head `cbf31aa`. For the folder actions the page was reloaded with `browser reload --tauri-stub --missing-dir /Users/me/Downloads/Video`: a fake `core.invoke` that records each native call and rejects `open_folder` for that one path. This proves which command the UI sends and how it shows a refusal. It does not prove a file manager opened; that needs a native run on Omarchy.

| File | What it shows |
| --- | --- |
| `browser-dev-disabled.png` | No native bridge: **Open download folder** on the Completed toolbar is disabled. |
| `open-download-folder.png`, `open-download-folder.invokes.json` | Clicking it sends `open_folder` with the configured folder, `/home/garia/Downloads`. |
| `row-menu.png`, `open-containing.invokes.json` | Row menu (Shift+F10) → **Open Containing Folder** sends `open_folder` with the row's folder, `/Users/me/Downloads`. |
| `missing-folder-notice.png`, `missing-folder.invokes.json` | When the folder is gone, the banner reads "Couldn't open the folder: /Users/me/Downloads/Video is not an existing folder". |
