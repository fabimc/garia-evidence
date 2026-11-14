#!/usr/bin/env bash
# Usage: run.sh <before|after> <out-dir>   (run from the garia checkout root)
set -uo pipefail
MODE="$1"; OUT="$2"
ROOT="$(pwd)"
BDIR="$(mktemp -d /tmp/garia-161-bridge-XXXX)"
PAYLOAD="$BDIR/scheduled-161.bin"
head -c 8388608 /dev/urandom >"$PAYLOAD"
mkdir -p "$OUT"
(cd src-tauri && GARIA_BRIDGE_MODE="$MODE" GARIA_BRIDGE_PORT=8790 GARIA_ARIA2_PORT=6810 GARIA_BRIDGE_DIR="$BDIR" \
  setsid mise x rust@stable -- cargo test --lib live_bridge -- --ignored --nocapture >"$BDIR/bridge.out" 2>&1 &)
for _ in $(seq 1 600); do
  curl -s -m 2 -o /dev/null -X POST --data '{"cmd":"schedule_state"}' http://127.0.0.1:8790/invoke && break
  sleep 0.2
done
timeout 300 node /tmp/garia-161-evidence/journey.mjs "$ROOT/src" "$OUT" 8790 "$BDIR" "$PAYLOAD" >"$OUT/journey.log" 2>&1
echo "journey exit $?"
curl -s -m 3 -X POST http://127.0.0.1:8790/stop
sleep 2
cp "$BDIR/bridge-log.jsonl" "$OUT/bridge-log.jsonl"
ls -l "$BDIR/downloads" >"$OUT/downloads-dir.txt"
rm -rf "$BDIR"
