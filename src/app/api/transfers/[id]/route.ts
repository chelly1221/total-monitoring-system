import { NextResponse } from 'next/server'
import { expireStalledTargets, getJob } from '@/lib/transfers'

export const dynamic = 'force-dynamic'

/** Current state of one transfer job (polled by the dialog). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const job = getJob(id)
  if (!job) {
    return NextResponse.json({ error: '전송 작업을 찾을 수 없습니다' }, { status: 404 })
  }
  expireStalledTargets(job)
  return NextResponse.json({ job })
}
