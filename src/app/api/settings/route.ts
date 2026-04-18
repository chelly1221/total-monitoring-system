import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { notifySirenSync, notifyAudioSettingsChanged } from '@/lib/ws-notify'

export async function GET() {
  try {
    const settings = await prisma.setting.findMany()
    const settingsObj = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value
      return acc
    }, {} as Record<string, string>)

    return NextResponse.json(settingsObj)
  } catch (error) {
    console.error('Failed to fetch settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()

    const updates = Object.entries(body).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )

    await prisma.$transaction(updates)

    const settings = await prisma.setting.findMany()
    const settingsObj = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value
      return acc
    }, {} as Record<string, string>)

    // If audioEnabled or muteEndTime changed, sync siren state and broadcast to all browsers
    if ('audioEnabled' in body || 'muteEndTime' in body) {
      notifySirenSync()
      notifyAudioSettingsChanged(
        settingsObj.audioEnabled ?? 'true',
        settingsObj.muteEndTime ?? ''
      )
    }

    return NextResponse.json(settingsObj)
  } catch (error) {
    console.error('Failed to update settings:', error)
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    )
  }
}
