// LAN discovery of TMS SoundSense clients. Server-initiated, on-demand only:
// one broadcast probe per interface (repeated once), replies collected for a
// short window. See docs/sound-client-protocol.md for the wire contract.

import dgram from 'dgram'
import os from 'os'
import { randomBytes } from 'crypto'
import { isIP } from 'net'

export const CLIENT_DISCOVERY_PORT = 7790
export const PING_CLIENT_DISCOVERY_PORT = 7791
export const CLIENT_DISCOVERY_PORTS = [CLIENT_DISCOVERY_PORT, PING_CLIENT_DISCOVERY_PORT] as const
export const PROTOCOL_VERSION = 1
/** Server listening ports handed to auto-registered sound clients. */
export const SOUND_CLIENT_PORT_RANGE = { from: 6100, to: 6199 } as const
export const DEFAULT_SOUND_ON = 'SOUND'
export const DEFAULT_SOUND_OFF = 'SILENCE'
export const DEFAULT_HEARTBEAT_MS = 5000

const MAX_DATAGRAM = 1200

export interface HereReply {
  kind: 'sound' | 'ping'
  discoveryPort: number
  alarm: boolean | null
  running: boolean
  id: string
  name: string
  host: string
  ip: string
  serverIp: string
  mac: string
  ver: string
  target: { ip: string; port: number } | null
  muted: boolean
  sound: boolean
  uptimeSec: number
}

export interface BroadcastTarget {
  address: string    // local interface address the socket binds to
  broadcast: string  // directed broadcast address of that interface
  netmask: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0)
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.')
}

/** Directed broadcast address for an IPv4 address/netmask pair. */
export function computeBroadcast(address: string, netmask: string): string {
  return intToIp((ipToInt(address) | (~ipToInt(netmask) >>> 0)) >>> 0)
}

/** True when `ip` is inside the subnet of `address`/`netmask`. */
export function sameSubnet(ip: string, address: string, netmask: string): boolean {
  const mask = ipToInt(netmask)
  return (ipToInt(ip) & mask) === (ipToInt(address) & mask)
}

/** Non-loopback IPv4 interfaces with their directed broadcast address. */
export function listBroadcastTargets(interfaces = os.networkInterfaces()): BroadcastTarget[] {
  const targets: BroadcastTarget[] = []
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number
      if (entry.internal || (family !== 'IPv4' && family !== 4)) continue
      if (isIP(entry.address) !== 4 || isIP(entry.netmask) !== 4) continue
      if (entry.address.startsWith('169.254.')) continue
      targets.push({
        address: entry.address,
        netmask: entry.netmask,
        broadcast: computeBroadcast(entry.address, entry.netmask),
      })
    }
  }
  return targets
}

/** Local address that shares a subnet with `clientIp`, else the first LAN address. */
export function pickServerAddressFor(clientIp: string, targets = listBroadcastTargets()): string | null {
  const match = targets.find(t => sameSubnet(clientIp, t.address, t.netmask))
  return match?.address ?? targets[0]?.address ?? null
}

/** Pick the lowest free port in the sound-client range, or null when exhausted. */
export function suggestSoundClientPort(usedPorts: Iterable<number>): number | null {
  const used = new Set(usedPorts)
  for (let port = SOUND_CLIENT_PORT_RANGE.from; port <= SOUND_CLIENT_PORT_RANGE.to; port++) {
    if (!used.has(port)) return port
  }
  return null
}

export function newNonce(): string {
  return randomBytes(8).toString('hex')
}

/** Parse a `here` datagram; returns null when it is not a valid reply to `nonce`. */
export function parseHereReply(raw: Buffer | string, nonce: string, from: string, serverIp: string): HereReply | null {
  let message: unknown
  try {
    message = JSON.parse(raw.toString())
  } catch {
    return null
  }
  if (!isRecord(message) || message.v !== PROTOCOL_VERSION || message.t !== 'here' || message.nonce !== nonce) return null
  if (typeof message.id !== 'string' || !message.id.trim()) return null
  const target = isRecord(message.target) && typeof message.target.ip === 'string' &&
    Number.isInteger(message.target.port)
    ? { ip: message.target.ip, port: Number(message.target.port) }
    : null
  return {
    kind: message.kind === 'ping' ? 'ping' : 'sound',
    discoveryPort: message.kind === 'ping' ? PING_CLIENT_DISCOVERY_PORT : CLIENT_DISCOVERY_PORT,
    alarm: typeof message.alarm === 'boolean' ? message.alarm : null,
    running: message.running === true,
    id: message.id.trim(),
    name: typeof message.name === 'string' ? message.name.trim() : '',
    host: typeof message.host === 'string' ? message.host : '',
    ip: from,
    serverIp,
    mac: typeof message.mac === 'string' ? message.mac : '',
    ver: typeof message.ver === 'string' ? message.ver : '',
    target,
    muted: message.muted === true,
    sound: message.sound === true,
    uptimeSec: typeof message.uptimeSec === 'number' && Number.isFinite(message.uptimeSec) ? message.uptimeSec : 0,
  }
}

export interface AckReply {
  ok: boolean
  id: string
  error: string
}

