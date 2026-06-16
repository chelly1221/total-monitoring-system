// Main entry point for the data collector worker

import { stopUdpListeners, getUdpListenerCount, getUdpStats, getUdpBoundPorts } from './udp-listener'
import { stopTcpListeners, getTcpListenerCount, getTcpStats, getTcpBoundPorts } from './tcp-listener'
import { closeDatabase, startOfflineDetection, startHistoryCleanup, syncOfflineAlarms, initDatabasePragmas } from './db-updater'
import { startWebSocketServer, stopWebSocketServer, isWebSocketServerRunning, setSystemsChangedHandler } from './websocket-server'
import { startBindingReconciler, stopBindingReconciler, reconcileBindings } from './binding'
import { stopMqttListeners, getMqttSubscriptionCount, isMqttConnected } from './mqtt-listener'
import { getQueueDepth, getIngestCounters, stopIngestQueue } from './ingest-queue'
import { resetSirens, syncSirenState } from './siren-trigger'
import { UDP_PORTS, TCP_PORTS } from './config'

// Global error handlers — log but don't crash (systemd handles real crashes)
process.on('unhandledRejection', (reason) => {
  console.error('[worker] Unhandled rejection:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('[worker] Uncaught exception:', error)
  // Exit so the Tauri supervisor can cleanly respawn a fresh worker instead of
  // leaving a half-dead process alive (e.g. a broken DB connection).
  process.exit(1)
})

console.log('='.repeat(60))
console.log('통합알람감시체계 - Data Collector Worker')
console.log('='.repeat(60))

// Display static default ports (the binder unions these with enabled DB systems)
console.log('\nDefault UDP ports (config.ts):')
for (const [port, config] of Object.entries(UDP_PORTS)) {
  console.log(`  ${port}: ${config.system} (${config.type})`)
}

console.log('\nDefault TCP ports (config.ts):')
for (const [port, config] of Object.entries(TCP_PORTS)) {
  console.log(`  ${port}: ${config.system} (${config.type})`)
}

console.log('\n' + '-'.repeat(60))
console.log('Starting listeners...\n')

// Start WebSocket server first so the binder's sockets can broadcast raw previews
// and so the systems-changed handler is registered before any reconcile runs.
// (No DB access — safe to start before the pragmas below.)
startWebSocketServer()

// Apply SQLite pragmas (WAL + busy_timeout) BEFORE any DB-touching startup, then
// kick off the DB-dependent subsystems. Awaited so the first real query runs with
// the pragmas in force. (Top-level await is unavailable in the CJS worker bundle,
// so this is an async IIFE.)
void (async () => {
  await initDatabasePragmas()

  // Re-bind sockets whenever the API reports a systems change (low-latency path).
  setSystemsChangedHandler(() => { void reconcileBindings() })

  // Bind sockets from (DB systems ∪ const defaults), then keep them reconciled on a poll.
  startBindingReconciler()

  // Start offline detection (checks systems every 10s; per-device threshold, 5min default)
  startOfflineDetection()

  // Start metric history cleanup (tiered retention, runs every hour)
  startHistoryCleanup()

  // Sync siren state on startup (activate if unresolved critical alarms exist)
  syncSirenState()

  // Create alarms for systems already offline at startup
  syncOfflineAlarms()
})()

console.log('\n' + '-'.repeat(60))
console.log('Worker is running. Press Ctrl+C to stop.\n')

const HEALTH_CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL || '60000', 10)
// A bound socket that has received nothing for this long is "silent" — likely a dead
// sender / pulled cable / reconfigured gateway, which the listener-count alone cannot see.
const PORT_SILENT_THRESHOLD = parseInt(process.env.PORT_SILENT_THRESHOLD || '120000', 10)

const healthCheckInterval = setInterval(() => {
  const udpCount = getUdpListenerCount()
  const tcpCount = getTcpListenerCount()
  // Expected = currently desired (bound) ports; a gap means a port is down/restarting.
  const expectedUdp = getUdpBoundPorts().length
  const expectedTcp = getTcpBoundPorts().length
  const wsRunning = isWebSocketServerRunning()

  // Flag bound-but-silent ports so a dead data flow is visible even while the socket is "up".
  const now = Date.now()
  const silent: string[] = []
  for (const [label, statsMap] of [['UDP', getUdpStats()], ['TCP', getTcpStats()]] as const) {
    for (const [port, s] of statsMap) {
      const age = s.lastSeenAt ? now - s.lastSeenAt : Infinity
      if (age > PORT_SILENT_THRESHOLD) {
        silent.push(`${label}:${port}=${s.lastSeenAt ? Math.round(age / 1000) + 's' : 'never'}`)
      }
    }
  }
  const silentNote = silent.length
    ? ` | SILENT(>${Math.round(PORT_SILENT_THRESHOLD / 1000)}s): ${silent.join(', ')}`
    : ''

  const { dropped, processed } = getIngestCounters()
  const queueNote = ` | queue: ${getQueueDepth()} (processed ${processed}, dropped ${dropped})`

  const mqttSubs = getMqttSubscriptionCount()
  const mqttNote = mqttSubs > 0 ? ` | MQTT: ${mqttSubs} sub(s) ${isMqttConnected() ? 'connected' : 'DISCONNECTED'}` : ''

  console.log(`[health] UDP: ${udpCount}/${expectedUdp}, TCP: ${tcpCount}/${expectedTcp}, WebSocket: ${wsRunning ? 'OK' : 'DOWN'}${queueNote}${mqttNote}${silentNote}`)

  // Auto-restart WebSocket if down
  if (!wsRunning) {
    console.log('[health] WebSocket server down, restarting...')
    startWebSocketServer()
  }
}, HEALTH_CHECK_INTERVAL)

// Graceful shutdown handler
async function shutdown(): Promise<void> {
  console.log('\nShutting down...')

  clearInterval(healthCheckInterval)
  stopBindingReconciler()
  await resetSirens()
  stopUdpListeners()
  stopTcpListeners()
  stopMqttListeners()
  await stopIngestQueue()
  stopWebSocketServer()
  await closeDatabase()

  console.log('Worker stopped.')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Keep the process running
process.stdin.resume()
