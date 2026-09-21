"""Check the Fritzing connector graph against the application's channel assignments."""
from pathlib import Path
import re
import xml.etree.ElementTree as E
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/pi-wiring'
channels = re.findall(r"id: '(\w+)'.*?gpio: (\d+), pin: (\d+)",
                      (ROOT / 'src/lib/pi-sensor.ts').read_text(encoding='utf-8'))
assert len(channels) == 8
for name, gpio, physical in channels:
    with zipfile.ZipFile(OUT / f'{name}.fzz') as archive:
        assert archive.testzip() is None
        assert archive.read('NOTICE.txt') == (OUT / 'NOTICE.txt').read_bytes()
        root = E.fromstring(archive.read(f'{name}.fz'))
        pi = E.fromstring(archive.read('part.raspberry-pi-4B_1.fzp'))
        pin_id = f'connector{int(physical)-1}'
        assert pi.find(f'./connectors/connector[@id="{pin_id}"]').get('name') == f'GPIO{gpio}'
        graph = {}
        def edge(a, b):
            graph.setdefault(a, set()).add(b)
        for part in root.findall('./instances/instance'):
            idx = part.get('modelIndex')
            for connector in part.findall('./views/breadboardView/connectors/connector'):
                a = (idx, connector.get('connectorId'))
                for target in connector.findall('./connects/connect'):
                    edge(a, (target.get('modelIndex'), target.get('connectorId')))
            if part.get('moduleIdRef') == 'WireModuleID':
                edge((idx, 'connector0'), (idx, 'connector1'))
                edge((idx, 'connector1'), (idx, 'connector0'))
        for a, neighbors in graph.items():
            assert all(a in graph.get(b, set()) for b in neighbors), f'{name}: nonreciprocal link'
        expected = {0: int(physical)-1, 1: 5}
        if name.startswith('dht'):
            expected = {0: 0, 1: int(physical)-1, 2: 5}
        visited = set()
        for terminal, pin in expected.items():
            origin = ('2', f'connector{terminal}')
            todo, net = [origin], set()
            while todo:
                point = todo.pop()
                if point in net:
                    continue
                net.add(point)
                todo.extend(graph.get(point, set()) - net)
            devices = {p for p in net if p[0] in ('1', '2')}
            assert devices == {origin, ('1', f'connector{pin}')}, f'{name}: miswired/shorted net {devices}'
            assert not visited.intersection(net), f'{name}: joined signal nets'
            visited.update(net)
        assert visited == set(graph), f'{name}: unconnected wire'
    drawing = (OUT / f'{name}_breadboard.svg').read_text(encoding='utf-8')
    assert 'Created with Fritzing' in drawing
    svg = E.fromstring(drawing)
    # Do not introduce network dependencies or active content into offline diagrams.
    for el in svg.iter():
        assert not el.tag.endswith('script')
        assert not any(k.lower().startswith('on') for k in el.attrib)
        for key, value in el.attrib.items():
            if key.endswith('href'):
                assert value.startswith(('#', 'data:')), value
    print(f'PASS {name}: GPIO{gpio}, physical {physical}; independent nets, bundled source, offline SVG')
