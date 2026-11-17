xdotool search --sync --onlyvisible --class chromium windowactivate --sync 2>/dev/null || true
xdotool key ctrl+l; sleep 0.3; xdotool type --delay 10 "http://127.0.0.1:8931/file.zip"; xdotool key Return
sleep 1; snap 1-after-1s
sleep 3; snap 2-after-4s
