import vm from 'vm'

/** Keep getters, proxy traps and result validation inside the execution timeout. */
export function compileCustomCode(code: string): vm.Script {
  return new vm.Script(`(() => {
    const stringify = JSON.stringify;
    const entriesOf = Object.entries;
    const isFiniteNumber = Number.isFinite;
    const isArray = Array.isArray;
    try {
      const result = (function(raw) { ${code}\n })(rawInput);
      if (result === null || typeof result !== 'object' || isArray(result)) {
        return stringify({ error: '반환값은 항목별 숫자 또는 문자열을 담은 객체여야 합니다.' });
      }
      const entries = entriesOf(result);
      for (const [key, value] of entries) {
        if (typeof value !== 'string' && !(typeof value === 'number' && isFiniteNumber(value))) {
          return stringify({ error: '항목 값은 유한한 숫자 또는 문자열이어야 합니다.' });
        }
      }
      return stringify({ entries });
    } catch (error) {
      return stringify({ error: '실행 오류: ' + String(error) });
    }
  })()`)
}

export function executeScript(script: vm.Script, rawData: string, timeout: number): Record<string, number | string> {
  const context = vm.createContext({ rawInput: rawData }, { microtaskMode: 'afterEvaluate' })
  const snapshot = script.runInContext(context, { timeout }) as string
  const result = JSON.parse(snapshot) as { entries?: [string, number | string][]; error?: string }
  if (result.error || !result.entries) throw new Error(result.error || '잘못된 반환값')
  return Object.fromEntries(result.entries)
}
