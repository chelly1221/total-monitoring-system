#!/bin/bash
# Validate only locally built staging images. Keep test state in temporary mounts.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
IMAGE=$(realpath "${1:?raw image}")
[[ -f $IMAGE && $IMAGE == /var/tmp/tms-offline.*/image.img ]] || exit 2
ROOT=$(mktemp -d /var/tmp/tms-korean-check.XXXXXXXX)
LOOP=$(losetup --find --show --read-only --partscan "$IMAGE")
cleanup() {
  for attempt in {1..20}; do
    if umount -R "$ROOT" 2>/dev/null; then losetup -d "$LOOP"; return; fi
    sleep 0.5
  done
  echo "Cleanup failed: $ROOT $LOOP" >&2
  return 1
}
trap cleanup EXIT
mount -o ro "${LOOP}p2" "$ROOT"
mount -o ro "${LOOP}p1" "$ROOT/boot/firmware"
cat "$ROOT/boot/firmware/tms-image.json"
cat "$ROOT/etc/default/locale"
cat "$ROOT/opt/tms-sensor/korean-dependencies.txt"
test ! -s "$ROOT/etc/machine-id"
test ! -e "$ROOT/usr/bin/qemu-aarch64-static"
test -x "$ROOT/usr/local/bin/tms-korean-session"
cmp "$HERE/korean-session.sh" "$ROOT/usr/local/bin/tms-korean-session"
mount -t tmpfs tmpfs "$ROOT/tmp"
mount --bind /dev "$ROOT/dev"
mount --make-rslave "$ROOT/dev"
mount -t proc proc "$ROOT/proc"
unshare -n chroot "$ROOT" env LANG=ko_KR.UTF-8 python3 - < "$HERE/verify-korean.py"
unshare -n chroot "$ROOT" python3 -c 'import locale; assert locale.setlocale(locale.LC_ALL,"ko_KR.UTF-8"); print("Offline Korean locale passed")'
mkdir -m700 "$ROOT/tmp/runtime"
printf '1234567890abcdef1234567890abcdef\n' > "$ROOT/tmp/test-machine-id"
mount --bind "$ROOT/tmp/test-machine-id" "$ROOT/etc/machine-id"
unshare -n chroot "$ROOT" env -u DISPLAY -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS \
  HOME=/tmp XDG_CONFIG_HOME=/tmp/config XDG_RUNTIME_DIR=/tmp/runtime \
  /usr/local/bin/tms-korean-session /bin/bash -c '
    trap "fcitx5-remote -e; sleep 1" EXIT
    for attempt in {1..30}; do
      method=$(fcitx5-remote --check -q 2>/dev/null || true)
      if [[ $method == 기본 ]] && [[ $(fcitx5-remote --check -m hangul) == hangul ]]; then
        echo "Offline Fcitx Hangul session passed"; exit 0
      fi
      sleep 0.2
    done
    echo "Unexpected initial input method: $method" >&2
    exit 1
  '
systemctl --root="$ROOT" is-enabled tms-sensor tms-sensor-setup
echo 'Network-isolated ARM Korean verification passed'
