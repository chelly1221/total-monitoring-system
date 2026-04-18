// Automatic siren activation/deactivation for critical alarms

import { sendTcp, sendUdp } from '@/lib/siren'
import { prisma } from './db-updater'

let sirensActive = false

/**
 * Activate all enabled sirens (send messageOn)
 * Always sends ON command on every critical alarm to ensure sirens fire
 */
export async function activateSirens(): Promise<void> {
  const wasActive = sirensActive

  try {
    const sirens = await prisma.siren.findMany({
      where: { isEnabled: true },
    })

    if (sirens.length === 0) return

    console.log(`[siren-trigger] Activating ${sirens.length} siren(s)... (wasActive=${wasActive})`)

    let successCount = 0
    for (const siren of sirens) {
      try {
        const send = siren.protocol === 'udp' ? sendUdp : sendTcp
        await send(siren.ip, siren.port, siren.messageOn)
        successCount++
        console.log(`[siren-trigger] Siren ON: ${siren.location} (${siren.ip}:${siren.port})`)
      } catch (error) {
        console.error(`[siren-trigger] Failed to activate siren ${siren.location}:`, error)
      }
    }

    if (successCount > 0) {
      sirensActive = true
    }
    console.log(`[siren-trigger] Activation complete: ${successCount}/${sirens.length} siren(s) activated`)
  } catch (error) {
    console.error('[siren-trigger] Error activating sirens:', error)
  }
}

/**
 * Deactivate all enabled sirens (send messageOff).
 * Pure OFF sender — no alarm count check.
 */
export async function deactivateSirens(): Promise<void> {
  try {
    const sirens = await prisma.siren.findMany({
      where: { isEnabled: true },
    })

    if (sirens.length === 0) {
      sirensActive = false
      return
    }

    console.log(`[siren-trigger] Deactivating ${sirens.length} siren(s)...`)

    for (const siren of sirens) {
      if (!siren.messageOff) continue
      try {
        const send = siren.protocol === 'udp' ? sendUdp : sendTcp
        await send(siren.ip, siren.port, siren.messageOff)
        console.log(`[siren-trigger] Siren OFF: ${siren.location} (${siren.ip}:${siren.port})`)
      } catch (error) {
        console.error(`[siren-trigger] Failed to deactivate siren ${siren.location}:`, error)
      }
    }

    sirensActive = false
  } catch (error) {
    console.error('[siren-trigger] Error deactivating sirens:', error)
  }
}

/**
 * Sync siren state based on unresolved+unacknowledged critical alarms.
 * State-based logic (same as browser AudioAlertManager):
 *   - Active critical alarms exist + sirens off → activate
 *   - No active critical alarms + sirens on → deactivate
 */
export async function syncSirenState(): Promise<void> {
  try {
    // Check mute settings first
    const audioEnabledSetting = await prisma.setting.findUnique({ where: { key: 'audioEnabled' } })
    const muteEndTimeSetting = await prisma.setting.findUnique({ where: { key: 'muteEndTime' } })

    const audioEnabled = audioEnabledSetting?.value !== 'false'
    const muteEndTime = muteEndTimeSetting?.value ? parseInt(muteEndTimeSetting.value) : 0
    const isMuted = !audioEnabled && (!muteEndTime || muteEndTime > Date.now())

    if (isMuted) {
      console.log('[siren-trigger] Audio muted, deactivating sirens')
      await deactivateSirens()
      return
    }

    const activeCriticalCount = await prisma.alarm.count({
      where: { severity: 'critical', resolvedAt: null, acknowledged: false },
    })

    if (activeCriticalCount > 0 && !sirensActive) {
      console.log(`[siren-trigger] ${activeCriticalCount} unresolved critical alarm(s) found, activating sirens`)
      await activateSirens()
    } else if (activeCriticalCount === 0 && sirensActive) {
      console.log(`[siren-trigger] No unresolved critical alarms, deactivating sirens`)
      await deactivateSirens()
    }
  } catch (error) {
    console.error('[siren-trigger] Error syncing siren state:', error)
  }
}

/**
 * Reset siren state (used during shutdown)
 */
export async function resetSirens(): Promise<void> {
  if (!sirensActive) return

  try {
    const sirens = await prisma.siren.findMany({
      where: { isEnabled: true },
    })

    for (const siren of sirens) {
      if (!siren.messageOff) continue
      try {
        const send = siren.protocol === 'udp' ? sendUdp : sendTcp
        await send(siren.ip, siren.port, siren.messageOff)
        console.log(`[siren-trigger] Shutdown - Siren OFF: ${siren.location}`)
      } catch (error) {
        console.error(`[siren-trigger] Shutdown - Failed to stop siren ${siren.location}:`, error)
      }
    }

    sirensActive = false
  } catch (error) {
    console.error('[siren-trigger] Error resetting sirens:', error)
  }
}
