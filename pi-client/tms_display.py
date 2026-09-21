#!/usr/bin/python3
"""Native Qt touchscreen. All measurements remain owned by the separate daemon."""
import argparse
import json
import math
from pathlib import Path
import queue
import socket
import subprocess
import sys
import time

from PySide6.QtCore import QEvent, QObject, QRectF, QSize, Qt, QThread, QTimer, Signal
from PySide6.QtGui import QColor, QFont, QFontDatabase, QIcon, QInputDevice, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import (QApplication, QFrame, QGraphicsScene, QGraphicsView, QGridLayout,
                              QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout, QWidget)
from hangul_keyboard import compose, KEYS

HERE = Path(__file__).resolve().parent
PALETTES = {
    'normal': ('#0c0c0c', '#181818', '#242424', '#f2f2f2', '#ababab', '#363636', '#ebebeb', '#111111'),
    'alarm': ('#25191a', '#352325', '#482925', '#fff2ee', '#d5b5b2', '#70494a', '#f4c5ba', '#381f1e'),
    'offline': ('#282116', '#382e1f', '#49381f', '#fff3df', '#d6c09c', '#796346', '#efc587', '#352713'),
}


def icon(name, color='#f2f2f2'):
    path = HERE / 'assets/icons' / (name + '.svg')
    if not path.exists():
        return QIcon()
    renderer = QSvgRenderer(path.read_bytes().replace(b'currentColor', color.encode()))
    pixmap = QPixmap(32, 32)
    pixmap.fill(Qt.GlobalColor.transparent)
    painter = QPainter(pixmap)
    renderer.render(painter)
    painter.end()
    return QIcon(pixmap)


def label(text='', size=14, muted=False):
    widget = QLabel(text)
    widget.setTextFormat(Qt.TextFormat.PlainText)
    widget.setWordWrap(True)
    widget.setFont(QFont('Pretendard Variable', size))
    widget.setStyleSheet(f'font-size: {size}px;')
    if muted:
        widget.setObjectName('muted')
    return widget


def button(text, callback, name=None, primary=False):
    widget = QPushButton(text)
    widget.setMinimumHeight(44)
    widget.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
    if name:
        widget.setIcon(icon(name))
        widget.setIconSize(QSize(20, 20))
    if primary:
        widget.setObjectName('primary')
    widget.clicked.connect(callback)
    return widget


def row(*widgets):
    layout = QHBoxLayout()
    layout.setContentsMargins(0, 0, 0, 0)
    layout.setSpacing(10)
    for widget in widgets:
        layout.addWidget(widget)
    return layout


def clear(layout):
    while layout.count():
        item = layout.takeAt(0)
        if item.widget():
            item.widget().hide()
            item.widget().deleteLater()
        elif item.layout():
            clear(item.layout())


class Bridge(QThread):
    snapshot = Signal(dict)
    result = Signal(dict)

    def __init__(self, path):
        super().__init__()
        self.path, self.commands = path, queue.Queue()
        self.running = True

    def send(self, command):
        self.commands.put(command)

    def request(self, command):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
            stream.settimeout(1)
            stream.connect(self.path)
            stream.sendall(json.dumps(command).encode() + b'\n')
            response = bytearray()
            while not response.endswith(b'\n'):
                chunk = stream.recv(65536)
                if not chunk or len(response) > 5 * 1024 * 1024:
                    raise OSError('센서 서비스 응답이 올바르지 않습니다')
                response.extend(chunk)
            return json.loads(response)

    def run(self):
        while self.running:
            try:
                while not self.commands.empty():
                    command = self.commands.get_nowait()
                    self.result.emit(dict(self.request(command), action=command['action']))
                self.snapshot.emit(self.request({'action': 'snapshot'}))
            except (OSError, ValueError) as error:
                self.result.emit({'error': '센서 서비스 연결 대기 · ' + str(error), 'action': 'connection'})
            self.msleep(500)


