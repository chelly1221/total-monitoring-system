import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Clear existing data
  await prisma.alarm.deleteMany()
  await prisma.metric.deleteMany()
  await prisma.alarmLog.deleteMany()
  await prisma.system.deleteMany()
  await prisma.setting.deleteMany()

  // Create all systems
  const systemsData = [
    // Radar systems
    { name: '1레이더', type: 'radar', location: '관제탑 A', description: '1번 레이더 시스템' },
    { name: '2레이더', type: 'radar', location: '관제탑 B', description: '2번 레이더 시스템' },
    // Port-mapped systems (UDP 1891-1898, 5555)
    { name: 'MARC', type: 'marc', location: '관제탑', description: 'MARC 시스템' },                      // UDP 1891
    { name: '관제송신소 UPS', type: 'ups', location: '관제송신소', description: '관제송신소 UPS' },      // UDP 1892
    { name: '1레이더 LCMS', type: 'lcms', location: '관제탑 A', description: '1레이더 LCMS' },          // UDP 1893
    { name: '1레이더 FMS', type: 'fms', location: '관제탑 A', description: '1레이더 FMS' },            // UDP 1894
    { name: '2레이더 LCMS', type: 'lcms', location: '관제탑 B', description: '2레이더 LCMS' },          // UDP 1895
    { name: '2레이더 FMS', type: 'fms', location: '관제탑 B', description: '2레이더 FMS' },            // UDP 1896
    { name: '1레이더 UPS', type: 'ups', location: '관제탑 A', description: '1레이더 UPS' },            // UDP 1897
    { name: '1레이더 전송로', type: 'transmission', location: '관제탑 A', description: '1레이더 전송로' }, // UDP 1898
    { name: '경항공기 통신실 UPS', type: 'ups', location: '경항공기 통신실', description: '경항공기 통신실 UPS' }, // UDP 5555
    // Other systems
    { name: 'VDL', type: 'vdl', location: '관제탑', description: 'VHF 데이터링크' },                   // TCP 1886
    { name: '온습도', type: 'sensor', location: '장비실', description: '온습도 모니터링' },             // UDP/TCP 1884
    { name: 'UPS-1레이더-2', type: 'ups', location: '관제탑 A', description: '1레이더 UPS #2' },       // UDP 1990
    { name: 'UPS-1레이더-2-aux', type: 'ups', location: '관제탑 A', description: '1레이더 UPS #2 보조' }, // UDP 1991
  ]

  const systems = await Promise.all(
    systemsData.map((data) =>
      prisma.system.create({
        data: {
          ...data,
          status: 'offline',
          isActive: true,
        },
      })
    )
  )

  // Create initial metrics (values will be updated by worker)
  for (const system of systems) {
    if (system.type === 'radar') {
      await prisma.metric.createMany({
        data: [
          { systemId: system.id, name: '출력', value: 0, unit: '%', min: 0, max: 100, warningThreshold: 70, criticalThreshold: 50 },
          { systemId: system.id, name: '온도', value: 0, unit: '°C', min: 0, max: 80, warningThreshold: 60, criticalThreshold: 70 },
        ],
      })
    } else if (system.type === 'ups') {
      await prisma.metric.createMany({
        data: [
          { systemId: system.id, name: '배터리', value: 0, unit: '%', min: 0, max: 100, warningThreshold: 50, criticalThreshold: 20 },
          { systemId: system.id, name: '입력전압', value: 0, unit: 'V', min: 180, max: 250, warningThreshold: 200, criticalThreshold: 190 },
          { systemId: system.id, name: '출력전압', value: 0, unit: 'V', min: 180, max: 250, warningThreshold: 200, criticalThreshold: 190 },
          { systemId: system.id, name: '부하', value: 0, unit: '%', min: 0, max: 100, warningThreshold: 80, criticalThreshold: 95 },
        ],
      })
    } else if (system.type === 'sensor') {
      await prisma.metric.createMany({
        data: [
          { systemId: system.id, name: '온도', value: 0, unit: '°C', min: 0, max: 50, warningThreshold: 30, criticalThreshold: 35 },
          { systemId: system.id, name: '습도', value: 0, unit: '%', min: 0, max: 100, warningThreshold: 70, criticalThreshold: 80 },
        ],
      })
    } else if (system.type === 'vdl') {
      await prisma.metric.createMany({
        data: [
          { systemId: system.id, name: '신호강도', value: 0, unit: 'dBm', min: -100, max: 0, warningThreshold: -60, criticalThreshold: -80 },
          { systemId: system.id, name: '연결상태', value: 0, unit: '', min: 0, max: 1, warningThreshold: 0.5, criticalThreshold: 0 },
        ],
      })
    } else if (system.type === 'lcms' || system.type === 'fms' || system.type === 'marc' || system.type === 'transmission') {
      // LCMS, FMS, MARC, Transmission systems - simple status metric
      await prisma.metric.create({
        data: { systemId: system.id, name: '상태', value: 0, unit: '', min: 0, max: 1, warningThreshold: 0.5, criticalThreshold: 0 },
      })
    } else {
      // Fallback for any other types
      await prisma.metric.create({
        data: { systemId: system.id, name: '상태', value: 0, unit: '', min: 0, max: 1, warningThreshold: 0.5, criticalThreshold: 0 },
      })
    }
  }

  // Create default settings
  await prisma.setting.createMany({
    data: [
      { key: 'refreshInterval', value: '5000', category: 'general' },
      { key: 'audioEnabled', value: 'true', category: 'audio' },
      { key: 'audioVolume', value: '0.7', category: 'audio' },
      { key: 'criticalSound', value: 'alarm1', category: 'audio' },
      { key: 'warningSound', value: 'beep', category: 'audio' },
    ],
  })

  console.log(`Created ${systems.length} systems with metrics`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
