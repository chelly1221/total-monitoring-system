#!/usr/bin/python3
"""Prepare identity/network from the FAT partition, with no network downloads."""
import ipaddress
import json
from pathlib import Path
import re
import shutil
import subprocess


def configure(boot=Path('/boot/firmware/tms-sensor'), root=Path('/')):
    config = json.loads((boot / 'config.json').read_text('utf-8'))
    if not isinstance(config.get('name'), str) or not 1 <= len(config['name']) <= 32:
        raise ValueError('장비 이름을 확인하세요')
    channels = config.get('channels', [])
    allowed = {f'{kind}{i}' for kind in ('dht', 'door') for i in range(1, 5)}
    if not channels or not set(channels) <= allowed or len(channels) != len(set(channels)):
        raise ValueError('센서 채널을 확인하세요')
    network = config.get('network', {})
    if network.get('mode') == 'static':
        address = ipaddress.IPv4Interface(network['address'])
        if address.ip in (address.network.network_address, address.network.broadcast_address):
            raise ValueError('사용할 수 없는 고정 IP입니다')
        gateway = network.get('gateway', '')
        if gateway and ipaddress.IPv4Address(gateway) not in address.network:
            raise ValueError('게이트웨이는 같은 서브넷이어야 합니다')
        interfaces = f'auto eth0\niface eth0 inet static\n    address {address}\n'
        if gateway:
            interfaces += f'    gateway {gateway}\n'
    elif network.get('mode', 'dhcp') == 'dhcp':
        interfaces = 'auto eth0\niface eth0 inet dhcp\n'
    else:
        raise ValueError('네트워크 설정이 올바르지 않습니다')
    destination = root / 'opt/tms-sensor'
    destination.mkdir(parents=True, exist_ok=True)
    for name in ('tms_sensor.py', 'config.json'):
        shutil.copyfile(boot / name, destination / name)
    (root / 'etc/network/interfaces').write_text('auto lo\niface lo inet loopback\n\n' + interfaces)
    state = root / 'var/lib/tms-sensor'
    state.mkdir(parents=True, exist_ok=True)
    # Keep the per-card hostname and UUID across power cycles; never bake either into a template.
    hostname_file = state / 'hostname'
    if not hostname_file.exists():
        import uuid
        hostname_file.write_text('tms-pi-' + uuid.uuid4().hex[:8])
    hostname = hostname_file.read_text().strip()
    if not re.fullmatch(r'tms-pi-[0-9a-f]{8}', hostname):
        raise ValueError('장비 호스트 이름이 올바르지 않습니다')
    (root / 'etc/hostname').write_text(hostname + '\n')
    (root / 'etc/hosts').write_text(f'127.0.0.1 localhost\n127.0.1.1 {hostname}\n::1 localhost ip6-localhost\n')
    if root == Path('/'):
        subprocess.run(['hostname', hostname], check=True)


if __name__ == '__main__':
    configure()
