import assert from 'node:assert/strict'
import { test } from 'node:test'
import { windowHref } from '../src/lib/window-href'

test('monitor windows preserve standalone mode across edit, add and return routes', () => {
  for (const route of ['/ups/ups-1', '/systems/sensor-1', '/ups/new', '/ups', '/temperature']) {
    assert.equal(windowHref(route, true), `${route}?standalone=true`)
    assert.equal(windowHref(route, false), route)
  }
})

test('standalone navigation preserves sensor type, history filters and anchors', () => {
  assert.equal(windowHref('/systems/new?type=sensor', true), '/systems/new?type=sensor&standalone=true')
  assert.equal(windowHref('/temperature/history?metric=humidity#chart', true), '/temperature/history?metric=humidity&standalone=true#chart')
  assert.equal(windowHref('/ups?standalone=true', true), '/ups?standalone=true')
  assert.equal(windowHref('/ups?standalone=false', true), '/ups?standalone=true')
})
