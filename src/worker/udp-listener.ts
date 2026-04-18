// UDP socket listeners for data collection

import * as dgram from 'dgram'
import { UDP_PORTS, PortConfig } from './config'
import { parseBuffer } from './parser'
import { updateMetric, processAlarm } from './db-updater'
import { broadcastRawData } from './websocket-server'

const sockets = new Map<number, dgram.Socket>()
const restartBackoffs = new Map<number, number>()
const restartTimers = new Map<number, ReturnType<typeof setTimeout>>()

const BACKOFF_INITIAL = 1000
const BACKOFF_MAX = 30000

/**
 * Start UDP listeners for all configured ports
 */
export function startUdpListeners(): void {
  for (const [portStr, config] of Object.entries(UDP_PORTS)) {
    const port = Number(portStr)
    startUdpListener(port, config)
  }
}

/**
 * Get the number of active UDP listeners
 */
export function getUdpListenerCount(): number {
  return sockets.size
}

/**
 * Start a single UDP listener on the specified port
 */
function startUdpListener(port: number, config: PortConfig): void {
  const socket = dgram.createSocket('udp4')

  socket.on('message', async (msg, rinfo) => {
    try {
      console.log(`[UDP:${port}] Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`)

      const data = parseBuffer(msg, config)

      // Broadcast raw data for preview in config UI
      broadcastRawData(port, data.value)

      // Route to appropriate handler based on type
      if (config.type === 'alarm') {
        await processAlarm(config, data)
      } else {
        await updateMetric(config, data, port, 'udp')
      }
    } catch (error) {
      console.error(`[UDP:${port}] Error processing message from ${rinfo.address}:${rinfo.port}:`, error)
    }
  })

  socket.on('error', (err) => {
    console.error(`[UDP:${port}] Error:`, err.message)
    sockets.delete(port)

    try {
      socket.close()
    } catch {
      // Socket may already be closed
    }

    // Auto-restart with exponential backoff
    const currentBackoff = restartBackoffs.get(port) ?? BACKOFF_INITIAL
    console.log(`[UDP:${port}] Restarting in ${currentBackoff}ms...`)

    const timer = setTimeout(() => {
      restartTimers.delete(port)
      console.log(`[UDP:${port}] Attempting restart...`)
      startUdpListener(port, config)
    }, currentBackoff)

    restartTimers.set(port, timer)
    restartBackoffs.set(port, Math.min(currentBackoff * 2, BACKOFF_MAX))
  })

  socket.on('listening', () => {
    const address = socket.address()
    console.log(`[UDP:${port}] Listening on ${address.address}:${address.port} for ${config.system}`)
    // Reset backoff on successful listen
    restartBackoffs.delete(port)
  })

  socket.bind(port)
  sockets.set(port, socket)
}

/**
 * Stop all UDP listeners
 */
export function stopUdpListeners(): void {
  // Clear pending restart timers
  for (const timer of restartTimers.values()) {
    clearTimeout(timer)
  }
  restartTimers.clear()
  restartBackoffs.clear()

  for (const socket of sockets.values()) {
    try {
      socket.close()
    } catch {
      // Socket may already be closed due to error
    }
  }
  sockets.clear()
  console.log('[UDP] All listeners stopped')
}
