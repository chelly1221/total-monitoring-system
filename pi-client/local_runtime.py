"""Local sensor state, offline alarms and a bounded Unix-socket GUI interface."""
import copy
import json
import math
import os
from pathlib import Path
import socketserver
import threading
import time
import urllib.request

KEYS = [f'{kind}{i}' for kind in ('dht', 'door') for i in range(1, 5)]


def condition(value, rule):
    if not isinstance(rule, dict):
        return False
    a, b, op = rule.get('value1'), rule.get('value2'), rule.get('operator')
    if not isinstance(a, (int, float)) or not math.isfinite(a):
        return False
    if rule.get('stringValue') is not None:
        return str(value) == rule['stringValue'] if op == 'eq' else str(value) != rule['stringValue'] if op == 'neq' else False
    if op == 'between':
        return isinstance(b if b is not None else a, (int, float)) and a <= value <= (b if b is not None else a)
    return {'gte': value >= a, 'lte': value <= a, 'eq': value == a, 'neq': value != a}.get(op, False)


def critical(value, item):
    if not isinstance(item, dict):
        return False
    if item.get('alarmEnabled') is False:
        return False
    groups = item.get('conditions') or {}
    if not isinstance(groups, dict):
        return False
    rules = [rule for group in ('critical', 'coldCritical', 'dryCritical', 'humidCritical')
             for rule in (groups.get(group) if isinstance(groups.get(group), list) else [])]
    if rules:
        return any(condition(value, rule) for rule in rules)
    return ((isinstance(item.get('critical'), (int, float)) and value >= item['critical']) or
            (isinstance(item.get('warning'), (int, float)) and value <= item['warning']))


