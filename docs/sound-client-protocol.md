# Sound Client Discovery Protocol (v1)

Shared contract between 통합알람감시체계 (server, `tms-portable`) and the Tauri
clients (`sound-client`, `ping-client`, `ups-client`). All implementations follow this file.

## Transport

- UDP, IPv4 only. One JSON object per datagram, UTF-8, no framing, max 1200 bytes.
- SoundSense binds **UDP 7790**; 네트워크 ping 감시 binds **UDP 7791**; 2026 1레이더 UPS binds **UDP 7792** on all IPv4 interfaces.
- The server probes all three ports during the same on-demand scan. The clients may coexist on one PC with independent UUIDs, settings and server data ports.
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

### `transfer` (server -> client ip:7790 / 7791; SoundSense 3.2.0+, ping 1.1.0+)

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
  "elevate": true                          // run with the `runas` verb (UAC prompt)
}
```

The server never pushes bytes over UDP. It stages the file and the client
**pulls** it over plain HTTP from `url` (this server's web port, reachable from
every PC that can open the dashboard). The client validates the payload (http
URL, safe base name, size 1 byte – 2 GB, 64 hex sha256, `run` only for
`.exe`/`.msi`) and replies with `ack` at once:
`ok: true` means the download started in the background, `ok: false` with
`error` when the payload is invalid or another transfer is still running.

The client saves the file as `received/<name>` next to its settings file
(`received/<name>.part` while downloading; the two newest received files are
kept), verifies `size` and `sha256`, and when `run` is set launches the file
through `ShellExecuteEx` with its window shown normally (`msiexec /i <file>`
for msi; verb `runas` when `elevate`, so a `requireAdministrator` installer
such as the AhnLab V3 engine setup shows its UAC prompt on that PC). The
installer's own UI appears on the facility PC; the client waits for the
process to exit and reports the exit code. No silent-install switches are
passed. Nothing is executed when verification fails.

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
`.exe`/`.msi` turns on 자동 실행; the installer then runs visibly on each
facility PC. Any number of PCs (up to 50 per job) can be selected at once and
each pulls the file independently. Both clients implement the same `transfer`
handling (SoundSense at UDP 7790, 네트워크 ping 감시 at UDP 7791, files under
each program's `received/` folder).

## Ping failure events (네트워크 ping 감시 1.1.0 and later)

The ping client shares its 장애 발생 / 정상 복구 history with the server so a
`PING_FAIL` alarm can say which monitored target failed. Events go over HTTP,
not UDP: the client posts to `http://<target.ip>:<httpPort>/api/ping-events`
where `target.ip` is the provisioned UDP server and `httpPort` comes from the
`config` command (new optional field, default 7777):

```json
{
  "id": "6d0c0a1e-...", "name": "1레이더 네트워크", "host": "RADAR1-PC",
  "events": [
    { "at": 1758000000000, "name": "1레이더 스위치", "address": "192.168.0.5",
      "status": "장애 발생", "rttMs": null, "sent": 10, "lost": 3,
      "consecutiveFailures": 3, "timeoutMs": 1000, "failureThreshold": 3 }
  ]
}
```

- The client queues every transition immediately, batches up to 200 events per
  POST, retries every 15 s on failure, and re-sends its recent history (up to
  100 events) after each server (re)provisioning. Nothing is sent while no
  server is provisioned.
- The server dedupes on `(client id, address, at, status)`, binds events to the
  facility whose `config.client.id` matches, keeps 90 days, and writes a
  summary of the targets still failed ("1레이더 스위치 192.168.0.5 응답 없음
  (3회 연속)") into the open critical alarm's value so the dashboard alarm
  card shows it. If the UDP `PING_FAIL` arrives before the HTTP report, the
  worker attaches the summary when the report lands (`alarm` WebSocket message
  with `valueOnly`). The facility detail page lists the events
  (`GET /api/ping-events?systemId=`).

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

## UPS client extension (2026 1레이더 UPS 1.0.0)

The UPS client (`ups-client/`, `tms-ups-monitor.exe`) polls the two UPS cards of 김포
제1레이더 over SNMP v2c (RFC 1628 UPS-MIB, same OIDs and value scaling as the original
snmpups program) and forwards each poll to the server. It uses the same v1 `probe`,
`identify`, `config`, `ack` and `transfer` messages at **UDP 7792**; the firewall rule is
"TMS UPS Monitor Discovery". Files received through `transfer` go to `received/` next to
`ups-settings.json` (exe folder, or `%APPDATA%/tms-ups-monitor/`).

`here` adds `kind: "ups"`, `discoveryPort: 7792` and one entry per UPS card:

```json
"units": [
  { "unit": 1, "target": { "ip": "192.168.0.10", "port": 6102 }, "alarm": false, "reachable": true, "muted": false, "ups": "192.168.0.99" },
  { "unit": 2, "target": null, "alarm": null, "reachable": null, "muted": false, "ups": "192.168.0.98" }
]
```

`target` mirrors unit 1 for readers of the base protocol; `alarm` is the summary
(`true` when any unit is in alarm, `false` when every unit answered and is healthy, `null`
while stopped or before the first reply). A unit's `alarm` follows the same rule for that
card alone.

`config` binds **one** UPS card to one server facility and carries no `on`/`off`:

```json
{ "v": 1, "t": "config", "nonce": "...", "target": { "ip": "192.168.0.10", "port": 6102 },
  "unit": 2, "intervalMs": 5000, "httpPort": 7777, "name": "1레이더 UPS PC" }
```

`unit` (1 or 2) is required; `target: null` unbinds that card. `intervalMs` maps onto the
card's poll period (readings are forwarded once per poll, so it also acts as the
heartbeat). The other card's binding and the local SNMP settings are untouched.

### Data path

After each poll the client sends the reading as UTF-8 JSON to the bound card's
`target.ip:target.port`, exactly like the original program:

```json
{ "UPS": 2, "Data": { "출력 상태": "정상", "입력 전압 (V)": "220 V", "출력 전압 (V)": "221 V",
  "입력 주파수 (Hz)": "60.0 Hz", "출력 주파수 (Hz)": "59.9 Hz", "배터리 상태": "정상",
  "배터리 전압 (V)": "13.50 V", "배터리 잔량 (%)": "100.0 %", "배터리 온도 (°C)": "28°C" } }
```

Values are the formatted display strings; `"No Data"` marks parameters the UPS did not
answer (or the whole set when the UPS is unreachable, so the server still sees the
heartbeat). UPS#1 has 24 keys (3-phase R/S/T input voltage/current/power, output
voltage/current/load, frequencies, output/battery status, battery voltage/charge);
UPS#2 has 9 keys.

On the server this is a `System` of type `ups`, protocol `udp`, encoding `utf8`, whose
`config` holds the auto-generated parser and display items from
`src/lib/ups-client-preset.ts` (thresholds = the client's default limits, status items
alarm when the text is not 정상) plus
`client: { kind: "ups", unit: 2, discoveryPort: 7792, id, name, host, ip, ... }`. The
UPS add/edit pages offer 자동 탐지 (PC) with a UPS#1/UPS#2 selector; saving the facility
sends `config` with that unit.

## PC 음소거 자동 해제 (all three clients)

The SoundSense feature that watches the Windows default render endpoint (mute popup
near the tray, countdown badge on the tray icon, auto-unmute + 100% volume when the
countdown ends) is also built into 네트워크 ping 감시 1.2.0+ and the UPS client
(`pcmute.rs`, `mute.html`; same behaviour, default duration `unmute_minutes` in each
client's settings, editable in its 경보 dialog). It never touches the discovery protocol.
