"""Generate editable Fritzing sketches and export their breadboard views with Fritzing.

Requires Python 3 and an installed Fritzing with its standard parts library.
The application never runs this script: all resulting assets ship offline.
"""
from pathlib import Path
import os
import re
import subprocess
import xml.etree.ElementTree as E
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PARTS = ROOT / 'docs/wiring/fritzing/parts'
OUT = ROOT / 'public/pi-wiring'
OUT.mkdir(parents=True, exist_ok=True)
channels = [(name, int(gpio), int(pin)) for name, gpio, pin in re.findall(
    r"id: '(\w+)'.*?gpio: (\d+), pin: (\d+)",
    (ROOT / 'src/lib/pi-sensor.ts').read_text(encoding='utf-8'))]
assert len(channels) == 8, 'Review the drawing layout when channel assignments change'
pi_svg = E.parse(PARTS/'svg.breadboard.raspberry-pi-4B_1_breadboard.svg')
positions = {}
for e in pi_svg.iter():
    if e.get('id','').startswith('connector') and e.tag.endswith('circle'):
        positions[e.get('id').replace('pin','')] = (20+float(e.get('cx'))*.09, 135+float(e.get('cy'))*.09)

for name, gpio, pin in channels:
    root = E.Element('module', fritzingVersion='1.0.1')
    E.SubElement(root, 'project_properties')
    views = E.SubElement(root, 'views')
    E.SubElement(views, 'view', name='breadboardView', backgroundColor='#ffffff', gridSize='0.1in', showGrid='0', alignToGrid='0')
    instances = E.SubElement(root, 'instances')
    def instance(mid, idx, title, x, y, path):
        ins = E.SubElement(instances, 'instance', moduleIdRef=mid, modelIndex=str(idx), path=path)
        E.SubElement(ins,'title').text = title
        view = E.SubElement(E.SubElement(ins,'views'),'breadboardView',layer='breadboard')
        E.SubElement(view,'geometry',x=str(x),y=str(y),z='2')
        return E.SubElement(view,'connectors')
    pi = instance('raspberry-pi-4B_1',1,'Raspberry Pi 4B',20,135,'raspberry-pi-4B_1.fzp')
    dht = name.startswith('dht')
    if dht:
        sensor = instance('tms-dht22-module',2,'DHT22 3-pin module',440,60,'tms-dht22-module.fzp')
        targets = [(440+v*.09,60+1642.5*.09) for v in [207.5,307.5,407.5]]
        wires = [(0,0,'#c62828',40),(pin-1,1,'#0072bc',65),(5,2,'#30343b',90)]
    else:
        sensor = instance('tms-mc58-nc',2,'MC-58 NC',405,145,'tms-mc58-nc.fzp')
        targets = [(406.5,183),(406.5,195)]
        wires = [(pin-1,0,'#0072bc',60),(5,1,'#30343b',88)]
    counter = 100
    def connection(parent, cid, other, other_cid, layer, other_layer):
        c = next((c for c in parent if c.get('connectorId')==cid),None)
        if c is None:
            c=E.SubElement(parent,'connector',connectorId=cid,layer=layer)
            E.SubElement(c,'geometry',x='0',y='0')
            E.SubElement(c,'connects')
        E.SubElement(c.find('connects'),'connect',connectorId=other_cid,modelIndex=str(other),layer=other_layer)
    for pc, sc, color, track in wires:
        start=positions[f'connector{pc}']; end=targets[sc]
        if dht:
            # Route above the board, then approach the module from below.
            lane=365+sc*20; bottom=255-sc*16
            points=[start,(start[0],track),(lane,track),(lane,bottom),(end[0],bottom),end]
        else:
            lane=355+sc*20
            points=[start,(start[0],track),(lane,track),(lane,end[1]),end]
        ids = list(range(counter,counter+len(points)-1)); counter+=len(ids)
        for n,(a,b) in enumerate(zip(points,points[1:])):
            idx=ids[n]
            ins=E.SubElement(instances,'instance',moduleIdRef='WireModuleID',modelIndex=str(idx),path=':/resources/parts/core/wire.fzp')
            E.SubElement(ins,'title').text=f'Pin {pc+1} wire segment {n+1}'
            v=E.SubElement(E.SubElement(ins,'views'),'breadboardView',layer='breadboardWire')
            E.SubElement(v,'geometry',x=str(a[0]),y=str(a[1]),z='3.5',x1='0',y1='0',x2=str(b[0]-a[0]),y2=str(b[1]-a[1]),wireFlags='64')
            E.SubElement(v,'wireExtras',mils='24',color=color,opacity='1',banded='0')
            cs=E.SubElement(v,'connectors')
            connection(cs,'connector0',1 if n==0 else ids[n-1],f'connector{pc}' if n==0 else 'connector1','breadboardWire','breadboard' if n==0 else 'breadboardWire')
            last=n==len(ids)-1
            connection(cs,'connector1',2 if last else ids[n+1],f'connector{sc}' if last else 'connector0','breadboardWire','breadboard' if last else 'breadboardWire')
        connection(pi,f'connector{pc}',ids[0],'connector0','breadboard','breadboardWire')
        connection(sensor,f'connector{sc}',ids[-1],'connector1','breadboard','breadboardWire')
    E.indent(root)
    content=E.tostring(root,encoding='utf-8',xml_declaration=True)
    with zipfile.ZipFile(OUT/f'{name}.fzz','w',zipfile.ZIP_DEFLATED) as z:
        z.writestr(f'{name}.fz',content)
        for file in sorted(PARTS.iterdir()): z.writestr(file.name, file.read_bytes())
        z.writestr('NOTICE.txt', (OUT/'NOTICE.txt').read_bytes())
    print(name, 'GPIO',gpio,'physical',pin)

subprocess.run([os.environ.get('FRITZING', 'fritzing'), '-svg', str(OUT)],
               env={**os.environ, 'QT_QPA_PLATFORM': 'offscreen'}, check=True, timeout=120)
for name, _, _ in channels:
    drawing = OUT / f'{name}_breadboard.svg'
    assert drawing.is_file() and 'Created with Fritzing' in drawing.read_text(), name
    # Only the breadboard view is designed here; discard unrelated empty exports.
    for view in ['pcb', 'schematic']:
        (OUT / f'{name}_{view}.svg').unlink(missing_ok=True)
print('Exported eight breadboard views with Fritzing')