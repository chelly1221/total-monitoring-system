#!/bin/bash
# Install the local dashboard into an already mounted, prepared image root.
set -euo pipefail
ROOT=${1:?image root}
HERE=$(cd "$(dirname "$0")" && pwd)
[[ $ROOT == /var/tmp/tms-offline.*/root && -d $ROOT/opt/tms-sensor ]] || exit 2
install -m644 "$HERE/"{local_runtime,hangul_keyboard,tms_display}.py "$ROOT/opt/tms-sensor/"
cp -r "$HERE/assets" "$ROOT/opt/tms-sensor/"
install -m644 "$HERE/tms-sensor.service" "$HERE/tms-display.service" "$ROOT/etc/systemd/system/"
install -m755 "$HERE/display-start.sh" "$ROOT/usr/local/bin/tms-display-start"
install -m755 "$HERE/display-session.sh" "$ROOT/usr/local/bin/tms-display-session"
install -m755 "$HERE/korean-session.sh" "$ROOT/usr/local/bin/tms-korean-session"
# KMS exposes DSI/HDMI displays to Xorg; libinput provides hotplug touch/USB input.
if ! grep -q '^dtoverlay=vc4-kms-v3d' "$ROOT/boot/firmware/config.txt"; then
  printf '\n[all]\ndtoverlay=vc4-kms-v3d\n' >> "$ROOT/boot/firmware/config.txt"
fi
if ! grep -q '^display_auto_detect=1' "$ROOT/boot/firmware/config.txt"; then
  printf '\n[all]\ndisplay_auto_detect=1\n' >> "$ROOT/boot/firmware/config.txt"
fi
systemctl --root="$ROOT" enable tms-display.service
chroot "$ROOT" python3 -c 'from PySide6.QtWidgets import QApplication; from PySide6.QtSvg import QSvgRenderer'
