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
import { reconcileMqttListeners } from './mqtt-listener'
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
async function computeDesired(): Promise<{ udp: Map<number, PortConfig>; tcp: Map<number, PortConfig>; mqtt: Map<string, PortConfig> }> {
  const udp = new Map<number, PortConfig>()
  const tcp = new Map<number, PortConfig>()
  const mqtt = new Map<string, PortConfig>()

  // Seed from static defaults (preserves existing behavior).
  for (const [p, c] of Object.entries(UDP_PORTS)) udp.set(Number(p), { ...c })
  for (const [p, c] of Object.entries(TCP_PORTS)) tcp.set(Number(p), { ...c })

  // Overlay enabled DB systems. Multiple systems MAY share one (port, protocol):
  // devices all send TO us, one socket receives, and the ingest path fans each
  // datagram out to every system on the port. The port-level config here only
  // carries the wire encoding and a log label, so sharing needs no extra state —
  // but conflicting encodings on one port can't both be honored (warned below).
  const systems = await getEnabledSystemsForBinding()
  const dbNames = new Map<string, string[]>() // `${protocol}:${port}` -> DB system names sharing it
  for (const s of systems) {
    // MQTT systems are addressed by topic, not port.
    if (s.protocol === 'mqtt') {
      if (!s.topic) {
        log.warn(`System "${s.name}" is mqtt but has no topic — not subscribed`)
        continue
      }
      mqtt.set(s.topic, {
        system: s.name,
        type: mapSystemType(s.type),
        encoding: normalizeEncoding(s.encoding),
      })
      continue
    }
    if (s.port == null) continue
    if (s.protocol !== 'udp' && s.protocol !== 'tcp') {
      log.warn(`System "${s.name}" has port ${s.port} but invalid protocol ${JSON.stringify(s.protocol)} — not bound`)
      continue
    }
    const target = s.protocol === 'udp' ? udp : tcp
    const existing = target.get(s.port)
    const shareKey = `${s.protocol}:${s.port}`
    const sharedNames = dbNames.get(shareKey) ?? []
    const enc = normalizeEncoding(s.encoding)
    // Encoding is port-scoped (one decode per datagram). If DB systems sharing
    // this port disagree, the last one wins — surface it instead of failing.
    if (enc && existing?.encoding && enc !== existing.encoding && sharedNames.length > 0) {
      log.warn(`Port ${s.port}/${s.protocol}: encoding conflict — "${s.name}" wants ${enc} but sharing system(s) [${sharedNames.join(', ')}] set ${existing.encoding}; using ${enc}`)
    }
    sharedNames.push(s.name)
    dbNames.set(shareKey, sharedNames)
    target.set(s.port, {
      system: sharedNames.length > 1 ? sharedNames.join(' + ') : s.name,
      type: mapSystemType(s.type),
      encoding: enc ?? existing?.encoding,
      description: existing?.description,
    })
  }

  return { udp, tcp, mqtt }
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
      const { udp, tcp, mqtt } = await computeDesired()
      reconcileUdpListeners(udp)
      reconcileTcpListeners(tcp)
      reconcileMqttListeners(mqtt)
      log.info(`Bindings reconciled: ${udp.size} UDP, ${tcp.size} TCP ports, ${mqtt.size} MQTT topic(s)`)
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
