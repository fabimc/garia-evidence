// SCRATCH — verification harness for PR #169 / issue #161. Not committed.
// Drives the real aria2c 1.37.0 sidecar through the same calls Garia makes.
use super::*;
use std::io::Write as _;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Kill(Child);
impl Drop for Kill {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn wait_for(mut ok: impl FnMut() -> bool, secs: u64) -> bool {
    let end = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < end {
        if ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn bridge_state(sched: &schedule::Schedule) -> serde_json::Value {
    let saved = sched.snapshot();
    serde_json::to_value(schedule::ScheduleState {
        enabled: false,
        open: true,
        queue_stopped: false,
        start: 0,
        end: 0,
        next_change: 0,
        held: saved.held.iter().cloned().collect(),
        starts: saved.starts,
        now: schedule::epoch_now(),
    })
    .unwrap()
}

/// Invoke bridge for the browser frontend: a headless page whose
/// `window.__TAURI__.core.invoke` posts here. `set_download_start` runs the
/// same steps as `set_download_start_blocking` (master or PR hold logic), and
/// a 1 s loop applies `schedule::decide` the way `schedule_tick` does.
#[test]
#[ignore]
fn live_bridge() {
    use std::io::{BufRead, BufReader, Read};
    let mode = std::env::var("GARIA_BRIDGE_MODE").unwrap_or_else(|_| "after".into());
    let bridge_port: u16 = std::env::var("GARIA_BRIDGE_PORT").unwrap().parse().unwrap();
    let aria2_port: u16 = std::env::var("GARIA_ARIA2_PORT").unwrap().parse().unwrap();
    let dir = std::path::PathBuf::from(std::env::var("GARIA_BRIDGE_DIR").unwrap());
    let log_path = dir.join("bridge-log.jsonl");
    std::fs::create_dir_all(dir.join("downloads")).unwrap();
    let secret = "verify161".to_string();

    let aria2c = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries/aria2c-x86_64-unknown-linux-gnu");
    let _aria2 = Kill(
        Command::new(&aria2c)
            .args([
                "--enable-rpc",
                &format!("--rpc-listen-port={aria2_port}"),
                &format!("--rpc-secret={secret}"),
                &format!("--dir={}", dir.join("downloads").display()),
                "--no-conf",
                "--quiet",
            ])
            .spawn()
            .unwrap(),
    );
    assert!(wait_for(
        || aria2_request(aria2_port, &secret, "aria2.getVersion", serde_json::json!([])).is_ok(),
        10
    ));

    let sched = std::sync::Arc::new(schedule::Schedule::new(dir.join("schedule.json")));
    let log = std::sync::Arc::new(std::sync::Mutex::new(
        std::fs::File::create(&log_path).unwrap(),
    ));
    let note = {
        let log = log.clone();
        move |v: serde_json::Value| {
            let mut f = log.lock().unwrap();
            writeln!(f, "{v}").unwrap();
        }
    };

    {
        let sched = sched.clone();
        let secret = secret.clone();
        let note = note.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            let saved = sched.snapshot();
            let now = schedule::epoch_now();
            let keys = serde_json::json!(["gid", "status"]);
            let mut rows = Vec::new();
            for (m, p) in [
                ("aria2.tellActive", serde_json::json!([keys])),
                ("aria2.tellWaiting", serde_json::json!([0, 500, keys])),
            ] {
                if let Ok(a) = aria2_request(aria2_port, &secret, m, p) {
                    for r in a["result"].as_array().cloned().unwrap_or_default() {
                        rows.push(schedule::Row {
                            gid: r["gid"].as_str().unwrap_or_default().into(),
                            status: r["status"].as_str().unwrap_or_default().into(),
                        });
                    }
                }
            }
            for row in rows {
                let allowed = schedule::allowed(&row.gid, true, &saved.starts, now);
                let spent = allowed && saved.starts.get(&row.gid).is_some_and(|at| now >= *at);
                let act = schedule::decide(&row, allowed, saved.held.contains(&row.gid), false);
                if saved.starts.contains_key(&row.gid) || saved.held.contains(&row.gid) {
                    note(serde_json::json!({"tick": now, "gid": row.gid, "status": row.status,
                        "allowed": allowed, "held": saved.held.contains(&row.gid), "act": format!("{act:?}")}));
                }
                if let schedule::Act::Release = act {
                    if row.status != "paused"
                        || aria2_request(aria2_port, &secret, "aria2.unpause", serde_json::json!([row.gid])).is_ok()
                    {
                        sched.release(&row.gid);
                    }
                }
                if spent {
                    sched.set_start(&row.gid, None);
                }
            }
        });
    }

