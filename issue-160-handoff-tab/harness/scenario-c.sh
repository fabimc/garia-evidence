xdotool key ctrl+l; sleep 0.3; xdotool type --delay 10 "http://127.0.0.1:8931/file.zip"; xdotool key Return
sleep 4; snap 1-prompt-at-4s
xdotool key Escape; sleep 1; snap 2-dismissed
xdotool mousemove 87 219 click 1; sleep 1.5; snap 3-retry-prompt
xdotool mousemove 259 186; sleep 0.5; xdotool click 1; sleep 1; xdotool mousemove 959 272; sleep 0.7; xdotool click 1; sleep 1.5; snap 4-opened
# second capture: Always allow is on now
xdotool key ctrl+1; sleep 0.5; xdotool key ctrl+l; sleep 0.3; xdotool type --delay 10 "http://127.0.0.1:8931/file.zip?second"; xdotool key Return
sleep 3; snap 5-second-capture
