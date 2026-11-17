xdotool key ctrl+l; sleep 0.3; xdotool type --delay 10 "http://127.0.0.1:8931/batch.html"; xdotool key Return
sleep 1.5; xdotool mousemove 400 300 click 1; xdotool key ctrl+a; sleep 0.5
xdotool mousemove 400 300 click 3; sleep 1; snap 1-menu
xdotool mousemove 515 563; sleep 0.4; xdotool click 1; sleep 3; snap 2-batch-prompt-at-3s
xdotool mousemove 259 186; sleep 0.5; xdotool click 1; sleep 1; xdotool mousemove 959 272; sleep 0.7; xdotool click 1; sleep 1.5; snap 3-batch-opened
xclip -selection clipboard -o > "$OUT/clipboard.txt" 2>&1