    let listener = std::net::TcpListener::bind(("127.0.0.1", bridge_port)).unwrap();
    println!("bridge ({mode}) on {bridge_port}, aria2 on {aria2_port}");
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut first = String::new();
        if reader.read_line(&mut first).is_err() {
            continue;
        }
        let mut len = 0usize;
        loop {
            let mut h = String::new();
            reader.read_line(&mut h).unwrap_or(0);
            if h == "\r\n" || h.is_empty() {
                break;
            }
            if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                len = v.trim().parse().unwrap_or(0);
            }
        }
        let mut body = vec![0u8; len];
        let _ = reader.read_exact(&mut body);
        if first.starts_with("POST /stop") {
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\n\r\n");
            break;
        }
        let req: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
        let cmd = req["cmd"].as_str().unwrap_or_default().to_owned();
        let args = req["args"].clone();
        let reply: Result<serde_json::Value, String> = match cmd.as_str() {
            "aria2_rpc" => aria2_request(
                aria2_port,
                &secret,
                args["method"].as_str().unwrap_or_default(),
                args["params"].clone(),
            ),
            "get_settings" => {
                let mut s = serde_json::to_value(Settings::default()).unwrap();
                s["setupSeen"] = serde_json::json!(true);
                s["downloadDir"] = serde_json::json!(dir.join("downloads").display().to_string());
                Ok(s)
            }
            "schedule_state" => Ok(bridge_state(&sched)),
            "set_download_start" => {
                let gid = args["gid"].as_str().unwrap_or_default().to_owned();
                let at = args["at"].as_i64();
                let pending = at.filter(|at| *at > schedule::epoch_now());
                sched.set_start(&gid, pending);
                let mut calls = Vec::new();
                if pending.is_some() {
                    let mut ask = |method: &str, params: serde_json::Value| {
                        let r = aria2_request(aria2_port, &secret, method, params.clone());
                        calls.push(serde_json::json!({"method": method, "params": params,
                            "answer": match &r { Ok(v) => v.clone(), Err(e) => serde_json::json!(format!("Err({e})")) }}));
                        r
                    };
                    if mode == "before" {
                        if ask("aria2.forcePause", serde_json::json!([gid])).is_ok() {
                            sched.hold(&gid);
                        }
                    } else {
                        hold_for_start(&sched, &gid, ask);
                    }
                }
                let state = bridge_state(&sched);
                note(serde_json::json!({"set_download_start": {"gid": gid, "at": at}, "rpc": calls,
                    "returned": state.clone()}));
                Ok(state)
            }
            _ => Err(format!("{cmd} is not available in the verification bridge")),
        };
        let out = match reply {
            Ok(v) => serde_json::json!({"ok": v}),
            Err(e) => serde_json::json!({"err": e}),
        }
        .to_string();
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}",
                out.len()
            )
            .as_bytes(),
        );
    }
}

