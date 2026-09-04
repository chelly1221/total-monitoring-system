// 뇌전경보 카드 디자인 확인용 데모 상태 생성.
// Setting `wing15Demo`='true'면 워커가 실제 wing15 조회 대신 이 상태를 내보낸다.
// 실데이터(wing15 피드)는 일절 건드리지 않는다.

import type { Wing15Checklist, Wing15State } from '@/types'

export function buildDemoState(
  checklist: Wing15Checklist | null,
  confirmed: boolean
): Wing15State {
  const now = Date.now()
  const min = 60_000
  // 2분마다 "경보 진행 중" ↔ "종료됨(확인 가능)" 상태를 번갈아 표시
  const active = !confirmed && Math.floor(now / (2 * min)) % 2 === 0
  // computeSig와 동일 규칙: 미확인 항목 key 정렬 후 '|' 결합
  const sig = confirmed ? '' : 'demo:strikes'
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    sig,
    items: [
      {
        key: 'demo:strikes',
        kind: 'strikes',
        title: '낙뢰 7건',
        startAt: new Date(now - 25 * min).toISOString(),
        endAt: new Date(now - (active ? 3 : 70) * min).toISOString(),
        active,
        strikeCount: 7,
        confirmed,
      },
    ],
    checklist:
      checklist && checklist.sig === sig
        ? checklist
        : { special: false, maintenance: false, sig },
  }
}
