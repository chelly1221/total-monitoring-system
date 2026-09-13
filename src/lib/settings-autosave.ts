export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error'

// Serialize writes: an older response must never overwrite the newest draft.
export function createSettingsAutosave<T>(save: (value: T) => Promise<void>, retryMs = 2000) {
  let status: AutosaveStatus = 'idle'
  let pending: T | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: Promise<void> | undefined
  let ready = false
  let revision = 0
  let failures = 0
  let allowRetry = true
  const listeners = new Set<() => void>()
  const publish = (next: AutosaveStatus) => { status = next; listeners.forEach(listener => listener()) }
  const clear = () => { clearTimeout(timer); timer = undefined }

  function drain(): Promise<void> {
    if (active) return active
    active = (async () => {
      while (ready && pending !== undefined) {
        const value = pending
        const currentRevision = revision
        pending = undefined
        ready = false
        publish('saving')
        try {
          await save(value)
          failures = 0
          if (revision === currentRevision) publish('saved')
        } catch {
          if (revision === currentRevision) {
            pending = value
            publish('error')
            if (allowRetry) timer = setTimeout(() => { ready = true; void drain() }, Math.min(retryMs * 2 ** failures++, 30000))
            break
          }
        }
      }
    })().finally(() => {
      active = undefined
      if (ready && pending !== undefined) void drain()
    })
    return active
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => status,
    schedule(value: T | undefined, delay = 500) {
      clear()
      revision++
      failures = 0
      allowRetry = true
      pending = value
      ready = false
      publish(value === undefined ? 'invalid' : 'pending')
      if (value !== undefined) {
        if (delay === 0) { ready = true; void drain() }
        else timer = setTimeout(() => { ready = true; void drain() }, delay)
      }
    },
    flush() { clear(); ready = pending !== undefined; return drain() },
    // Finish the last valid edit when navigating away, without background retries.
    leave() { allowRetry = false; clear(); ready = pending !== undefined; return drain() },
  }
}
