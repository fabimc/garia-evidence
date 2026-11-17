#!/bin/bash
# usage: run.sh <unpacked extension dir> <outdir> <a|c|d>
# Xvfb :77 + Chrome for Testing (fresh profile) + fake xdg-open/xdg-mime/xdg-settings from ./bin.
# Tab lists come from the DevTools /json/list endpoint; screenshots are of the whole X screen.
set -u
EXT=$1; OUT=$2; SC=$3; H=$(dirname "$(readlink -f "$0")")
mkdir -p "$OUT"; rm -rf "$OUT"/*
export HARNESS_LOG=$OUT/xdg.log; : > "$HARNESS_LOG"
export PATH=$H/bin:$PATH
PROFILE=$(mktemp -d); export DISPLAY=:77
Xvfb :77 -screen 0 1280x800x24 >/dev/null 2>&1 & XV=$!
sleep 1
(cd $H/site && python3 -m http.server 8931 --bind 127.0.0.1 >/dev/null 2>&1) & HS=$!
sleep 0.5
${CHROME:-/opt/pw-browsers/chromium-1243/chrome-linux64/chrome} --user-data-dir=$PROFILE --no-first-run --no-default-browser-check \
  --no-sandbox --disable-dev-shm-usage --remote-debugging-port=9333 --window-size=1280,800 --window-position=0,0 \
  --load-extension=$EXT --disable-features=DisableLoadExtensionCommandLineSwitch \
  http://127.0.0.1:8931/ --enable-logging=stderr --v=0 >"$OUT/chrome.log" 2>&1 & CH=$!
sleep 5
snap(){ import -window root "$OUT/$1.png"; curl -s localhost:9333/json/list | python3 -c 'import json,sys; print(json.dumps([t["url"] for t in json.load(sys.stdin) if t["type"]=="page"]))' > "$OUT/$1.tabs.json"; echo "[$1] tabs: $(cat $OUT/$1.tabs.json)"; }
snap 0-page
. $H/scenario-$SC.sh
kill $CH $HS $XV 2>/dev/null; wait 2>/dev/null; rm -rf $PROFILE
echo "--- xdg log"; grep -v xdg-settings "$HARNESS_LOG" | grep -v "xdg-mime" ; true
