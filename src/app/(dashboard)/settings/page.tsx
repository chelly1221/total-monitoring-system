import { prisma } from '@/lib/db'
import { GateSettingsCard } from '@/components/settings/gate-settings-card'
import { SirenSettingsCard } from '@/components/settings/siren-settings-card'
import { FeatureSettingsCard } from '@/components/settings/feature-settings-card'

export const dynamic = 'force-dynamic'

async function getSettings() {
  const settings = await prisma.setting.findMany()
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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">설정</h1>
        <p className="text-muted-foreground">시스템 설정 관리</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Left column: Gate + Feature toggles */}
        <div className="space-y-4">
          <GateSettingsCard
            initialIp={settings.gateIp}
            initialPort={settings.gatePort}
            initialProtocol={settings.gateProtocol}
          />
          <FeatureSettingsCard
            initialTemperatureEnabled={settings.temperatureEnabled !== 'false'}
            initialUpsEnabled={settings.upsEnabled !== 'false'}
            initialGateEnabled={settings.gateEnabled !== 'false'}
          />
        </div>

        {/* Right column: Siren */}
        <SirenSettingsCard initialSirens={sirens} />
      </div>
    </div>
  )
}
