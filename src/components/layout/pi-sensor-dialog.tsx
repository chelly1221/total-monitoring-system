'use client'

import { useCallback, useEffect, useState } from 'react'
import { CircuitBoard, Loader2, RefreshCw, Search, CardSim, Cable } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PI_CHANNELS, type PiChannelId } from '@/lib/pi-sensor'
import type { DiscoveredClient } from '@/types'
import { PiWiringDiagram } from './pi-wiring-diagram'

interface Disk { number: number; name: string; size: number; uniqueId: string; serial: string | null; bus: string }
interface Progress { phase: string; done: number; total: number; message: string }
const selectClass = 'h-9 rounded-md border border-input bg-background px-3 text-sm'
export function PiSensorDialog() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'wiring' | 'install' | 'discover'>('wiring')
  const [channel, setChannel] = useState<PiChannelId>('dht1')
  const [model, setModel] = useState('pi34')
  const [name, setName] = useState('라즈베리파이 센서')
  const [enabled, setEnabled] = useState<PiChannelId[]>(['dht1', 'door1'])
  const [mode, setMode] = useState('dhcp')
  const [address, setAddress] = useState('')
  const [gateway, setGateway] = useState('')
  const [disks, setDisks] = useState<Disk[]>([])
  const [diskId, setDiskId] = useState('')
  const [available, setAvailable] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [diskLoading, setDiskLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState('')
  const [clients, setClients] = useState<DiscoveredClient[]>([])
  const [scanning, setScanning] = useState(false)
  const [registering, setRegistering] = useState('')
  const [names, setNames] = useState<Record<string, string>>({})
  const [levels, setLevels] = useState<Record<string, number>>({})
  const desktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

  const loadDisks = useCallback(async () => {
    if (!desktop) return
    setDiskLoading(true)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const [rows, images] = await Promise.all([invoke<Disk[]>('pi_disks'), invoke<{ model: string; available: boolean }[]>('pi_images')])
      setDisks(rows)
      setAvailable(images.filter(i => i.available).map(i => i.model))
    } catch (e) { setError(String(e)) } finally { setDiskLoading(false) }
  }, [desktop])

  const scan = useCallback(async () => {
    setScanning(true); setError('')
    try {
      const res = await fetch('/api/discovery/clients', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setClients((data.clients as DiscoveredClient[]).filter(c => c.kind === 'pi'))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setScanning(false) }
  }, [])

  useEffect(() => {
    if (!open || tab !== 'install' || busy) return
    void loadDisks()
    const timer = setInterval(() => void loadDisks(), 5000)
    return () => clearInterval(timer)
  }, [open, tab, busy, loadDisks])
  useEffect(() => { if (open && tab === 'discover') void scan() }, [open, tab, scan])

  const install = async () => {
    const disk = disks.find(d => `${d.number}:${d.uniqueId}` === diskId)
    if (!disk || !confirmed) return
    setBusy(true); setError(''); setProgress({ phase: 'preparing', done: 0, total: 0, message: '설치 준비 중' })
    let unlisten: (() => void) | undefined
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const { listen } = await import('@tauri-apps/api/event')
      unlisten = await listen<Progress>('pi-install-progress', e => { if (e.payload) setProgress(e.payload) })
      const done = await invoke<boolean>('pi_install', { disk, model, config: { name: name.trim(), channels: enabled, network: { mode, address: address.trim(), gateway: gateway.trim() } } })
      if (done) toast.success('SD 카드 기록과 검증을 완료했습니다')
      else setProgress(null)
    } catch (e) { setError(String(e)); setProgress(null) }
    finally { unlisten?.(); setBusy(false); setConfirmed(false) }
  }

  const register = async (client: DiscoveredClient, channel: typeof PI_CHANNELS[number]) => {
    const key = `${client.id}:${channel.id}`
    setRegistering(key); setError('')
    try {
      const res = await fetch('/api/pi/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        id: client.id, ip: client.ip, channel: channel.id, name: names[key] ?? `${client.name || client.host} ${channel.label}`, closedLevel: levels[key] ?? client.channels?.find(c => c.id === channel.id)?.closedLevel ?? 0,
      }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`${channel.label} 서버 연결 완료`)
      await scan()
    } catch (e) { await scan(); setError(e instanceof Error ? e.message : String(e)) }
    finally { setRegistering('') }
  }

  return <Dialog open={open} onOpenChange={value => { if (!busy && !registering) setOpen(value) }}>
    <DialogTrigger asChild><Button variant="ghost" size="icon" title="라즈베리파이 센서 · 배선 및 SD 설치" aria-label="라즈베리파이 센서"><CircuitBoard className="h-5 w-5" /></Button></DialogTrigger>
    <DialogContent className="flex max-h-[90vh] flex-col gap-[14px] p-[20px] text-[15px] sm:max-w-[1060px] [&_p]:text-[14px] [&_label]:text-[14px] [&_button]:h-[36px] [&_button]:text-[14px] [&_input]:text-[14px] [&_input:not([type=checkbox])]:h-[36px] [&_select]:h-[36px] [&_select]:text-[14px] [&_table]:text-[14px] [&_.text-sm]:text-[14px] [&_.text-xs]:text-[12px]" showCloseButton={!busy && !registering} style={{ fontFamily: 'var(--font-pretendard), sans-serif' }}>
      <DialogHeader><DialogTitle className="flex items-center gap-2 text-[22px]"><CircuitBoard className="size-6 text-emerald-400" />라즈베리파이 센서</DialogTitle><DialogDescription>채널 배선 → 폐쇄망용 SD 카드 설치 → 자동탐지 및 시설 등록</DialogDescription></DialogHeader>
      <div className="flex flex-wrap gap-2 border-b pb-3" role="tablist" aria-label="라즈베리파이 관리">
        {([{ id: 'wiring', label: '입력 배선도', Icon: Cable }, { id: 'install', label: 'SD 카드 설치', Icon: CardSim }, { id: 'discover', label: '자동탐지 · 등록', Icon: Search }] as const).map(({ id, label, Icon }) => <Button key={id} role="tab" aria-selected={tab === id} variant={tab === id ? 'secondary' : 'ghost'} disabled={busy || !!registering} onClick={() => { setTab(id); setError('') }}><Icon className="mr-2 size-4" />{label}</Button>)}
      </div>
      <div className="min-h-0 overflow-y-auto pr-1" role="tabpanel">
        {tab === 'wiring' && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{PI_CHANNELS.map(c => <Button key={c.id} size="sm" aria-pressed={channel === c.id} variant={channel === c.id ? 'default' : 'outline'} onClick={() => setChannel(c.id)}>{c.label} · GPIO{c.gpio}</Button>)}</div>
          <PiWiringDiagram key={channel} channel={PI_CHANNELS.find(c => c.id === channel)!} />
          <p className="text-sm text-muted-foreground">전원을 끈 상태에서 연결하세요. 3.3V와 GND는 단자대로 분배할 수 있습니다. 기본 4개 온습도 채널·4개 개폐 채널 중 실제 연결한 채널만 설치 시 선택합니다. 배선 길이는 짧게 유지하세요.</p>
        </div>}
        {tab === 'install' && <div className="space-y-5">
          {!desktop && <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">SD 카드 기록은 서버 PC의 TMS 데스크톱 앱에서 사용할 수 있습니다. 브라우저에서는 배선 안내와 자동탐지를 이용하세요.</div>}
          <div className="grid grid-cols-2 gap-6">
            <fieldset disabled={busy} className="space-y-4">
              <label className="flex flex-col gap-2 text-sm">설치할 모델<select className={selectClass} value={model} onChange={e => { setModel(e.target.value); setConfirmed(false) }}><option value="pi34">라즈베리파이 3 / 4 · ARM64</option><option value="pi5">라즈베리파이 5 · ARM64 전용</option></select></label>
              <label className="flex flex-col gap-2 text-sm">장비 이름<Input value={name} onChange={e => setName(e.target.value)} maxLength={32} /></label>
              <div><p className="mb-2 text-sm">사용할 입력 채널</p><div className="grid grid-cols-2 gap-2">{PI_CHANNELS.map(c => <label key={c.id} className="flex items-center gap-2 rounded border p-2 text-sm"><input type="checkbox" checked={enabled.includes(c.id)} onChange={e => setEnabled(v => e.target.checked ? [...v, c.id] : v.filter(id => id !== c.id))} />{c.label}<span className="ml-auto text-xs text-muted-foreground">GPIO{c.gpio}</span></label>)}</div></div>
              <label className="flex flex-col gap-2 text-sm">유선 LAN 주소<select className={selectClass} value={mode} onChange={e => setMode(e.target.value)}><option value="dhcp">자동 할당 (DHCP 서버 필요)</option><option value="static">고정 IP</option></select></label>
              {mode === 'static' && <div className="grid grid-cols-2 gap-2"><label className="text-sm">IP / 접두 길이<Input value={address} onChange={e => setAddress(e.target.value)} placeholder="192.168.1.50/24" /></label><label className="text-sm">게이트웨이 (선택)<Input value={gateway} onChange={e => setGateway(e.target.value)} placeholder="192.168.1.1" /></label></div>}
            </fieldset>
            <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
              <div className="flex items-center justify-between font-medium"><span>기록할 SD 카드</span><Button variant="ghost" size="sm" disabled={busy || diskLoading || !desktop} onClick={() => void loadDisks()}><RefreshCw className={`mr-1 size-4 ${diskLoading ? 'animate-spin' : ''}`} />새로고침</Button></div>
              <p className="text-sm text-muted-foreground">SD 카드를 리더기에 꽂으면 목록이 갱신됩니다. 8GB 이상 권장 · 최대 512GB USB·SD·MMC 장치 중 시스템 디스크를 제외합니다.</p>
              <select aria-label="기록할 SD 카드" className={`${selectClass} w-full`} value={diskId} disabled={busy || !desktop} onChange={e => { setDiskId(e.target.value); setConfirmed(false) }}><option value="">대상 카드를 선택하세요</option>{disks.map(d => <option key={`${d.number}:${d.uniqueId}`} value={`${d.number}:${d.uniqueId}`}>디스크 {d.number} · {d.name} · {(d.size / 1e9).toFixed(1)} GB</option>)}</select>
              {disks.find(d => `${d.number}:${d.uniqueId}` === diskId) && <p className="break-all text-xs text-muted-foreground">일련번호: {disks.find(d => `${d.number}:${d.uniqueId}` === diskId)?.serial || '없음'}</p>}
              {desktop && !available.includes(model) && <p className="text-sm text-amber-400">이 모델의 폐쇄망용 이미지가 서버에 없습니다.</p>}
              <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm leading-6">OS·Python·센서 드라이버를 함께 기록합니다. 첫 부팅부터 인터넷 연결이 필요 없습니다. 설치 후 유선 LAN과 전원을 연결하고 자동탐지에서 채널을 등록하세요.</div>
              <label className="flex gap-2 text-sm text-amber-300"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />선택한 디스크의 기존 데이터가 모두 삭제됨을 확인했습니다.</label>
              <Button className="w-full" disabled={!desktop || busy || !confirmed || !disks.some(d => `${d.number}:${d.uniqueId}` === diskId) || !available.includes(model) || !enabled.length || !name.trim()} onClick={() => void install()}>{busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <CardSim className="mr-2 size-4" />}OS와 센서 프로그램 설치</Button>
              <p className="text-xs text-muted-foreground">Windows 관리자 권한 확인이 표시됩니다. 기록·검증 중에는 카드를 빼거나 앱을 종료하지 마세요.</p>
            </div>
          </div>
          {progress && <div role="status" className="space-y-2 rounded border p-3 text-sm"><p>{progress.message}</p>{progress.total > 0 && <progress className="h-2 w-full accent-emerald-500" value={progress.done} max={progress.total} />}</div>}
        </div>}
        {tab === 'discover' && <div className="space-y-4">
          <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">같은 서브넷의 장비를 검색합니다. 등록한 채널은 재부팅 후에도 자동 연결됩니다.</p><Button variant="outline" disabled={scanning || !!registering} onClick={() => void scan()}><RefreshCw className={`mr-2 size-4 ${scanning ? 'animate-spin' : ''}`} />다시 탐지</Button></div>
          {!clients.length && <div className="rounded border border-dashed p-10 text-center text-muted-foreground">{scanning ? '라즈베리파이를 찾고 있습니다…' : '탐지된 장비가 없습니다. 전원·유선 LAN·IP 설정과 UDP 7793 통신을 확인하세요.'}</div>}
          {clients.map(client => <div key={client.id} className="rounded-lg border">
            <div className="flex items-center gap-3 border-b bg-muted/20 p-3"><CircuitBoard className="size-5 text-emerald-400" /><strong>{client.name || client.host}</strong><span className="text-sm text-muted-foreground">{client.ip} · {client.host} · v{client.ver}</span></div>
            <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-3">채널 / 배선</th><th>시설 이름</th><th>닫힘 입력</th><th className="p-3 text-right">서버 연결</th></tr></thead><tbody>{client.channels?.map(entry => {
              const c = PI_CHANNELS.find(c => c.id === entry.id)!, key = `${client.id}:${entry.id}`
              const registered = client.registeredChannels?.find(r => r.channel === entry.id)
              return <tr key={entry.id} className="border-t"><td className="p-3">{c.label}<div className="text-xs text-muted-foreground">GPIO{c.gpio} · 물리 {c.pin}번</div></td><td className="pr-3">{registered ? <Link className="text-emerald-400 hover:underline" href={`/systems/${registered.systemId}`} onClick={() => setOpen(false)}>{registered.systemName}</Link> : <Input aria-label={`${c.label} 시설 이름`} maxLength={64} value={names[key] ?? `${client.name || client.host} ${c.label}`} onChange={e => setNames(v => ({ ...v, [key]: e.target.value }))} />}</td><td>{c.kind === 'mc58' ? <select aria-label={`${c.label} 닫힘 입력`} className={selectClass} value={levels[key] ?? entry.closedLevel ?? 0} onChange={e => setLevels(v => ({ ...v, [key]: Number(e.target.value) }))}><option value={0}>LOW (기본)</option><option value={1}>HIGH (반전)</option></select> : '—'}</td><td className="p-3 text-right"><Button size="sm" variant={registered ? 'outline' : 'default'} disabled={!!registering || scanning} onClick={() => void register(client, c)}>{registering === key && <Loader2 className="mr-1 size-4 animate-spin" />}{registered ? '다시 연결' : '자동 추가'}</Button></td></tr>
            })}</tbody></table>
          </div>)}
          <p className="text-xs text-muted-foreground">온습도는 온습도 감시 화면, 개폐는 장비상태 화면에 등록됩니다. 온습도 알람 임계값은 시설 상세에서 지정하세요. MC-58(NC)은 설치 후 실제 문을 열고 닫아 극성을 확인하세요.</p>
        </div>}
        {error && <p role="alert" className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </DialogContent>
  </Dialog>
}
