// Worker-side custom code executor with vm.Script caching per system

import type vm from 'vm'
import { compileCustomCode, executeScript } from '@/lib/custom-code-script'

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
      const script = compileCustomCode(code)
      cached = { code, script }
      scriptCache.set(systemId, cached)
    }

    return executeScript(cached.script, rawData, 500)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[custom-code] ${systemId}: 실행 오류 - ${message}`)
    return null
  }
}

export function clearCustomCodeCache(systemId: string): void {
  scriptCache.delete(systemId)
}
