import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moveCard, nearestCardSlot, orderCards, readCardOrder } from '../src/lib/card-order'

test('saved order survives status updates, ignores removed IDs, and appends new equipment', () => {
  const saved = readCardOrder('["b","a","deleted","b",null,1]')
  const items = [{ id: 'a', status: 'critical' }, { id: 'b', status: 'normal' }, { id: 'c', status: 'offline' }]
  assert.deepEqual(orderCards(items, saved), [items[1], items[0], items[2]])
  for (const raw of ['invalid', '{}', 'null']) assert.deepEqual(orderCards(items, readCardOrder(raw)), items)
})

test('reorder inserts at the selected slot and retains every other card', () => {
  const ids = ['a', 'b', 'c', 'd']
  assert.deepEqual(moveCard(ids, 'a', 'c'), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveCard(ids, 'd', 'b'), ['a', 'd', 'b', 'c'])
  assert.deepEqual(moveCard(ids, 'removed', 'b'), ids)
  assert.deepEqual(moveCard(ids, 'a', 'removed'), ids)
  assert.deepEqual(moveCard(ids, 'a', 'a'), ids)
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'])
})

test('snap targets work across unequal UPS columns and grid gaps', () => {
  const slots = [
    { id: 'large', left: 0, top: 0, width: 200, height: 600 },
    { id: 'upper', left: 210, top: 0, width: 200, height: 300 },
    { id: 'lower', left: 210, top: 310, width: 200, height: 150 },
  ]
  assert.equal(nearestCardSlot(slots, 190, 40), 'large')
  assert.equal(nearestCardSlot(slots, 250, 40), 'upper')
  assert.equal(nearestCardSlot(slots, 250, 309), 'lower')
  assert.equal(nearestCardSlot(slots, 250, 500), 'lower')
  assert.equal(nearestCardSlot([], 0, 0), undefined)
})
