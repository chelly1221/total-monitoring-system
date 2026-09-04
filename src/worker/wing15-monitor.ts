// wing15(WING 전국공항 기상 데이터) 뇌전 감시 폴러.
// 3분 주기로 wing15 낙뢰 피드(김포공항 최신 N건)를 조회해 반경 5km 지상낙뢰를
// 로컬 이력에 누적하고, 경보 상태를 DB(Setting)에 저장한 뒤 WebSocket으로
// 대시보드에 브로드캐스트한다.
// wing15 측 요청: 호출은 최대 1분당 1회 — 주기를 env로 줄여도 60초 미만은 막는다.

import { prisma } from './db-updater'
import { broadcast } from './websocket-server'
import {
  buildWing15State,
  fetchNearbyStrikes,
  mergeStrikes,
  parseConfirmedAt,
  parseStrikes,
} from '@/lib/wing15'
import { buildDemoState } from '@/lib/wing15-demo'
import { createLogger } from '@/lib/logger'
import type { Wing15Checklist, Wing15State } from '@/types'

const log = createLogger('wing15-monitor')

const MIN_POLL_INTERVAL_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 180_000
const POLL_INTERVAL_MS = Math.max(
  MIN_POLL_INTERVAL_MS,
  parseInt(process.env.WING15_POLL_INTERVAL || '', 10) || DEFAULT_POLL_INTERVAL_MS
)

const STATE_KEY = 'wing15State'
const CHECKLIST_KEY = 'wing15Checklist'
const ENABLED_KEY = 'wing15Enabled'
const STRIKES_KEY = 'wing15Strikes'
const CONFIRMED_AT_KEY = 'wing15ConfirmedAt'

let pollTimer: ReturnType<typeof setInterval> | null = null
let polling = false
let lastState: Wing15State | null = null
// 직전 폴링에서 본 ON/OFF 값 (전환 로그용). 시작 시 켜짐으로 가정해 첫 로그와 중복되지 않게 한다
let lastEnabled = true

// 설정 화면의 "뇌전감시" 스위치 (미설정이면 켜짐)
async function isEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: ENABLED_KEY } })
  return row?.value !== 'false'
}

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

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value ?? null
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
    // ON/OFF는 매 주기 DB에서 확인 — WS 알림이 유실돼도 늦어도 다음 주기에 반영된다
    const enabled = await isEnabled()
    if (enabled !== lastEnabled) {
      log.info(enabled ? '뇌전 감시 켜짐 (설정)' : '뇌전 감시 꺼짐 (설정)')
      lastEnabled = enabled
    }
    if (!enabled) {
      // 꺼짐: wing15 조회/기록 없이 대기. 다시 켜지면 첫 폴링에서 경보 감지 로그가 나오도록 리셋
      lastState = null
      return
    }

    // 데모 모드: 카드 디자인 확인용 가짜 경보 (실제 wing15 조회 없음)
    const demo = await readSetting('wing15Demo')
    if (demo === 'true') {
      const checklist = await readChecklist()
      const demoConfirmed = await readSetting('wing15DemoConfirmed')
      await publishState(buildDemoState(checklist, demoConfirmed === 'true'), checklist)
      return
    }
    // 데모 종료 시 확인 흔적 정리
    await prisma.setting.deleteMany({ where: { key: 'wing15DemoConfirmed' } })

    // 피드 조회(네트워크)를 먼저 끝낸 뒤 로컬 상태를 읽어, 확인 버튼(API)과의
    // 경합 창을 최소화한다
    const incoming = await fetchNearbyStrikes()
    const [checklist, historyJson, confirmedAtRaw] = await Promise.all([
      readChecklist(),
      readSetting(STRIKES_KEY),
      readSetting(CONFIRMED_AT_KEY),
    ])
    const history = parseStrikes(historyJson)
    const strikes = mergeStrikes(history, incoming)
    const added = strikes.length - mergeStrikes(history, []).length
    if (added > 0) {
      log.info(`낙뢰 ${added}건 신규 감지 (김포공항 5km 이내 지상낙뢰, 누적 ${strikes.length}건)`)
    }
    const strikesJson = JSON.stringify(strikes)
    if (strikesJson !== historyJson) await saveSetting(STRIKES_KEY, strikesJson)

    const state = buildWing15State(strikes, parseConfirmedAt(confirmedAtRaw), checklist)

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

// 설정(ON/OFF) 변경을 다음 주기까지 기다리지 않고 즉시 반영한다
export function triggerWing15Poll(): void {
  if (!pollTimer) return
  void poll()
}
