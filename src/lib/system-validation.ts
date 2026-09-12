import { validateCustomCode } from './validate-custom-code'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parsePort(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

export function normalizeEncoding(value: unknown): string | null {
  return value === 'utf8' || value === 'buffer' ? value : null
}

export function normalizeOfflineThreshold(value: unknown): number | null {
  if (value == null || value === '') return null
  const threshold = Number(value)
  if (!Number.isSafeInteger(threshold) || threshold <= 0 || threshold > 2147483647) return null
  return Math.max(60000, threshold)
}

/** Validate full and partial edits before touching the system or its metrics. */
export function validateSystemBody(body: unknown, partial = false): string | null {
  if (!isRecord(body)) return '잘못된 요청 형식입니다'
  if ((!partial || 'name' in body) && (typeof body.name !== 'string' || !body.name.trim())) {
    return '장비 이름을 입력하세요'
  }
  if ('isEnabled' in body && typeof body.isEnabled !== 'boolean') return '사용 여부가 올바르지 않습니다'
  if (!partial) {
    if (!['equipment', 'ups', 'sensor'].includes(String(body.type))) return '잘못된 장비 유형입니다'
    if (!['udp', 'tcp', 'mqtt'].includes(String(body.protocol))) return '잘못된 통신 방식입니다'
    if (body.protocol !== 'mqtt' && parsePort(body.port) === null) return '포트는 1~65535 사이의 정수여야 합니다'
  }
  const config = body.config
  if (config == null) return null
  if (!isRecord(config)) return '장비 설정은 객체여야 합니다'
  if (config.customCode !== undefined) {
    if (typeof config.customCode !== 'string') return '커스텀 코드는 문자열이어야 합니다'
    if (config.customCode.trim()) {
      const result = validateCustomCode(config.customCode)
      if (!result.valid) return `커스텀 코드 구문 오류: ${result.error}`
    }
  }
  if (config.delimiter !== undefined && typeof config.delimiter !== 'string') return '구분자가 올바르지 않습니다'
  for (const key of ['normalPatterns', 'criticalPatterns']) {
    const patterns = config[key]
    if (patterns !== undefined && (!Array.isArray(patterns) || patterns.some(p => typeof p !== 'string'))) {
      return '상태 패턴은 문자열 목록이어야 합니다'
    }
  }
  if (config.client !== undefined && config.client !== null) {
    const client = config.client
    if (!isRecord(client) || typeof client.id !== 'string' || !client.id.trim() || typeof client.ip !== 'string') {
      return '연결된 PC 정보가 올바르지 않습니다'
    }
  }
  if (config.displayItems !== undefined) {
    if (!Array.isArray(config.displayItems)) return '표시 항목은 목록이어야 합니다'
    const names = new Set<string>()
    for (const item of config.displayItems) {
      if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim() || typeof item.unit !== 'string') {
        return '표시 항목의 이름과 단위를 확인하세요'
      }
      if (names.has(item.name)) return '표시 항목 이름은 중복될 수 없습니다'
      names.add(item.name)
      if (!Number.isInteger(item.index) || Number(item.index) < 0) return '항목 인덱스는 0 이상의 정수여야 합니다'
      for (const key of ['warning', 'critical']) {
        if (item[key] != null && (typeof item[key] !== 'number' || !Number.isFinite(item[key]))) return '임계값은 유한한 숫자여야 합니다'
      }
      if (item.conditions != null) {
        if (!isRecord(item.conditions)) return '임계 조건이 올바르지 않습니다'
        for (const list of Object.values(item.conditions)) {
          if (!Array.isArray(list) || list.some(c => !isRecord(c) ||
            !['between', 'gte', 'lte', 'eq', 'neq'].includes(String(c.operator)) ||
            typeof c.value1 !== 'number' || !Number.isFinite(c.value1) ||
            (c.value2 != null && (typeof c.value2 !== 'number' || !Number.isFinite(c.value2))) ||
            (c.operator === 'between' && c.value2 != null && Number(c.value2) < c.value1))) {
            return '임계 조건의 연산자와 범위를 확인하세요'
          }
        }
      }
    }
  }
  return null
}
