'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, MonitorCheck, MonitorUp, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { identifyClient } from '@/components/forms/client-discovery-panel'
import {
  formatBytes,
  isJobActive,
  isRunnable,
  phaseLabel,
  supportsTransfer,
  minTransferVersion,
  type StagedFileInfo,
  type TransferJob,
  type TransferTarget,
} from '@/lib/transfer-rules'
import { cn } from '@/lib/utils'
import type { DiscoveredClient } from '@/types'

const POLL_INTERVAL_MS = 1000

/** Why a discovered client cannot be a transfer target; null when it can. */
function unsupportedReason(client: DiscoveredClient): string | null {
  const kind = client.kind === 'ping' ? 'ping' : 'sound'
  if (!supportsTransfer(client.ver, kind)) {
    const program = kind === 'ping' ? '네트워크 ping 감시' : '음성탐지기'
    return `${program} ${minTransferVersion(kind)} 이상이 필요합니다 (현재 v${client.ver || '?'})`
  }
  return null
}

/** Upload with progress; fetch() cannot report upload progress, so use XHR. */
function uploadFile(file: File, onProgress: (ratio: number) => void): Promise<StagedFileInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/transfers/files?name=${encodeURIComponent(file.name)}`)
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      let data: { file?: StagedFileInfo; error?: string } = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.file) resolve(data.file)
      else reject(new Error(data.error || '파일 업로드에 실패했습니다'))
    }
    xhr.onerror = () => reject(new Error('파일 업로드에 실패했습니다'))
    xhr.send(file)
  })
}

function PhaseIcon({ target }: { target: TransferTarget }) {
  switch (target.phase) {
    case 'done':
      return <CheckCircle2 className="size-4 shrink-0 text-[#4ade80]" />
    case 'error':
    case 'unreachable':
    case 'rejected':
      return <XCircle className="size-4 shrink-0 text-[#f87171]" />
    default:
      return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
  }
}

function TargetRow({ target }: { target: TransferTarget }) {
  const pct = target.total > 0 ? Math.min(100, Math.floor((target.received / target.total) * 100)) : 0
  const showBar = target.phase === 'downloading' || target.phase === 'verifying' || target.phase === 'running' || target.phase === 'done'
  return (
    <li className="flex flex-col gap-1 border-t py-2 first:border-t-0">
      <div className="flex items-center gap-2 text-sm">
        <PhaseIcon target={target} />
        <span className="truncate font-medium">{target.name || target.host || target.ip}</span>
        <span className="font-mono text-xs text-muted-foreground">{target.ip}</span>
        <span className="ml-auto shrink-0 text-xs tabular-nums">{phaseLabel(target)}</span>
      </div>
      {showBar && (
        <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
          <div
            className={cn('h-full transition-[width]', target.phase === 'done' ? 'bg-[#4ade80]' : 'bg-primary')}
            style={{ width: `${target.phase === 'downloading' ? pct : 100}%` }}
          />
        </div>
      )}
      {target.message && (
        <div className={cn('text-xs', target.phase === 'error' || target.phase === 'unreachable' || target.phase === 'rejected' ? 'text-[#f87171]' : 'text-muted-foreground')}>
          {target.message}
        </div>
      )}
    </li>
  )
}

/**
 * Header 파일 전송 dialog: pick a file on this PC, choose the SoundSense PCs to
 * receive it, optionally run it there (silent V3 engine install), and watch
 * each PC's progress. The job keeps running on the server after the dialog
 * closes; reopening it resumes the latest job.
 */
export function TransferDialog() {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [run, setRun] = useState(false)
  const [elevate, setElevate] = useState(true)
  const [clients, setClients] = useState<DiscoveredClient[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [identifying, setIdentifying] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [job, setJob] = useState<TransferJob | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const scan = useCallback(async () => {
    setScanning(true)
    setScanError(null)
    try {
      const response = await fetch('/api/discovery/clients', { cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'PC 탐지에 실패했습니다')
      const found = data.clients as DiscoveredClient[]
      setClients(found)
      // Drop selections that disappeared from the network.
      setSelected(prev => new Set([...prev].filter(id => found.some(c => c.id === id))))
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'PC 탐지에 실패했습니다')
    } finally {
      setScanning(false)
    }
  }, [])

  const loadLatestJob = useCallback(async () => {
    try {
      const response = await fetch('/api/transfers', { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      const latest = (data.jobs as TransferJob[])[0]
      if (latest && isJobActive(latest)) setJob(latest)
    } catch {
      // nothing to resume
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void scan()
    void loadLatestJob()
  }, [open, scan, loadLatestJob])

  // Poll the running job while the dialog is open.
  useEffect(() => {
    if (!open || !job || !isJobActive(job)) return
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/transfers/${job.id}`, { cache: 'no-store' })
        if (!response.ok) return
        const data = await response.json()
        setJob(data.job as TransferJob)
      } catch {
        // keep polling
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [open, job])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null
    setFile(picked)
    if (picked) {
      setRun(isRunnable(picked.name))
      setElevate(true)
    }
  }

  const toggle = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const eligible = (clients ?? []).filter(client => unsupportedReason(client) === null)
  const allSelected = eligible.length > 0 && eligible.every(client => selected.has(client.id))

  const handleIdentify = async (client: DiscoveredClient) => {
    setIdentifying(client.id)
    await identifyClient(client.ip, client.discoveryPort)
    setIdentifying(null)
  }

  const start = async () => {
    if (!file) {
      toast.error('전송할 파일을 선택하세요')
      return
    }
    const targets = eligible.filter(client => selected.has(client.id))
    if (targets.length === 0) {
      toast.error('대상 PC를 하나 이상 선택하세요')
      return
    }
    setStarting(true)
    setUploadPct(0)
    try {
      const staged = await uploadFile(file, ratio => setUploadPct(Math.floor(ratio * 100)))
      setUploadPct(null)
      const response = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: staged.id,
          run,
          elevate,
          targets: targets.map(client => ({ id: client.id, name: client.name, host: client.host, ip: client.ip, discoveryPort: client.discoveryPort ?? 7790 })),
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '파일 전송을 시작하지 못했습니다')
      setJob(data.job as TransferJob)
      toast.success(`${targets.length}대 PC로 전송을 시작했습니다`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 전송을 시작하지 못했습니다')
    } finally {
      setUploadPct(null)
      setStarting(false)
    }
  }

  const jobActive = job !== null && isJobActive(job)
  const busy = starting || jobActive

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="파일 전송 · V3 자동설치">
          <MonitorUp className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" style={{ fontFamily: 'var(--font-pretendard), sans-serif' }}>
        <DialogHeader>
          <DialogTitle>파일 전송 · V3 자동설치</DialogTitle>
          <DialogDescription>
            이 PC의 파일을 음성탐지기나 네트워크 ping 감시가 실행 중인 시설 PC들로 한 번에 보냅니다. V3 엔진 설치 파일(예: ahnlabengine_setup260819.exe)을 고르면 받은 뒤 그 PC 화면에서 설치 프로그램이 자동으로 실행됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">1. 보낼 파일</div>
            <div className="flex items-center gap-3">
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                파일 선택
              </Button>
              {file ? (
                <span className="min-w-0 truncate text-sm">
                  {file.name} <span className="text-muted-foreground">({formatBytes(file.size)})</span>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">선택한 파일이 없습니다</span>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">2. 전송 후 동작</div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={run} onCheckedChange={value => setRun(value === true)} disabled={busy || !file || !isRunnable(file.name)} />
                자동 실행(설치)
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={elevate} onCheckedChange={value => setElevate(value === true)} disabled={busy || !run} />
                관리자 권한으로 실행
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              설치 프로그램 창이 시설 PC 화면에 그대로 뜨며, 설치를 마쳐 창이 닫히면 완료로 보고됩니다. 시설 PC에서 UAC 확인 창이 켜져 있으면 그 PC에서 승인해야 합니다.
              exe·msi가 아닌 파일은 실행하지 않고 음성탐지기 폴더의 received 안에 저장만 합니다.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                3. 대상 PC
                {clients && <span className="ml-1 normal-case">({eligible.length}대 선택 가능)</span>}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={allSelected}
                    disabled={busy || eligible.length === 0}
                    onCheckedChange={value => setSelected(value === true ? new Set(eligible.map(c => c.id)) : new Set())}
                  />
                  전체 선택
                </label>
                <Button type="button" variant="outline" size="xs" onClick={() => void scan()} disabled={scanning || busy}>
                  {scanning ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {scanning ? '검색 중' : '다시 검색'}
                </Button>
              </div>
            </div>
            {scanError && <div className="text-xs text-destructive">{scanError}</div>}
            {clients && clients.length === 0 && !scanning && !scanError && (
              <div className="py-2 text-xs text-muted-foreground">같은 네트워크에서 실행 중인 음성탐지기·네트워크 ping 감시를 찾지 못했습니다.</div>
            )}
            {clients && clients.length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded border">
                {clients.map(client => {
                  const reason = unsupportedReason(client)
                  return (
                    <li key={client.id} className="flex items-center gap-3 border-t px-3 py-1.5 text-sm first:border-t-0">
                      <Checkbox
                        checked={selected.has(client.id)}
                        disabled={busy || reason !== null}
                        onCheckedChange={value => toggle(client.id, value === true)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {client.name || <span className="text-muted-foreground">(미등록)</span>}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{client.host} · {client.kind === 'ping' ? 'ping 감시' : '음성탐지기'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{client.ip}</span>
                          <span>v{client.ver || '?'}</span>
                          {client.registered && <span>· {client.registered.systemName}</span>}
                          {reason && (
                            <span className="flex items-center gap-1 text-[#facc15]">
                              <AlertTriangle className="size-3" /> {reason}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title="이 PC에서 확인 알림 표시"
                        disabled={identifying !== null}
                        onClick={() => void handleIdentify(client)}
                      >
                        {identifying === client.id ? <Loader2 className="animate-spin" /> : <MonitorCheck />}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {uploadPct !== null && (
            <section className="flex flex-col gap-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>서버로 파일 올리는 중</span>
                <span className="tabular-nums">{uploadPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-primary transition-[width]" style={{ width: `${uploadPct}%` }} />
              </div>
            </section>
          )}

          {job && (
            <section className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  진행 상황 · {job.file.name} ({formatBytes(job.file.size)}){job.run ? ' · 전송 후 실행' : ''}
                </div>
                {!jobActive && (
                  <Button type="button" variant="ghost" size="xs" onClick={() => setJob(null)}>
                    새 전송
                  </Button>
                )}
              </div>
              <ul className="max-h-48 overflow-y-auto rounded border px-3">
                {job.targets.map(target => <TargetRow key={target.clientId} target={target} />)}
              </ul>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
          <Button type="button" onClick={() => void start()} disabled={busy || !file || selected.size === 0}>
            {starting ? <Loader2 className="animate-spin" /> : <MonitorUp />}
            {jobActive ? '전송 진행 중' : '전송 시작'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
