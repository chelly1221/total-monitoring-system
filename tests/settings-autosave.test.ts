import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSettingsAutosave } from '../src/lib/settings-autosave'
import { gateSettingsError } from '../src/lib/gate-settings'

test('autosave skips initial render, coalesces typing, and cancels incomplete drafts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const writes: string[] = []
  const queue = createSettingsAutosave<string>(async value => { writes.push(value) })
  assert.equal(queue.getSnapshot(), 'idle')
  queue.schedule('first')
  t.mock.timers.tick(300)
  queue.schedule('latest')
  t.mock.timers.tick(499)
  assert.deepEqual(writes, [])
  t.mock.timers.tick(1)
  await queue.flush()
  assert.deepEqual(writes, ['latest'])
  assert.equal(queue.getSnapshot(), 'saved')
  queue.schedule('do not send')
  queue.schedule(undefined)
  t.mock.timers.tick(1000)
  await queue.leave()
  assert.deepEqual(writes, ['latest'])
  assert.equal(queue.getSnapshot(), 'invalid')
})

test('slow saves stay serialized and only the final selection follows them', async () => {
  let release!: () => void
  const writes: string[] = []
  const queue = createSettingsAutosave<string>(async value => {
    writes.push(value)
    if (value === 'first') await new Promise<void>(resolve => { release = resolve })
  })
  queue.schedule('first', 0)
  queue.schedule('middle', 0)
  queue.schedule('last', 0)
  assert.deepEqual(writes, ['first'])
  assert.equal(queue.getSnapshot(), 'pending')
  release()
  await queue.flush()
  assert.deepEqual(writes, ['first', 'last'])
  assert.equal(queue.getSnapshot(), 'saved')
})

test('failed saves retain the draft and automatically retry without a save button', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let attempts = 0
  const queue = createSettingsAutosave<string>(async () => {
    if (++attempts === 1) throw new Error('offline')
  })
  queue.schedule('value', 0)
  await queue.flush()
  assert.equal(queue.getSnapshot(), 'error')
  assert.equal(attempts, 1)
  t.mock.timers.tick(2000)
  await queue.flush()
  assert.equal(attempts, 2)
  assert.equal(queue.getSnapshot(), 'saved')
})

test('leaving the page flushes the pending valid edit and invalid input cannot show saved', async () => {
  const writes: string[] = []
  const queue = createSettingsAutosave<string>(async value => { writes.push(value) })
  queue.schedule('last edit')
  await queue.leave()
  assert.deepEqual(writes, ['last edit'])
  queue.schedule('in flight', 0)
  queue.schedule(undefined)
  await queue.flush()
  assert.equal(queue.getSnapshot(), 'invalid')
})

test('gate drafts require a complete IP, exact integer port, and supported protocol', () => {
  const valid = { gateIp: '192.0.2.150', gatePort: '6722', gateProtocol: 'tcp' }
  assert.equal(gateSettingsError(valid), null)
  assert.equal(gateSettingsError({ ...valid, gatePort: 6722 }), null)
  for (const gateIp of ['', '192.0.2.', '256.0.0.1', '1.2.3.04']) assert.ok(gateSettingsError({ ...valid, gateIp }))
  for (const gatePort of ['', '0', '65536', '12.5', '12x', true]) assert.ok(gateSettingsError({ ...valid, gatePort }))
  assert.ok(gateSettingsError({ ...valid, gateProtocol: 'other' }))
})
