#!/usr/bin/env python3
"""TMS GPIO client. Discovery is server initiated; measurements are unicast."""
import ipaddress
import json
import logging
import math
import os
from pathlib import Path
import socket
import threading
import time
import uuid

CHANNELS = {
    'dht1': ('dht22', 4), 'dht2': ('dht22', 17),
    'dht3': ('dht22', 27), 'dht4': ('dht22', 22),
    'door1': ('mc58', 23), 'door2': ('mc58', 24),
    'door3': ('mc58', 25), 'door4': ('mc58', 26),
}
DISCOVERY_PORT = 7793
VERSION = '2.0.0'


def gpiochip_number(base=Path('/sys/bus/gpio/devices')):
    for device in base.glob('gpiochip*'):
        compatible = device / 'of_node/compatible'
        if compatible.is_file():
            drivers = set(compatible.read_text().split('\0'))
            if drivers & {'raspberrypi,rp1-gpio', 'brcm,bcm2835-gpio', 'brcm,bcm2711-gpio',
                          'raspberrypi,bcm2835-gpio', 'raspberrypi,bcm2711-gpio'}:
                return int(device.name.removeprefix('gpiochip'))
    raise RuntimeError('40핀 GPIO 컨트롤러를 찾을 수 없습니다')


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def valid_target(value):
    if not isinstance(value, dict) or type(value.get('port')) is not int or not 1 <= value['port'] <= 65535:
        return False
    try:
        address = ipaddress.IPv4Address(value.get('ip'))
        return not (address.is_unspecified or address.is_multicast or address.is_loopback or str(address) == '255.255.255.255')
    except (ValueError, TypeError, ipaddress.AddressValueError):
        return False


