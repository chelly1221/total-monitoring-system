import vm from 'vm'

export function validateCustomCode(code: string): { valid: boolean; error?: string } {
  try {
    const wrapped = `(function(raw) { ${code} })(rawInput)`
    new vm.Script(wrapped)
    return { valid: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { valid: false, error: msg }
  }
}
