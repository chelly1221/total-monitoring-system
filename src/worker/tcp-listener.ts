// TCP socket listeners for data collection

import * as net from 'net'
import { TCP_PORTS, PortConfig } from './config'
import { parseBuffer } from './parser'
import { updateMetric } from './db-updater'
import { broadcastRawData } from './websocket-server'

const servers = new Map<number, net.Server>()
const restartBackoffs = new Map<number, number>()
const restartTimers = new Map<number, ReturnType<typeof setTimeout>>()

const BACKOFF_INITIAL = 1000
const BACKOFF_MAX = 30000

/**
 * Start TCP listeners for all configured ports
 */
export function startTcpListeners(): void {
  for (const [portStr, config] of Object.entries(TCP_PORTS)) {
    const port = Number(portStr)
    startTcpListener(port, config)
  }
}

/**
 * Get the number of active TCP listeners
 */
export function getTcpListenerCount(): number {
  return servers.size
}

/**
 * Start a single TCP listener on the specified port
 */
function startTcpListener(port: number, config: PortConfig): void {
  const server = net.createServer((socket) => {
    const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`
    console.log(`[TCP:${port}] Client connected: ${clientAddr}`)

    let buffer = Buffer.alloc(0)

    socket.on('data', async (data) => {
      try {
        console.log(`[TCP:${port}] Received ${data.length} bytes from ${clientAddr}`)

        // Accumulate data in buffer
        buffer = Buffer.concat([buffer, data])

        // Process complete messages (20 bytes each for buffer protocol)
        while (buffer.length >= 20 || (config.encoding === 'utf8' && buffer.length > 0)) {
          let messageLength: number

          if (config.encoding === 'utf8') {
            // For UTF-8, look for newline or process entire buffer
            const newlineIndex = buffer.indexOf('\n')
            if (newlineIndex !== -1) {
              messageLength = newlineIndex + 1
            } else {
              // Wait for more data unless buffer is getting large
              if (buffer.length < 256) break
              messageLength = buffer.length
            }
          } else {
            // For buffer protocol, process 20 bytes at a time
            messageLength = 20
          }

          const message = buffer.subarray(0, messageLength)
          buffer = buffer.subarray(messageLength)

          const parsed = parseBuffer(message, config)

          // Broadcast raw data for preview in config UI
          broadcastRawData(port, parsed.value)

          await updateMetric(config, parsed, port, 'tcp')
        }
      } catch (error) {
        console.error(`[TCP:${port}] Error processing data from ${clientAddr}:`, error)
      }
    })

    socket.on('error', (err) => {
      console.error(`[TCP:${port}] Socket error from ${clientAddr}:`, err.message)
    })

    socket.on('close', async () => {
      try {
        console.log(`[TCP:${port}] Client disconnected: ${clientAddr}`)

        // Process any remaining data in buffer when connection closes
        if (buffer.length > 0) {
          console.log(`[TCP:${port}] Processing remaining ${buffer.length} bytes`)
          const parsed = parseBuffer(buffer, config)
          broadcastRawData(port, parsed.value)
          await updateMetric(config, parsed, port, 'tcp')
          buffer = Buffer.alloc(0)
        }
      } catch (error) {
        console.error(`[TCP:${port}] Error processing remaining data from ${clientAddr}:`, error)
      }
    })
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[TCP:${port}] Server error:`, err.message)
    servers.delete(port)

    // Auto-restart with exponential backoff
    const currentBackoff = restartBackoffs.get(port) ?? BACKOFF_INITIAL
    console.log(`[TCP:${port}] Restarting in ${currentBackoff}ms...`)

    const timer = setTimeout(() => {
      restartTimers.delete(port)
      console.log(`[TCP:${port}] Attempting restart...`)
      startTcpListener(port, config)
    }, currentBackoff)

    restartTimers.set(port, timer)
    restartBackoffs.set(port, Math.min(currentBackoff * 2, BACKOFF_MAX))
  })

  server.listen(port, () => {
    console.log(`[TCP:${port}] Listening for ${config.system}`)
    // Reset backoff on successful listen
    restartBackoffs.delete(port)
  })

  servers.set(port, server)
}

/**
 * Stop all TCP listeners
 */
export function stopTcpListeners(): void {
  // Clear pending restart timers
  for (const timer of restartTimers.values()) {
    clearTimeout(timer)
  }
  restartTimers.clear()
  restartBackoffs.clear()

  for (const server of servers.values()) {
    server.close()
  }
  servers.clear()
  console.log('[TCP] All listeners stopped')
}
