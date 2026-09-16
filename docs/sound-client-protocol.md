# Sound Client Discovery Protocol (v1)

Shared contract between 통합알람감시체계 (server, `tms-portable`) and the Tauri
clients (`sound-client`, `ping-client`). All implementations follow this file.

## Transport

- UDP, IPv4 only. One JSON object per datagram, UTF-8, no framing, max 1200 bytes.
- SoundSense binds **UDP 7790**; 네트워크 ping 감시 binds **UDP 7791** on all IPv4 interfaces.
- The server probes both ports during the same on-demand scan. The two clients may coexist on one PC with independent UUIDs, settings and server data ports.
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

### `transfer` (server -> client ip:7790, SoundSense 3.2.0 and later)

```json
{
  "v": 1, "t": "transfer", "nonce": "...", "ts": 1757600000,
  "job": "5f1c0d2e9a7b4c31",                                       // server job id
  "url": "http://192.168.0.10:7777/api/transfers/files/0123456789abcdef",
  "report": "http://192.168.0.10:7777/api/transfers/5f1c0d2e9a7b4c31/report",
  "name": "ahnlabengine_setup260819.exe",  // file name to save under (base name only)
  "size": 303182776,                       // exact byte count
  "sha256": "9f2c...",                     // lowercase hex digest of the file
  "run": true,                             // run the file after download (exe/msi only)
  "args": "/S",                            // command line for `run` ("" = none)
  "elevate": true                          // run with the `runas` verb (UAC prompt)
}
```

The server never pushes bytes over UDP. It stages the file and the client
**pulls** it over plain HTTP from `url` (this server's web port, reachable from
every PC that can open the dashboard). The client validates the payload (http
URL, safe base name, size 1 byte – 2 GB, 64 hex sha256, single-line `args` up
to 200 chars, `run` only for `.exe`/`.msi`) and replies with `ack` at once:
`ok: true` means the download started in the background, `ok: false` with
`error` when the payload is invalid or another transfer is still running.

The client saves the file as `received/<name>` next to its settings file
(`received/<name>.part` while downloading; the two newest received files are
kept), verifies `size` and `sha256`, and when `run` is set launches the file
through `ShellExecuteEx` (`msiexec /i <file> <args>` for msi; verb `runas`
when `elevate`, so a `requireAdministrator` installer such as the AhnLab V3
engine setup shows its UAC prompt on that PC) and waits for it to exit.
Nothing is executed when verification fails.

Progress goes back over HTTP as JSON `POST`s to `report`, at most once per
second while downloading and on every phase change:

```json
{ "id": "6d0c0a1e-...", "phase": "downloading", "received": 1048576, "total": 303182776,
  "message": "", "exitCode": null }
```

`phase` is one of `downloading`, `verifying`, `running`, `done`, `error`.
`exitCode` carries the installer's exit code with the final `done` report of a
run (null for a plain file transfer). Report failures are logged only; the
server marks a target that stops reporting as stalled (60 s before the first
report, 3 min while downloading, 30 min while running).

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

## File transfer / V3 auto-install (server side)

The header's 파일 전송 icon opens a dialog that uploads a file from the
operator's PC (`POST /api/transfers/files?name=` with the raw body, streamed to
`TRANSFERS_DIR`, one staged file at a time), scans for SoundSense clients and
sends `transfer` to the selected ones (`POST /api/transfers`). Only sound
clients of version 3.2.0 or later are selectable; ping clients ignore the
command. Jobs are kept in memory (`GET /api/transfers`, `GET /api/transfers/<id>`)
and reports arrive at `POST /api/transfers/<id>/report`. Selecting an
`.exe`/`.msi` turns on 자동 실행 with `/S` (NSIS silent) or `/qn` (msi) by
default, which is what the AhnLab V3 engine setup needs.

## Server-side storage

When SoundSense runs on the server PC, the server app's own alarm playback can
be detected again and keep the sound alarm active. Turn off **서버 PC 알람 소리**
under **설정 → 서버 알람 소리** to suppress automatic alarm playback in the
installed server app. The persistent `serverAudioEnabled` setting defaults to
enabled; it is independent of global mute (`audioEnabled` / `muteEndTime`).
Detection, alarm status/history and external sirens are unchanged. Web browsers
continue to play alarms under the existing mute rules, including browsers opened
on the server PC. Manual audio previews are unaffected.

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

## Network ping client extension (1.0.0)

The ping client uses the same v1 `probe`, `identify`, `config`, and `ack` messages at UDP 7791. Token-free behavior is identical. Its `here` adds `kind: "ping"`, `discoveryPort: 7791`, `running: boolean`, and `alarm: boolean|null`. `sound` remains false; `muted` describes the local alarm mute setting. Missing `kind` continues to mean SoundSense at UDP 7790.

The server stores optional `kind`, `discoveryPort`, and the receiving interface's `serverIp` in `System.config.client`. Identify and provision APIs accept `discoveryPort` (only 7790/7791; omitted means 7790). The chosen server interface is forwarded when provisioning. Data ports come from the existing shared free range 6100–6199; the client's old destination port is not reused blindly.

Ping provisioning stores `target.ip`, `target.port`, `on`, `off`, `intervalMs`, and optional `name` while preserving local targets/topology. Defaults are `on: "PING_FAIL"`, `off: "PING_OK"`, heartbeat 5000ms. `target: null` disconnects. Invalid settings return a negative acknowledgement and leave the current settings unchanged.

An active target becomes failed after its configured consecutive failure count (default 1). Any confirmed failure yields `on`; `off` requires successful measurements for all active targets. No active targets, stopped monitoring or pending first measurements produce no normal heartbeat. The server's ordinary offline detection therefore remains effective. State changes send immediately (within the 250ms sender tick); otherwise a heartbeat repeats at the provisioned interval. Persisted targets and server settings resume when the application starts with automatic monitoring enabled.

The ping client registers its own inbound UDP 7791 firewall rule. It does not open the SoundSense port. PC identification shows the window, requests taskbar attention, displays the Korean banner and beeps, then acknowledges.
