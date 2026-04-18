// Condition-based threshold evaluator for sensor systems

import type { ThresholdCondition, StatusConditions, SystemStatus } from '@/types'

/**
 * Evaluate a single condition against a value
 */
export function evaluateCondition(value: number, condition: ThresholdCondition): boolean {
  switch (condition.operator) {
    case 'between':
      return value >= condition.value1 && value <= (condition.value2 ?? condition.value1)
    case 'gte':
      return value >= condition.value1
    case 'lte':
      return value <= condition.value1
    case 'eq':
      if (condition.stringValue !== undefined) return String(value) === condition.stringValue
      return value === condition.value1
    case 'neq':
      if (condition.stringValue !== undefined) return String(value) !== condition.stringValue
      return value !== condition.value1
    default:
      return false
  }
}

/**
 * Evaluate a condition against a raw string value (for status-type metrics)
 */
export function evaluateStringCondition(rawValue: string, condition: ThresholdCondition): boolean {
  const compareValue = condition.stringValue ?? String(condition.value1)
  switch (condition.operator) {
    case 'eq':
      return rawValue === compareValue
    case 'neq':
      return rawValue !== compareValue
    default:
      return false
  }
}

/**
 * Evaluate sensor status based on conditions
 * Priority: critical/coldCritical/dryCritical/humidCritical > normal (default)
 * Conditions within each status are OR (any match triggers that status)
 */
export function evaluateSensorStatus(value: number, conditions: StatusConditions): SystemStatus {
  // Check critical first (highest priority)
  if (conditions.critical?.some(c => evaluateCondition(value, c))) {
    return 'critical'
  }

  // Check coldCritical (same priority as critical)
  if (conditions.coldCritical?.some(c => evaluateCondition(value, c))) {
    return 'critical'
  }

  // Check dryCritical (same priority as critical)
  if (conditions.dryCritical?.some(c => evaluateCondition(value, c))) {
    return 'critical'
  }

  // Check humidCritical (same priority as critical)
  if (conditions.humidCritical?.some(c => evaluateCondition(value, c))) {
    return 'critical'
  }

  // Default to normal
  return 'normal'
}

/**
 * Check if a status was triggered by cold conditions specifically
 */
export function isColdCritical(value: number, conditions: StatusConditions): boolean {
  return conditions.coldCritical?.some(c => evaluateCondition(value, c)) ?? false
}

/**
 * Check if a status was triggered by dry conditions specifically
 */
export function isDryCritical(value: number, conditions: StatusConditions): boolean {
  return conditions.dryCritical?.some(c => evaluateCondition(value, c)) ?? false
}

/**
 * Check if a status was triggered by humid conditions specifically
 */
export function isHumidCritical(value: number, conditions: StatusConditions): boolean {
  return conditions.humidCritical?.some(c => evaluateCondition(value, c)) ?? false
}
