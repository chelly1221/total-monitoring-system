// How many consecutive critical messages an equipment system must send before the
// worker raises a fault. Shared by the worker, the facility form and the API
// validator; tests import it too (they cannot load the worker, which opens Prisma).

import type { EquipmentConfig } from '@/types'

/** Default for devices (FMS/LCMS...) that report every second: one glitch packet is ignored. */
export const DEFAULT_CRITICAL_CONFIRMATIONS = 3
export const MIN_CRITICAL_CONFIRMATIONS = 1
export const MAX_CRITICAL_CONFIRMATIONS = 10

type ConfirmationsConfig = Pick<EquipmentConfig, 'client' | 'criticalConfirmations'> | null | undefined

/** True when `value` is an integer inside the allowed range. */
export function isValidCriticalConfirmations(value: unknown): value is number {
  return Number.isInteger(value) &&
    (value as number) >= MIN_CRITICAL_CONFIRMATIONS &&
    (value as number) <= MAX_CRITICAL_CONFIRMATIONS
}

/**
 * Default when the facility does not set its own count. A SoundSense-linked PC is
 * already debounced on the client (100 ms detector + silence hold-off) and only
 * heartbeats every 5 s, so counting to three there meant ~10 s of continuous sound
 * before the alarm; trust its first `SOUND` instead.
 */
export function defaultCriticalConfirmations(config: ConfirmationsConfig): number {
  return config?.client ? 1 : DEFAULT_CRITICAL_CONFIRMATIONS
}

/** Effective count for a facility: its own setting when valid, otherwise the default. */
export function criticalConfirmations(config: ConfirmationsConfig): number {
  const own = config?.criticalConfirmations
  return isValidCriticalConfirmations(own) ? own : defaultCriticalConfirmations(config)
}
