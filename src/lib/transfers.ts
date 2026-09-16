// File transfer and remote install jobs for TMS SoundSense clients (server side).
//
// Flow: the operator uploads a file into the staging directory (one file at a
// time), the server sends a `transfer` command over the discovery channel to
// each selected client, the client pulls the file over HTTP from this server,
// verifies its SHA-256, optionally runs it, and posts progress reports back.
// Jobs live in memory only; they describe a one-off operator action, not
// persistent state. See docs/sound-client-protocol.md for the wire contract.

import { createHash, randomBytes } from 'crypto'
import { createWriteStream } from 'fs'
import { mkdir, readdir, rm, stat } from 'fs/promises'
import os from 'os'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import {
  MAX_TRANSFER_FILE_BYTES,
  buildTransferCommand as buildCommandFields,
  isJobActive,
  sanitizeFileName,
  type StagedFileInfo,
  type TransferJob,
} from './transfer-rules'

export * from './transfer-rules'

const MAX_JOBS = 20

export interface StagedFile extends StagedFileInfo {
  path: string
}

interface TransferStore {
  files: Map<string, StagedFile>
  jobs: TransferJob[]
}

// Survives Next.js dev-mode module reloads; there is a single server process in production.
const globalStore = globalThis as typeof globalThis & { __tmsTransferStore?: TransferStore }
const store: TransferStore = globalStore.__tmsTransferStore ??= { files: new Map(), jobs: [] }

function newId(): string {
  return randomBytes(8).toString('hex')
}

/** Staging directory: TRANSFERS_DIR (set by the desktop app) or a temp folder in development. */
export function transfersDirectory(): string {
  return process.env.TRANSFERS_DIR || path.join(os.tmpdir(), 'tms-transfers')
}

/** Port other PCs use to reach this server over HTTP. */
export function serverHttpPort(): number {
  const port = Number(process.env.PORT)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 7777
}

function fileInUse(fileId: string): boolean {
  return store.jobs.some(job => job.file.id === fileId && isJobActive(job))
}

/** Delete staged files that no running job needs (only one upload is kept around). */
async function pruneStagedFiles(keepId: string | null): Promise<void> {
  const dir = transfersDirectory()
  const referenced = new Set<string>()
  for (const [id, file] of store.files) {
    if (id === keepId || fileInUse(id)) referenced.add(path.basename(file.path))
    else store.files.delete(id)
  }
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return
  }
  await Promise.all(entries.filter(name => !referenced.has(name)).map(name =>
    rm(path.join(dir, name), { force: true }).catch(() => undefined),
  ))
}

/**
 * Stream an upload into the staging directory, hashing it on the way.
 * Other staged files are removed unless a running job still serves them.
 */
export async function stageFile(name: string, body: Readable, maxBytes = MAX_TRANSFER_FILE_BYTES): Promise<StagedFile> {
  const safeName = sanitizeFileName(name)
  if (!safeName) throw new Error('파일 이름이 올바르지 않습니다')
  const dir = transfersDirectory()
  await mkdir(dir, { recursive: true })
  const id = newId()
  const filePath = path.join(dir, `${id}.bin`)
  const hash = createHash('sha256')
  let size = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > maxBytes) {
        callback(new Error('파일이 너무 큽니다 (최대 2GB)'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(body, counter, createWriteStream(filePath))
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined)
    throw error
  }
  if (size === 0) {
    await rm(filePath, { force: true }).catch(() => undefined)
    throw new Error('빈 파일은 전송할 수 없습니다')
  }
  const staged: StagedFile = { id, name: safeName, size, sha256: hash.digest('hex'), path: filePath, createdAt: new Date().toISOString() }
  store.files.set(id, staged)
  await pruneStagedFiles(id)
  return staged
}

/** Re-check that a staged file is still on disk (the temp folder may have been cleaned). */
export async function locateStagedFile(id: string): Promise<StagedFile | null> {
  const file = store.files.get(id)
  if (!file) return null
  try {
    const info = await stat(file.path)
    return info.isFile() && info.size === file.size ? file : null
  } catch {
    return null
  }
}

export function publicFileInfo(file: StagedFile): StagedFileInfo {
  return { id: file.id, name: file.name, size: file.size, sha256: file.sha256, createdAt: file.createdAt }
}

export interface JobTargetInput {
  clientId: string
  name: string
  host: string
  ip: string
  discoveryPort: number
}

export interface CreateJobInput {
  file: StagedFileInfo
  run: boolean
  elevate: boolean
  targets: JobTargetInput[]
}

export function createJob(input: CreateJobInput): TransferJob {
  const now = new Date().toISOString()
  const job: TransferJob = {
    id: newId(),
    createdAt: now,
    file: { id: input.file.id, name: input.file.name, size: input.file.size, sha256: input.file.sha256, createdAt: input.file.createdAt },
    run: input.run,
    elevate: input.run ? input.elevate : false,
    targets: input.targets.map(target => ({
      ...target,
      phase: 'pending',
      received: 0,
      total: input.file.size,
      message: '',
      exitCode: null,
      updatedAt: now,
    })),
  }
  store.jobs.unshift(job)
  if (store.jobs.length > MAX_JOBS) store.jobs.length = MAX_JOBS
  return job
}

export function getJob(id: string): TransferJob | undefined {
  return store.jobs.find(job => job.id === id)
}

export function listJobs(): TransferJob[] {
  return store.jobs
}

/** `transfer` datagram fields for one target, pointing at this server's HTTP port. */
export function buildTransferCommand(job: TransferJob, serverIp: string, port = serverHttpPort()): Record<string, unknown> {
  return buildCommandFields(job, serverIp, port)
}
