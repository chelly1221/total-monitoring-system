import { NextResponse } from 'next/server'
import { readWing15State } from '@/lib/wing15-state'

export async function GET() {
  try {
    return NextResponse.json(await readWing15State())
  } catch (error) {
    console.error('Wing15 status error:', error)
    return NextResponse.json({ error: '뇌전 감시 상태 조회 실패' }, { status: 500 })
  }
}
