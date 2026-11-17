#!/bin/bash
# usage: startup.sh <label> <binary>
label=$1; bin=$2; root=$(mktemp -d /tmp/claude-0/ev/run-XXXX)
home=$root/home; mkdir -p $home/.config/autostart $root/xdg $root/data
echo "=== $label: $bin"
run() { # $1 = XDG_CONFIG_HOME or empty
  ( export HOME=$home XDG_DATA_HOME=$root/data; [ -n "$1" ] && export XDG_CONFIG_HOME=$1 || unset XDG_CONFIG_HOME
    timeout 12 xvfb-run -a "$bin" >$root/app.log 2>&1 ); }
echo "--- Scenario 1: legacy entry, no flag, XDG_CONFIG_HOME unset"
printf '[Desktop Entry]\nType=Application\nVersion=1.0\nName=Garia\nComment=Garia startup script\nExec=/usr/bin/garia \nStartupNotify=false\nTerminal=false' > $home/.config/autostart/Garia.desktop
run ""
echo "Exec after launch: $(grep ^Exec $home/.config/autostart/Garia.desktop)"
echo "--- Scenario 2 (#159): user entry in ~/.config, test run with XDG_CONFIG_HOME=$root/xdg"
printf '[Desktop Entry]\nType=Application\nName=Garia\nExec="/usr/bin/garia" --garia-background\n' > $home/.config/autostart/Garia.desktop
before=$(sha256sum < $home/.config/autostart/Garia.desktop)
run "$root/xdg"
after=$(sha256sum < $home/.config/autostart/Garia.desktop)
echo "Exec after launch: $(grep ^Exec $home/.config/autostart/Garia.desktop)"
[ "$before" = "$after" ] && echo "user entry unchanged: YES" || echo "user entry unchanged: NO"
echo "entries under XDG_CONFIG_HOME/autostart: $(ls $root/xdg/autostart 2>/dev/null | wc -l)"
echo "app log tail:"; tail -3 $root/app.log | sed 's/^/  /'
