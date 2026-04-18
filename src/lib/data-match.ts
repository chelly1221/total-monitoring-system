import type { DataMatchCondition } from '@/types'

/**
 * Evaluate a single data match condition against raw data
 */
export function evaluateDataMatchCondition(rawData: string, condition: DataMatchCondition): boolean {
  const { operator, value } = condition
  switch (operator) {
    case 'contains':
      return rawData.includes(value)
    case 'startsWith':
      return rawData.startsWith(value)
    case 'endsWith':
      return rawData.endsWith(value)
    case 'equals':
      return rawData === value
    case 'regex':
      try {
        return new RegExp(value).test(rawData)
      } catch {
        return false
      }
    default:
      return false
  }
}

/**
 * Evaluate data match conditions (OR logic).
 * Returns true if no conditions are defined (backward compatible).
 */
export function matchesDataConditions(rawData: string, conditions?: DataMatchCondition[]): boolean {
  if (!conditions || conditions.length === 0) return true
  return conditions.some(c => evaluateDataMatchCondition(rawData, c))
}
