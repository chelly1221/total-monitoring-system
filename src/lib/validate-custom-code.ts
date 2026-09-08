import { compileCustomCode } from './custom-code-script'

export function validateCustomCode(code: string): { valid: boolean; error?: string } {
  try {
    compileCustomCode(code)
    return { valid: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { valid: false, error: msg }
  }
}
