#!/bin/bash
# Run under Linux/WSL as root. Only the explicitly supplied regular image file is modified.
set -euo pipefail
SOURCE=$(realpath "${1:?source .img.xz}")
MODEL=${2:?pi34 or pi5}
OUTPUT=$(realpath -m "${3:?output .img.xz}")
[[ $MODEL == pi34 || $MODEL == pi5 ]] || exit 2
[[ -f $SOURCE && $SOURCE != "$OUTPUT" && $OUTPUT == *.img.xz ]] || exit 2
mkdir -p "$(dirname "$OUTPUT")"
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d /var/tmp/tms-offline.XXXXXXXX)
LOOP=
cleanup() {
  if mountpoint -q "$WORK/root"; then umount -R "$WORK/root"; fi
  [[ -z $LOOP ]] || losetup -d "$LOOP"
  # Preserve failed staging directories for diagnosis; never clean a computed external path.
}
trap cleanup EXIT
command -v qemu-aarch64-static >/dev/null
if [[ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]]; then
  cat /usr/lib/binfmt.d/qemu-aarch64.conf > /proc/sys/fs/binfmt_misc/register
fi
xz -dc "$SOURCE" > "$WORK/image.img"
# Expand the last ext4 partition to a fixed 3 GiB image before installing dependencies.
truncate -s 3G "$WORK/image.img"
echo ', +' | sfdisk --no-reread -N 2 "$WORK/image.img"
LOOP=$(losetup --find --show --partscan "$WORK/image.img")
e2fsck -pf "${LOOP}p2" || [[ $? == 1 ]]
resize2fs "${LOOP}p2"
mkdir -p "$WORK/root"
mount "${LOOP}p2" "$WORK/root"
mount "${LOOP}p1" "$WORK/root/boot/firmware"
cp /usr/bin/qemu-aarch64-static "$WORK/root/usr/bin/"
cp -L /etc/resolv.conf "$WORK/root/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$WORK/root/usr/sbin/policy-rc.d"
chmod +x "$WORK/root/usr/sbin/policy-rc.d"
mount --bind /dev "$WORK/root/dev"
mount --make-rslave "$WORK/root/dev"
mount -t devpts devpts "$WORK/root/dev/pts"
mount -t proc proc "$WORK/root/proc"
mount -t sysfs sysfs "$WORK/root/sys"
cp "$HERE/requirements.txt" "$WORK/root/tmp/tms-requirements.txt"
chmod 1777 "$WORK/root/tmp"
if [[ -f "$WORK/root/etc/apt/apt.conf.d/70debconf" ]]; then
  mv "$WORK/root/etc/apt/apt.conf.d/70debconf" "$WORK/root/tmp/tms-70debconf"
fi
chroot "$WORK/root" /bin/bash -ec '
  export DEBIAN_FRONTEND=noninteractive
  export PIP_CONFIG_FILE=/dev/null
  for package in linux-image-rpi-v8 linux-base-rpi-v8 linux-image-rpi-2712 linux-base-rpi-2712 raspi-firmware; do
    if dpkg-query -W "$package" >/dev/null 2>&1; then apt-mark hold "$package"; fi
  done
  apt-get update
  apt-get install -y --no-install-recommends python3-venv python3-lgpio python3-rpi.gpio python3-dev build-essential
  python3 -m venv --system-site-packages /opt/tms-sensor/venv
  /opt/tms-sensor/venv/bin/pip install -r /tmp/tms-requirements.txt
  /opt/tms-sensor/venv/bin/python -c "import lgpio; import importlib.metadata as m; print(m.version(\"adafruit-circuitpython-dht\"))"
  /opt/tms-sensor/venv/bin/python -c "import importlib.util as u; assert u.find_spec(\"RPi.GPIO\") is not None"
  /opt/tms-sensor/venv/bin/pip freeze > /opt/tms-sensor/dependencies.txt
  apt-get clean
  passwd -l root
  if getent passwd dietpi >/dev/null; then passwd -l dietpi; fi
'
if [[ -f "$WORK/root/tmp/tms-70debconf" ]]; then
  mv "$WORK/root/tmp/tms-70debconf" "$WORK/root/etc/apt/apt.conf.d/70debconf"
fi
install -m 755 "$HERE/offline_boot.py" "$WORK/root/usr/local/lib/tms-offline-boot.py"
install -m 644 "$HERE/tms-sensor-setup.service" "$HERE/tms-sensor.service" "$WORK/root/etc/systemd/system/"
mkdir -p "$WORK/root/etc/systemd/system/networking.service.d"
printf '[Unit]\nRequires=tms-sensor-setup.service\nAfter=tms-sensor-setup.service\n' > "$WORK/root/etc/systemd/system/networking.service.d/tms.conf"
# Replace interactive/online DietPi first-run services with the offline setup above.
for unit in dietpi-firstboot dietpi-preboot dietpi-postboot dietpi-fs_partition_resize dietpi-kill_ssh ssh sshd dropbear; do
  systemctl --root="$WORK/root" disable "$unit.service" 2>/dev/null || true
  ln -sf /dev/null "$WORK/root/etc/systemd/system/$unit.service"
done
for unit in apt-daily.timer apt-daily-upgrade.timer; do
  systemctl --root="$WORK/root" mask "$unit"
done
systemctl --root="$WORK/root" enable networking tms-sensor-setup tms-sensor
printf '2\n' > "$WORK/root/boot/dietpi/.install_stage"
printf '0\n' > "$WORK/root/boot/dietpi/.update_stage"
sed -i 's/^CONFIG_CHECK_DIETPI_UPDATES=.*/CONFIG_CHECK_DIETPI_UPDATES=0/;s/^CONFIG_CHECK_APT_UPDATES=.*/CONFIG_CHECK_APT_UPDATES=0/' "$WORK/root/boot/dietpi.txt"
# Predictable eth0 on all supported boards, including Pi 5.
sed -i 's/$/ net.ifnames=0/' "$WORK/root/boot/firmware/cmdline.txt"
mkdir -p "$WORK/root/boot/firmware/tms-sensor"
cp "$HERE/tms_sensor.py" "$WORK/root/boot/firmware/tms-sensor/"
printf '{"name":"TMS 센서","channels":["dht1","door1"],"network":{"mode":"dhcp"}}\n' > "$WORK/root/boot/firmware/tms-sensor/config.json"
printf '{"format":"tms-offline-v1","model":"%s","version":"1.0.0","sourceSha256":"%s"}\n' "$MODEL" "$(sha256sum "$SOURCE" | cut -d' ' -f1)" > "$WORK/root/boot/firmware/tms-image.json"
# No source-host resolver, shared machine identity, or emulator in shipped cards.
rm -f "$WORK/root/usr/sbin/policy-rc.d" "$WORK/root/usr/bin/qemu-aarch64-static" "$WORK/root/tmp/tms-requirements.txt"
truncate -s 0 "$WORK/root/etc/machine-id"
rm -f "$WORK/root/var/lib/dbus/machine-id"
printf 'nameserver 127.0.0.1\n' > "$WORK/root/etc/resolv.conf"
cp "$WORK/root/opt/tms-sensor/dependencies.txt" "${OUTPUT%.img.xz}-dependencies.txt"
sync
cleanup
LOOP=
mkdir -p "$(dirname "$OUTPUT")"
xz -T2 -3 -c "$WORK/image.img" > "$OUTPUT.part"
mv "$OUTPUT.part" "$OUTPUT"
sha256sum "$OUTPUT" > "$OUTPUT.sha256"
printf 'Prepared %s\nStaging retained at %s\n' "$OUTPUT" "$WORK"
