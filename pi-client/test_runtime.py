import copy
from pathlib import Path
import tempfile
import unittest

from hangul_keyboard import compose
from local_runtime import LocalRuntime
from tms_sensor import Client


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.client = Client(Path(directory.name) / 'state.json', {'name': '장비실', 'channels': []})
        self.now = 100
        self.runtime = LocalRuntime(self.client, lambda: self.now)

    def test_hangul_composition_and_backspace(self):
        for raw, expected in [('gksrmf', '한글'), ('wkdqltlf', '장비실'), ('rkqt', '값'), ('rhk', '과'), ('rkrk', '가가'), ('rkqtk', '갑사')]:
            self.assertEqual(compose(raw), expected)
        self.assertEqual([compose('rkqt'[:n]) for n in (4, 3, 2, 1)], ['값', '갑', '가', 'ㄱ'])

    def test_dht_detection_and_stale_values(self):
        self.runtime.sample('dht2', [24, 55])
        self.assertIn('dht2', self.client.state['channels'])
        self.now += 61
        snapshot = self.runtime.snapshot()
        self.assertIsNone(snapshot['channels'][1]['value'])
        self.assertEqual(snapshot['alarms'][0]['kind'], 'offline')

    def test_nc_contact_requires_real_transition_and_realarms(self):
        self.runtime.sample('door1', 0)
        self.runtime.command({'action': 'doorClosed', 'channel': 'door1'})
        with self.assertRaises(ValueError):
            self.runtime.command({'action': 'doorOpen', 'channel': 'door1'})
        self.runtime.sample('door1', 1)
        self.runtime.command({'action': 'doorOpen', 'channel': 'door1'})
        first = self.runtime.snapshot()['alarms'][0]['id']
        self.runtime.command({'action': 'ack'})
        self.assertTrue(self.runtime.snapshot()['alarms'][0]['acknowledged'])
        self.runtime.sample('door1', 0)
        self.assertFalse(self.runtime.snapshot()['alarms'])
        self.runtime.sample('door1', 1)
        self.assertNotEqual(self.runtime.snapshot()['alarms'][0]['id'], first)

    def test_server_all_categories_cache_offline_and_thresholds(self):
        self.client.state['serverIp'] = '192.168.1.10'
        response = {'v': 1, 'channels': [{'id': 'dht1', 'name': '장비실', 'displayItems': [{'index': 0, 'critical': 30}]}],
                    'alarms': [{'id': kind, 'title': kind, 'severity': 'critical', 'kind': kind, 'source': 'server'} for kind in ['radar', 'ups', 'ping', 'sound', 'lightning']]}
        self.runtime.accept_server(response, '192.168.1.10')
        self.runtime.sample('dht1', [31, 40])
        self.assertEqual(len(self.runtime.snapshot()['alarms']), 6)
        self.runtime.command({'action': 'ack'})
        self.runtime.command({'action': 'mute'})
        self.now += 16
        snapshot = self.runtime.snapshot()
        self.assertFalse(snapshot['server']['online'])
        self.assertEqual(snapshot['mutedSeconds'], 44)
        self.assertTrue(any('상태 미확인' in a.get('detail', '') for a in snapshot['alarms']))
        restored = LocalRuntime(self.client, lambda: self.now)
        self.assertEqual(len(restored.cache['alarms']), 5)
        self.client.state['serverIp'] = '192.168.1.11'
        self.assertFalse(any(a.get('source') == 'server' for a in restored.snapshot()['alarms']))
        invalid = copy.deepcopy(response)
        invalid['alarms'][0]['detail'] = []
        with self.assertRaises(ValueError):
            self.runtime.accept_server(invalid, '192.168.1.11')

    def test_settings_persist_without_network(self):
        for command in [{'action': 'rename', 'channel': 'dht1', 'name': '한글 장비실'}, {'action': 'rotation', 'value': 180}, {'action': 'autoScan', 'value': False}]:
            self.runtime.command(command)
        restored = Client(self.client.path, {}).runtime.snapshot()
        self.assertEqual(restored['channels'][0]['name'], '한글 장비실')
        self.assertEqual(restored['rotation'], 180)
        self.assertIn('dht1', restored['pendingNames'])
        self.runtime.sample('dht3', [20, 40])
        self.assertNotIn('dht3', self.client.state['channels'])
        self.runtime.command({'action': 'scan'})
        self.runtime.sample('dht3', [20, 40])
        self.assertIn('dht3', self.client.state['channels'])


if __name__ == '__main__':
    unittest.main()
