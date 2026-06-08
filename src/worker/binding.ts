// Dynamic socket-binding reconciler.
// The set of ports to bind is the UNION of the static config.ts defaults and every
// enabled DB system that carries a (port, protocol). This closes the gap where a
// UI-created system on a new port never got a listener (silent dead device) and
// makes the wire `encoding` DB-editable — without a rebuild.
//
// Reconciliation runs at startup, on a "systems-changed" signal from the API
// (low latency), and on a slow safety poll (in case the signal is missed).

import { UDP_PORTS, TCP_PORTS, PortConfig } from './config'
import { reconcileUdpListeners } from './udp-listener'
import { reconcileTcpListeners } from './tcp-listener'
import { getEnabledSystemsForBinding } from './db-updater'
import { createLogger } from '@/lib/logger'

const log = createLogger('binding')

let reconcileTimer: ReturnType<typeof setInterval> | null = null
let reconciling = false
let pending = false

/** Map a DB system.type to a PortConfig.type (only used for the dead 'alarm' route). */
function mapSystemType(t: string): PortConfig['type'] {
  switch (t) {
    case 'sensor': return 'sensor'
    case 'ups': return 'ups'
    case 'equipment': return 'equipment'
    default: return 'equipment'
  }
}

function normalizeEncoding(e: string | null | undefined): 'utf8' | 'buffer' | undefined {
  return e === 'utf8' || e === 'buffer' ? e : undefined
}

/**
 * Compute the desired UDP/TCP (port -> config) sets from const defaults overlaid
 * with enabled DB systems. DB systems win on encoding; const fills the gap.
 */
async function computeDesired(): Promise<{ udp: Map<number, PortConfig>; tcp: Map<number, PortConfig> }> {
  const udp = new Map<number, PortConfig>()
  const tcp = new Map<number, PortConfig>()

  // Seed from static defaults (preserves existing behavior).
  for (const [p, c] of Object.entries(UDP_PORTS)) udp.set(Number(p), { ...c })
  for (const [p, c] of Object.entries(TCP_PORTS)) tcp.set(Number(p), { ...c })

  // Overlay enabled DB systems.
  const systems = await getEnabledSystemsForBinding()
  for (const s of systems) {
    if (s.port == null) continue
    if (s.protocol !== 'udp' && s.protocol !== 'tcp') {
      log.warn(`System "${s.name}" has port ${s.port} but invalid protocol ${JSON.stringify(s.protocol)} — not bound`)
      continue
    }
    const target = s.protocol === 'udp' ? udp : tcp
    const existing = target.get(s.port)
    target.set(s.port, {
      system: s.name,
      type: mapSystemType(s.type),
      encoding: normalizeEncoding(s.encoding) ?? existing?.encoding,
      description: existing?.description,
    })
  }

  return { udp, tcp }
}

/**
 * Reconcile bound sockets to the current DB + const state. Coalesces concurrent
 * calls: if a reconcile is already running, one more pass is scheduled afterwards.
 */
export async function reconcileBindings(): Promise<void> {
  if (reconciling) {
    pending = true
    return
  }
  reconciling = true
  try {
    do {
      pending = false
      const { udp, tcp } = await computeDesired()
      reconcileUdpListeners(udp)
      reconcileTcpListeners(tcp)
      log.info(`Bindings reconciled: ${udp.size} UDP, ${tcp.size} TCP ports`)
    } while (pending)
  } catch (error) {
    log.error('Reconcile failed:', error)
  } finally {
    reconciling = false
  }
}

/**
 * Start the binding reconciler: reconcile once now, then on a slow safety poll.
 * Call reconcileBindings() directly for the low-latency "systems-changed" path.
 */
export function startBindingReconciler(pollMs = 60000): void {
  if (reconcileTimer) return
  void reconcileBindings()
  reconcileTimer = setInterval(() => { void reconcileBindings() }, pollMs)
}

export function stopBindingReconciler(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer)
    reconcileTimer = null
  }
}
