#!/bin/sh
set -eu
xset s off
xset -dpms
xset s noblank
setxkbmap kr -variant kr104
export HOME=/var/lib/tms-display
export XDG_CONFIG_HOME=$HOME/.config
export XDG_CACHE_HOME=$HOME/.cache
export XDG_RUNTIME_DIR=/run/tms-display
export QT_QPA_PLATFORM=xcb
export QT_AUTO_SCREEN_SCALE_FACTOR=0
export QT_SCALE_FACTOR=1
exec /usr/local/bin/tms-korean-session /usr/bin/python3 /opt/tms-sensor/tms_display.py
