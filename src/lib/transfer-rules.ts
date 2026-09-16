// Pure rules for file transfer / remote install jobs. No Node imports: this
// module is shared by the API routes, the header dialog and the tests.

/** Clients older than this ignore the `transfer` command. */
export const MIN_TRANSFER_CLIENT_VERSION = '3.2.0'
export const MAX_TRANSFER_FILE_BYTES = 2 * 1024 * 1024 * 1024
/** NSIS installers (AhnLab V3 engine setup among them) install silently with /S. */
export const DEFAULT_EXE_ARGS = '/S'
export const DEFAULT_MSI_ARGS = '/qn'
const MAX_ARGS_LENGTH = 200

export type TargetPhase =
  | 'pending'      // command not sent yet
  | 'sent'         // client acknowledged, waiting for its first report
  | 'downloading'
  | 'verifying'
  | 'running'
  | 'done'
  | 'error'        // client reported a failure (or stalled)
  | 'unreachable'  // no ack
  | 'rejected'     // client refused the command (busy, invalid payload)

export const TERMINAL_PHASES: ReadonlySet<TargetPhase> = new Set(['done', 'error', 'unreachable', 'rejected'])

/** How long a target may sit in a phase without a report before it is marked stalled. */
export const STALL_TIMEOUT_MS: Partial<Record<TargetPhase, number>> = {
  sent: 60_000,
  downloading: 180_000,
  verifying: 180_000,
  running: 30 * 60_000, // an installer may wait for a UAC prompt on the facility PC
}

export interface StagedFileInfo {
  id: string
  name: string
  size: number
  sha256: string
  createdAt: string
}

export interface TransferTarget {
  clientId: string
  name: string
  host: string
  ip: string
  discoveryPort: number
  phase: TargetPhase
  received: number
  total: number
  message: string
  exitCode: number | null
  updatedAt: string
}

export interface TransferJob {
  id: string
  createdAt: string
  file: StagedFileInfo
  run: boolean
  args: string
  elevate: boolean
  targets: TransferTarget[]
}

export interface TransferReport {
  clientId: string
  phase: 'downloading' | 'verifying' | 'running' | 'done' | 'error'
  received: number
  total: number
  message: string
  exitCode: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase()
}

/**
 * Reduce an operator-supplied file name to a safe base name: no directories,
 * no characters Windows rejects, no control characters, at most 120 chars.
 * Returns '' when nothing usable remains.
 */
export function sanitizeFileName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const base = raw.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')
  if (!cleaned || cleaned === '.' || cleaned === '..') return ''
  return cleaned.slice(0, 120)
}

/** Default silent-install arguments for a file, by extension; '' for anything not runnable. */
export function defaultArgsFor(fileName: string): string {
  const ext = extensionOf(fileName)
  if (ext === '.exe') return DEFAULT_EXE_ARGS
  if (ext === '.msi') return DEFAULT_MSI_ARGS
  return ''
}

/** Files the client can execute after download. */
export function isRunnable(fileName: string): boolean {
  const ext = extensionOf(fileName)
  return ext === '.exe' || ext === '.msi'
}

/** True when a client version (e.g. "3.2.0") supports the transfer command. */
export function supportsTransfer(version: string): boolean {
  const parse = (v: string) => v.trim().split('.').map(part => Number.parseInt(part, 10))
  const have = parse(version)
  const need = parse(MIN_TRANSFER_CLIENT_VERSION)
  if (have.length < 3 || have.some(n => !Number.isInteger(n))) return false
  for (let i = 0; i < 3; i++) {
    if (have[i] > need[i]) return true
    if (have[i] < need[i]) return false
  }
  return true
}

/** Normalise run arguments: single line, trimmed, bounded. null when unusable. */
export function normalizeArgs(raw: unknown): string | null {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') return null
  const args = raw.replace(/[\r\n\t]+/g, ' ').trim()
  return args.length > MAX_ARGS_LENGTH ? null : args
}

export function isTargetActive(target: TransferTarget): boolean {
  return !TERMINAL_PHASES.has(target.phase)
}

export function isJobActive(job: TransferJob): boolean {
  return job.targets.some(isTargetActive)
}

