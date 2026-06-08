// TCP socket listeners for data collection.
// Bindings are reconciled from a desired (port -> config) set computed in binding.ts
// (const defaults ∪ enabled DB systems). Each framed message is parsed then handed to
// the ingest queue. Encoding/framing is read from the current config so a reconcile
// can hot-swap it without rebinding.

import * as net from 'net'
import { PortConfig } from './config'
import { parseBuffer } from './parser'
import { broadcastRawData } from './websocket-server'
import { enqueueIngest } from './ingest-queue'
import { createPortStats } from './port-stats'
import { createLogger } from '@/lib/logger'

const log = createLogger('tcp')

const servers = new Map<number, net.Server>()
const configs = new Map<number, PortConfig>() // desired config per bound port
const clients = new Map<number, Set<net.Socket>>() // live client sockets per port
const restartBackoffs = new Map<number, number>()
const restartTimers = new Map<number, ReturnType<typeof setTimeout>>()
const portStats = createPortStats()

const BACKOFF_INITIAL = 1000
const BACKOFF_MAX = 30000
// EADDRINUSE is usually transient self-contention (the previous server on this port
// is still closing after a reconcile), so retry fast instead of the long backoff.
const EADDRINUSE_RETRY = 500

// Fixed frame size for the Node-RED buffer protocol (non-utf8 ports).
const FRAME_SIZE = 20
// Max bytes to buffer for a utf8 line before force-flushing when no newline arrives.
const UTF8_MAX_LINE = 256

/**
 * Get the number of active TCP listeners
 */
export function getTcpListenerCount(): number {
  return servers.size
}

/**
 * Get per-port ingestion stats (last-seen, received/ok/fail/dropped counts)
 */
export function getTcpStats(): Map<number, import('./port-stats').PortStat> {
  return portStats.map
}

/**
 * Get the set of ports currently bound (desired).
 */
export function getTcpBoundPorts(): number[] {
  return Array.from(configs.keys())
}

/**
 * Reconcile bound TCP servers to the desired (port -> config) set:
 * bind new ports, close removed ports, hot-swap config (e.g. encoding) in place.
 */
export function reconcileTcpListeners(desired: Map<number, PortConfig>): void {
  // Close ports no longer desired
  for (const port of Array.from(configs.keys())) {
    if (!desired.has(port)) {
      // Destroy live client connections first so server.close() completes promptly
      // (net.Server keeps its listening socket open until all connections end), which
      // frees the port before any later reconcile/retry tries to rebind it.
      const set = clients.get(port)
      if (set) {
        for (const s of set) s.destroy()
        clients.delete(port)
      }
      const server = servers.get(port)
      if (server) {
        try { server.close() } catch { /* already closed */ }
        servers.delete(port)
      }
      const timer = restartTimers.get(port)
      if (timer) { clearTimeout(timer); restartTimers.delete(port) }
      restartBackoffs.delete(port)
      configs.delete(port)
      portStats.remove(port)
      log.info(`[${port}] unbound (no longer configured)`)
    }
  }
  // Add new ports / hot-swap config on existing ones
  for (const [port, cfg] of desired) {
    configs.set(port, cfg)
    portStats.ensure(port)
    if (!servers.has(port) && !restartTimers.has(port)) {
      bindTcpServer(port)
    }
  }
}

