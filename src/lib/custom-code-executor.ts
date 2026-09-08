// Shared custom code executor for API test endpoint
// Runs trusted local parsing code with a bounded execution time

import { compileCustomCode, executeScript } from './custom-code-script'

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
    const result = executeScript(compileCustomCode(code), rawData, timeoutMs)
    return { success: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `실행 오류: ${message}` }
  }
}
