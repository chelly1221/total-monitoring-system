// How many consecutive critical messages an equipment system must send before the
// worker raises a fault. Shared by the worker, the facility form and the API
// validator; tests import it too (they cannot load the worker, which opens Prisma).

import type { EquipmentConfig } from '@/types'

/**
 * Default: alarm on the first critical message. Every facility but one is fed by a
 * program (FMS/LCMS software, SoundSense PCs) whose status is already clean, so a
 * consecutive-message filter only delays the alarm. The one analogue sender
 * (1레이더 LCMS) sets its own count in the facility form.
 */
export const DEFAULT_CRITICAL_CONFIRMATIONS = 1
export const MIN_CRITICAL_CONFIRMATIONS = 1
export const MAX_CRITICAL_CONFIRMATIONS = 10

/** True when `value` is an integer inside the allowed range. */
export function isValidCriticalConfirmations(value: unknown): value is number {
  return Number.isInteger(value) &&
    (value as number) >= MIN_CRITICAL_CONFIRMATIONS &&
    (value as number) <= MAX_CRITICAL_CONFIRMATIONS
}

/** Effective count for a facility: its own setting when valid, otherwise the default. */
export function criticalConfirmations(config: Pick<EquipmentConfig, 'criticalConfirmations'> | null | undefined): number {
  const own = config?.criticalConfirmations
  return isValidCriticalConfirmations(own) ? own : DEFAULT_CRITICAL_CONFIRMATIONS
}
