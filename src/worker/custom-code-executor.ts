// Worker-side custom code executor with vm.Script caching per system

import vm from 'vm'

interface CachedScript {
  code: string
  script: vm.Script
}

const scriptCache = new Map<string, CachedScript>()

export interface CustomCodeResult {
  [metricName: string]: number | string
}

/**
 * Execute custom parsing code for a system. Returns metric name→value pairs or null on failure.
 * Caches compiled vm.Script per systemId, auto-invalidates when code changes.
 */
export function executeCustomCode(systemId: string, code: string, rawData: string): CustomCodeResult | null {
  try {
    // Get or compile script
    let cached = scriptCache.get(systemId)
    if (!cached || cached.code !== code) {
      const wrapped = `(function(raw) { ${code} })(rawInput)`
      const script = new vm.Script(wrapped)
      cached = { code, script }
      scriptCache.set(systemId, cached)
    }

    const sandbox = { rawInput: rawData }
    const context = vm.createContext(sandbox)
    const result = cached.script.runInContext(context, { timeout: 500 })

    // Validate
    if (result === null || result === undefined || typeof result !== 'object' || Array.isArray(result)) {
      console.error(`[custom-code] ${systemId}: 반환값이 객체가 아닙니다`)
      return null
    }

    const validated: CustomCodeResult = {}
    for (const [key, val] of Object.entries(result)) {
      if (typeof val === 'string') {
        validated[key] = val
      } else if (typeof val === 'number' && !isNaN(val)) {
        validated[key] = val
      } else {
        console.error(`[custom-code] ${systemId}: "${key}" 값이 숫자 또는 문자열이 아닙니다: ${val}`)
        return null
      }
    }

    // Empty result is valid for per-line parsers (e.g. apcupsd sends many
    // lines per cycle, only a few match metrics). Return empty object so
    // callers can distinguish "no metrics in this line" from "code error".
    return validated
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[custom-code] ${systemId}: 실행 오류 - ${message}`)
    return null
  }
}