class LocalRuntime:
    def __init__(self, client, clock=time.monotonic):
        self.client, self.clock = client, clock
        self.started = clock()
        self.readings, self.episodes, self.acknowledged = {}, {}, set()
        self.sequence, self.mute_until, self.scan_until = 0, 0, 0
        self.door_test = {}
        self.server_at, self.server_seen = 0, False
        self.server_error = ''
        self.cache = {'alarms': [], 'channels': []}
        self.cache_path = client.path.with_name('server-cache.json')
        try:
            cache = json.loads(self.cache_path.read_text('utf-8'))
            self.validate_server(dict(cache, v=1))
            if cache.get('ip') == self.server_ip():
                self.cache = cache
        except (OSError, ValueError, TypeError):
            pass

    def server_ip(self):
        state = self.client.state
        return state.get('serverIp') or next((c['target']['ip'] for c in state['channels'].values() if c.get('target')), '')

    def ui(self):
        return self.client.state.get('ui', {})

    def sample(self, key, value):
        with self.client.lock:
            self.readings[key] = {'value': value, 'at': self.clock()}
            if key.startswith('dht') and key not in self.client.state['channels'] and (self.ui().get('autoScan', True) or self.clock() < self.scan_until):
                state = copy.deepcopy(self.client.state)
                state['channels'][key] = {'target': None, 'closedLevel': 0}
                self.client.persist(state)

    def snapshot(self):
        with self.client.lock:
            now = self.clock()
            if self.cache.get('ip') and self.cache['ip'] != self.server_ip():
                self.cache = {'alarms': [], 'channels': []}
                self.server_seen = False
            ui = self.ui()
            names = ui.get('names', {})
            policies = {c['id']: c for c in self.cache.get('channels', [])}
            channels, alarms, active = [], [], set()

            def alarm(key, title, detail, severity='critical', kind='local'):
                active.add(key)
                if key not in self.episodes:
                    self.sequence += 1
                    self.episodes[key] = (self.sequence, time.strftime('%H:%M:%S'))
                episode, at = self.episodes[key]
                alarms.append({'id': f'{key}:{episode}', 'title': title, 'detail': detail,
                               'severity': severity, 'source': 'local', 'kind': kind, 'occurredAt': at})

            for key in KEYS:
                enabled = key in self.client.state['channels']
                reading = self.readings.get(key)
                fresh = reading is not None and now - reading['at'] < 60
                name = names.get(key) or policies.get(key, {}).get('name') or ('온습도 ' if key.startswith('dht') else '개폐 ') + key[-1]
                value = reading['value'] if fresh else None
                age = round(now - reading['at']) if reading else None
                if key.startswith('door') and value is not None:
                    value = 'CLOSED' if value == self.client.state['channels'].get(key, {}).get('closedLevel', 0) else 'OPEN'
                channels.append({'id': key, 'name': name, 'enabled': enabled, 'fresh': fresh, 'value': value,
                                 'age': age, 'lastValue': reading['value'] if reading else None,
                                 'raw': reading['value'] if fresh else None})
                if not enabled:
                    continue
                if not fresh and now - self.started >= 60:
                    alarm(f'offline:{key}', f'{name} 응답 없음', '현재값 — · 센서와 배선을 확인하세요', 'warning', 'offline')
                elif value == 'OPEN':
                    alarm(f'door:{key}', f'{name} 열림', 'MC-58(NC) · 접점 개방', kind='door')
                elif key.startswith('dht') and isinstance(value, list):
                    for item in policies.get(key, {}).get('displayItems', []):
                        index = item.get('index')
                        if type(index) is int and 0 <= index < 2 and critical(value[index], item):
                            alarm(f'metric:{key}:{index}', f"{name} {item.get('name', '측정값')} 이상",
                                  f"{value[index]:.1f}{item.get('unit', '')} · 서버 임계값 적용", kind='sensor')
            bound = bool(self.server_ip())
            online = self.server_seen and now - self.server_at < 15
            if bound and not online and now - self.started >= 15:
                alarm('server-offline', '본 서버 연결 끊김', '현장 센서 감시는 계속됩니다 · 마지막 서버 알람은 상태 미확인', 'warning', 'offline')
            for item in self.cache.get('alarms', []):
                item = copy.deepcopy(item)
                item['id'] = f"server:{item['id']}:{item.get('occurrence', 1)}:{item.get('occurredAt', '')}"
                if not online:
                    item['detail'] = '상태 미확인 · ' + item.get('detail', '')
                alarms.append(item)
            self.episodes = {k: v for k, v in self.episodes.items() if k in active}
            live_ids = {a['id'] for a in alarms}
            self.acknowledged.intersection_update(live_ids)
            for item in alarms:
                item['acknowledged'] = item['id'] in self.acknowledged
            alarms.sort(key=lambda a: (a.get('severity') != 'critical', a['id']))
            return {'name': self.client.state['name'], 'id': self.client.state['id'], 'channels': channels,
                    'alarms': alarms, 'server': {'ip': self.server_ip(), 'online': online, 'bound': bound, 'error': self.server_error},
                    'rotation': ui.get('rotation', 0), 'autoScan': ui.get('autoScan', True),
                    'mutedSeconds': max(0, math.ceil(self.mute_until - now)), 'scanning': now < self.scan_until,
                    'pendingNames': list(ui.get('pendingNames', {})), 'doorTest': self.door_test}

    def command(self, request):
        with self.client.lock:
            action = request.get('action')
            if action == 'snapshot':
                return self.snapshot()
            state = copy.deepcopy(self.client.state)
            ui = state.setdefault('ui', {})
            if action == 'rename':
                key, name = request.get('channel'), request.get('name')
                if key not in KEYS or not isinstance(name, str) or not 1 <= len(name.strip()) <= 20 or any(ord(c) < 32 for c in name):
                    raise ValueError('센서 이름은 1~20자로 입력하세요')
                ui.setdefault('names', {})[key] = name.strip()
                ui.setdefault('pendingNames', {})[key] = name.strip()
            elif action == 'rotation':
                if type(request.get('value')) is not int or request['value'] not in (0, 180):
                    raise ValueError('화면 방향을 확인하세요')
                ui['rotation'] = request['value']
            elif action == 'autoScan':
                if type(request.get('value')) is not bool:
                    raise ValueError('자동 탐지 설정을 확인하세요')
                ui['autoScan'] = request['value']
            elif action == 'scan':
                self.scan_until = self.clock() + 20
                return {'ok': True}
            elif action in ('doorClosed', 'doorOpen'):
                key = request.get('channel')
                reading = self.readings.get(key)
                if key not in KEYS[4:] or not reading or self.clock() - reading['at'] >= 10:
                    raise ValueError('접점을 읽지 못했습니다. 배선을 확인하세요')
                if action == 'doorClosed':
                    self.door_test[key] = reading['value']
                    return {'ok': True}
                if key not in self.door_test or self.door_test[key] == reading['value']:
                    raise ValueError('닫힘 확인 후 문을 열어 접점 변화를 확인하세요')
                state['channels'].setdefault(key, {'target': None})['closedLevel'] = self.door_test.pop(key)
            elif action == 'ack':
                self.acknowledged.update(a['id'] for a in self.snapshot()['alarms'])
                return {'ok': True}
            elif action == 'mute':
                self.mute_until = self.clock() + 60
                return {'ok': True}
            else:
                raise ValueError('지원하지 않는 설정입니다')
            self.client.persist(state)
            return {'ok': True}

    @staticmethod
    def validate_server(response):
        if not isinstance(response, dict) or response.get('v') != 1 or not isinstance(response.get('alarms'), list) or not isinstance(response.get('channels'), list):
            raise ValueError('서버 응답 형식 오류')
        for alarm in response['alarms']:
            if not isinstance(alarm, dict) or not all(isinstance(alarm.get(k, ''), str) for k in ('id', 'title', 'severity', 'detail', 'kind', 'source', 'occurredAt')) or not alarm.get('id'):
                raise ValueError('서버 알람 형식 오류')
        for channel in response['channels']:
            if not isinstance(channel, dict) or channel.get('id') not in KEYS or not isinstance(channel.get('name', ''), str) or not isinstance(channel.get('displayItems', []), list):
                raise ValueError('서버 채널 형식 오류')
            if any(not isinstance(item, dict) for item in channel.get('displayItems', [])):
                raise ValueError('서버 임계값 형식 오류')

    def accept_server(self, response, ip):
        self.validate_server(response)
        cache = {'ip': ip, 'alarms': response['alarms'], 'channels': response['channels']}
        with self.client.lock:
            if ip != self.server_ip():
                return
            if self.cache != cache:
                self.client.write_json(self.cache_path, cache)
            self.cache = cache
            self.server_at, self.server_seen, self.server_error = self.clock(), True, ''

    def server_loop(self):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while True:
            ip = self.server_ip()
            if ip:
                try:
                    url = f'http://{ip}:7777/api/pi/dashboard'
                    with opener.open(url + '?id=' + self.client.state['id'], timeout=3) as stream:
                        raw = stream.read(4 * 1024 * 1024 + 1)
                    if len(raw) > 4 * 1024 * 1024:
                        raise ValueError('서버 응답이 너무 큽니다')
                    self.accept_server(json.loads(raw), ip)
                    with self.client.lock:
                        pending = dict(self.ui().get('pendingNames', {}))
                    for key, name in pending.items():
                        if not any(c['id'] == key for c in self.cache['channels']):
                            continue
                        req = urllib.request.Request(url, json.dumps({'id': self.client.state['id'], 'channel': key, 'name': name}).encode(),
                                                     {'Content-Type': 'application/json'}, method='POST')
                        with opener.open(req, timeout=3) as response:
                            response.read(1024)
                        with self.client.lock:
                            state = copy.deepcopy(self.client.state)
                            if state.get('ui', {}).get('pendingNames', {}).get(key) == name:
                                del state['ui']['pendingNames'][key]
                                self.client.persist(state)
                except Exception as error:
                    self.server_error = str(error)[:160]
            time.sleep(3)

    def serve(self, path='/run/tms-sensor/control.sock'):
        runtime = self
        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                self.request.settimeout(2)
                try:
                    raw = self.rfile.readline(8193)
                    if len(raw) > 8192:
                        raise ValueError('요청이 너무 큽니다')
                    response = runtime.command(json.loads(raw))
                except Exception as error:
                    response = {'error': str(error)[:160]}
                self.wfile.write(json.dumps(response, ensure_ascii=False).encode() + b'\n')
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).unlink(missing_ok=True)
        server = socketserver.ThreadingUnixStreamServer(path, Handler)
        server.daemon_threads = True
        os.chmod(path, 0o600)
        threading.Thread(target=self.server_loop, daemon=True).start()
        server.serve_forever()
