import type { PrismaClient } from '@prisma/client'
import type { HereReply } from './client-discovery'
import { PI_DATA_PORT_RANGE, PI_DISCOVERY_PORT, piChannel, piPreset, type PiChannelId } from './pi-sensor'
import { syncMetricsFromConfig } from './sync-metrics'
import type { MetricsConfig, SoundClientInfo } from '@/types'

export async function registerPiChannel(db: PrismaClient, device: HereReply, channel: PiChannelId, name: string) {
  const definition = piChannel(channel)!
  return db.$transaction(async tx => {
    const systems = await tx.system.findMany()
    const existing = systems.find(s => {
      try {
        const c = JSON.parse(s.config || '{}').client
        return s.isActive && c?.kind === 'pi' && c.id === device.id && c.channel === channel
      } catch { return false }
    })
    const client: SoundClientInfo = {
      kind: 'pi', discoveryPort: PI_DISCOVERY_PORT, channel, id: device.id,
      name: device.name, host: device.host, ip: device.ip, serverIp: device.serverIp, ver: device.ver,
    }
    if (existing) {
      // Retrying provisioning must preserve user-edited thresholds and names.
      const config = JSON.parse(existing.config!)
      config.client = { ...config.client, ...client }
      return tx.system.update({ where: { id: existing.id }, data: { config: JSON.stringify(config) } })
    }
    const used = new Set(systems.filter(s => s.protocol !== 'mqtt').map(s => s.port))
    let port = PI_DATA_PORT_RANGE.from
    while (used.has(port) && port <= PI_DATA_PORT_RANGE.to) port++
    if (port > PI_DATA_PORT_RANGE.to) throw new Error('라즈베리파이용 수신 포트가 모두 사용 중입니다')
    const config = piPreset(channel, client)
    const system = await tx.system.create({ data: {
      name, type: definition.kind === 'dht22' ? 'sensor' : 'equipment', protocol: 'udp', port,
      encoding: 'utf8', offlineThreshold: 60000, config: JSON.stringify(config), status: 'offline',
    } })
    if ('displayItems' in config) await syncMetricsFromConfig(system.id, config as MetricsConfig, tx)
    return system
  })
}
