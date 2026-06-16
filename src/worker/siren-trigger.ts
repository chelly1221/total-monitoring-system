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

    // Latch ACTIVE during the attempt so concurrent syncs don't re-fire mid-send.
    // Fire all sends concurrently so the worst case is one timeout, not the sum of N.
    sirensActive = true
    const results = await Promise.allSettled(
      sirens.map((siren) => {
        const send = siren.protocol === 'udp' ? sendUdp : sendTcp
        return send(siren.ip, siren.port, siren.messageOn)
      }),
    )
    let successCount = 0
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        successCount++
        console.log(`[siren-trigger] Siren ON: ${sirens[i].location} (${sirens[i].ip}:${sirens[i].port})`)
      } else {
        console.error(`[siren-trigger] Failed to activate siren ${sirens[i].location}:`, r.reason)
      }
    })
    // If NOTHING got through (e.g. a transient blip made all sends time out), unlatch
    // so the next alarm/status event retries — a critical siren must not stay silently
    // off for the whole episode. Sends are concurrent + fire-and-forget off the ingest
    // path, so retrying per event does not pile up. A partial success stays latched.
    if (successCount === 0) sirensActive = false
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

    // OFF is best-effort and latches inactive regardless of reachability; send
    // concurrently so one unreachable siren can't stall the rest.
    sirensActive = false
    const withOff = sirens.filter((s) => s.messageOff)
    const results = await Promise.allSettled(
      withOff.map((siren) => {
        const send = siren.protocol === 'udp' ? sendUdp : sendTcp
        return send(siren.ip, siren.port, siren.messageOff)
      }),
    )
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        console.log(`[siren-trigger] Siren OFF: ${withOff[i].location} (${withOff[i].ip}:${withOff[i].port})`)
      } else {
        console.error(`[siren-trigger] Failed to deactivate siren ${withOff[i].location}:`, r.reason)
      }
    })
  } catch (error) {
    console.error('[siren-trigger] Error deactivating sirens:', error)
  }
}

let syncRunning = false
let syncRerun = false

/**
 * Sync siren state based on unresolved+unacknowledged critical alarms.
 * State-based logic (same as browser AudioAlertManager):
 *   - Active critical alarms exist + sirens off → activate
 *   - No active critical alarms + sirens on → deactivate
 *
 * Coalesces concurrent calls: this is now invoked fire-and-forget from the ingest
 * drain path, so many status changes in a burst must collapse into at most one
 * in-flight run plus one trailing rerun — never a pile-up of overlapping siren I/O.
 */
export async function syncSirenState(): Promise<void> {
  if (syncRunning) {
    syncRerun = true
    return
  }
  syncRunning = true
  try {
    do {
      syncRerun = false
      await syncSirenStateOnce()
    } while (syncRerun)
  } finally {
    syncRunning = false
  }
}

async function syncSirenStateOnce(): Promise<void> {
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
