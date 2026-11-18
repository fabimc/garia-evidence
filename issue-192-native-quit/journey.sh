#!/usr/bin/env bash
# Usage: journey.sh <garia-binary> <out-dir> <menu-click|ctrl-q|tray-quit>
# Native Linux journey for fabimc/garia#192, run headless under Xvfb + xfwm4
# inside dbus-run-session. Each run gets a throwaway HOME/XDG sandbox.
#   menu-click : open Garia menu, screenshot it, click Quit
#   ctrl-q     : focus the main window, press Ctrl+Q
#   tray-quit  : send com.canonical.dbusmenu.Event "clicked" to the tray's Quit
# After each, records whether garia and its aria2c are still running.
set -u
BIN=$(readlink -f "$1"); E=$2; MODE=$3
mkdir -p "$E"; E=$(readlink -f "$E")
SB=$(mktemp -d); mkdir -p "$SB"/{data,config,cache,state,Downloads}
LOG=$E/$MODE.log; : >"$LOG"
log() { printf '%s %s\n' "$(date +%T.%3N)" "$*" | tee -a "$LOG"; }
shot() { import -window root "$E/$1" && log "screenshot $1"; }

env HOME=$SB XDG_DATA_HOME=$SB/data XDG_CONFIG_HOME=$SB/config XDG_CACHE_HOME=$SB/cache \
  XDG_STATE_HOME=$SB/state XDG_DOWNLOAD_DIR=$SB/Downloads WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  "$BIN" >"$E/$MODE.garia.log" 2>&1 &
GPID=$!
log "launched $BIN pid=$GPID"

WID=""
for _ in $(seq 1 60); do WID=$(xdotool search --pid "$GPID" --name '^Garia$' 2>/dev/null | head -1); [ -n "$WID" ] && break; sleep 0.5; done
sleep 4
ARIA=$(pgrep -P "$GPID" -x aria2c)
log "window=$WID aria2c=${ARIA:-none}"
xdotool windowactivate --sync "$WID" 2>/dev/null; xdotool windowmove "$WID" 0 0; sleep 1
# Dismiss the first-run Welcome sheet: click Continue. The window sits at 0,0
# under an xfwm4 title bar (~29 px), so these are screen coordinates.
xdotool mousemove 677 693 click 1; sleep 1
shot "$MODE-01-launched.png"

case $MODE in
  menu-click)
    # "Garia" is the first item of the GTK menu bar, top-left of the window.
    xdotool mousemove 18 41 click 1; sleep 1.5
    shot "$MODE-02-garia-menu-open.png"
    # Hover Quit (last item of the Garia menu), screenshot, then click it.
    xdotool mousemove 48 143; sleep 0.5; shot "$MODE-03-quit-hovered.png"
    xdotool click 1
    ;;
  ctrl-q)
    xdotool key --clearmodifiers ctrl+q
    ;;
  tray-quit)
    # Find the connection that exports the ayatana tray menu (dbusmenu).
    NAME=""; MENU=""
    for n in $(busctl --user --json=short list | jq -r --argjson p "$GPID" '.[] | select(.pid == $p) | .name'); do
      m=$(busctl --user tree --list "$n" 2>/dev/null | grep '/NotificationItem/.*/Menu$' | head -1)
      [ -n "$m" ] && { NAME=$n; MENU=$m; break; }
    done
    log "tray bus=$NAME menu=$MENU"
    busctl --user --json=pretty call "$NAME" "$MENU" com.canonical.dbusmenu GetLayout iias -- 0 -1 0 >"$E/$MODE.menu-layout.json"
    jq -r '[.. | arrays | select(length == 3 and (.[0]|type) == "number" and (.[1]|type) == "object")
            | "\(.[0]) \(.[1].label.data // "-")"] | .[]' "$E/$MODE.menu-layout.json" >"$E/$MODE.menu-labels.txt"
    QID=$(awk '$2 == "Quit" {print $1}' "$E/$MODE.menu-labels.txt" | head -1)
    log "tray Quit id=$QID"
    busctl --user call "$NAME" "$MENU" com.canonical.dbusmenu Event isvu -- "$QID" clicked s "" 0
    ;;
esac
log "sent $MODE"

for _ in $(seq 1 20); do kill -0 "$GPID" 2>/dev/null || break; sleep 0.25; done
sleep 0.5
if kill -0 "$GPID" 2>/dev/null; then G=running; else G=exited; fi
if [ -n "$ARIA" ] && kill -0 "$ARIA" 2>/dev/null; then A=running; else A=gone; fi
log "RESULT mode=$MODE garia=$G aria2c($ARIA)=$A"
pgrep -a aria2c >>"$LOG" || log "no aria2c processes left"
[ "$G" = running ] && { shot "$MODE-04-still-running.png"; kill "$GPID"; sleep 1; }
[ "$A" = running ] && kill "$ARIA"
rm -rf "$SB"
