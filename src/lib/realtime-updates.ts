import type { PrismaMetric, PrismaSystem } from '@/types'

export function applyMetricUpdates(systems: PrismaSystem[], updates: Map<string, Partial<PrismaMetric>>): PrismaSystem[] {
  let changed = false
  const next = systems.map(system => {
    if (!system.metrics?.some(metric => updates.has(metric.id))) return system
    changed = true
    return { ...system, metrics: system.metrics.map(metric => {
      const update = updates.get(metric.id)
      return update ? { ...metric, ...update } : metric
    }) }
  })
  return changed ? next : systems
}

// Serialize refreshes and retain one trailing request so a save that happens
// during an older query is not lost. All callers await the latest result.
export function createRefreshQueue(refresh: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null
  let requested = false
  return () => {
    requested = true
    if (!running) {
      running = Promise.resolve().then(async () => {
        while (requested) {
          requested = false
          await refresh()
        }
      }).finally(() => { running = null })
    }
    return running
  }
}
