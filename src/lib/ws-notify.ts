// Utility for API routes to send WebSocket notifications
// Connects as temporary client to the worker WebSocket server

import WebSocket from 'ws'
import type { WebSocketMessage, Wing15State } from '@/types'

const WS_URL = `ws://127.0.0.1:${Number(process.env.WS_PORT) || 7778}`

/**
 * Send a notification to the WebSocket server
 * Fire-and-forget: doesn't block on delivery
 */
function sendNotification(message: WebSocketMessage): void {
  const ws = new WebSocket(WS_URL, { handshakeTimeout: 3000 })

  ws.on('open', () => {
    ws.send(JSON.stringify(message))
    ws.close()
  })

  ws.on('error', (error) => {
    console.error('[ws-notify] Connection error:', error.message)
  })
}

/** A ping client posted new failure / recovery events for a facility. */
export function notifyPingEvents(systemId: string, clientId: string): void {
  sendNotification({ type: 'ping-events', data: { systemId, clientId }, timestamp: new Date().toISOString() })
}

/** The value text of an open alarm changed (e.g. which ping target failed). */
export function notifyAlarmValue(systemId: string, systemName: string, alarmId: string, value: string): void {
  sendNotification({
    type: 'alarm',
    data: { systemId, systemName, alarmId, alarmValue: value, valueOnly: true },
    timestamp: new Date().toISOString(),
  })
}

export function notifyWing15Changed(state: Wing15State): void {
  sendNotification({ type: 'wing15', data: { wing15: state }, timestamp: new Date().toISOString() })
}

/**
 * Notify all clients that a system was deleted
 */
export function notifySystemDeleted(systemId: string, systemName: string): void {
  sendNotification({
    type: 'delete',
    data: {
      systemId,
      systemName,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Notify all clients that a system's status changed
 */
export function notifySystemStatusChanged(
  systemId: string,
  systemName: string,
  status: 'normal' | 'warning' | 'critical' | 'offline'
): void {
  sendNotification({
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
 * Notify all clients that an alarm was acknowledged
 */
export function notifyAlarmAcknowledged(
  alarmId: string,
  systemId: string,
  systemName: string
): void {
  sendNotification({
    type: 'alarm',
    data: {
      alarmId,
      systemId,
      systemName,
      acknowledged: true,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Notify all clients that all alarms were acknowledged
 */
export function notifyAllAlarmsAcknowledged(
  alarmIds: string[]
): void {
  sendNotification({
    type: 'alarm',
    data: {
      alarmIds,
      acknowledged: true,
      bulk: true,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Notify all clients that alarms were resolved (system returned to normal)
 */
export function notifyAlarmResolution(
  systemId: string,
  systemName: string
): void {
  sendNotification({
    type: 'alarm-resolved' as WebSocketMessage['type'],
    data: {
      systemId,
      systemName,
    },
    timestamp: new Date().toISOString(),
  })
}

/**
 * Notify all clients that audio settings changed (mute/unmute sync across browsers)
 */
export function notifyAudioSettingsChanged(audioEnabled: string, muteEndTime: string): void {
  sendNotification({
    type: 'settings',
    data: {
      audioEnabled,
      muteEndTime,
    },
    timestamp: new Date().toISOString(),
  })
}

export function notifyServerAudioSettingsChanged(serverAudioEnabled: string): void {
  sendNotification({
    type: 'settings',
    data: { serverAudioEnabled },
    timestamp: new Date().toISOString(),
  })
}

export type FeatureSettingKey = 'temperatureEnabled' | 'upsEnabled' | 'gateEnabled' | 'wing15Enabled'

/**
 * Notify all browsers (and the worker) that feature toggles changed
 * (tab/button visibility, wing15 lightning monitor ON/OFF)
 */
export function notifyFeatureSettingsChanged(changed: Partial<Record<FeatureSettingKey, string>>): void {
  sendNotification({
    type: 'settings',
    data: changed,
    timestamp: new Date().toISOString(),
  })
}

/**
 * Notify worker to re-sync siren state (e.g., after mute toggle or alarm acknowledge)
 */
export function notifySirenSync(): void {
  sendNotification({
    type: 'siren-sync',
    data: {},
    timestamp: new Date().toISOString(),
  })
}

/**
 * Notify the worker that systems changed (created/updated/deleted) so it can
 * re-bind listening sockets to match the new (port, protocol, encoding) set.
 */
export function notifySystemsChanged(): void {
  sendNotification({
    type: 'systems-changed',
    data: {},
    timestamp: new Date().toISOString(),
  })
}
