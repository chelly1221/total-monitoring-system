// How many consecutive critical messages an equipment system must send before the
// worker raises a fault. Shared with tests, which cannot load the worker (it opens Prisma).

import type { EquipmentConfig } from '@/types'

/** Default for devices (FMS/LCMS...) that report every second: one glitch packet is ignored. */
export const DEFAULT_CRITICAL_CONFIRMATIONS = 3

/**
 * A SoundSense-linked facility is already debounced on the PC (100 ms detector +
 * silence hold-off) and only heartbeats every 5 s, so counting to three there meant
 * ~10 s of continuous sound before the alarm. Trust its first `SOUND` instead.
 */
export function criticalConfirmations(config: Pick<EquipmentConfig, 'client'> | null | undefined): number {
  return config?.client ? 1 : DEFAULT_CRITICAL_CONFIRMATIONS
}
