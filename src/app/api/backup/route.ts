import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateBackup } from '@/lib/backup-validation'
import { notifySystemsChanged, notifySirenSync } from '@/lib/ws-notify'

export async function GET() {
  try {
    const [systems, settings, sirens, alarmLogs] = await prisma.$transaction([
      prisma.system.findMany({ include: { metrics: true } }),
      prisma.setting.findMany({ where: { key: { not: 'clientToken' } } }),
      prisma.siren.findMany(),
      prisma.alarmLog.findMany({ orderBy: { createdAt: 'desc' } }),
    ])

    const backup = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      systems,
      settings,
      sirens,
      alarmLogs,
    }

    return NextResponse.json(backup)
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json()

    const validationError = validateBackup(data)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.metricHistory.deleteMany()
      await tx.metric.deleteMany()
      await tx.alarm.deleteMany()
      await tx.alarmLog.deleteMany()
      await tx.system.deleteMany()
      await tx.setting.deleteMany()
      await tx.siren.deleteMany()

      for (const system of data.systems) {
        const { metrics, ...systemData } = system
        await tx.system.create({
          data: {
            ...systemData,
            lastDataAt: systemData.lastDataAt ? new Date(systemData.lastDataAt) : null,
            createdAt: new Date(systemData.createdAt),
            updatedAt: new Date(systemData.updatedAt),
            metrics: {
              create: metrics.map((m: Record<string, unknown>) => ({
                id: m.id as string,
                name: m.name as string,
                value: m.value as number,
                textValue: m.textValue as string | null,
                unit: m.unit as string,
                min: m.min as number | null,
                max: m.max as number | null,
                warningThreshold: m.warningThreshold as number | null,
                criticalThreshold: m.criticalThreshold as number | null,
                trend: m.trend as string | null,
                createdAt: new Date(m.createdAt as string),
                updatedAt: new Date(m.updatedAt as string),
              })),
            },
          },
        })
      }

      if (data.settings?.length) {
        for (const setting of data.settings) {
          // Old backups must not restore the retired client token.
          if (setting.key === 'clientToken') continue
          await tx.setting.create({
            data: {
              id: setting.id,
              key: setting.key,
              value: setting.value,
              category: setting.category,
              createdAt: new Date(setting.createdAt),
              updatedAt: new Date(setting.updatedAt),
            },
          })
        }
      }

      if (data.sirens?.length) {
        for (const siren of data.sirens) {
          await tx.siren.create({
            data: {
              id: siren.id,
              ip: siren.ip,
              port: siren.port,
              protocol: siren.protocol,
              messageOn: siren.messageOn,
              messageOff: siren.messageOff,
              location: siren.location,
              isEnabled: siren.isEnabled,
              createdAt: new Date(siren.createdAt),
              updatedAt: new Date(siren.updatedAt),
            },
          })
        }
      }

      if (data.alarmLogs?.length) {
        for (const log of data.alarmLogs) {
          await tx.alarmLog.create({
            data: {
              id: log.id,
              systemId: log.systemId,
              systemName: log.systemName,
              severity: log.severity,
              message: log.message,
              value: log.value,
              createdAt: new Date(log.createdAt),
            },
          })
        }
      }
    }, { timeout: 60_000 })

    notifySystemsChanged()
    notifySirenSync()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Import error:', error)
    if (error instanceof SyntaxError) return NextResponse.json({ error: '잘못된 백업 JSON입니다' }, { status: 400 })
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.metricHistory.deleteMany()
      await tx.metric.deleteMany()
      await tx.alarm.deleteMany()
      await tx.alarmLog.deleteMany()
      await tx.system.deleteMany()
      await tx.setting.deleteMany()
      await tx.siren.deleteMany()
    })

    notifySystemsChanged()
    notifySirenSync()
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Reset error:', error)
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 })
  }
}
