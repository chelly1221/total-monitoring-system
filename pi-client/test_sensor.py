import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tms_sensor import Client, CHANNELS, gpiochip_number, valid_target
from offline_boot import configure


class SensorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.client = Client(self.path / 'state.json', {'name': '테스트 센서', 'channels': list(CHANNELS)})

    def config(self, **changes):
        return dict({'v': 1, 't': 'config', 'nonce': '0123456789abcdef', 'id': self.client.state['id'],
                     'channel': 'door1', 'target': {'ip': '192.168.1.10', 'port': 6300},
                     'intervalMs': 5000, 'closedLevel': 0}, **changes)

    def test_binding_is_persisted_and_channels_are_independent(self):
        reply = self.client.handle(self.config(closedLevel=1), '192.168.1.10')
        self.assertTrue(reply['ok'])
        restored = Client(self.path / 'state.json', {})
        self.assertEqual(restored.state, self.client.state)
        self.assertIsNone(restored.state['channels']['door2']['target'])
        self.assertEqual(restored.state['channels']['door1']['closedLevel'], 1)

    def test_invalid_commands_do_not_mutate_state(self):
        original = json.dumps(self.client.state)
        for changes in [{'id': 'other'}, {'channel': 'dht5'}, {'intervalMs': 0}, {'closedLevel': True},
                        {'target': {'ip': '192.168.1.11', 'port': 6300}}, {'target': {'ip': '127.0.0.1', 'port': 6300}}]:
            self.assertFalse(self.client.handle(self.config(**changes), '192.168.1.10')['ok'])
        self.assertEqual(json.dumps(self.client.state), original)
        with patch('tms_sensor.atomic_json', side_effect=OSError('disk full')):
            self.assertFalse(self.client.handle(self.config(), '192.168.1.10')['ok'])
        self.assertEqual(json.dumps(self.client.state), original)

    def test_discovery_size_identity_and_nonce(self):
        self.client.state['name'] = '가' * 32
        for binding in self.client.state['channels'].values():
            binding['target'] = {'ip': '192.168.100.100', 'port': 6399}
        reply = self.client.handle({'v': 1, 't': 'probe', 'nonce': '0123456789abcdef'}, '192.168.1.10')
        self.assertEqual(reply['kind'], 'pi')
        self.assertEqual(len(reply['channels']), 8)
        self.assertLessEqual(len(json.dumps(reply, ensure_ascii=False, separators=(',', ':')).encode()), 1200)
        self.assertIsNone(self.client.handle({'v': 2, 't': 'probe'}, '192.168.1.10'))
        self.assertIsNone(self.client.handle({'v': 1, 't': 'probe', 'nonce': 'bad'}, '192.168.1.10'))
        other = Client(self.path / 'other.json', {'name': '복제 카드', 'channels': ['dht1']})
        self.assertNotEqual(self.client.state['id'], other.state['id'])

    def test_pi5_gpiochip_is_selected_by_controller(self):
        device = self.path / 'gpiochip4/of_node'
        device.mkdir(parents=True)
        (device / 'compatible').write_bytes(b'raspberrypi,rp1-gpio\0')
        self.assertEqual(gpiochip_number(self.path), 4)
        (device / 'compatible').write_bytes(b'brcm,not-user-gpio\0')
        with self.assertRaises(RuntimeError):
            gpiochip_number(self.path)

    def test_destination_validation(self):
        for address in ['127.0.0.1', '0.0.0.0', '255.255.255.255', '224.0.0.1', '::1', 'bad']:
            self.assertFalse(valid_target({'ip': address, 'port': 6300}))
        self.assertFalse(valid_target({'ip': '192.168.1.10', 'port': True}))
        self.assertTrue(valid_target({'ip': '192.168.1.10', 'port': 6300}))

    def test_offline_setup_writes_network_and_preserves_identity(self):
        boot = self.path / 'boot'
        boot.mkdir()
        root = self.path / 'root'
        (root / 'etc/network').mkdir(parents=True)
        (boot / 'tms_sensor.py').write_text('pass\n')
        config = {'name': '센서', 'channels': ['dht1', 'door2'],
                  'network': {'mode': 'static', 'address': '192.168.1.50/24', 'gateway': '192.168.1.1'}}
        (boot / 'config.json').write_text(json.dumps(config))
        configure(boot, root)
        self.assertIn('address 192.168.1.50/24', (root / 'etc/network/interfaces').read_text())
        hostname = (root / 'etc/hostname').read_text()
        configure(boot, root)
        self.assertEqual(hostname, (root / 'etc/hostname').read_text())
        config['network']['address'] = '192.168.1.255/24'
        (boot / 'config.json').write_text(json.dumps(config))
        with self.assertRaises(ValueError):
            configure(boot, root)


if __name__ == '__main__':
    unittest.main()
