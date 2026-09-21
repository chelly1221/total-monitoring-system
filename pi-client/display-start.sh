#!/bin/sh
set -eu
export XAUTHORITY=/run/tms-display/Xauthority
touch "$XAUTHORITY"
chmod 600 "$XAUTHORITY"
xauth -f "$XAUTHORITY" add :0 . "$(mcookie)"
exec /usr/bin/xinit /usr/local/bin/tms-display-session -- /usr/lib/xorg/Xorg :0 vt7 -auth "$XAUTHORITY" -nolisten tcp -s 0 -dpms -noreset