class Client:
    def __init__(self, settings_path, boot_config):
        self.path = Path(settings_path)
        self.lock = threading.RLock()
        self.dht_lock = threading.Lock()
        self.started = time.monotonic()
        self.state = json.loads(self.path.read_text('utf-8')) if self.path.exists() else {
            'id': str(uuid.uuid4()), 'name': boot_config['name'],
            'channels': {key: {'target': None, 'closedLevel': 0} for key in boot_config['channels']},
        }
        if not isinstance(self.state['channels'], dict) or any(c not in CHANNELS for c in self.state['channels']):
            raise ValueError('활성 채널 설정이 올바르지 않습니다')
        atomic_json(self.path, self.state)
        from local_runtime import LocalRuntime
        self.runtime = LocalRuntime(self)

    write_json = staticmethod(atomic_json)

    def persist(self, state):
        atomic_json(self.path, state)
        self.state = state

    def handle(self, message, source):
        if not isinstance(message, dict) or message.get('v') != 1:
            return None
        nonce = message.get('nonce')
        if not isinstance(nonce, str) or len(nonce) != 16 or any(c not in '0123456789abcdef' for c in nonce):
            return None
        with self.lock:
            base = {'v': 1, 'nonce': nonce, 'id': self.state['id']}
            if message.get('t') == 'probe':
                return dict(base, t='here', kind='pi', name=self.state['name'], host=socket.gethostname()[:64],
                            ver=VERSION, running=True, uptimeSec=int(time.monotonic() - self.started),
                            channels=[{'id': key, 'target': c['target'], 'closedLevel': c.get('closedLevel', 0)} for key, c in self.state['channels'].items()])
            if message.get('t') != 'config':
                return dict(base, t='ack', ok=False, error='라즈베리파이에서 지원하지 않는 명령입니다')
            channel = message.get('channel')
            target = message.get('target')
            level = message.get('closedLevel', 0)
            if (message.get('id') != self.state['id'] or channel not in self.state['channels'] or
                    not valid_target(target) or target['ip'] != source or
                    type(level) is not int or level not in (0, 1) or message.get('intervalMs') != 5000):
                return dict(base, t='ack', ok=False, error='장비 식별자, 채널 또는 서버 설정이 올바르지 않습니다')
            updated = json.loads(json.dumps(self.state))
            updated['channels'][channel] = {'target': target, 'closedLevel': level}
            updated['serverIp'] = target['ip']
            try:
                atomic_json(self.path, updated)
            except OSError:
                logging.exception('설정 저장 실패')
                return dict(base, t='ack', ok=False, error='설정을 저장하지 못했습니다')
            self.state = updated
            return dict(base, t='ack', ok=True, error='')

    def send(self, key, value, udp):
        with self.lock:
            target = self.state['channels'].get(key, {}).get('target')
            if target:
                packet = {'v': 1, 't': 'sensor', 'id': self.state['id'], 'channel': key, 'value': value}
                try:
                    udp.sendto(json.dumps(packet, separators=(',', ':')).encode('utf-8'), (target['ip'], target['port']))
                except OSError as error:
                    logging.warning('서버 전송 실패: %s', error)

    def dht_loop(self, key, gpio):
        # Each sensor owns its reader and schedule; a failing DHT cannot block doors.
        while True:
            sensor = None
            try:
                import board
                import adafruit_dht
                sensor = adafruit_dht.DHT22(getattr(board, f'D{gpio}'), use_pulseio=False)
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
                    while True:
                        try:
                            # Bit-banged DHT pulses must not compete with another DHT reader.
                            with self.dht_lock:
                                temperature, humidity = sensor.temperature, sensor.humidity
                            if (temperature is not None and humidity is not None and
                                    math.isfinite(temperature) and math.isfinite(humidity) and
                                    -40 <= temperature <= 80 and 0 <= humidity <= 100):
                                self.runtime.sample(key, [temperature, humidity])
                                self.send(key, f'{temperature:.1f},{humidity:.1f}', udp)
                        except RuntimeError as error:
                            logging.warning('%s: %s', key, error)
                        time.sleep(5)
            except Exception:
                logging.exception('%s 센서 읽기 실패; 10초 후 재시도', key)
                time.sleep(10)
            finally:
                if sensor is not None:
                    try:
                        sensor.exit()
                    except Exception:
                        logging.exception('%s 센서 정리 실패', key)

    def door_loop(self, key, gpio):
        while True:
            chip = None
            try:
                import lgpio
                chip = lgpio.gpiochip_open(gpiochip_number())
                lgpio.gpio_claim_input(chip, gpio, lgpio.SET_PULL_UP)
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
                    candidate, stable, since, sent, last_value = None, None, 0, 0, None
                    while True:
                        now = time.monotonic()
                        value = lgpio.gpio_read(chip, gpio)
                        if value != candidate:
                            candidate, since = value, now
                        if now - since >= 0.1:
                            stable = candidate
                        with self.lock:
                            binding = self.state['channels'].get(key, {'target': None})
                            closed = binding.get('closedLevel', 0)
                            target = binding['target']
                        payload = 'CLOSED' if stable == closed else 'OPEN'
                        current = (payload, json.dumps(target))
                        if stable is not None and (current != last_value or now - sent >= 5):
                            self.runtime.sample(key, stable)
                            self.send(key, payload, udp)
                            sent, last_value = now, current
                        time.sleep(0.02)
            except Exception:
                logging.exception('%s 센서 읽기 실패; 10초 후 재시도', key)
                time.sleep(10)
            finally:
                if chip is not None:
                    lgpio.gpiochip_close(chip)

    def run(self):
        threading.Thread(target=self.runtime.serve, daemon=True).start()
        for key in CHANNELS:
            kind, gpio = CHANNELS[key]
            threading.Thread(target=self.dht_loop if kind == 'dht22' else self.door_loop,
                             args=(key, gpio), daemon=True).start()
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as udp:
            udp.bind(('0.0.0.0', DISCOVERY_PORT))
            while True:
                raw, source = udp.recvfrom(1201)
                if len(raw) > 1200:
                    continue
                try:
                    reply = self.handle(json.loads(raw), source[0])
                    if reply:
                        data = json.dumps(reply, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
                        if len(data) <= 1200:
                            udp.sendto(data, source)
                except (ValueError, TypeError, KeyError, OSError):
                    logging.exception('탐지 요청 처리 실패')


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    boot = json.loads(Path('/opt/tms-sensor/config.json').read_text('utf-8'))
    Client('/var/lib/tms-sensor/settings.json', boot).run()
