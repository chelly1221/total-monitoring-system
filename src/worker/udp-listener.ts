// UDP socket listeners for data collection.
// Bindings are reconciled from a desired (port -> config) set computed in binding.ts
// (const defaults ∪ enabled DB systems), so user-added ports get a socket without a
// rebuild. Each received datagram is parsed then handed to the ingest queue.

import * as dgram from 'dgram'
import { PortConfig } from './config'
import { parseBuffer } from './parser'
import { broadcastRawData } from './websocket-server'
import { enqueueIngest } from './ingest-queue'
import { createPortStats } from './port-stats'
import { markSeen, clearLiveness, livenessKey } from './liveness'
import { createLogger } from '@/lib/logger'

const log = createLogger('udp')

const sockets = new Map<number, dgram.Socket>()
const configs = new Map<number, PortConfig>() // desired config per bound port
const restartBackoffs = new Map<number, number>()
const restartTimers = new Map<number, ReturnType<typeof setTimeout>>()
const portStats = createPortStats()

const BACKOFF_INITIAL = 1000
const BACKOFF_MAX = 30000
// EADDRINUSE is usually transient self-contention (the previous socket on this port
// is still closing after a reconcile), so retry fast instead of the long backoff.
const EADDRINUSE_RETRY = 500

/**
 * Get the number of active UDP listeners
 */
export function getUdpListenerCount(): number {
  return sockets.size
}

/**
 * Get per-port ingestion stats (last-seen, received/ok/fail/dropped counts)
 */
export function getUdpStats(): Map<number, import('./port-stats').PortStat> {
  return portStats.map
}

/**
 * Get the set of ports currently bound (desired).
 */
export function getUdpBoundPorts(): number[] {
  return Array.from(configs.keys())
}

/**
 * Reconcile bound UDP sockets to the desired (port -> config) set:
 * bind new ports, close removed ports, hot-swap config (e.g. encoding) in place.
 */
export function reconcileUdpListeners(desired: Map<number, PortConfig>): void {
  // Close ports no longer desired
  for (const port of Array.from(configs.keys())) {
    if (!desired.has(port)) {
      const socket = sockets.get(port)
      if (socket) {
        try { socket.close() } catch { /* already closed */ }
        sockets.delete(port)
      }
      const timer = restartTimers.get(port)
      if (timer) { clearTimeout(timer); restartTimers.delete(port) }
      restartBackoffs.delete(port)
      configs.delete(port)
      portStats.remove(port)
      clearLiveness(livenessKey('udp', port))
      log.info(`[${port}] unbound (no longer configured)`)
    }
  }
  // Add new ports / hot-swap config on existing ones
  for (const [port, cfg] of desired) {
    configs.set(port, cfg)
    portStats.ensure(port)
    if (!sockets.has(port) && !restartTimers.has(port)) {
      bindUdpSocket(port)
    }
  }
}

function bindUdpSocket(port: number): void {
  const socket = dgram.createSocket('udp4')

  socket.on('message', (msg, rinfo) => {
    portStats.received(port)
    // Record liveness BEFORE the queue so offline detection sees the bytes even if
    // the drainer is stalled / the DB write is delayed.
    markSeen(livenessKey('udp', port))
    const config = configs.get(port)
    if (!config) return
    try {
      log.debug(`[${port}] Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`)
      const data = parseBuffer(msg, config)
      // Immediate raw preview for the config UI; DB work is deferred to the queue.
      broadcastRawData(port, data.value)
      enqueueIngest({ config, data, port, protocol: 'udp', stats: portStats })
    } catch (error) {
      portStats.fail(port)
      log.error(`[${port}] Error parsing message from ${rinfo.address}:${rinfo.port}:`, error)
    }
  })

  socket.on('error', (err) => {
    log.error(`[${port}] Error:`, err.message)
    sockets.delete(port)
    try { socket.close() } catch { /* may already be closed */ }

    if (!configs.has(port)) return // unbound during the error — don't restart

    // EADDRINUSE: retry fast (transient self-contention or, if it persists, a port
    // owned by another process — surfaced via this warn + the health count gap).
    const inUse = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
    const delay = inUse ? EADDRINUSE_RETRY : (restartBackoffs.get(port) ?? BACKOFF_INITIAL)
    log.warn(inUse
      ? `[${port}] Address in use — retrying in ${delay}ms (still closing, or owned by another process)`
      : `[${port}] Restarting in ${delay}ms...`)

    const timer = setTimeout(() => {
      restartTimers.delete(port)
      if (!configs.has(port)) return // unbound while waiting to restart
      bindUdpSocket(port)
    }, delay)
    restartTimers.set(port, timer)
    if (!inUse) restartBackoffs.set(port, Math.min(delay * 2, BACKOFF_MAX))
  })

  socket.on('listening', () => {
    const address = socket.address()
    log.info(`[${port}] Listening on ${address.address}:${address.port} for ${configs.get(port)?.system ?? '?'}`)
    restartBackoffs.delete(port)
  })

  socket.bind(port)
  sockets.set(port, socket)
}

/**
 * Stop all UDP listeners
 */
export function stopUdpListeners(): void {
  for (const timer of restartTimers.values()) clearTimeout(timer)
  restartTimers.clear()
  restartBackoffs.clear()
  for (const socket of sockets.values()) {
    try { socket.close() } catch { /* already closed */ }
  }
  sockets.clear()
  configs.clear()
  log.info('All listeners stopped')
}
