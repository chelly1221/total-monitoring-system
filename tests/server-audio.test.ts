import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

// Exercise the real playback effect with persistent refs and a silent Audio double.
function playback(desktop: boolean) {
  const state = {
    alarms: [{ systemId: 'sound', severity: 'critical', acknowledged: false, resolvedAt: null }],
    systems: [{ id: 'sound', isEnabled: true, isActive: true, audioConfig: JSON.stringify({ type: 'file', fileName: 'alarm.wav' }) }],
    metrics: [], audioMuted: false, serverAudioEnabled: null as boolean | null,
  }
  const players: { src: string; loop: boolean; playing: boolean }[] = []
  const refs: { current: unknown }[] = []
  let refIndex = 0
  let effects: (() => unknown)[] = []
  const componentModule = { exports: {} as { AudioAlertManager: () => void } }
  const code = transformSync(readFileSync('src/components/realtime/audio-alert-manager.tsx', 'utf8'), { loader: 'tsx', format: 'cjs' }).code
  runInNewContext(code, {
    module: componentModule,
    window: desktop ? { __TAURI_INTERNALS__: {} } : {},
    require: (name: string) => {
      if (name === 'react') return {
        useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
        useEffect: (effect: () => unknown) => effects.push(effect),
      }
      if (name === './realtime-provider') return { useRealtime: () => state }
      if (name === '@/lib/threshold-evaluator') return {}
      throw new Error(`Unexpected import: ${name}`)
    },
    Audio: class {
      loop = false
      playing = false
      constructor(public src: string) { players.push(this) }
      play() { this.playing = true; return Promise.resolve() }
      pause() { this.playing = false }
    },
  })
  return { state, players, render: () => {
    refIndex = 0
    effects = []
    componentModule.exports.AudioAlertManager()
    effects[0]()
  } }
}

test('desktop waits for settings, stops immediately when disabled, and respects global mute when re-enabled', () => {
  const app = playback(true)
  app.render()
  assert.equal(app.players.length, 0)
  app.state.serverAudioEnabled = false
  app.render()
  assert.equal(app.players.length, 0)
  app.state.serverAudioEnabled = true
  app.render()
  assert.equal(app.players[0].playing, true)
  assert.equal(app.players[0].loop, true)
  app.state.serverAudioEnabled = false
  app.render()
  assert.equal(app.players[0].playing, false)
  assert.equal(app.players[0].src, '')
  app.state.audioMuted = true
  app.state.serverAudioEnabled = true
  app.render()
  assert.equal(app.players.length, 1)
  app.state.audioMuted = false
  app.render()
  assert.equal(app.players[1].playing, true)
})

test('web playback ignores server output changes but still obeys existing global mute', () => {
  const web = playback(false)
  web.render()
  assert.equal(web.players[0].playing, true)
  web.state.serverAudioEnabled = false
  web.render()
  assert.equal(web.players.length, 1)
  assert.equal(web.players[0].playing, true)
  web.state.audioMuted = true
  web.render()
  assert.equal(web.players[0].playing, false)
})
