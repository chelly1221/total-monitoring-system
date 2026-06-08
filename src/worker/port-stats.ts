// Per-port ingestion statistics, shared by the UDP and TCP listeners.
// Lets the health check distinguish a healthy socket from a "bound but silent"
// one (sender died / cable pulled / device reconfigured) and report parse error rates.

export interface PortStat {
  received: number   // packets/chunks received
  parseOk: number    // successfully parsed + handled
  parseFail: number  // threw during parse/handling
  dropped: number    // dropped because the ingest queue was full
  lastSeenAt: number // epoch ms of last received packet, 0 if none yet
}

export interface PortStats {
  map: Map<number, PortStat>
  ensure(port: number): void
  received(port: number): void
  ok(port: number): void
  fail(port: number): void
  drop(port: number): void
  remove(port: number): void
}

export function createPortStats(): PortStats {
  const map = new Map<number, PortStat>()
  function get(port: number): PortStat {
    let s = map.get(port)
    if (!s) {
      s = { received: 0, parseOk: 0, parseFail: 0, dropped: 0, lastSeenAt: 0 }
      map.set(port, s)
    }
    return s
  }
  return {
    map,
    // ensure()/received() are the live-socket paths and may create an entry.
    ensure(port: number): void { get(port) },
    received(port: number): void { const s = get(port); s.received++; s.lastSeenAt = Date.now() },
    // ok()/fail()/drop() run later from the async ingest drainer — they must NOT
    // re-create an entry for a port that was unbound (remove()) in the meantime,
    // or a stale "SILENT never" phantom would leak into the health report.
    ok(port: number): void { const s = map.get(port); if (s) s.parseOk++ },
    fail(port: number): void { const s = map.get(port); if (s) s.parseFail++ },
    drop(port: number): void { const s = map.get(port); if (s) s.dropped++ },
    remove(port: number): void { map.delete(port) },
  }
}