#[test]
#[ignore]
fn live_aria2_scheduled_add_is_held_and_starts_at_its_time() {
    let out_path = std::env::var("GARIA_EVIDENCE_OUT").expect("GARIA_EVIDENCE_OUT");
    let mut log = std::fs::File::create(&out_path).unwrap();
    let mut say = |line: String| {
        println!("{line}");
        writeln!(log, "{line}").unwrap();
    };

    let root = std::env::temp_dir().join(format!("garia-161-live-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let www = root.join("www");
    let dl = root.join("downloads");
    std::fs::create_dir_all(&www).unwrap();
    std::fs::create_dir_all(&dl).unwrap();
    std::fs::write(www.join("payload.bin"), vec![7u8; 1_048_576]).unwrap();

    let http_port = free_port();
    let _http = Kill(
        Command::new("python3")
            .args(["-m", "http.server", &http_port.to_string(), "--bind", "127.0.0.1"])
            .current_dir(&www)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );

    let aria2c = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries/aria2c-x86_64-unknown-linux-gnu");
    let version = Command::new(&aria2c).arg("--version").output().unwrap();
    say(format!(
        "aria2c: {}",
        String::from_utf8_lossy(&version.stdout).lines().next().unwrap_or("?")
    ));
    let port = free_port();
    let secret = "verify161";
    let _aria2 = Kill(
        Command::new(&aria2c)
            .args([
                "--enable-rpc",
                &format!("--rpc-listen-port={port}"),
                &format!("--rpc-secret={secret}"),
                &format!("--dir={}", dl.display()),
                "--no-conf",
                "--quiet",
            ])
            .spawn()
            .unwrap(),
    );
    assert!(wait_for(
        || aria2_request(port, secret, "aria2.getVersion", serde_json::json!([])).is_ok(),
        10
    ));
    let url = format!("http://127.0.0.1:{http_port}/payload.bin");
    assert!(wait_for(|| ureq::get(&url).call().is_ok(), 10));

    let status_of = |gid: &str| -> String {
        aria2_request(port, secret, "aria2.tellStatus", serde_json::json!([gid, ["status"]]))
            .ok()
            .and_then(|a| a["result"]["status"].as_str().map(str::to_owned))
            .unwrap_or_default()
    };
    // What the frontend's start-time add sends: addUri with pause=true.
    let add = |name: &str| -> String {
        let a = aria2_request(
            port,
            secret,
            "aria2.addUri",
            serde_json::json!([[url.clone()], {"pause": "true", "out": name}]),
        )
        .unwrap();
        a["result"].as_str().unwrap().to_owned()
    };

    // --- 1. The cause, on the real aria2: forcePause of a paused download.
    say("\n## 1. forcePause on an add made with pause=true (the issue's cause)".into());
    let probe = add("probe.bin");
    say(format!("addUri pause=true -> gid {probe}, status {}", status_of(&probe)));
    let fp = aria2_request(port, secret, "aria2.forcePause", serde_json::json!([probe]));
    say(format!("aria2.forcePause -> {fp:?}"));
    assert!(fp.is_err(), "aria2 1.37 should refuse to pause an already paused download");

    // --- 2. Master's logic: hold only if forcePause is_ok. Expect no hold.
    say("\n## 2. Master behaviour (hold only when forcePause is Ok)".into());
    let master_file = root.join("schedule-master.json");
    let master = schedule::Schedule::new(master_file.clone());
    let gid_m = add("master.bin");
    let start_m = schedule::epoch_now() + 3;
    master.set_start(&gid_m, Some(start_m));
    if aria2_request(port, secret, "aria2.forcePause", serde_json::json!([gid_m])).is_ok() {
        master.hold(&gid_m);
    }
    say(format!("schedule.json after set_download_start: {}", std::fs::read_to_string(&master_file).unwrap()));
    let held_m = master.snapshot().held.contains(&gid_m);
    say(format!("held contains gid: {held_m}"));
    assert!(!held_m);

    // --- 3. PR logic: hold_for_start confirms paused via tellStatus.
    say("\n## 3. PR #169 behaviour (hold_for_start)".into());
    let pr_file = root.join("schedule-pr.json");
    let pr = schedule::Schedule::new(pr_file.clone());
    let gid_p = add("pr.bin");
    let start_p = schedule::epoch_now() + 3;
    pr.set_start(&gid_p, Some(start_p));
    let mut calls = Vec::new();
    hold_for_start(&pr, &gid_p, |method, params| {
        let r = aria2_request(port, secret, method, params.clone());
        calls.push(format!("{method} {params} -> {}", match &r {
            Ok(v) => v.to_string(),
            Err(e) => format!("Err({e})"),
        }));
        r
    });
    for c in &calls {
        say(format!("  rpc: {c}"));
    }
    say(format!("schedule.json after set_download_start: {}", std::fs::read_to_string(&pr_file).unwrap()));
    let held_p = pr.snapshot().held.contains(&gid_p);
    say(format!("held contains gid: {held_p}"));
    assert!(held_p);
    // A relaunch reloads schedule.json from disk.
    let reloaded = schedule::Schedule::new(pr_file.clone()).snapshot();
    say(format!("after reload from disk (relaunch): held contains gid: {}", reloaded.held.contains(&gid_p)));
    assert!(reloaded.held.contains(&gid_p));

    // --- 4. Ticks before and at the start time, applying decide like schedule_tick.
    say("\n## 4. schedule_tick decisions before and at the start time".into());
    let tick = |sched: &schedule::Schedule, gid: &str, label: &str| -> String {
        let saved = sched.snapshot();
        let now = schedule::epoch_now();
        let row = schedule::Row { gid: gid.to_owned(), status: status_of(gid) };
        let allowed = schedule::allowed(gid, true, &saved.starts, now);
        let act = schedule::decide(&row, allowed, saved.held.contains(gid), false);
        if let schedule::Act::Release = act {
            if aria2_request(port, secret, "aria2.unpause", serde_json::json!([gid])).is_ok() {
                sched.release(gid);
            }
        }
        if allowed && saved.starts.get(gid).is_some_and(|at| now >= *at) {
            sched.set_start(gid, None);
        }
        format!("{label}: now={now} status={} allowed={allowed} held={} -> {act:?}", row.status, saved.held.contains(gid))
    };
    say(tick(&pr, &gid_p, "PR     before start"));
    say(tick(&master, &gid_m, "master before start"));
    assert!(wait_for(|| schedule::epoch_now() >= start_p.max(start_m), 10));
    say(tick(&pr, &gid_p, "PR     at start"));
    say(tick(&master, &gid_m, "master at start"));

    let pr_done = wait_for(|| status_of(&gid_p) == "complete", 20);
    std::thread::sleep(Duration::from_secs(2));
    say(format!("\nPR     download status after start: {} (file exists: {}, bytes: {})",
        status_of(&gid_p), dl.join("pr.bin").exists(),
        std::fs::metadata(dl.join("pr.bin")).map(|m| m.len()).unwrap_or(0)));
    say(format!("master download status after start: {} (file exists: {})",
        status_of(&gid_m), dl.join("master.bin").exists()));
    say(format!("PR     schedule.json final: {}", std::fs::read_to_string(&pr_file).unwrap()));
    say(format!("master schedule.json final: {}", std::fs::read_to_string(&master_file).unwrap()));
    assert!(pr_done);
    assert_eq!(std::fs::metadata(dl.join("pr.bin")).unwrap().len(), 1_048_576);
    assert_eq!(status_of(&gid_m), "paused");
    let _ = std::fs::remove_dir_all(&root);
}
