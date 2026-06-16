// MQTT subscriber for data collection.
// Unlike UDP/TCP, MQTT devices do not bind a port — they publish to a topic on a
// broker that this worker connects to. Bindings are reconciled from a desired
// (topic -> config) set computed in binding.ts (enabled DB systems with
// protocol='mqtt' and a topic). Each received message is parsed then handed to the
// same ingest queue as UDP/TCP, so all downstream processing (metrics, alarms,
// offline detection) is identical.
//
// The broker URL is global (one broker per deployment): env MQTT_BROKER_URL,
// default mqtt://127.0.0.1:1883.

import mqtt, { MqttClient } from 'mqtt'
import { PortConfig } from './config'
import { parseBuffer } from './parser'
import { enqueueIngest } from './ingest-queue'
import { createPortStats } from './port-stats'
import { markSeen, clearLiveness, livenessKey } from './liveness'
import { createLogger } from '@/lib/logger'

const log = createLogger('mqtt')

const BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883'

let client: MqttClient | null = null
const configs = new Map<string, PortConfig>() // desired config per subscribed topic
// The ingest queue / stats are keyed by a numeric "port"; MQTT has none, so assign
// each topic a stable synthetic id used only for queue bucketing and stat keying.
const topicIds = new Map<string, number>()
let nextTopicId = 1
const portStats = createPortStats()

/** Number of topics currently subscribed (desired). */
export function getMqttSubscriptionCount(): number {
  return configs.size
}

/** The set of topics currently subscribed. */
export function getMqttSubscribedTopics(): string[] {
  return Array.from(configs.keys())
}

/** Whether the broker connection is currently up. */
export function isMqttConnected(): boolean {
  return client?.connected ?? false
}

export function getMqttStats(): Map<number, import('./port-stats').PortStat> {
  return portStats.map
}

function ensureClient(): MqttClient {
  if (client) return client
  log.info(`Connecting to MQTT broker ${BROKER_URL}`)
  client = mqtt.connect(BROKER_URL, {
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    resubscribe: true, // re-subscribe stored topics automatically after a reconnect
    clientId: `tms-worker-${process.pid}`,
  })

  client.on('connect', () => {
    log.info(`Connected to MQTT broker ${BROKER_URL}`)
    // (Re)subscribe to all desired topics on (re)connect.
    const topics = Array.from(configs.keys())
    if (topics.length > 0) {
      client!.subscribe(topics, { qos: 1 }, (err) => {
        if (err) log.error('Subscribe-on-connect failed:', err.message)
        else log.info(`Subscribed to ${topics.length} topic(s)`)
      })
    }
  })

  client.on('reconnect', () => log.warn('Reconnecting to MQTT broker...'))
  client.on('error', (err) => log.error('MQTT client error:', err.message))
  client.on('close', () => log.warn('MQTT connection closed'))

  client.on('message', (topic, payload) => {
    const config = configs.get(topic)
    if (!config) return
    const id = topicIds.get(topic)
    if (id == null) return
    portStats.received(id)
    // Record liveness BEFORE the queue so offline detection sees the message even if
    // the drainer is stalled / the DB write is delayed.
    markSeen(livenessKey('mqtt', null, topic))
    try {
      log.debug(`[${topic}] Received ${payload.length} bytes`)
      const data = parseBuffer(payload, config)
      enqueueIngest({ config, data, port: id, protocol: 'mqtt', topic, stats: portStats })
    } catch (error) {
      portStats.fail(id)
      log.error(`[${topic}] Error parsing message:`, error)
    }
  })

  return client
}

/**
 * Reconcile subscribed topics to the desired (topic -> config) set:
 * subscribe new topics, unsubscribe removed ones, hot-swap config in place.
 */
export function reconcileMqttListeners(desired: Map<string, PortConfig>): void {
  // Unsubscribe topics no longer desired.
  for (const topic of Array.from(configs.keys())) {
    if (!desired.has(topic)) {
      const id = topicIds.get(topic)
      client?.unsubscribe(topic, (err) => {
        if (err) log.error(`[${topic}] Unsubscribe failed:`, err.message)
      })
      configs.delete(topic)
      topicIds.delete(topic)
      if (id != null) portStats.remove(id)
      clearLiveness(livenessKey('mqtt', null, topic))
      log.info(`[${topic}] unsubscribed (no longer configured)`)
    }
  }

  // No MQTT systems left: tear the broker connection down instead of holding an
  // idle, zero-subscription session open forever (ensureClient lazily recreates it).
  if (desired.size === 0) {
    if (client) {
      try { client.end(true) } catch { /* already closing */ }
      client = null
    }
    return
  }

  // Add new topics / hot-swap config on existing ones.
  const c = ensureClient()
  for (const [topic, cfg] of desired) {
    const isNew = !configs.has(topic)
    configs.set(topic, cfg)
    if (isNew) {
      const id = nextTopicId++
      topicIds.set(topic, id)
      portStats.ensure(id)
      if (c.connected) {
        c.subscribe(topic, { qos: 1 }, (err) => {
          if (err) log.error(`[${topic}] Subscribe failed:`, err.message)
          else log.info(`[${topic}] Subscribed for ${cfg.system}`)
        })
      }
      // If not yet connected, the 'connect' handler subscribes the full set.
    }
  }
}

/** Stop the MQTT client and clear all subscriptions (worker shutdown). */
export function stopMqttListeners(): void {
  for (const topic of configs.keys()) clearLiveness(livenessKey('mqtt', null, topic))
  configs.clear()
  topicIds.clear()
  if (client) {
    try { client.end(true) } catch { /* already closing */ }
    client = null
  }
  log.info('MQTT listener stopped')
}
