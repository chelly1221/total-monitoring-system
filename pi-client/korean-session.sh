#!/bin/sh
# GUI service entrypoint: tms-korean-session /absolute/path/to/native-gui [args].
# Scope toolkit IM modules to this X11 session, not unrelated Wayland sessions.
set -eu
[ "$#" -gt 0 ] || { echo 'GUI 실행 명령이 필요합니다.' >&2; exit 2; }
export LANG=ko_KR.UTF-8 LANGUAGE=ko_KR:ko:en
export XMODIFIERS=@im=fcitx GTK_IM_MODULE=fcitx QT_IM_MODULE=fcitx
unset LC_ALL
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  exec dbus-run-session -- "$0" "$@"
fi
fcitx5 -d -r
# Wait without triggering a second D-Bus-activated input-method instance.
attempt=0
while [ "$attempt" -lt 50 ]; do
  if fcitx5-remote --check -q >/dev/null 2>&1; then
    exec "$@"
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done
echo '한글 입력기를 시작할 수 없습니다.' >&2
exit 1
