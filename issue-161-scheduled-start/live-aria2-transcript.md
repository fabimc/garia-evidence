aria2c: aria2 version 1.37.0

## 1. forcePause on an add made with pause=true (the issue's cause)
addUri pause=true -> gid 60303fc3872ce8c8, status paused
aria2.forcePause -> Err("aria2 request failed: http://127.0.0.1:40359/jsonrpc: status code 400")

## 2. Master behaviour (hold only when forcePause is Ok)
schedule.json after set_download_start: {
  "starts": {
    "83a9fe0838b2d64f": 1794675674
  },
  "held": []
}
held contains gid: false

## 3. PR #169 behaviour (hold_for_start)
  rpc: aria2.forcePause ["4ee4079dc6ed9953"] -> Err(aria2 request failed: http://127.0.0.1:40359/jsonrpc: status code 400)
  rpc: aria2.tellStatus ["4ee4079dc6ed9953",["status"]] -> {"id":1,"jsonrpc":"2.0","result":{"status":"paused"}}
schedule.json after set_download_start: {
  "starts": {
    "4ee4079dc6ed9953": 1794675674
  },
  "held": [
    "4ee4079dc6ed9953"
  ]
}
held contains gid: true
after reload from disk (relaunch): held contains gid: true

## 4. schedule_tick decisions before and at the start time
PR     before start: now=1794675671 status=paused allowed=false held=true -> Leave
master before start: now=1794675671 status=paused allowed=false held=false -> Leave
PR     at start: now=1794675674 status=paused allowed=true held=true -> Release
master at start: now=1794675674 status=paused allowed=true held=false -> Leave

PR     download status after start: complete (file exists: true, bytes: 1048576)
master download status after start: paused (file exists: false)
PR     schedule.json final: {
  "starts": {},
  "held": []
}
master schedule.json final: {
  "starts": {},
  "held": []
}
