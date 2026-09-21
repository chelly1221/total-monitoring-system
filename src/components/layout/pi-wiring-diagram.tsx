'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Download, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PI_CHANNELS } from '@/lib/pi-sensor'

export function PiWiringDiagram({ channel }: { channel: typeof PI_CHANNELS[number] }) {
  const [zoom, setZoom] = useState(1)
  const dht = channel.kind === 'dht22'
  const connections = [
    ...(dht ? [{ pin: 1, signal: '3.3V', terminal: 'VCC / +', color: '#c62828', name: '빨강' }] : []),
    { pin: channel.pin, signal: `GPIO${channel.gpio}`, terminal: dht ? 'DATA / OUT / S' : '접점 선 1', color: '#0072bc', name: '파랑' },
    { pin: 6, signal: 'GND', terminal: dht ? 'GND / −' : '접점 선 2', color: '#30343b', name: '검정' },
  ]
  const asset = `/pi-wiring/${channel.id}`

  return <section aria-label={`${channel.label} 배선 안내`} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="font-semibold">{channel.label} · {dht ? 'DHT22 3핀 모듈' : 'MC-58 (NC)'}</h3>
        <p className="text-xs text-muted-foreground">Fritzing 배선도 · 보드 윗면 기준 · 그림의 보드는 Raspberry Pi 4B</p>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="도면 확대 설정">
        <Button variant="outline" size="icon" aria-label="도면 축소" disabled={zoom === 1} onClick={() => setZoom(v => Math.max(1, v - 0.5))}><Minus className="size-4" /></Button>
        <span className="w-[48px] text-center text-xs tabular-nums" aria-live="polite">{zoom * 100}%</span>
        <Button variant="outline" size="icon" aria-label="도면 확대" disabled={zoom === 3} onClick={() => setZoom(v => Math.min(3, v + 0.5))}><Plus className="size-4" /></Button>
        <Button variant="ghost" size="icon" aria-label="도면 크기 초기화" disabled={zoom === 1} onClick={() => setZoom(1)}><RotateCcw className="size-4" /></Button>
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_230px]">
      <div className="h-[380px] min-w-0 overflow-auto rounded-lg bg-white p-[18px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:h-[420px]" tabIndex={0} role="region" aria-label="배선도 보기 · 확대한 뒤 스크롤로 이동">
        <div className="relative min-h-full" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          <Image src={`${asset}_breadboard.svg`} alt={`${channel.label}. ${connections.map(c => `라즈베리파이 물리 ${c.pin}번 ${c.signal}에서 센서 ${c.terminal}로 ${c.name} 선 연결`).join('. ')}.`} fill unoptimized className="object-contain" sizes="(max-width: 1024px) 90vw, 720px" />
        </div>
      </div>
      <div className="space-y-4">
        <div>
          <h4 className="mb-2 text-sm font-semibold">연결할 물리 핀</h4>
          <dl className="divide-y border-y">
            {connections.map(c => <div key={c.pin} className="flex items-start gap-3 py-3">
              <span className="mt-[5px] h-[10px] w-[24px] shrink-0 rounded-sm border border-white/30" style={{ backgroundColor: c.color }} aria-hidden="true" />
              <div>
                <dt className="text-sm font-medium">{c.pin}번 · {c.signal}</dt>
                <dd className="mt-1 text-xs text-muted-foreground">{c.name} 선 → {c.terminal}</dd>
              </div>
            </div>)}
          </dl>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">GPIO 번호와 물리 핀 번호는 다릅니다. 그림에서 GPIO 단자의 왼쪽 아래가 1번, 왼쪽 위가 2번입니다. 3·4·5의 40핀 헤더에 같은 배선을 사용합니다.</p>
        <div className="space-y-2 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          {dht ? <>
            <p>그림은 VCC–DATA–GND 순서의 모듈입니다. 실제 모듈에 인쇄된 핀 이름을 우선 확인하세요.</p>
            <p>GPIO에 5V를 연결하지 마세요. 풀업이 없는 모듈은 DATA–3.3V 사이에 4.7~10kΩ 저항이 필요합니다.</p>
          </> : <>
            <p>무극성 접점 · 내부 풀업 사용. 접점 연결(LOW)은 닫힘, 분리(HIGH)는 열림입니다.</p>
            <p>아래쪽 부품은 배선하지 않는 자석입니다. 접점에 외부 전압을 넣지 마세요. 외형은 배선 설명용입니다.</p>
          </>}
        </div>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <a href={`${asset}_breadboard.svg`} download className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"><Download className="size-3" />도면 SVG 저장</a>
      <a href={`${asset}.fzz`} download className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"><Download className="size-3" />Fritzing 원본 저장</a>
      <a href="/pi-wiring/NOTICE.txt" download className="underline underline-offset-4 hover:text-foreground">부품 출처 및 이용조건</a>
    </div>
  </section>
}