/** Parse an `ack` datagram; returns null when it does not answer `nonce`. */
export function parseAck(raw: Buffer | string, nonce: string): AckReply | null {
  let message: unknown
  try {
    message = JSON.parse(raw.toString())
  } catch {
    return null
  }
  if (!isRecord(message) || message.v !== PROTOCOL_VERSION || message.t !== 'ack' || message.nonce !== nonce) return null
  return {
    ok: message.ok === true,
    id: typeof message.id === 'string' ? message.id : '',
    error: typeof message.error === 'string' ? message.error : '',
  }
}

interface DiscoverOptions {
  timeoutMs?: number
  port?: number
  ports?: number[]
  targets?: BroadcastTarget[]
}

/**
 * Broadcast a probe on every LAN interface and collect `here` replies.
 * Sends two probes (t=0, t=timeout/2) and resolves after `timeoutMs`.
 * Replies are deduped by client id; a later reply replaces an earlier one.
 */
export function discoverClients(options: DiscoverOptions = {}): Promise<HereReply[]> {
  const timeoutMs = options.timeoutMs ?? 2000
  const ports: readonly number[] = options.ports ?? (options.port === undefined ? CLIENT_DISCOVERY_PORTS : [options.port])
  const targets = options.targets ?? listBroadcastTargets()
  const nonce = newNonce()
  const probe = Buffer.from(JSON.stringify({ v: PROTOCOL_VERSION, t: 'probe', nonce }))
  const found = new Map<string, HereReply>()

  return new Promise(resolve => {
    if (targets.length === 0) {
      resolve([])
      return
    }

    const sockets: dgram.Socket[] = []
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      for (const socket of sockets) {
        try { socket.close() } catch { /* already closed */ }
      }
      resolve([...found.values()])
    }

    let pending = targets.length
    for (const target of targets) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      sockets.push(socket)
      socket.on('error', err => {
        console.error(`[discovery] socket error on ${target.address}:`, err.message)
        if (--pending === 0) setTimeout(finish, timeoutMs)
      })
      socket.on('message', (raw, rinfo) => {
        if (raw.length > MAX_DATAGRAM || !ports.includes(rinfo.port)) return
        const reply = parseHereReply(raw, nonce, rinfo.address, target.address)
        if (reply) found.set(reply.id, reply)
      })
      socket.bind({ address: target.address, port: 0 }, () => {
        try {
          socket.setBroadcast(true)
        } catch (err) {
          console.error(`[discovery] setBroadcast failed on ${target.address}:`, (err as Error).message)
        }
        const send = () => {
          if (finished) return
          for (const destination of new Set([target.broadcast, '255.255.255.255'])) {
            for (const port of ports) {
              socket.send(probe, port, destination, err => {
                if (err) console.error(`[discovery] probe to ${destination}:${port} failed:`, err.message)
              })
            }
          }
        }
        send()
        setTimeout(send, Math.floor(timeoutMs / 2)).unref()
        if (--pending === 0) setTimeout(finish, timeoutMs)
      })
    }
    // Safety net in case a bind callback never fires.
    setTimeout(finish, timeoutMs + 1000).unref()
  })
}

interface CommandOptions {
  timeoutMs?: number
  retries?: number
  port?: number
}

export class ClientCommandError extends Error {
  constructor(message: string, readonly kind: 'timeout' | 'rejected') {
    super(message)
  }
}

export type ClientCommandType = 'identify' | 'config' | 'transfer'

/**
 * Send a command (`identify`, `config` or `transfer`) to one client and wait for its ack.
 * Retries once by default (UDP may drop the first datagram).
 */
export async function sendClientCommand(
  ip: string,
  type: ClientCommandType,
  fields: Record<string, unknown>,
  options: CommandOptions = {},
): Promise<AckReply> {
  const timeoutMs = options.timeoutMs ?? 1500
  const retries = options.retries ?? 1
  const port = options.port ?? CLIENT_DISCOVERY_PORT

  for (let attempt = 0; attempt <= retries; attempt++) {
    const nonce = newNonce()
    const ts = Math.floor(Date.now() / 1000)
    const message: Record<string, unknown> = { v: PROTOCOL_VERSION, t: type, nonce, ts, ...fields }
    const ack = await sendOnce(ip, port, Buffer.from(JSON.stringify(message)), nonce, timeoutMs)
    if (ack) {
      if (!ack.ok) throw new ClientCommandError(ack.error || '클라이언트가 명령을 거부했습니다', 'rejected')
      return ack
    }
  }
  throw new ClientCommandError('클라이언트가 응답하지 않습니다', 'timeout')
}

function sendOnce(ip: string, port: number, payload: Buffer, nonce: string, timeoutMs: number): Promise<AckReply | null> {
  return new Promise(resolve => {
    const socket = dgram.createSocket('udp4')
    let done = false
    const finish = (ack: AckReply | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { socket.close() } catch { /* already closed */ }
      resolve(ack)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    socket.on('error', err => {
      console.error(`[discovery] command to ${ip} failed:`, err.message)
      finish(null)
    })
    socket.on('message', (raw, source) => {
      if (source.address !== ip || source.port !== port || raw.length > MAX_DATAGRAM) return
      const ack = parseAck(raw, nonce)
      if (ack) finish(ack)
    })
    socket.send(payload, port, ip, err => {
      if (err) finish(null)
    })
  })
}
