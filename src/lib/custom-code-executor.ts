// Shared custom code executor for API test endpoint
// Uses Node.js vm module to safely run user-provided parsing code

import vm from 'vm'

export interface CustomCodeResult {
  success: boolean
  result?: Record<string, number | string>
  error?: string
}

/**
 * Run user-provided custom parsing code against raw data.
 * The code receives `raw` as the input string and must return { "name": number, ... }
 */
export function runCustomCode(code: string, rawData: string, timeoutMs = 500): CustomCodeResult {
  try {
    const sandbox = { rawInput: rawData }
    const context = vm.createContext(sandbox)

    const wrapped = `(function(raw) { ${code} })(rawInput)`
    const script = new vm.Script(wrapped)

    const result = script.runInContext(context, { timeout: timeoutMs })

    // Validate return value
    if (result === null || result === undefined || typeof result !== 'object' || Array.isArray(result)) {
      return { success: false, error: '반환값이 객체가 아닙니다. { "항목명": 숫자값 } 형태로 반환하세요.' }
    }

    const entries = Object.entries(result)
    if (entries.length === 0) {
      return { success: false, error: '빈 객체가 반환되었습니다. 최소 1개 항목이 필요합니다.' }
    }

    const validated: Record<string, number | string> = {}
    for (const [key, val] of entries) {
      if (typeof val === 'string') {
        validated[key] = val
      } else if (typeof val === 'number' && !isNaN(val)) {
        validated[key] = val
      } else {
        return { success: false, error: `"${key}" 값이 숫자 또는 문자열이 아닙니다: ${val}` }
      }
    }

    return { success: true, result: validated }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `실행 오류: ${message}` }
  }
}
