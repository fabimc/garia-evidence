#!/usr/bin/env bash
# Usage: journey.sh <before|after>
# Native tray journey for fabimc/garia#156: hide the window, then send tray menu
# clicks over D-Bus (com.canonical.dbusmenu.Event) and record what happens.
set -u
V=$1
ROOT=/tmp/garia-184
BIN=$ROOT/$V/garia
SB=$ROOT/sandbox-$V
E=$ROOT/evidence/$V
PORT=8791
rm -rf "$SB" "$E" "$ROOT/$V/aria2c.args"; mkdir -p "$SB"/{data,config,cache,state,Downloads} "$E"
LOG=$E/steps.log
log() { printf '%s %s\n' "$(date +%T.%3N)" "$*" | tee -a "$LOG"; }

python3 $ROOT/slow_server.py $PORT 2>"$E/http-server.log" &
SRV=$!

env HOME=$SB XDG_DATA_HOME=$SB/data XDG_CONFIG_HOME=$SB/config XDG_CACHE_HOME=$SB/cache \
  XDG_STATE_HOME=$SB/state XDG_DOWNLOAD_DIR=$SB/Downloads "$BIN" >"$E/garia.log" 2>&1 &
GPID=$!
log "launched $BIN pid=$GPID"

win() { hyprctl clients -j | jq -c --argjson p "$GPID" '.[] | select(.pid == $p) | {address, at, size, workspace: .workspace.name, mapped, hidden}'; }
addr() { win | jq -r .address | head -1; }
shot() { local g; g=$(win | jq -r '"\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"' | head -1); [ -n "$g" ] && grim -g "$g" "$E/$1" && log "screenshot $1"; }
hide() { local a; a=$(addr); hyprctl dispatch "hl.dsp.window.close({ window = \"address:$a\" })" >/dev/null; sleep 1; log "hid window $a; garia clients now: $(win | wc -l)"; }
focus() { hyprctl dispatch "hl.dsp.focus({ window = \"address:$(addr)\" })" >/dev/null; sleep 0.4; }

for i in $(seq 1 60); do [ -n "$(addr)" ] && break; sleep 0.5; done
for i in $(seq 1 20); do [ -s "$ROOT/$V/aria2c.args" ] && break; sleep 0.5; done
RPC_PORT=$(sed -n 's/^--rpc-listen-port=//p' "$ROOT/$V/aria2c.args")
SECRET=$(sed -n 's/^--rpc-secret=//p' "$ROOT/$V/aria2c.args")
log "window $(win); aria2 port=$RPC_PORT"

rpc() { curl -s "http://127.0.0.1:$RPC_PORT/jsonrpc" -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"v\",\"method\":\"$1\",\"params\":[\"token:$SECRET\"${2:+,$2}]}"; }
KEYS='["gid","status","errorCode","connections","completedLength","files"]'
state() {
  { echo '{'
    echo '"active":'; rpc aria2.tellActive "$KEYS" | jq '.result'; echo ','
    echo '"waiting":'; rpc aria2.tellWaiting "0,100,$KEYS" | jq '.result'; echo ','
    echo '"stopped":'; rpc aria2.tellStopped "0,100,$KEYS" | jq '.result'; echo '}'
  } | jq '{active, waiting, stopped} | map_values(map({gid, status, errorCode, connections, completedLength, uri: .files[0].uris[0].uri}))' >"$E/$1"
  log "aria2 $1: $(jq -c '[.active[], .waiting[], .stopped[]] | map("\(.uri | split("/") | last):\(.status):conn=\(.connections)")' "$E/$1")"
}

sleep 3
focus; wtype -k Return; sleep 0.8
shot 01-launched.png

rpc aria2.addUri "[\"http://127.0.0.1:$PORT/big.bin\"]" >/dev/null
rpc aria2.addUri "[\"http://127.0.0.1:$PORT/missing.bin\"]" >/dev/null
sleep 5
shot 02-two-downloads.png
state 02-two-downloads.json

ITEM=""; MENU=""
for it in $(busctl --user get-property org.kde.StatusNotifierWatcher /StatusNotifierWatcher org.kde.StatusNotifierWatcher RegisteredStatusNotifierItems | grep -o '"[^"]*"' | tr -d '"'); do
  svc=${it%%/*}; path=/${it#*/}
  pid=$(busctl --user call org.freedesktop.DBus /org/freedesktop/DBus org.freedesktop.DBus GetConnectionUnixProcessID s "$svc" | awk '{print $2}')
  if [ "$pid" = "$GPID" ]; then ITEM=$svc; MENU=$(busctl --user get-property "$svc" "$path" org.kde.StatusNotifierItem Menu | awk '{print $2}' | tr -d '"'); fi
done
log "tray item $ITEM menu $MENU"
busctl --user --json=short call "$ITEM" "$MENU" com.canonical.dbusmenu GetLayout iias -- 0 -1 0 >"$E/menu-layout.json"
menu_id() { jq -r --arg l "$1" '.. | arrays | select(length == 3 and (.[0] | type) == "number" and (.[1] | type) == "object") | select(.[1].label.data == $l) | .[0]' "$E/menu-layout.json" | head -1; }
jq -r '.. | arrays | select(length == 3 and (.[0] | type) == "number" and (.[1] | type) == "object") | select(.[1].label) | "\(.[0]) \(.[1].label.data)"' "$E/menu-layout.json" >"$E/menu-labels.txt"
log "menu: $(paste -sd, "$E/menu-labels.txt")"
click() { local id; id=$(menu_id "$1"); busctl --user call "$ITEM" "$MENU" com.canonical.dbusmenu Event isvu "$id" clicked s '' 0; log "tray click \"$1\" (id $id)"; }

hide
state 03-hidden.json
click "Pause All"; sleep 1.5
shot 04-after-pause-all.png
state 04-after-pause-all.json

hide
click "Resume All"; sleep 1.5
shot 05-after-resume-all.png
state 05-after-resume-all.json

hide
click "Retry Failed"; sleep 3
shot 06-after-retry-failed.png
state 06-after-retry-failed.json

hide
click "Show Garia"; sleep 1.5
log "after Show Garia: $(win)"
shot 07-after-show.png

hide
click "Quit"
for i in $(seq 1 30); do kill -0 "$GPID" 2>/dev/null || break; sleep 0.2; done
sleep 1
log "after Quit: garia alive=$(kill -0 $GPID 2>/dev/null && echo yes || echo no); aria2c for this sandbox=$(pgrep -f "sandbox-$V" | wc -l)"
kill -0 "$GPID" 2>/dev/null && { kill "$GPID"; log "had to kill garia"; }
pkill -f "$ROOT/$V/aria2c"
kill $SRV
log done