class TouchKeyboard(QWidget):
    def __init__(self, field):
        super().__init__()
        self.field, self.mode, self.shift = field, 'ko', False
        self.raw, self.before, self.after, self.rendered = '', '', '', None
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(5)
        self.build()

    def reset(self):
        self.raw, self.rendered = '', None

    def type_key(self, key):
        field = self.field
        if key == 'clear':
            field.clear()
            self.reset()
        elif key == 'back':
            if self.rendered == field.text() and self.raw and field.cursorPosition() == len(self.before + compose(self.raw)):
                self.raw = self.raw[:-1]
                text = compose(self.raw)
                field.setText(self.before + text + self.after)
                field.setCursorPosition(len(self.before + text))
                self.rendered = field.text()
            else:
                field.backspace()
                self.reset()
        elif self.mode == 'ko' and key in KEYS:
            current = field.text()
            if self.rendered != current or field.cursorPosition() != len(self.before + compose(self.raw)):
                start = field.selectionStart()
                start = field.cursorPosition() if start < 0 else start
                self.before, self.after = current[:start], current[start + len(field.selectedText()):]
                self.raw = ''
            proposed = self.raw + key
            text = self.before + compose(proposed) + self.after
            if len(text) <= 20:
                self.raw = proposed
                field.setText(text)
                field.setCursorPosition(len(self.before + compose(self.raw)))
                self.rendered = text
        else:
            self.reset()
            field.insert(key)
        field.setFocus()

    def build(self):
        clear(self.layout)
        rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'] if self.mode != 'num' else ['1234567890', '-_./():+%', '[]@#&,?!']
        for index, keys in enumerate(rows):
            line = QHBoxLayout()
            line.setSpacing(5)
            if index == 2:
                line.addWidget(button('Shift', self.toggle_shift))
            for key in keys:
                value = key.upper() if self.shift and (self.mode == 'en' or key in 'qwertop') else key
                text = KEYS.get(value, value) if self.mode == 'ko' else value
                control = button(text, lambda checked=False, value=value: self.type_key(value))
                control.setMinimumWidth(0)
                control.setMinimumHeight(39)
                control.setAccessibleName(text)
                line.addWidget(control)
            if index == 2:
                line.addWidget(button('지우기', lambda: self.type_key('back')))
            self.layout.addLayout(line)
        self.layout.addLayout(row(button('ABC' if self.mode == 'ko' else '한글', self.toggle_language),
                                  button('123' if self.mode != 'num' else '한글', self.toggle_numbers),
                                  button('띄어쓰기', lambda: self.type_key(' ')),
                                  button('전체 지우기', lambda: self.type_key('clear'))))
        for control in self.findChildren(QPushButton):
            control.setFocusPolicy(Qt.FocusPolicy.NoFocus)

    def toggle_shift(self):
        self.shift = not self.shift
        self.build()

    def toggle_language(self):
        self.mode = 'en' if self.mode == 'ko' else 'ko'
        self.reset()
        self.build()

    def toggle_numbers(self):
        self.mode = 'num' if self.mode != 'num' else 'ko'
        self.reset()
        self.build()


