'use client'

// 김포공항 반경 5km 뇌전경보 패널 (wing15.lovable.app 연동).
// 경보가 없으면 한 줄 상태 표시, 경보 시 시작/종료 시각 + 점검 체크리스트를
// 보여주고 둘 다 체크해야 확인 버튼이 활성화된다. 확인 시 wing15의
// 현장별 확인 현황에서 송신소(TX)가 확인됨으로 바뀐다.

import { useEffect, useState } from 'react'
import { useRealtime } from '@/components/realtime/realtime-provider'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Check, Zap } from 'lucide-react'
import { toast } from 'sonner'

// UTC ISO → KST "MM/DD HH:mm"
function fmtKst(iso: string | null): string {
  if (!iso) return '-'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '-'
  const d = new Date(t + 9 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

export function LightningAlertPanel() {
  const { wing15, syncWing15 } = useRealtime()
  const [special, setSpecial] = useState(false)
  const [maintenance, setMaintenance] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const sig = wing15?.sig ?? ''
  const savedSpecial = wing15?.checklist.special ?? false
  const savedMaintenance = wing15?.checklist.maintenance ?? false

  // 서버 저장 상태를 로컬 체크 상태로 반영 (새 경보로 sig가 바뀌면 리셋됨)
  useEffect(() => {
    setSpecial(savedSpecial)
    setMaintenance(savedMaintenance)
  }, [sig, savedSpecial, savedMaintenance])

  if (!wing15) return null

  const items = wing15.items
  const hasUnconfirmed = items.some((i) => !i.confirmed)
  const anyActive = items.some((i) => i.active && !i.cancelled)

  const saveChecklist = (nextSpecial: boolean, nextMaintenance: boolean) => {
    setSpecial(nextSpecial)
    setMaintenance(nextMaintenance)
    fetch('/api/wing15/checklist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ special: nextSpecial, maintenance: nextMaintenance, sig }),
    }).catch(() => {})
  }

  const confirm = async () => {
    setConfirming(true)
    try {
      const res = await fetch('/api/wing15/confirm', { method: 'POST' })
      if (res.ok) {
        toast.success('송신소 현장 확인 완료')
        await syncWing15()
      } else {
        const body = await res.json().catch(() => null)
        toast.error(body?.error ?? '현장 확인 처리 실패')
      }
    } catch {
      toast.error('현장 확인 처리 실패')
    } finally {
      setConfirming(false)
    }
  }

  // 경보 없음 — 한 줄 상태 표시
  if (items.length === 0) {
    return (
      <div
        className="mt-1 flex flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1"
        title={
          wing15.ok
            ? `김포공항 반경 5km 뇌전 감시 중 (갱신 ${fmtKst(wing15.updatedAt)})`
            : `wing15 연결 오류: ${wing15.error ?? '알 수 없음'}`
        }
      >
        <Zap className="h-3 w-3 text-yellow-500/80" />
        <span className="text-[11px] text-neutral-400">뇌전감시 김포5km</span>
        <span className={`ml-auto text-[10px] font-medium ${wing15.ok ? 'text-green-500' : 'text-amber-500'}`}>
          {wing15.ok ? '정상' : '오류'}
        </span>
      </div>
    )
  }

  // 뇌전경보 카드
  return (
    <div
      className={`mt-1 flex flex-shrink-0 flex-col gap-1.5 rounded-md border border-border border-l-4 p-2 ${
        anyActive ? 'border-l-[#ef4444] bg-red-950/50' : 'border-l-[#eab308] bg-yellow-950/30'
      }`}
    >
      <div className="flex items-center gap-1">
        <Zap
          className={`h-3.5 w-3.5 ${anyActive ? 'animate-electric-pulse text-red-400' : 'text-yellow-400'}`}
        />
        <span className="text-xs font-bold text-white">뇌전경보</span>
        <span className="ml-auto text-[10px] text-neutral-400">김포 5km</span>
      </div>

      {items.map((item) => (
        <div key={item.key} className="rounded bg-black/25 px-1.5 py-1">
          <div className="flex items-center gap-1 text-[11px] font-medium text-neutral-200">
            <span>{item.title}</span>
            {item.cancelled && (
              <span className="rounded bg-neutral-700 px-1 py-px text-[9px] text-neutral-300">해제</span>
            )}
            {item.confirmed && <Check className="ml-auto h-3 w-3 text-green-500" />}
          </div>
          <div className="mt-0.5 text-[10px] leading-4 text-neutral-400">
            <div>시작 {fmtKst(item.startAt)}</div>
            <div>종료 {fmtKst(item.endAt)}</div>
          </div>
        </div>
      ))}

      {hasUnconfirmed ? (
        <div className="flex flex-col gap-1 pt-0.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-200">
            <Checkbox
              className="size-3.5"
              checked={special}
              onCheckedChange={(v) => saveChecklist(v === true, maintenance)}
            />
            특별점검
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-200">
            <Checkbox
              className="size-3.5"
              checked={maintenance}
              onCheckedChange={(v) => saveChecklist(special, v === true)}
            />
            유지보수일지
          </label>
          <Button
            size="sm"
            className="mt-0.5 h-6 w-full text-xs"
            disabled={!special || !maintenance || confirming}
            onClick={confirm}
          >
            {confirming ? '처리 중...' : '확인'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-[11px] font-medium text-green-500">
          <Check className="h-3 w-3" />
          송신소 확인 완료
        </div>
      )}
    </div>
  )
}
