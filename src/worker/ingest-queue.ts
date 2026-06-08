// Bounded ingest queue: decouples the (synchronous) socket receive callbacks from
// the per-packet SQLite writes in updateMetric/processAlarm. Without this, awaiting
// DB writes on the receive path lets a slow/locked SQLite back up the event loop so
// the kernel silently overflows its UDP buffer and drops datagrams across ALL ports.
//
// Here the receive callback only parses + enqueues (returns immediately); a single
// drainer applies the writes. The queue is bounded globally AND per-port so one
// chatty/flooded port cannot monopolize it; excess is dropped WITH a counter.

import { PortConfig } from './config'
import { ParsedData } from './parser'
import { updateMetric, processAlarm } from './db-updater'
import type { PortStats } from './port-stats'
import { createLogger } from '@/lib/logger'

const log = createLogger('ingest')

export interface IngestItem {
  config: PortConfig
  data: ParsedData
  port: number
  protocol: 'udp' | 'tcp'
  stats: PortStats
}

const queue: IngestItem[] = []
const perPortCount = new Map<string, number>() // `${protocol}:${port}` -> items currently queued
const MAX_QUEUE = parseInt(process.env.INGEST_QUEUE_MAX || '2000', 10)
const MAX_PER_PORT = parseInt(process.env.INGEST_QUEUE_PER_PORT || '500', 10)

let draining = false
let stopped = false
let totalDropped = 0
let totalProcessed = 0
let drainPromise: Promise<void> | null = null

function keyOf(item: IngestItem): string {
  return `${item.protocol}:${item.port}`
}

/**
 * Enqueue a parsed packet for asynchronous DB processing. Synchronous and
 * non-blocking. Drops (and counts) the item if the global or per-port cap is hit.
 */
export function enqueueIngest(item: IngestItem): void {
  if (stopped) return
  const key = keyOf(item)
  const portCount = perPortCount.get(key) ?? 0
  if (queue.length >= MAX_QUEUE || portCount >= MAX_PER_PORT) {
    totalDropped++
    item.stats.drop(item.port)
    return
  }
  queue.push(item)
  perPortCount.set(key, portCount + 1)
  if (!draining) drainPromise = drain()
}

async function drain(): Promise<void> {
  draining = true
  try {
    while (queue.length && !stopped) {
      const item = queue.shift()!
      const key = keyOf(item)
      perPortCount.set(key, Math.max(0, (perPortCount.get(key) ?? 1) - 1))
      try {
        if (item.protocol === 'udp' && item.config.type === 'alarm') {
          await processAlarm(item.config, item.data)
        } else {
          await updateMetric(item.config, item.data, item.port, item.protocol)
        }
        totalProcessed++
        item.stats.ok(item.port)
      } catch (error) {
        item.stats.fail(item.port)
        log.error(`[${item.protocol}:${item.port}] ingest error:`, error)
      }
    }
  } finally {
    draining = false
  }
}

export function getQueueDepth(): number {
  return queue.length
}

export function getIngestCounters(): { dropped: number; processed: number } {
  return { dropped: totalDropped, processed: totalProcessed }
}

/**
 * Stop accepting and processing items (called on worker shutdown). Awaits the
 * in-flight drain so no Prisma query is outstanding when the DB connection closes.
 */
export async function stopIngestQueue(): Promise<void> {
  stopped = true
  try {
    await drainPromise
  } catch {
    // drain already logs its own per-item errors
  }
  queue.length = 0
  perPortCount.clear()
}