class Dashboard(QWidget):
    def __init__(self, send):
        super().__init__()
        self.send = send
        self.data = {'name': 'TMS LOCAL', 'id': '', 'channels': [], 'alarms': [], 'rotation': 0,
                     'server': {'online': False, 'bound': False, 'ip': ''}, 'autoScan': True,
                     'scanning': False, 'mutedSeconds': 0, 'pendingNames': [], 'doorTest': {}}
        self.page, self.tab, self.channel, self.alarm_page = 'home', 'display', 'dht1', 0
        self.signature, self.alarm_ids, self.input_mode = None, set(), '입력 대기'
        self.rotation_pending, self.rotation_deadline = None, 0
        self.rotate = lambda value: None
        self.beep_process, self.last_beep, self.last_received = None, 0, time.monotonic()
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(16, 10, 16, 10)
        self.layout.setSpacing(10)
        self.heading, self.connection, self.clock = label('TMS LOCAL', 17), label('', 12), label('', 12)
        self.nav = button('설정', self.settings, 'Settings')
        self.layout.addLayout(row(self.heading, self.connection, self.clock, self.nav))
        self.body = QVBoxLayout()
        self.body.setContentsMargins(0, 0, 0, 0)
        self.body.setSpacing(10)
        self.layout.addLayout(self.body, 1)
        self.footer = QHBoxLayout()
        self.layout.addLayout(self.footer)
        self.error = label('', 12)
        self.error.setObjectName('error')
        self.error.hide()
        self.layout.addWidget(self.error)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.tick)
        self.timer.start(500)
        self.render()

    def palette(self):
        theme = 'normal'
        if self.page == 'home' and self.data['alarms']:
            theme = 'offline' if all(a.get('kind') == 'offline' for a in self.data['alarms']) else 'alarm'
        bg, card, soft, text, sub, line, accent, on = PALETTES[theme]
        self.setStyleSheet(f'''
            QWidget {{ background: {bg}; color: {text}; font-family: "Pretendard Variable"; font-size: 14px; }}
            QLabel {{ background: transparent; }} QLabel#muted {{ color: {sub}; }}
            QFrame#tile {{ background: {card}; border: 1px solid {line}; border-radius: 10px; }}
            QPushButton {{ background: {card}; border: 1px solid {line}; border-radius: 8px; padding: 5px 9px; }}
            QPushButton:pressed {{ background: {soft}; border-color: {accent}; }}
            QPushButton:disabled {{ color: {sub}; }} QPushButton#primary {{ background: {accent}; color: {on}; }}
            QLineEdit {{ background: {card}; border: 1px solid {accent}; border-radius: 8px; padding: 7px; font-size: 22px; selection-background-color: {accent}; selection-color: {on}; }}
            QLabel#error {{ color: #f3cd8c; }}
        ''')

    def command(self, action, **values):
        self.send(dict(action=action, **values))

    def receive(self, data):
        if 'error' in data:
            self.result(data)
            return
        self.last_received = time.monotonic()
        if getattr(self, 'connection_failed', False):
            self.error.hide()
            self.connection_failed = False
        new_ids = {a['id'] for a in data['alarms']}
        if new_ids - self.alarm_ids:
            if self.rotation_pending is not None:
                self.cancel_rotation()
            self.page, self.alarm_page = 'home', 0
            self.signature = None
        self.alarm_ids = new_ids
        old_rotation = self.data.get('rotation', 0)
        self.data = data
        if self.rotation_pending is None and data['rotation'] != old_rotation:
            self.rotate(data['rotation'])
        if self.page == 'home':
            signature = json.dumps(data['alarms'], ensure_ascii=False) if data['alarms'] else 'normal'
            if signature != self.signature:
                self.signature = signature
                self.render()
            self.update_home()
        elif self.page in ('settings', 'doors', 'doorTest', 'details'):
            self.update_settings()
        self.tick()

    def result(self, response):
        if response.get('error'):
            if response.get('action') == 'connection':
                self.connection_failed = True
            if response.get('action') == 'rotation':
                self.rotate(self.data.get('rotation', 0))
            self.error.setText(response['error'])
            self.error.show()
        else:
            self.error.hide()
            if response.get('action') == 'rename':
                self.page, self.tab = 'settings', 'sensors'
                self.render()

    def tick(self):
        self.clock.setText(time.strftime('%H:%M'))
        server = self.data['server']
        self.connection.setText('서버 연결됨' if server['online'] else '서버 오프라인' if server['bound'] else '서버 등록 대기')
        if self.rotation_pending is not None:
            remaining = math.ceil(self.rotation_deadline - time.monotonic())
            if remaining <= 0:
                self.cancel_rotation()
            elif hasattr(self, 'rotation_note'):
                self.rotation_note.setText(f'{remaining}초 안에 방향을 확인하세요. 미확인 시 자동 복구합니다.')
        if hasattr(self, 'mute_button') and self.page == 'home' and self.data['alarms']:
            seconds = self.data.get('mutedSeconds', 0)
            self.mute_button.setText(f'무음 {seconds}초' if seconds else '60초 무음')
        if time.monotonic() - self.last_received > 5:
            if not any(a['id'] == 'daemon-offline' for a in self.data['alarms']):
                self.cancel_rotation()
                self.data['alarms'].append({'id': 'daemon-offline', 'title': '로컬 센서 서비스 응답 없음',
                    'detail': '현재값을 확인할 수 없습니다 · 자동 재연결 중', 'kind': 'offline', 'severity': 'warning'})
                self.page, self.signature = 'home', None
                self.render()
            self.error.setText('센서 서비스 연결 끊김 · 현재 표시값은 최신 상태가 아닙니다')
            self.error.show()
        alarms = self.data['alarms']
        if (alarms and any(not a.get('acknowledged') for a in alarms) and not self.data.get('mutedSeconds')
                and time.monotonic() - self.last_beep > 5):
            self.last_beep = time.monotonic()
            if sys.platform == 'linux' and (self.beep_process is None or self.beep_process.poll() is not None):
                try:
                    self.beep_process = subprocess.Popen(['aplay', '-q', str(HERE / 'assets/alarm.wav')], stderr=subprocess.DEVNULL)
                except OSError:
                    pass

    def settings(self):
        if self.rotation_pending is not None:
            self.cancel_rotation()
        self.page = 'settings' if self.page == 'home' else 'home'
        self.render()

    def render(self):
        clear(self.body)
        clear(self.footer)
        self.palette()
        self.error.hide()
        self.nav.setText('설정' if self.page == 'home' else '대시보드')
        self.nav.setIcon(icon('Settings' if self.page == 'home' else 'ArrowLeft'))
        self.heading.setText(self.data['name'] if self.page == 'home' else '센서 이름 설정' if self.page == 'rename' else '장치 설정')
        if self.page == 'home':
            self.home()
        elif self.page == 'rename':
            self.rename()
        elif self.page == 'settings':
            self.settings_page()
        elif self.page == 'doors':
            self.doors()
        elif self.page == 'doorTest':
            self.door_test_page()
        else:
            self.details()

    def channel_data(self, key):
        return next((c for c in self.data['channels'] if c['id'] == key),
                    {'id': key, 'name': key, 'enabled': False, 'fresh': False, 'value': None, 'age': None})

    def home(self):
        if self.data['alarms']:
            alarms = self.data['alarms']
            self.body.addLayout(row(label('복합 알람', 24), label(f'{len(alarms)}건', 22)))
            pages = max(1, math.ceil(len(alarms) / 4))
            self.alarm_page = min(self.alarm_page, pages - 1)
            grid = QGridLayout()
            grid.setSpacing(10)
            for index, alarm in enumerate(alarms[self.alarm_page * 4:self.alarm_page * 4 + 4]):
                tile = QFrame()
                tile.setObjectName('tile')
                content = QVBoxLayout(tile)
                content.setContentsMargins(12, 10, 12, 10)
                severity = '위험' if alarm.get('severity') == 'critical' else '주의'
                origin = '서버' if alarm.get('source') == 'server' else '현장'
                content.addWidget(label(f"{severity} · {origin} · {'확인됨' if alarm.get('acknowledged') else '미확인'}", 12, True))
                title = label(alarm['title'], 17)
                content.addWidget(title, 1)
                content.addWidget(label(alarm.get('detail', ''), 12, True))
                grid.addWidget(tile, index // 2, index % 2)
            for index in range(2):
                grid.setRowStretch(index, 1)
                grid.setColumnStretch(index, 1)
            self.body.addLayout(grid, 1)
            previous = button('이전', lambda: self.paginate(-1), 'ChevronLeft')
            previous.setEnabled(self.alarm_page > 0)
            following = button('다음', lambda: self.paginate(1), 'ChevronRight')
            following.setEnabled(self.alarm_page < pages - 1)
            self.mute_button = button('60초 무음', lambda: self.command('mute'), 'VolumeX')
            self.footer.addWidget(previous)
            self.footer.addWidget(label(f'{self.alarm_page + 1} / {pages}', 12))
            self.footer.addWidget(following)
            self.footer.addStretch()
            self.footer.addWidget(self.mute_button)
            self.footer.addWidget(button('알람 확인', lambda: self.command('ack'), primary=True))
        else:
            self.body.addWidget(label('현장 센서', 22))
            grid = QGridLayout()
            grid.setSpacing(10)
            self.sensor_labels = {}
            for i in range(1, 5):
                key = f'dht{i}'
                tile = QFrame()
                tile.setObjectName('tile')
                content = QVBoxLayout(tile)
                content.setContentsMargins(12, 10, 12, 10)
                name, temperature, humidity = label('', 16), label('—', 28), label('—', 17, True)
                content.addWidget(name)
                content.addWidget(temperature)
                content.addWidget(humidity)
                content.addWidget(button(f'온습도 {i}', lambda checked=False, key=key: self.open_details(key)))
                self.sensor_labels[key] = (name, temperature, humidity)
                grid.addWidget(tile, 0, i - 1)
                grid.setColumnStretch(i - 1, 1)
            self.body.addLayout(grid, 1)
            self.body.addWidget(label('출입문 / 개폐 상태 · MC-58(NC)', 14, True))
            line = QHBoxLayout()
            self.door_buttons = {}
            for i in range(1, 5):
                key = f'door{i}'
                control = button('', lambda checked=False, key=key: self.open_details(key), 'DoorClosed')
                self.door_buttons[key] = control
                line.addWidget(control)
            self.body.addLayout(line)
            self.input_label = label(self.input_mode, 12, True)
            self.footer.addWidget(self.input_label)
            self.footer.addStretch()
            self.footer.addWidget(button('센서 관리', lambda: self.open_tab('sensors'), 'CircuitBoard'))
            self.update_home()

    def update_home(self):
        if self.data['alarms'] or not hasattr(self, 'sensor_labels'):
            return
        for key, widgets in self.sensor_labels.items():
            channel = self.channel_data(key)
            widgets[0].setText(channel['name'])
            value = channel['value'] if channel['enabled'] else None
            widgets[1].setText(f'{value[0]:.1f} °C' if isinstance(value, list) else '—')
            widgets[2].setText(f'{value[1]:.1f} %' if isinstance(value, list) else '응답 대기' if channel['enabled'] else '미등록')
        for key, control in self.door_buttons.items():
            channel = self.channel_data(key)
            status = {'CLOSED': '닫힘', 'OPEN': '열림'}.get(channel['value'], '응답 대기') if channel['enabled'] else '미등록'
            control.setText(channel['name'] + '\n' + status)
        self.input_label.setText(self.input_mode + ' · 로컬 센서 감시')

    def paginate(self, delta):
        self.alarm_page += delta
        self.render()

    def open_tab(self, tab):
        if self.rotation_pending is not None:
            self.cancel_rotation()
        self.page, self.tab = 'settings', tab
        self.render()

    def settings_page(self):
        columns = QHBoxLayout()
        nav = QVBoxLayout()
        for key, text, symbol in [('display', '화면 · 입력', 'Monitor'), ('sensors', '센서 관리', 'CircuitBoard'), ('server', '서버 · 알람', 'Server')]:
            control = button(text, lambda checked=False, key=key: self.open_tab(key), symbol)
            control.setFixedWidth(150)
            nav.addWidget(control)
        nav.addStretch()
        columns.addLayout(nav)
        panel = QVBoxLayout()
        panel.setSpacing(6)
        columns.addLayout(panel, 1)
        self.body.addLayout(columns, 1)
        if self.tab == 'display':
            panel.addWidget(label('화면과 입력', 22))
            panel.addWidget(label('화면 방향 · 화면과 터치 좌표 함께 회전', 14, True))
            panel.addLayout(row(button('정방향', lambda: self.preview_rotation(0)), button('180° 반전', lambda: self.preview_rotation(180))))
            self.rotation_note = label('변경 후 15초 안에 확인하세요.', 13, True)
            panel.addWidget(self.rotation_note)
            self.rotation_controls = QWidget()
            self.rotation_controls.setLayout(row(button('되돌리기', self.cancel_rotation), button('방향 유지', self.keep_rotation, primary=True)))
            self.rotation_controls.setVisible(self.rotation_pending is not None)
            panel.addWidget(self.rotation_controls)
            self.device_label = label('', 14)
            panel.addWidget(self.device_label)
            panel.addWidget(label('Pretendard 전체 글꼴 내장 · 한/영 키 또는 Ctrl+Space\n인터넷 없이 한글과 영문을 입력할 수 있습니다.', 13, True))
        elif self.tab == 'sensors':
            panel.addLayout(row(label('연결 센서', 22), button('다시 탐지', lambda: self.command('scan'), 'RefreshCw')))
            self.scan_label = label('', 12, True)
            panel.addWidget(self.scan_label)
            self.scan_buttons = {}
            for i in range(1, 5):
                key = f'dht{i}'
                control = button('', lambda checked=False, key=key: self.open_rename(key))
                self.scan_buttons[key] = control
                panel.addWidget(control)
            self.auto_button = button('', lambda: self.command('autoScan', value=not self.data['autoScan']))
            panel.addLayout(row(self.auto_button, button('MC-58(NC) 채널 설정', self.open_doors, 'DoorClosed')))
        else:
            panel.addWidget(label('서버와 알람', 22))
            self.server_label = label('', 16)
            panel.addWidget(self.server_label)
            panel.addWidget(label('서버의 라즈베리파이 메뉴에서 자동 탐지 후 채널을 등록하세요.\n등록된 서버는 전원을 다시 켜도 기억합니다.', 14, True))
            panel.addWidget(label('모든 서버 알람과 로컬 센서 알람을 함께 표시합니다.\n확인은 이 화면에만 기록하며, 복구 전까지 알람은 유지합니다.\n연결이 끊기면 별도 오프라인 알람과 마지막 서버 알람을 표시합니다.', 14))
        panel.addStretch()
        self.footer.addWidget(label('장치 자체 설정 · 인터넷 연결 불필요', 12, True))
        self.footer.addStretch()
        self.footer.addWidget(button('대시보드로', self.settings))
        self.update_settings()

    def update_settings(self):
        if self.page == 'settings':
            if self.tab == 'display':
                devices = QInputDevice.devices()
                touch = any(d.type() == QInputDevice.DeviceType.TouchScreen for d in devices)
                self.device_label.setText(f"입력 자동 감지 · {'터치스크린 연결됨' if touch else self.input_mode}")
            elif self.tab == 'sensors':
                found = sum(self.channel_data(f'dht{i}')['fresh'] for i in range(1, 5))
                self.scan_label.setText('탐지 중 · 최대 20초' if self.data['scanning'] else f'DHT22 {found}개 응답 · 이름을 누르면 변경합니다')
                self.auto_button.setText('시작 시 자동 탐지 · ' + ('사용 중' if self.data['autoScan'] else '사용 안 함'))
                for key, control in self.scan_buttons.items():
                    item = self.channel_data(key)
                    control.setText(f"{item['name']} · GPIO {[4,17,27,22][int(key[-1])-1]} · {'응답 확인' if item['fresh'] else '응답 없음'}")
            else:
                server = self.data['server']
                self.server_label.setText((server['ip'] or '등록 대기') + (' · 연결됨' if server['online'] else ' · 연결 대기'))
        elif self.page == 'doorTest':
            item = self.channel_data(self.channel)
            self.contact_label.setText(f"현재 접점: {item.get('raw') if item['fresh'] else '응답 없음'} · 문을 실제로 열고 닫으세요")
            self.open_confirm.setEnabled(self.channel in self.data['doorTest'])
        elif self.page == 'details':
            item = self.channel_data(self.channel)
            self.details_label.setText(f"현재값: {item['value'] if item['fresh'] else '—'}\n" +
                                      (f"마지막 수신: {item['age']}초 전" if item.get('age') is not None else '아직 수신된 값이 없습니다'))

    def preview_rotation(self, value):
        self.rotation_pending = value
        self.rotation_deadline = time.monotonic() + 15
        self.rotate(value)
        self.rotation_controls.show()
        self.tick()

    def cancel_rotation(self):
        self.rotation_pending = None
        self.rotate(self.data.get('rotation', 0))
        if self.page == 'settings' and self.tab == 'display':
            self.rotation_controls.hide()

    def keep_rotation(self):
        if self.rotation_pending is not None:
            value = self.rotation_pending
            self.rotation_pending = None
            self.command('rotation', value=value)
            self.rotation_controls.hide()

    def open_details(self, key):
        self.page, self.channel = 'details', key
        self.render()

    def details(self):
        item = self.channel_data(self.channel)
        self.body.addWidget(label(item['name'], 24))
        self.details_label = label('', 22)
        self.body.addWidget(self.details_label, 1)
        self.body.addWidget(label('측정 실패 시 마지막 값을 현재값으로 표시하지 않습니다.', 14, True))
        self.footer.addWidget(button('이름 변경', lambda: self.open_rename(self.channel)))
        if self.channel.startswith('door'):
            self.footer.addWidget(button('개폐 접점 확인', lambda: self.open_door_test(self.channel)))
        self.update_settings()

    def open_doors(self):
        self.page = 'doors'
        self.render()

    def doors(self):
        self.body.addWidget(label('MC-58(NC) 채널 설정', 23))
        self.body.addWidget(label('접점만으로 연결 여부를 자동 판별할 수 없습니다.\n각 채널의 문을 닫은 상태와 연 상태를 확인하면 채널을 활성화합니다.', 14, True))
        for i in range(1, 5):
            key = f'door{i}'
            self.body.addWidget(button(f"{self.channel_data(key)['name']} · GPIO {[23,24,25,26][i-1]}", lambda checked=False, key=key: self.open_door_test(key)))

    def open_door_test(self, key):
        self.page, self.channel = 'doorTest', key
        self.render()

    def door_test_page(self):
        self.body.addWidget(label(self.channel_data(self.channel)['name'] + ' 접점 확인', 23))
        self.contact_label = label('', 17)
        self.body.addWidget(self.contact_label, 1)
        self.body.addWidget(button('1. 닫힌 상태 확인', lambda: self.command('doorClosed', channel=self.channel)))
        self.open_confirm = button('2. 열린 상태 확인 · 채널 활성화', lambda: self.command('doorOpen', channel=self.channel))
        self.body.addWidget(self.open_confirm)
        self.body.addWidget(button('센서 이름 설정', lambda: self.open_rename(self.channel)))
        self.update_settings()

    def open_rename(self, key):
        self.page, self.channel = 'rename', key
        self.render()

    def rename(self):
        item = self.channel_data(self.channel)
        self.body.addLayout(row(label(item['name'] + ' 이름', 20), label('최대 20자 · 한/영 입력', 12, True)))
        self.name_field = QLineEdit(item['name'])
        self.name_field.setAccessibleName('센서 이름')
        self.name_field.setMaxLength(20)
        self.name_field.setMinimumHeight(46)
        self.name_field.returnPressed.connect(self.save_name)
        self.body.addWidget(self.name_field)
        self.keyboard = TouchKeyboard(self.name_field)
        self.body.addWidget(self.keyboard)
        self.footer.addWidget(label('가상키보드 또는 연결된 키보드로 입력하세요.', 12, True))
        self.footer.addStretch()
        self.footer.addWidget(button('취소', lambda: self.open_tab('sensors')))
        self.footer.addWidget(button('이름 저장', self.save_name, primary=True))
        self.name_field.setFocus()

    def save_name(self):
        name = self.name_field.text().strip()
        if not name:
            self.result({'error': '센서 이름을 입력하세요'})
            return
        self.command('rename', channel=self.channel, name=name)


class Display(QGraphicsView):
    def __init__(self, dashboard):
        super().__init__()
        self.dashboard, self.rotation = dashboard, 0
        self.setWindowTitle('TMS LOCAL')
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.setBackgroundBrush(QColor('#0c0c0c'))
        self.scene_object = QGraphicsScene(self)
        self.scene_object.setSceneRect(0, 0, 800, 480)
        dashboard.setFixedSize(800, 480)
        self.proxy = self.scene_object.addWidget(dashboard)
        self.setScene(self.scene_object)
        dashboard.rotate = self.rotate_screen
        self.resize(800, 480)
        QApplication.instance().installEventFilter(self)

    def rotate_screen(self, value):
        self.rotation = value
        self.resetTransform()
        self.rotate(value)
        self.fitInView(QRectF(0, 0, 800, 480), Qt.AspectRatioMode.KeepAspectRatio)
        self.centerOn(400, 240)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.rotate_screen(self.rotation)

    def eventFilter(self, obj, event):
        if event.type() in (QEvent.Type.MouseButtonPress, QEvent.Type.TouchBegin, QEvent.Type.KeyPress):
            if event.type() == QEvent.Type.KeyPress:
                mode = '키보드'
            elif hasattr(event, 'device') and event.device().type() == QInputDevice.DeviceType.TouchScreen:
                mode = '터치'
            else:
                mode = '마우스'
            self.dashboard.input_mode = '자동 · ' + mode
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--socket', default='/run/tms-sensor/control.sock')
    parser.add_argument('--windowed', action='store_true')
    args = parser.parse_args()
    app = QApplication(sys.argv[:1])
    QFontDatabase.addApplicationFont(str(HERE / 'assets/PretendardVariable.ttf'))
    app.setFont(QFont('Pretendard Variable', 14))
    bridge = Bridge(args.socket)
    dashboard = Dashboard(bridge.send)
    window = Display(dashboard)
    bridge.snapshot.connect(dashboard.receive)
    bridge.result.connect(dashboard.result)
    bridge.start()
    window.show() if args.windowed else window.showFullScreen()
    result = app.exec()
    bridge.running = False
    bridge.wait(2000)
    return result


if __name__ == '__main__':
    sys.exit(main())
