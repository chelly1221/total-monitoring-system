#!/bin/bash
# Run inside the ARM image chroot at build time, never at first boot.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
printf '3090ccde0442bb347aa7685d9ba8b17436a60682df6e8f92a9a670de14056e22  %s\n' "$HERE/assets/PretendardVariable.ttf" | sha256sum -c -
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends locales tzdata fontconfig fonts-noto-cjk \
  keyboard-configuration xkb-data dbus-x11 fcitx5 fcitx5-hangul \
  fcitx5-frontend-gtk3 fcitx5-frontend-qt6
sed -i -E 's/^# ?(ko_KR.UTF-8 UTF-8|en_US.UTF-8 UTF-8)$/\1/' /etc/locale.gen
locale-gen
update-locale LANG=ko_KR.UTF-8 LANGUAGE=ko_KR:ko:en LC_ALL
ln -snf /usr/share/zoneinfo/Asia/Seoul /etc/localtime
printf 'Asia/Seoul\n' > /etc/timezone
cat > /etc/default/keyboard <<'EOF'
XKBMODEL="pc105"
XKBLAYOUT="kr"
XKBVARIANT="kr104"
XKBOPTIONS=""
BACKSPACE="guess"
EOF
install -Dm644 "$HERE/assets/PretendardVariable.ttf" /usr/local/share/fonts/pretendard/PretendardVariable.ttf
install -Dm644 "$HERE/assets/Pretendard-LICENSE.txt" /usr/share/doc/tms-korean/Pretendard-LICENSE.txt
install -Dm644 "$HERE/korean/fontconfig.conf" /etc/fonts/conf.d/99-tms-korean.conf
install -Dm644 "$HERE/korean/profile" /etc/xdg/fcitx5/profile
install -Dm644 "$HERE/korean/config" /etc/xdg/fcitx5/config
install -Dm644 "$HERE/korean/hangul.conf" /etc/xdg/fcitx5/conf/hangul.conf
install -Dm755 "$HERE/korean-session.sh" /usr/local/bin/tms-korean-session
fc-cache -f
# Fail the image build if the Korean locale or full native font is missing.
env LANG=ko_KR.UTF-8 locale charmap | grep -qx UTF-8
fc-match -f '%{family}\n' 'sans-serif:lang=ko' | grep -q 'Pretendard'
python3 "$HERE/verify-korean.py"
dpkg-query -W -f='${Package}\t${Version}\n' locales tzdata fontconfig fonts-noto-cjk \
  keyboard-configuration xkb-data dbus-x11 fcitx5 fcitx5-hangul \
  fcitx5-frontend-gtk3 fcitx5-frontend-qt6 > /opt/tms-sensor/korean-dependencies.txt
