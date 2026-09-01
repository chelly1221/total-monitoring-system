// wing15(WING 전국공항 기상 데이터) 뇌전 감시 폴러.
// 1분 주기로 김포공항 반경 5km 낙뢰/뇌전특보를 조회해 상태를 DB(Setting)에
// 저장하고 WebSocket으로 대시보드에 브로드캐스트한다.

import { prisma } from './db-updater'
import { broadcast } from './websocket-server'
import { getWing15Status } from '@/lib/wing15'
import { buildDemoState } from '@/lib/wing15-demo'
import { createLogger } from '@/lib/logger'
import type { Wing15Checklist, Wing15State } from '@/types'

const log = createLogger('wing15-monitor')

const POLL_INTERVAL_MS = parseInt(process.env.WING15_POLL_INTERVAL || '60000', 10)

const STATE_KEY = 'wing15State'
const CHECKLIST_KEY = 'wing15Checklist'

let pollTimer: ReturnType<typeof setInterval> | null = null
let polling = false
let lastState: Wing15State | null = null

async function readChecklist(): Promise<Wing15Checklist | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: CHECKLIST_KEY } })
    if (!row) return null
    const parsed = JSON.parse(row.value) as Wing15Checklist
    if (typeof parsed?.special !== 'boolean' || typeof parsed?.maintenance !== 'boolean') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function saveSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value, category: 'wing15' },
  })
}

async function publishState(
  state: Wing15State,
  priorChecklist: Wing15Checklist | null
): Promise<void> {
  // 미확인 알림 구성이 바뀌어 체크리스트가 리셋됐으면 반영
  if (!priorChecklist || priorChecklist.sig !== state.checklist.sig) {
    await saveSetting(CHECKLIST_KEY, JSON.stringify(state.checklist))
  }
  lastState = state
  await saveSetting(STATE_KEY, JSON.stringify(state))
  broadcast({ type: 'wing15', data: { wing15: state }, timestamp: new Date().toISOString() })
}

async function poll(): Promise<void> {
  if (polling) return // 이전 폴링이 늦어지면 겹치지 않게 스킵
  polling = true
  try {
    const checklist = await readChecklist()

    // 데모 모드: 카드 디자인 확인용 가짜 경보 (실제 wing15 조회/기록 없음)
    const demo = await prisma.setting.findUnique({ where: { key: 'wing15Demo' } })
    if (demo?.value === 'true') {
      const demoConfirmed = await prisma.setting.findUnique({
        where: { key: 'wing15DemoConfirmed' },
      })
      await publishState(buildDemoState(checklist, demoConfirmed?.value === 'true'), checklist)
      return
    }
    // 데모 종료 시 확인 흔적 정리
    await prisma.setting.deleteMany({ where: { key: 'wing15DemoConfirmed' } })

    const state = await getWing15Status(checklist)

    const hadItems = (lastState?.items.length ?? 0) > 0
    if (state.items.length > 0 && !hadItems) {
      log.info(`뇌전경보 감지: ${state.items.map((i) => i.title).join(', ')}`)
    }
    await publishState(state, checklist)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('폴링 실패:', message)
    // 일시 장애 시 마지막 정상 항목은 유지한 채 오류만 표시
    const state: Wing15State = {
      ok: false,
      error: message,
      updatedAt: new Date().toISOString(),
      sig: lastState?.sig ?? '',
      items: lastState?.items ?? [],
      checklist: lastState?.checklist ?? { special: false, maintenance: false, sig: '' },
    }
    lastState = state
    try {
      await saveSetting(STATE_KEY, JSON.stringify(state))
    } catch {
      // DB까지 실패하면 브로드캐스트만
    }
    broadcast({ type: 'wing15', data: { wing15: state }, timestamp: new Date().toISOString() })
  } finally {
    polling = false
  }
}

export function startWing15Monitor(): void {
  if (pollTimer) return
  log.info(`뇌전 감시 시작 (김포공항 5km, ${POLL_INTERVAL_MS / 1000}s 주기)`)
  void poll()
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS)
}

export function stopWing15Monitor(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
