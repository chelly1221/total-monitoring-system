import { NextResponse } from 'next/server'
import { listDownloads } from '@/lib/downloads'

export const dynamic = 'force-dynamic'

/** Client programs offered in the header 다운로드 menu, with availability. */
export async function GET() {
  try {
    return NextResponse.json({ items: await listDownloads() })
  } catch (error) {
    console.error('Failed to list downloads:', error)
    return NextResponse.json({ error: '다운로드 목록을 불러오지 못했습니다' }, { status: 500 })
  }
}
