import { prisma } from '@/lib/db'
import { GateSettingsCard } from '@/components/settings/gate-settings-card'
import { SirenSettingsCard } from '@/components/settings/siren-settings-card'
import { FeatureSettingsCard } from '@/components/settings/feature-settings-card'
import { DataManagementCard } from '@/components/settings/data-management-card'
import { SettingsWorkspace } from '@/components/settings/settings-workspace'

export const dynamic = 'force-dynamic'

async function getSettings() {
  const settings = await prisma.setting.findMany({ where: { key: { not: 'clientToken' } } })
  return settings.reduce((acc, setting) => {
    acc[setting.key] = setting.value
    return acc
  }, {} as Record<string, string>)
}

async function getSirens() {
  return prisma.siren.findMany({ orderBy: { createdAt: 'desc' } })
}

export default async function SettingsPage() {
  const [settings, sirens] = await Promise.all([getSettings(), getSirens()])

  return (
    <SettingsWorkspace
      gate={
        <GateSettingsCard
            initialIp={settings.gateIp}
            initialPort={settings.gatePort}
            initialProtocol={settings.gateProtocol}
        />
      }
      features={
        <FeatureSettingsCard
            initialTemperatureEnabled={settings.temperatureEnabled !== 'false'}
            initialUpsEnabled={settings.upsEnabled !== 'false'}
            initialGateEnabled={settings.gateEnabled !== 'false'}
            initialWing15Enabled={settings.wing15Enabled !== 'false'}
        />
      }
      data={<DataManagementCard initialHistoryMaxMb={settings.historyMaxSizeMb} />}
      sirens={<SirenSettingsCard initialSirens={sirens} />}
    />
  )
}
