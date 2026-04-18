import { prisma } from '@/lib/db'
import type { MetricsConfig, DisplayItem } from '@/types'

/**
 * Extract representative threshold from conditions for gauge display
 */
export function extractRepresentativeThreshold(conditions: DisplayItem['conditions'], type: 'warning' | 'critical'): number | null {
  if (!conditions) return null
  if (type === 'warning') return null
  const list = [...(conditions.critical || []), ...(conditions.coldCritical || []),
     ...(conditions.dryCritical || []), ...(conditions.humidCritical || [])]
  // Pick the first gte condition's value, or first condition's value1
  const gteCondition = list.find(c => c.operator === 'gte')
  if (gteCondition) return gteCondition.value1
  if (list.length > 0) return list[0].value1
  return null
}

/**
 * Sync displayItems from config to Metric table
 * Creates or updates metrics based on config.displayItems
 */
export async function syncMetricsFromConfig(systemId: string, config: MetricsConfig): Promise<void> {
  if (!config.displayItems || !Array.isArray(config.displayItems)) {
    return
  }

  for (const item of config.displayItems) {
    // Use conditions-based thresholds if available, otherwise fall back to legacy
    const warningThreshold = item.conditions
      ? extractRepresentativeThreshold(item.conditions, 'warning')
      : item.warning
    const criticalThreshold = item.conditions
      ? extractRepresentativeThreshold(item.conditions, 'critical')
      : item.critical

    const existingMetric = await prisma.metric.findFirst({
      where: {
        systemId,
        name: item.name,
      },
    })

    if (existingMetric) {
      await prisma.metric.update({
        where: { id: existingMetric.id },
        data: {
          warningThreshold,
          criticalThreshold,
          unit: item.unit,
        },
      })
    } else {
      await prisma.metric.create({
        data: {
          systemId,
          name: item.name,
          value: 0,
          unit: item.unit,
          warningThreshold,
          criticalThreshold,
        },
      })
    }
  }
}
