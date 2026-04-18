// WebSocket server for real-time updates to frontend

import { WebSocketServer, WebSocket } from 'ws'
import type { WebSocketMessage } from '@/types'
import { syncSirenState } from './siren-trigger'

const WS_PORT = 7778

let wss: WebSocketServer | null = null
const clients = new Set<WebSocket>()

let wsRestartBackoff = 1000
const WS_BACKOFF_MAX = 30000
let wsRestartTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Check if the WebSocket server is running
 */
export function isWebSocketServerRunning(): boolean {
  return wss !== null
}

/**
 * Start the WebSocket server
 */
export function startWebSocketServer(): void {
  if (wss) return // Prevent duplicate start

  wss = new WebSocketServer({ port: WS_PORT })

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws)
    console.log(`[websocket] Client connected (total: ${clients.size})`)

    // Send initial ping
    ws.send(JSON.stringify({
      type: 'ping',
      data: { systemId: '', systemName: '' },
      timestamp: new Date().toISOString(),
    } satisfies WebSocketMessage))

    // Handle incoming messages (e.g., delete/alarm notifications from API)
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WebSocketMessage
        // Handle siren-sync: trigger immediate siren state check
        if (message.type === 'siren-sync') {
          syncSirenState()
          return
        }
        // Relay delete, alarm, and settings messages to all OTHER clients
        if (message.type === 'delete' || message.type === 'alarm' || message.type === 'settings') {
          const payload = JSON.stringify(message)
          for (const client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(payload)
            }
          }
        }
      } catch (error) {
        console.error('[websocket] Failed to parse message:', error)
      }
    })

    ws.on('close', () => {
      clients.delete(ws)
      console.log(`[websocket] Client disconnected (total: ${clients.size})`)
    })

    ws.on('error', (error: Error) => {
      console.error('[websocket] Client error:', error.message)
      clients.delete(ws)
    })
  })

  wss.on('error', (error: NodeJS.ErrnoException) => {
    console.error('[websocket] Server error:', error.message)

    // Auto-restart on critical errors
    if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
      wss?.close()
      wss = null
      clients.clear()

      console.log(`[websocket] Restarting in ${wsRestartBackoff}ms...`)
      wsRestartTimer = setTimeout(() => {
        wsRestartTimer = null
        console.log('[websocket] Attempting restart...')
        startWebSocketServer()
      }, wsRestartBackoff)
      wsRestartBackoff = Math.min(wsRestartBackoff * 2, WS_BACKOFF_MAX)
    }
  })

  wss.on('listening', () => {
    // Reset backoff on successful start
    wsRestartBackoff = 1000
    console.log(`[websocket] WebSocket server listening on port ${WS_PORT}`)
  })
}

/**
 * Broadcast a message to all connected clients
 */
export function broadcast(message: WebSocketMessage): void {
  if (!wss || clients.size === 0) return

  const payload = JSON.stringify(message)

  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload)
      } catch (error) {
        console.error('[websocket] Broadcast error:', error)
      }
    }
  }
}

/**
 * Broadcast a metric update
 */
export function broadcastMetric(
  systemId: string,
  systemName: string,
  metricId: string,
  metricName: string,
  value: number,
  unit: string,
  trend: 'up' | 'down' | 'stable' | null,
  textValue?: string | null
): void {
  broadcast({
    type: 'metric',
    data: {
      systemId,
      systemName,
      metricId,
      metricName,
      value,
      textValue: textValue ?? undefined,
      unit,
      trend,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Broadcast a system status update
 */
export function broadcastSystemStatus(
  systemId: string,
  systemName: string,
  status: 'normal' | 'warning' | 'critical' | 'offline'
): void {
  broadcast({
    type: 'system',
    data: {
      systemId,
      systemName,
      status,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Broadcast a new alarm
 */
export function broadcastAlarm(
  systemId: string,
  systemName: string,
  alarmId: string,
  severity: 'warning' | 'critical' | 'offline',
  message: string,
  value?: string | null
): void {
  broadcast({
    type: 'alarm',
    data: {
      systemId,
      systemName,
      alarmId,
      severity,
      message,
      alarmValue: value ?? undefined,
      acknowledged: false,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Broadcast alarm resolution (when system returns to normal)
 */
export function broadcastAlarmResolution(
  systemId: string,
  systemName: string
): void {
  broadcast({
    type: 'alarm-resolved' as WebSocketMessage['type'],
    data: {
      systemId,
      systemName,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Broadcast targeted alarm resolution (only specific alarm IDs)
 */
export function broadcastAlarmResolutionByIds(
  systemId: string,
  systemName: string,
  alarmIds: string[]
): void {
  broadcast({
    type: 'alarm-resolved' as WebSocketMessage['type'],
    data: {
      systemId,
      systemName,
      alarmIds,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Broadcast a system deletion
 */
export function broadcastSystemDelete(
  systemId: string,
  systemName: string
): void {
  broadcast({
    type: 'delete',
    data: {
      systemId,
      systemName,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Broadcast raw data for preview (used in system configuration)
 */
export function broadcastRawData(
  port: number,
  rawData: string
): void {
  broadcast({
    type: 'raw',
    data: {
      systemId: '',
      systemName: '',
      port,
      rawData,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Stop the WebSocket server
 */
export function stopWebSocketServer(): void {
  if (wsRestartTimer) {
    clearTimeout(wsRestartTimer)
    wsRestartTimer = null
  }
  if (wss) {
    for (const client of clients) {
      client.close()
    }
    clients.clear()
    wss.close()
    wss = null
    console.log('[websocket] WebSocket server stopped')
  }
}
