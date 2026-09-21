"""Offscreen native UI checks, runnable on Windows and network-isolated ARM."""
import copy
import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
try:
    from PySide6.QtCore import QPoint, Qt
    from PySide6.QtGui import QFont, QFontDatabase
    from PySide6.QtTest import QTest
    from PySide6.QtWidgets import QApplication, QPushButton
    from tms_display import Dashboard, Display, HERE
except ImportError:
    raise unittest.SkipTest('Install PySide6 to run the native UI checks')


class DisplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = QApplication.instance() or QApplication([])
        assert QFontDatabase.addApplicationFont(str(HERE / 'assets/PretendardVariable.ttf')) >= 0
        cls.app.setFont(QFont('Pretendard Variable', 14))

    def setUp(self):
        self.now = 100
        timer = patch('tms_display.time.monotonic', lambda: self.now)
        timer.start()
        self.addCleanup(timer.stop)
        self.commands = []
        self.dashboard = Dashboard(self.commands.append)
        self.window = Display(self.dashboard)
        self.window.show()
        self.data = copy.deepcopy(self.dashboard.data)
        self.data['channels'] = [{'id': f'{kind}{i}', 'name': ('장비실 ' if kind == 'dht' else '출입문 ') + str(i),
            'enabled': True, 'fresh': True, 'value': [24.5, 51.0] if kind == 'dht' else 'CLOSED', 'age': 0}
            for kind in ('dht', 'door') for i in range(1, 5)]
        self.dashboard.receive(copy.deepcopy(self.data))
        self.app.processEvents()

    def tearDown(self):
        self.dashboard.timer.stop()
        self.window.close()
        self.window.deleteLater()
        self.app.processEvents()

    def capture(self, name):
        self.app.processEvents()
        for button in self.dashboard.findChildren(QPushButton):
            if button.isVisible():
                position = button.mapTo(self.dashboard, QPoint(0, 0))
                self.assertGreaterEqual(position.y(), 0, button.text())
                self.assertLessEqual(position.y() + button.height(), 480, button.text())
        output = os.environ.get('TMS_UI_SNAPSHOTS')
        if output:
            Path(output).mkdir(parents=True, exist_ok=True)
            self.dashboard.grab().save(str(Path(output) / (name + '.png')))

    def test_all_pages_and_alarm_interrupt(self):
        self.capture('normal')
        for tab in ('display', 'sensors', 'server'):
            self.dashboard.open_tab(tab)
            self.capture('settings-' + tab)
        self.dashboard.open_doors()
        self.capture('doors')
        self.dashboard.open_door_test('door1')
        self.capture('door-test')
        self.dashboard.open_details('dht1')
        self.capture('details')
        self.data['alarms'] = [{'id': str(i), 'title': '레이더 장비실 온도 상한 초과', 'detail': '35.2 °C · 현재 알람이 유지되고 있습니다',
            'severity': 'critical', 'source': 'server', 'kind': 'sensor'} for i in range(7)]
        self.dashboard.receive(copy.deepcopy(self.data))
        self.assertEqual(self.dashboard.page, 'home')
        self.capture('alarm')
        self.dashboard.paginate(1)
        self.assertEqual(self.dashboard.alarm_page, 1)
        self.data['alarms'] = [{'id': 'offline', 'title': '본 서버 연결 끊김', 'detail': '현장 센서 감시는 계속됩니다', 'kind': 'offline', 'severity': 'warning'}]
        self.dashboard.receive(copy.deepcopy(self.data))
        self.capture('offline')
        self.dashboard.open_tab('sensors')
        self.assertIn('#0c0c0c', self.dashboard.styleSheet())
        self.capture('settings-during-alarm')

    def test_korean_keyboard_edit_save_and_physical_input(self):
        self.dashboard.open_rename('dht1')
        field, keyboard = self.dashboard.name_field, self.dashboard.keyboard
        keyboard.type_key('clear')
        for key in 'wkdqltlf':
            keyboard.type_key(key)
        self.assertEqual(field.text(), '장비실')
        keyboard.type_key('back')
        self.assertEqual(field.text(), '장비시')
        keyboard.type_key('f')
        keyboard.type_key(' ')
        keyboard.mode = 'en'
        keyboard.type_key('A')
        self.assertEqual(field.text(), '장비실 A')
        field.setSelection(0, 3)
        keyboard.mode = 'ko'
        for key in 'gksrmf':
            keyboard.type_key(key)
        self.assertEqual(field.text(), '한글 A')
        field.setCursorPosition(len(field.text()))
        QTest.keyClicks(field, '2')
        self.assertEqual(field.text(), '한글 A2')
        self.dashboard.save_name()
        self.assertEqual(self.commands[-1], {'action': 'rename', 'channel': 'dht1', 'name': '한글 A2'})
        self.capture('keyboard')

    def test_rotation_timeout_navigation_and_daemon_loss(self):
        self.dashboard.open_tab('display')
        self.dashboard.preview_rotation(180)
        self.assertEqual(self.window.rotation, 180)
        mapped = self.window.mapFromScene(100, 100)
        self.assertGreater(mapped.x(), 600)
        self.dashboard.rotation_deadline = time.monotonic() - 1
        self.dashboard.tick()
        self.assertEqual(self.window.rotation, 0)
        self.dashboard.preview_rotation(180)
        self.dashboard.open_tab('sensors')
        self.app.processEvents()
        self.dashboard.tick()
        self.assertIsNone(self.dashboard.rotation_pending)
        self.dashboard.last_received = time.monotonic() - 10
        self.dashboard.tick()
        self.assertEqual(self.dashboard.page, 'home')
        self.assertTrue(any(a['id'] == 'daemon-offline' for a in self.dashboard.data['alarms']))
        self.capture('daemon-offline')
        self.dashboard.receive(copy.deepcopy(self.data))
        self.assertFalse(self.dashboard.data['alarms'])


if __name__ == '__main__':
    unittest.main()
