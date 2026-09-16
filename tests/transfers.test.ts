import assert from 'node:assert/strict'
import { test } from 'node:test'
import dgram from 'node:dgram'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { sendClientCommand } from '../src/lib/client-discovery'
import {
  applyReport,
  buildTransferCommand,
  expireStalledTargets,
  isJobActive,
  isRunnable,
  markCommandResult,
  parseReport,
  phaseLabel,
  sanitizeFileName,
  supportsTransfer,
  type TransferJob,
} from '../src/lib/transfer-rules'

function sampleJob(): TransferJob {
  const now = new Date('2026-09-16T00:00:00.000Z').toISOString()
  return {
    id: 'job1',
    createdAt: now,
    file: { id: '0123456789abcdef', name: 'ahnlabengine_setup260819.exe', size: 303182776, sha256: 'a'.repeat(64), createdAt: now },
    run: true,
    elevate: true,
    targets: [
      { clientId: 'c1', name: '1레이더 LCMS PC', host: 'RADAR1', ip: '192.168.0.21', discoveryPort: 7790, phase: 'pending', received: 0, total: 303182776, message: '', exitCode: null, updatedAt: now },
      { clientId: 'c2', name: '', host: 'RADAR2', ip: '192.168.0.22', discoveryPort: 7790, phase: 'pending', received: 0, total: 303182776, message: '', exitCode: null, updatedAt: now },
    ],
  }
}

test('file names are reduced to a safe base name', () => {
  assert.equal(sanitizeFileName('E:\\ahnlabengine_setup260819.exe'), 'ahnlabengine_setup260819.exe')
  assert.equal(sanitizeFileName('/tmp/../notice: v2?.pdf'), 'notice v2.pdf')
  assert.equal(sanitizeFileName('..'), '')
  assert.equal(sanitizeFileName('.hidden'), 'hidden')
  assert.equal(sanitizeFileName(''), '')
  assert.equal(sanitizeFileName(42), '')
  assert.equal(sanitizeFileName('x'.repeat(200)).length, 120)
})

test('only exe and msi files can be run after delivery', () => {
  assert.ok(isRunnable('ahnlabengine_setup260819.exe'))
  assert.ok(isRunnable('Agent.MSI'))
  assert.ok(!isRunnable('notice.pdf'))
})

test('only clients from 3.2.0 on can receive files', () => {
  assert.ok(supportsTransfer('3.2.0'))
  assert.ok(supportsTransfer('3.10.1'))
  assert.ok(supportsTransfer('4.0.0'))
  assert.ok(!supportsTransfer('3.1.0'))
  assert.ok(!supportsTransfer('3.1.9'))
  assert.ok(!supportsTransfer(''))
  assert.ok(!supportsTransfer('abc'))
})

test('transfer command points the client at this server and fits one datagram', () => {
  const fields = buildTransferCommand(sampleJob(), '192.168.0.10', 7777)
  assert.equal(fields.url, 'http://192.168.0.10:7777/api/transfers/files/0123456789abcdef')
  assert.equal(fields.report, 'http://192.168.0.10:7777/api/transfers/job1/report')
  assert.equal(fields.name, 'ahnlabengine_setup260819.exe')
  assert.equal(fields.sha256, 'a'.repeat(64))
  assert.equal(fields.run, true)
  assert.equal(fields.elevate, true)
  assert.equal('args' in fields, false)
  const datagram = JSON.stringify({ v: 1, t: 'transfer', nonce: 'ffffffffffffffff', ts: 1757600000, ...fields })
  assert.ok(Buffer.byteLength(datagram) < 1200)
})

test('command results and progress reports drive the target phases', () => {
  const job = sampleJob()
  const t0 = new Date('2026-09-16T00:00:01.000Z')
  markCommandResult(job, 'c1', { ok: true }, t0)
  markCommandResult(job, 'c2', { ok: false, kind: 'timeout', error: '클라이언트가 응답하지 않습니다' }, t0)
  markCommandResult(job, 'ghost', { ok: true }, t0)
  assert.equal(job.targets[0].phase, 'sent')
  assert.equal(job.targets[1].phase, 'unreachable')
  assert.equal(job.targets[1].message, '클라이언트가 응답하지 않습니다')
  assert.ok(isJobActive(job))

  const downloading = parseReport({ id: 'c1', phase: 'downloading', received: 151591388, total: 303182776 })
  assert.ok(downloading)
  assert.ok(applyReport(job, downloading, t0))
  assert.equal(job.targets[0].phase, 'downloading')
  assert.equal(phaseLabel(job.targets[0]), '받는 중 50%')

  const done = parseReport({ id: 'c1', phase: 'done', received: 303182776, total: 303182776, message: '설치 완료', exitCode: 0 })
  assert.ok(done)
  applyReport(job, done, t0)
  assert.equal(job.targets[0].phase, 'done')
  assert.equal(job.targets[0].exitCode, 0)
  assert.equal(phaseLabel(job.targets[0]), '완료 (종료 코드 0)')
  assert.ok(!isJobActive(job))

  // A late report must not reopen a finished target; unknown clients are refused.
  applyReport(job, { clientId: 'c1', phase: 'error', received: 0, total: 0, message: 'late', exitCode: null }, t0)
  assert.equal(job.targets[0].phase, 'done')
  assert.ok(!applyReport(job, { clientId: 'nobody', phase: 'done', received: 0, total: 0, message: '', exitCode: null }, t0))

  assert.equal(parseReport({ id: 'c1', phase: 'bogus' }), null)
  assert.equal(parseReport({ phase: 'done' }), null)
  assert.equal(parseReport('done'), null)
  assert.equal(parseReport({ id: 'c1', phase: 'done', exitCode: 1.5 })?.exitCode, null)
})