function bindTcpServer(port: number): void {
  const server = net.createServer((socket) => {
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`
    log.info(`[${port}] Client connected: ${clientAddr}`)

    // Track the connection so unbind can force it closed.
    let set = clients.get(port)
    if (!set) { set = new Set(); clients.set(port, set) }
    set.add(socket)
    socket.on('close', () => { clients.get(port)?.delete(socket) })

    let buffer = Buffer.alloc(0)

    const handleFrame = (message: Buffer) => {
      const config = configs.get(port)
      if (!config) return
      const parsed = parseBuffer(message, config)
      broadcastRawData(port, parsed.value)
      enqueueIngest({ config, data: parsed, port, protocol: 'tcp', stats: portStats })
    }

    socket.on('data', (data) => {
      portStats.received(port)
      try {
        const isUtf8 = configs.get(port)?.encoding === 'utf8'
        log.debug(`[${port}] Received ${data.length} bytes from ${clientAddr}`)

        buffer = Buffer.concat([buffer, data])

        while (buffer.length >= FRAME_SIZE || (isUtf8 && buffer.length > 0)) {
          let messageLength: number

          if (isUtf8) {
            const newlineIndex = buffer.indexOf('\n')
            if (newlineIndex !== -1) {
              messageLength = newlineIndex + 1
            } else {
              if (buffer.length < UTF8_MAX_LINE) break
              log.warn(`[${port}] utf8 line exceeded ${UTF8_MAX_LINE} bytes with no newline — force-flushing (value may be split)`)
              messageLength = buffer.length
            }
          } else {
            messageLength = FRAME_SIZE
          }

          const message = buffer.subarray(0, messageLength)
          buffer = buffer.subarray(messageLength)
          handleFrame(message)
        }
      } catch (error) {
        portStats.fail(port)
        log.error(`[${port}] Error processing data from ${clientAddr}:`, error)
      }
    })

    socket.on('error', (err) => {
      log.error(`[${port}] Socket error from ${clientAddr}:`, err.message)
    })

    socket.on('close', () => {
      try {
        log.info(`[${port}] Client disconnected: ${clientAddr}`)
        if (buffer.length === 0) return

        const isUtf8 = configs.get(port)?.encoding === 'utf8'
        if (isUtf8) {
          // A final line that arrived without a trailing newline — process it.
          log.debug(`[${port}] Processing final ${buffer.length} bytes`)
          handleFrame(buffer)
        } else {
          // Buffer protocol: any leftover is a PARTIAL frame (< 20 bytes). Parsing
          // it as a value would manufacture a bogus reading and indicates the stream
          // was not a clean multiple of the 20-byte frame size (misalignment).
          log.warn(`[${port}] Discarding ${buffer.length}-byte partial frame on close (stream not aligned to ${FRAME_SIZE}-byte frames)`)
        }
        buffer = Buffer.alloc(0)
      } catch (error) {
        log.error(`[${port}] Error processing remaining data from ${clientAddr}:`, error)
      }
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    log.error(`[${port}] Server error:`, err.message)
    servers.delete(port)

    if (!configs.has(port)) return // unbound during the error — don't restart

    // EADDRINUSE: retry fast (transient self-contention or, if it persists, a port
    // owned by another process — surfaced via this warn + the health count gap).
    const inUse = err.code === 'EADDRINUSE'
    const delay = inUse ? EADDRINUSE_RETRY : (restartBackoffs.get(port) ?? BACKOFF_INITIAL)
    log.warn(inUse
      ? `[${port}] Address in use — retrying in ${delay}ms (still closing, or owned by another process)`
      : `[${port}] Restarting in ${delay}ms...`)

    const timer = setTimeout(() => {
      restartTimers.delete(port)
      if (!configs.has(port)) return // unbound while waiting to restart
      bindTcpServer(port)
    }, delay)
    restartTimers.set(port, timer)
    if (!inUse) restartBackoffs.set(port, Math.min(delay * 2, BACKOFF_MAX))
  })

  server.listen(port, () => {
    log.info(`[${port}] Listening for ${configs.get(port)?.system ?? '?'}`)
    restartBackoffs.delete(port)
  })

  servers.set(port, server)
}

/**
 * Stop all TCP listeners
 */
export function stopTcpListeners(): void {
  for (const timer of restartTimers.values()) clearTimeout(timer)
  restartTimers.clear()
  restartBackoffs.clear()
  for (const set of clients.values()) {
    for (const s of set) s.destroy()
  }
  clients.clear()
  for (const server of servers.values()) server.close()
  servers.clear()
  configs.clear()
  log.info('All listeners stopped')
}
