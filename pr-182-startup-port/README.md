# PR #182: busy RPC port no longer delays the first window

[fabimc/garia#182](https://github.com/fabimc/garia/pull/182) (for [#128](https://github.com/fabimc/garia/issues/128)), at PR head `7d52ceb` after merging master.

| File | What it shows |
| --- | --- |
| `cargo-test.txt` | `busy_preferred_port_falls_back_without_waiting` shows that a held port falls back to a free one in under 40 ms (before, 20 x 50 ms retries). `free_preferred_port_is_kept` shows that a free 6800-style port is still preferred. Full `cargo test --lib` result on Linux. |

The 1 s retry is kept only when Garia has just stopped an orphaned aria2c from a crashed run, so remote clients pointed at 6800 keep working after a crash.

The scheduled-add hold from the original PR was dropped. Master's #169 already holds a scheduled add once aria2 confirms the pause (proof: [`issue-161-scheduled-start/`](../issue-161-scheduled-start/)). `schedule.rs` is identical to master.

Not covered here: cold and warm start timings on Omarchy (garia-bin vs AppImage). These need the native machine.