test('targets that stop reporting are marked stalled per phase', () => {
  const job = sampleJob()
  const t0 = new Date('2026-09-16T00:00:00.000Z')
  markCommandResult(job, 'c1', { ok: true }, t0)
  markCommandResult(job, 'c2', { ok: true }, t0)
  applyReport(job, { clientId: 'c2', phase: 'running', received: 1, total: 1, message: '', exitCode: null }, t0)

  expireStalledTargets(job, new Date(t0.getTime() + 30_000))
  assert.equal(job.targets[0].phase, 'sent')
  expireStalledTargets(job, new Date(t0.getTime() + 61_000))
  assert.equal(job.targets[0].phase, 'error')
  assert.equal(job.targets[1].phase, 'running') // installers may run for a long time
  expireStalledTargets(job, new Date(t0.getTime() + 31 * 60_000))
  assert.equal(job.targets[1].phase, 'error')
})

test('staged uploads are hashed, kept once and served by id', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tms-transfers-test-'))
  const previous = process.env.TRANSFERS_DIR
  process.env.TRANSFERS_DIR = dir
  try {
    const { stageFile, locateStagedFile, createJob, getJob, listJobs } = await import('../src/lib/transfers')
    const first = Buffer.from('first file contents')
    const staged1 = await stageFile('C:\\temp\\notice.txt', Readable.from([first]))
    assert.equal(staged1.name, 'notice.txt')
    assert.equal(staged1.size, first.length)
    assert.equal(staged1.sha256, createHash('sha256').update(first).digest('hex'))
    assert.deepEqual(await readFile(staged1.path), first)

    const second = Buffer.alloc(70_000, 7)
    const staged2 = await stageFile('setup.exe', Readable.from([second.subarray(0, 40_000), second.subarray(40_000)]))
    assert.equal(staged2.size, second.length)
    // Only the newest upload survives when nothing is using the older one.
    assert.deepEqual(await readdir(dir), [path.basename(staged2.path)])
    assert.equal(await locateStagedFile(staged1.id), null)
    assert.equal((await locateStagedFile(staged2.id))?.id, staged2.id)

    await assert.rejects(stageFile('empty.bin', Readable.from([])), /빈 파일/)
    await assert.rejects(stageFile('big.bin', Readable.from([Buffer.alloc(10)]), 5), /너무 큽니다/)
    assert.deepEqual(await readdir(dir), [path.basename(staged2.path)])

    const job = createJob({ file: staged2, run: true, elevate: true, targets: [{ clientId: 'c1', name: 'PC', host: 'H', ip: '127.0.0.1', discoveryPort: 7790 }] })
    assert.equal(getJob(job.id)?.targets[0].phase, 'pending')
    assert.equal(listJobs()[0].id, job.id)
    // A file referenced by an active job is kept when a newer upload arrives.
    const staged3 = await stageFile('third.bin', Readable.from([Buffer.from('x')]))
    assert.deepEqual((await readdir(dir)).sort(), [path.basename(staged2.path), path.basename(staged3.path)].sort())
  } finally {
    if (previous === undefined) delete process.env.TRANSFERS_DIR
    else process.env.TRANSFERS_DIR = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('transfer command is delivered over the discovery channel and acknowledged', async () => {
  const socket = dgram.createSocket('udp4')
  const received: Record<string, unknown>[] = []
  socket.on('message', (raw, rinfo) => {
    const message = JSON.parse(raw.toString())
    received.push(message)
    const ok = message.t === 'transfer' && typeof message.url === 'string' && message.run === true
    socket.send(JSON.stringify({ v: 1, t: 'ack', nonce: message.nonce, ok, id: 'fake-1', error: ok ? '' : 'invalid transfer' }), rinfo.port, rinfo.address)
  })
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  try {
    const fields = buildTransferCommand(sampleJob(), '127.0.0.1', 7777)
    const ack = await sendClientCommand('127.0.0.1', 'transfer', fields, { port: socket.address().port, retries: 0, timeoutMs: 500 })
    assert.equal(ack.ok, true)
    assert.equal(received[0].t, 'transfer')
    assert.equal(received[0].job, 'job1')
    assert.equal(received[0].name, 'ahnlabengine_setup260819.exe')
  } finally {
    socket.close()
  }
})
