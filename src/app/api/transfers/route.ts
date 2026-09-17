import { NextResponse } from 'next/server'
import { isIP } from 'net'
import {
  CLIENT_DISCOVERY_PORT,
  CLIENT_DISCOVERY_PORTS,
  ClientCommandError,
  pickServerAddressFor,
  sendClientCommand,
} from '@/lib/client-discovery'
import {
  buildTransferCommand,
  createJob,
  expireStalledTargets,
  isRunnable,
  listJobs,
  locateStagedFile,
  markCommandResult,
  type JobTargetInput,
} from '@/lib/transfers'

export const dynamic = 'force-dynamic'

const MAX_TARGETS = 50

/** Recent transfer jobs, newest first (the dialog resumes the latest one). */
export async function GET() {
  const now = new Date()
  const jobs = listJobs()
  for (const job of jobs) expireStalledTargets(job, now)
  return NextResponse.json({ jobs })
}

function parseTargets(raw: unknown): JobTargetInput[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return '대상 PC를 하나 이상 선택하세요'
  if (raw.length > MAX_TARGETS) return `한 번에 최대 ${MAX_TARGETS}대까지 보낼 수 있습니다`
  const targets: JobTargetInput[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return '대상 PC 정보가 올바르지 않습니다'
    const item = entry as Record<string, unknown>
    const clientId = typeof item.id === 'string' ? item.id.trim() : ''
    const ip = typeof item.ip === 'string' ? item.ip.trim() : ''
    if (!clientId || isIP(ip) !== 4) return '대상 PC 정보가 올바르지 않습니다'
    const discoveryPort = typeof item.discoveryPort === 'number' ? item.discoveryPort : CLIENT_DISCOVERY_PORT
    if (!(CLIENT_DISCOVERY_PORTS as readonly number[]).includes(discoveryPort)) return '지원하지 않는 클라이언트 탐지 포트입니다'
    if (seen.has(clientId)) continue
    seen.add(clientId)
    targets.push({
      clientId,
      name: typeof item.name === 'string' ? item.name.slice(0, 64) : '',
      host: typeof item.host === 'string' ? item.host.slice(0, 64) : '',
      ip,
      discoveryPort,
    })
  }
  return targets
}

/**
 * Start a transfer: send the `transfer` command to every selected client and
 * return the job so the UI can poll its progress.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 })
    }
    const fileId = typeof body.fileId === 'string' ? body.fileId : ''
    const file = fileId ? await locateStagedFile(fileId) : null
    if (!file) {
      return NextResponse.json({ error: '전송할 파일을 먼저 올리세요' }, { status: 400 })
    }
    const targets = parseTargets(body.targets)
    if (typeof targets === 'string') {
      return NextResponse.json({ error: targets }, { status: 400 })
    }
    const run = body.run === true
    if (run && !isRunnable(file.name)) {
      return NextResponse.json({ error: '자동 실행은 exe 또는 msi 파일만 가능합니다' }, { status: 400 })
    }
    const elevate = body.elevate !== false

    const job = createJob({ file, run, elevate, targets })
    await Promise.all(job.targets.map(async target => {
      const serverIp = pickServerAddressFor(target.ip)
      if (!serverIp) {
        markCommandResult(job, target.clientId, { ok: false, kind: 'unroutable', error: '서버의 LAN IP를 찾을 수 없습니다' })
        return
      }
      try {
        await sendClientCommand(target.ip, 'transfer', buildTransferCommand(job, serverIp), { port: target.discoveryPort, timeoutMs: 2000 })
        markCommandResult(job, target.clientId, { ok: true })
      } catch (error) {
        if (error instanceof ClientCommandError) {
          markCommandResult(job, target.clientId, { ok: false, kind: error.kind, error: error.message })
        } else {
          console.error(`[transfers] command to ${target.ip} failed:`, error)
          markCommandResult(job, target.clientId, { ok: false, kind: 'unroutable', error: '명령 전송에 실패했습니다' })
        }
      }
    }))
    return NextResponse.json({ job })
  } catch (error) {
    console.error('Transfer job creation failed:', error)
    return NextResponse.json({ error: '파일 전송을 시작하지 못했습니다' }, { status: 500 })
  }
}
