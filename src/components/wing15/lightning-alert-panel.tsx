'use client'

// 김포공항 반경 5km 뇌전경보 패널 (wing15.lovable.app 연동).
// 경보가 없으면 상태 카드(정상/연결 중/오류), 경보 시 시작/종료 시각을 표시하고
// 특보 해제 후 점검 체크리스트가 나타나 둘 다 체크해야 확인 버튼이 활성화된다.
// 확인 시 wing15의 현장별 확인 현황에서 송신소(TX)가 확인됨으로 바뀐다.
// 디자인: design_handoff_lightning_panel 명세 (솔리드 배경 5개 상태 카드)

import { useEffect, useState } from 'react'
import { useRealtime } from '@/components/realtime/realtime-provider'
import { Checkbox } from '@/components/ui/checkbox'
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

const CARD_SHADOW = 'shadow-[0_4px_6px_-1px_rgba(0,0,0,0.3)]'

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

  const items = wing15?.items ?? []
  const hasUnconfirmed = items.some((i) => !i.confirmed)
  // 발효 중 여부 — 체크리스트는 모든 항목 해제/종료 후에만 표시
  const anyActive = items.some((i) => i.active && !i.cancelled)
  // 앱/워커 시작 직후 첫 폴링 전에는 오류가 아니라 연결 중 상태
  const connecting = !wing15 || (!wing15.ok && !wing15.updatedAt)

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

  // 경보 없음 — 상태 카드 (정상=초록, 연결 중=회색, 오류=노랑)
  if (items.length === 0) {
    const status = connecting ? 'connecting' : wing15!.ok ? 'normal' : 'error'
    const cardClass = {
      normal: 'border-l-[#4ade80] bg-[#22c55e]',
      connecting: 'border-l-[#525252] bg-[#404040]',
      error: 'border-l-[#facc15] bg-[#eab308]',
    }[status]
    const iconClass = {
      normal: 'text-[#052e16]',
      connecting: 'text-[#d4d4d4]',
      error: 'text-[#1f1300]',
    }[status]
    const titleClass = {
      normal: 'text-[#052e16]',
      connecting: 'text-[#fafafa]',
      error: 'text-[#1f1300]',
    }[status]
    const subClass = {
      normal: 'text-[#14532d]',
      connecting: 'text-[#d4d4d4]',
      error: 'text-[#422006]',
    }[status]
    const badge = {
      normal: { text: '정상', className: 'bg-[rgba(20,83,45,0.8)] text-[#dcfce7]' },
      connecting: { text: '연결 중', className: 'bg-[rgba(23,23,23,0.8)] text-[#d4d4d4]' },
      error: { text: '오류', className: 'bg-[rgba(113,63,18,0.8)] text-[#fef9c3]' },
    }[status]
    const detail = {
      normal: `갱신 ${fmtKst(wing15?.updatedAt ?? null)}`,
      connecting: '상태 수집 대기 중...',
      error: `마지막 갱신 ${fmtKst(wing15?.updatedAt || null)}`,
    }[status]

    return (
      <div
        className={`mt-1 flex-shrink-0 rounded-[6px] border-l-4 px-3 py-[10px] ${CARD_SHADOW} ${cardClass}`}
        title={
          status === 'error'
            ? `wing15 연결 오류: ${wing15?.error ?? '알 수 없음'}`
            : '김포공항 반경 5km 낙뢰/뇌전특보 감시 (wing15)'
        }
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <Zap className={`size-5 ${iconClass}`} />
            <span className={`text-[17px] font-bold ${titleClass}`}>뇌전감시</span>
          </div>
          <span
            className={`flex-shrink-0 rounded-full border border-white/20 px-2 py-0.5 text-[13px] font-bold ${badge.className}`}
          >
            {badge.text}
          </span>
        </div>
        <div className={`mt-1 text-[14px] font-medium leading-5 ${subClass}`}>
          <div>김포공항 반경 5km</div>
          <div>{detail}</div>
        </div>
      </div>
    )
  }

  // 뇌전경보 카드 — 발효 중(레드) / 해제(옐로)
  const cardClass = anyActive
    ? 'border-l-[#f87171] bg-[#dc2626]'
    : 'border-l-[#facc15] bg-[#eab308]'
  const headTitleClass = anyActive ? 'text-white' : 'text-[#1f1300]'
  const headSubClass = anyActive ? 'text-white' : 'text-[#422006]'
  const itemRowClass = anyActive ? 'bg-[rgba(0,0,0,0.25)]' : 'bg-[rgba(255,255,255,0.35)]'
  const itemTitleClass = anyActive
    ? 'font-medium text-white'
    : 'font-semibold text-[#422006]'
  const itemTimeClass = anyActive ? 'text-white' : 'text-[#422006]'
  const checkClass = anyActive ? 'text-white' : 'text-[#14532d]'

  return (
    <div
      className={`mt-1 flex flex-shrink-0 flex-col gap-1.5 rounded-[6px] border-l-4 p-[10px] ${CARD_SHADOW} ${cardClass}`}
    >
      <div className="flex items-center gap-1.5">
        <Zap
          className={`size-[18px] ${anyActive ? 'animate-electric-pulse text-white' : 'text-[#1f1300]'}`}
        />
        <span className={`text-[15px] font-bold ${headTitleClass}`}>뇌전경보</span>
        <span className={`ml-auto text-[13px] ${headSubClass}`}>김포 5km</span>
      </div>

      {items.map((item) => (
        <div key={item.key} className={`rounded-[4px] px-2 py-1.5 ${itemRowClass}`}>
          <div className={`flex items-center gap-1.5 text-[14px] ${itemTitleClass}`}>
            <span className="whitespace-nowrap">{item.title}</span>
            {item.cancelled && (
              <span className="whitespace-nowrap rounded-[4px] bg-[rgba(66,32,6,0.9)] px-1.5 py-0.5 text-[12px] font-medium text-[#fef9c3]">
                해제
              </span>
            )}
            {item.confirmed && <Check className={`ml-auto size-[15px] ${checkClass}`} />}
          </div>
          <div className={`mt-0.5 text-[13px] leading-5 ${itemTimeClass}`}>
            <div>시작 {fmtKst(item.startAt)}</div>
            <div>종료 {fmtKst(item.endAt)}</div>
          </div>
        </div>
      ))}

      {hasUnconfirmed ? (
        anyActive ? (
          // 발효 중에는 점검 항목을 숨기고 해제 후 표시
          <div className="text-[13px] text-white">특보 해제 후 점검 체크리스트가 표시됩니다</div>
        ) : (
          <div className="flex flex-col gap-1.5 pt-0.5">
            <label className="flex cursor-pointer items-center gap-1.5 text-[14px] font-medium text-[#422006]">
              <Checkbox
                className="size-[18px] rounded-[4px] border-[rgba(31,19,0,0.7)] bg-[rgba(255,255,255,0.45)] data-[state=checked]:border-[#1f1300] data-[state=checked]:bg-[#1f1300] data-[state=checked]:text-[#fef9c3] [&_svg]:size-[13px]"
                checked={special}
                onCheckedChange={(v) => saveChecklist(v === true, maintenance)}
              />
              특별점검
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[14px] font-medium text-[#422006]">
              <Checkbox
                className="size-[18px] rounded-[4px] border-[rgba(31,19,0,0.7)] bg-[rgba(255,255,255,0.45)] data-[state=checked]:border-[#1f1300] data-[state=checked]:bg-[#1f1300] data-[state=checked]:text-[#fef9c3] [&_svg]:size-[13px]"
                checked={maintenance}
                onCheckedChange={(v) => saveChecklist(special, v === true)}
              />
              유지보수일지
            </label>
            <button
              type="button"
              className="mt-0.5 h-8 w-full rounded-[6px] text-[15px] font-semibold transition-colors enabled:bg-[#1f1300] enabled:text-[#fef9c3] enabled:hover:bg-[#1f1300]/90 disabled:cursor-not-allowed disabled:bg-[rgba(31,19,0,0.45)] disabled:text-[#fffbeb]"
              disabled={!special || !maintenance || confirming}
              onClick={confirm}
            >
              {confirming ? '처리 중...' : '확인'}
            </button>
          </div>
        )
      ) : (
        <div className={`flex items-center gap-1.5 text-[14px] font-bold ${checkClass}`}>
          <Check className="size-[15px]" />
          송신소 확인 완료
        </div>
      )}
    </div>
  )
}
