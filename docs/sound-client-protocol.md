# Sound Client Discovery Protocol (v1)

Shared contract between 통합알람감시체계 (server, `tms-portable`) and the Tauri
sound client (`sound-client`). Both sides must follow this file exactly.

## Transport

- UDP, IPv4 only. One JSON object per datagram, UTF-8, no framing, max 1200 bytes.
- The client binds **UDP port 7790** on all interfaces (`0.0.0.0:7790`).
- The server never binds a fixed port. It opens an ephemeral socket per
  operation and receives replies on it.
- Discovery is **server-initiated and on-demand only**. Clients never broadcast
  and never announce themselves periodically.
- Every message carries `v: 1` and `t: <type>`. Unknown `t` or wrong `v` is ignored.

## Messages

### `probe` (server -> subnet broadcast :7790)

```json
{ "v": 1, "t": "probe", "nonce": "9f2c1a..." }
```

`nonce` is 16 random hex chars. The server sends the probe to the directed
broadcast address of each non-loopback IPv4 interface (and to
`255.255.255.255`). It sends at most two probes per scan and listens ~2 s.

### `here` (client -> unicast back to the probe's source ip:port)

```json
{
  "v": 1, "t": "here", "nonce": "9f2c1a...",
  "id": "6d0c0a1e-...",          // stable UUID generated on first run, stored in settings
  "name": "1레이더 LCMS PC",      // operator-entered 장비명 ("" if not set yet)
  "host": "RADAR1-PC",           // Windows computer name
  "ver": "3.1.0",                // client version
  "mac": "AA:BB:CC:DD:EE:FF",    // MAC of the interface used to reply ("" if unknown)
  "target": { "ip": "192.168.0.10", "port": 6100 },   // current send target or null
  "muted": false,                // current system mute state
  "sound": false,                // sound currently detected
  "uptimeSec": 1234
}
```

The client replies immediately (no delay) with a single datagram. The server
dedupes by `id`, records the reply's source address as the client IP, and
records the local address of the socket that received it as `serverIp`.

### `identify` (server -> client ip:7790)

```json
{ "v": 1, "t": "identify", "nonce": "...", "ts": 1757600000, "sec": 5 }
```

The client must react so an operator standing at the PC can tell it is this
machine: bring the window to front, flash the taskbar entry, show a full-window
banner ("이 PC를 확인 중입니다") for `sec` seconds, and play a short beep.
It replies with `ack`.

### `config` (server -> client ip:7790)

```json
{
  "v": 1, "t": "config", "nonce": "...", "ts": 1757600000,
  "target": { "ip": "192.168.0.10", "port": 6100 },
  "on": "SOUND", "off": "SILENCE", "intervalMs": 5000,
  "name": "1레이더 LCMS PC"      // optional; when present the client overwrites its 장비명
}
```

The client persists target, on/off payloads, interval and (if present) name,
applies them immediately, and replies with `ack`.

### `ack` (client -> server, unicast to the command's source ip:port)

```json
{ "v": 1, "t": "ack", "nonce": "...", "ok": true, "id": "6d0c0a1e-...", "error": "" }
```

`nonce` echoes the command. `ok: false` with `error` when the command was
rejected (invalid payload).

## Token-free commands (SoundSense 3.1.0 and later)

All messages operate without authentication tokens or signatures. The server
does not send `sig`; `ts` is optional informational metadata. The client validates
the protocol version and configuration payload and echoes the request nonce.
Legacy `sig` fields are ignored, keeping the v1 message format compatible.

The client removes the retired `token` field from existing settings on startup,
preserving its identity, target and audio settings. The server removes the retired
`clientToken` setting and excludes it from settings responses and backup restores.
Clients older than 3.1.0 that still require a token must be replaced with the new
client before provisioning from a token-free server.

## Data path (unchanged from soundsense)

After provisioning, the client sends the plain UTF-8 string `on` while sound is
detected and `off` otherwise to `target.ip:target.port` over UDP:

- immediately on every state change, and
- every `intervalMs` (default 5000) as a heartbeat regardless of state.

On the server this maps to a `System` of type `equipment`, protocol `udp`,
encoding `utf8`, `normalPatterns = [off]`, `criticalPatterns = [on]`. The
periodic heartbeat is what drives the server's existing offline detection.

Sound detection semantics (from soundsense): peak amplitude above the
threshold (default 0.01) => `on`; `off` only after `silenceMs` (default 3000)
of continuous silence.

## Server-side storage

The selected client is stored inside `System.config` JSON:

```json
{
  "normalPatterns": ["SILENCE"], "criticalPatterns": ["SOUND"], "matchMode": "exact",
  "client": { "id": "6d0c0a1e-...", "name": "1레이더 LCMS PC", "host": "RADAR1-PC",
              "mac": "AA:BB:...", "ip": "192.168.0.21", "ver": "3.1.0",
              "provisionedAt": "2026-09-12T03:00:00.000Z" }
}
```

## Firewall

- Client: inbound UDP 7790 must be allowed (the client registers a rule via
  `netsh advfirewall` on first run, elevating once if needed).
- Server: no new inbound rule. Replies to the server's ephemeral socket are
  allowed by Windows stateful UDP filtering.
