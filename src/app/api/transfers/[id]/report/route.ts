import { NextResponse } from 'next/server'
import { applyReport, getJob, parseReport } from '@/lib/transfers'

export const dynamic = 'force-dynamic'

/** Progress report posted by a SoundSense client while it downloads / runs the file. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const job = getJob(id)
  if (!job) {
    return NextResponse.json({ error: 'unknown job' }, { status: 404 })
  }
  const report = parseReport(await request.json().catch(() => null))
  if (!report) {
    return NextResponse.json({ error: 'invalid report' }, { status: 400 })
  }
  if (!applyReport(job, report)) {
    return NextResponse.json({ error: 'unknown client' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