/** Fields of the `transfer` datagram for one target (see the protocol document). */
export function buildTransferCommand(job: TransferJob, serverIp: string, port: number): Record<string, unknown> {
  const base = `http://${serverIp}:${port}/api/transfers`
  return {
    job: job.id,
    url: `${base}/files/${job.file.id}`,
    report: `${base}/${job.id}/report`,
    name: job.file.name,
    size: job.file.size,
    sha256: job.file.sha256,
    run: job.run,
    args: job.args,
    elevate: job.elevate,
  }
}

function touch(target: TransferTarget, phase: TargetPhase, message: string, now: Date): void {
  target.phase = phase
  target.message = message
  target.updatedAt = now.toISOString()
}

export type CommandResult =
  | { ok: true }
  | { ok: false; kind: 'timeout' | 'rejected' | 'unroutable'; error: string }

/** Record the outcome of sending the command to one target. */
export function markCommandResult(job: TransferJob, clientId: string, result: CommandResult, now = new Date()): void {
  const target = job.targets.find(t => t.clientId === clientId)
  if (!target) return
  if (result.ok) {
    touch(target, 'sent', '명령을 전달했습니다. 파일을 받기 시작하면 진행률이 표시됩니다.', now)
    return
  }
  touch(target, result.kind === 'rejected' ? 'rejected' : 'unreachable', result.error, now)
}

/** Parse a client progress report; null when malformed. */
export function parseReport(body: unknown): TransferReport | null {
  if (!isRecord(body)) return null
  const clientId = typeof body.id === 'string' ? body.id.trim() : ''
  const phase = body.phase
  if (!clientId) return null
  if (phase !== 'downloading' && phase !== 'verifying' && phase !== 'running' && phase !== 'done' && phase !== 'error') return null
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)
  return {
    clientId,
    phase,
    received: count(body.received),
    total: count(body.total),
    message: typeof body.message === 'string' ? body.message.slice(0, 500) : '',
    exitCode: typeof body.exitCode === 'number' && Number.isInteger(body.exitCode) ? body.exitCode : null,
  }
}

/**
 * Apply a progress report to its target. Reports for a target that already
 * finished are ignored (a late duplicate must not reopen it). Returns false
 * when the target is not part of the job.
 */
export function applyReport(job: TransferJob, report: TransferReport, now = new Date()): boolean {
  const target = job.targets.find(t => t.clientId === report.clientId)
  if (!target) return false
  if (TERMINAL_PHASES.has(target.phase)) return true
  target.received = report.received
  if (report.total > 0) target.total = report.total
  target.exitCode = report.exitCode
  touch(target, report.phase, report.message, now)
  return true
}

/** Mark targets whose last report is older than the phase allows as failed. */
export function expireStalledTargets(job: TransferJob, now = new Date()): void {
  for (const target of job.targets) {
    const limit = STALL_TIMEOUT_MS[target.phase]
    if (limit === undefined) continue
    const age = now.getTime() - new Date(target.updatedAt).getTime()
    if (age <= limit) continue
    const message = target.phase === 'sent'
      ? '클라이언트가 파일을 받기 시작하지 않았습니다'
      : target.phase === 'running'
        ? '실행 결과를 받지 못했습니다. 시설 PC에서 설치 창이나 권한 확인 창을 확인하세요'
        : '클라이언트의 진행 보고가 끊겼습니다'
    touch(target, 'error', message, now)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** Korean label for a target's phase (used by the dialog). */
export function phaseLabel(target: TransferTarget): string {
  switch (target.phase) {
    case 'pending': return '대기'
    case 'sent': return '명령 전달됨'
    case 'downloading': {
      const pct = target.total > 0 ? Math.min(100, Math.floor((target.received / target.total) * 100)) : 0
      return `받는 중 ${pct}%`
    }
    case 'verifying': return '검증 중'
    case 'running': return '실행 중'
    case 'done': return target.exitCode !== null ? `완료 (종료 코드 ${target.exitCode})` : '완료'
    case 'error': return '실패'
    case 'unreachable': return '응답 없음'
    case 'rejected': return '거부됨'
  }
}
