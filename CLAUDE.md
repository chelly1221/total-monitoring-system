# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tms-portable** — 통합알람감시체계 (Unified Alarm Monitoring System)의 Windows 데스크톱 앱. [unified-monitoring](https://github.com/chelly1221/unified-monitoring) 프로젝트를 Tauri v2로 패키징하여 단일 EXE로 배포한다.

### 아키텍처

Tauri 앱이 두 개의 Node.js 자식 프로세스를 spawn하고, WebView가 localhost를 로드한다:

```
Tauri (Rust) — tms-portable.exe
├── WebView → 스플래시(번들 splash/index.html) → http://localhost:7777
│             (스플래시가 서버 준비를 폴링 후 자동 전환, Rust 측 TCP 폴링은 fallback)
├── spawns: node resources/standalone/server.js  (Next.js 서버)
└── spawns: node resources/worker/index.js       (데이터 수집기)
```

| 프로세스 | 포트 | 역할 |
|----------|------|------|
| Next.js Server | 7777 | 웹 UI + REST API |
| Worker | 7778 | UDP/TCP 데이터 수집, 알람 처리, WebSocket 브로드캐스트 |

앱 종료 시 `kill_on_drop` + `WindowEvent::Destroyed` 핸들러로 자식 프로세스 자동 정리.

## 개발 환경 (WSL + Windows)

코드 편집은 WSL에서 하지만, **Tauri 빌드와 실행은 반드시 Windows 측 도구를 사용**해야 한다. WSL의 Linux 바이너리로는 Windows exe를 빌드할 수 없다.

| 용도 | WSL 명령 | 비고 |
|------|----------|------|
| Rust 빌드 | `cargo.exe` | Windows 측 Rust toolchain 사용 |
| Node.js 실행 | `node.exe` | Windows 측 Node.js (nvm4w) 사용 |
| npm 실행 | `node.exe -e "require('child_process').execSync('npm ...', {stdio:'inherit', cwd:'C:\\\\...'})"` | WSL의 `npm.cmd`는 쉘 호환 문제로 실패함 |
| Tauri CLI | `cargo.exe tauri ...` | `cargo install tauri-cli --version "^2"` 로 설치 |

**주의사항:**
- WSL 경로(`/mnt/c/...`)와 Windows 경로(`C:\...`)를 혼용하지 않도록 주의
- `cargo.exe`는 Windows 경로로 자동 변환됨
- `npm.cmd`는 WSL에서 직접 호출 시 실패 — `node.exe`를 통해 간접 호출

## Essential Commands

```bash
# 최초 설정 (빌드 전 필수)
echo 'DATABASE_URL="file:./dev.db"' > .env
node.exe -e "require('child_process').execSync('npx prisma db push', {stdio:'inherit', cwd:'C:\\\\code\\\\tms\\\\tms-portable'})"

# 프로덕션 빌드 (Windows 측 도구)
node.exe scripts/build-standalone.js   # 프론트엔드 + 리소스 빌드
cargo.exe tauri build                  # Tauri EXE + NSIS 인스톨러

# 개발 모드
npm run dev              # Next.js 개발 서버 (포트 7777)
npm run worker:dev       # Worker (별도 터미널)
cargo.exe tauri dev      # Tauri 앱 (dev server에 연결)

# 데이터베이스
npx prisma db push       # 스키마 동기화
npx tsx prisma/seed.ts   # 시드 데이터
```

## Build Pipeline

`cargo.exe tauri build` 실행 시:

1. `beforeBuildCommand` → `npm run tauri:build-frontend` → `node scripts/build-standalone.js`
   - `next build` (output: 'standalone')
   - standalone server + static + public → `src-tauri/resources/standalone/`
   - worker → esbuild 번들 → `src-tauri/resources/worker/index.js`
   - prisma schema + generated client → `src-tauri/resources/`
2. Rust 릴리즈 빌드 → `src-tauri/target/release/tms-portable.exe`
3. NSIS 인스톨러 → `src-tauri/target/release/bundle/nsis/TMS Portable_x.x.x_x64-setup.exe`

**빌드 전 필수 조건:**
- `.env` 파일에 `DATABASE_URL="file:./dev.db"` 설정 (Prisma가 빌드 시점에 DB 접근)
- `npx prisma db push` 로 DB 스키마 적용

## Project Structure

```
tms-portable/
├── src/                          # Next.js 소스
│   ├── app/                      # App Router
│   │   ├── (dashboard)/          # 대시보드 페이지
│   │   │   ├── alarms/           # 알람 이력 (필터링)
│   │   │   ├── settings/         # 기능 토글, 오디오, 사이렌 설정
│   │   │   ├── systems/          # 장비 CRUD 및 상세
│   │   │   ├── ups/              # UPS CRUD 및 상세
│   │   │   └── temperature/      # 센서 감시
│   │   └── api/                  # REST API 라우트
│   ├── components/
│   │   ├── realtime/             # WebSocket 기반 실시간 컴포넌트
│   │   ├── forms/                # 시스템 설정 폼
│   │   ├── alarms/               # 알람 표시 및 필터링
│   │   ├── charts/               # uPlot 차트 래퍼
│   │   ├── layout/               # 사이드바, 헤더
│   │   └── ui/                   # shadcn/ui 기본 컴포넌트
│   ├── hooks/                    # React 훅
│   ├── lib/                      # 유틸리티
│   ├── types/                    # TypeScript 인터페이스
│   └── worker/                   # 데이터 수집 프로세스
│       ├── config.ts             # UDP/TCP 포트 설정
│       ├── db-updater.ts         # 데이터 처리, 알람, 스파이크 필터
│       ├── index.ts              # Worker 진입점
│       ├── siren-trigger.ts      # 물리 사이렌 제어
│       ├── tcp-listener.ts       # TCP 리스너
│       ├── udp-listener.ts       # UDP 리스너
│       └── websocket-server.ts   # WebSocket 브로드캐스트 서버
├── src-tauri/                    # Tauri (Rust)
│   ├── src/
│   │   ├── main.rs               # Windows 진입점 (windows_subsystem = "windows")
│   │   └── lib.rs                # 앱 로직: spawn_server, spawn_worker, kill_processes
│   ├── capabilities/default.json # Tauri 권한
│   ├── icons/                    # 앱 아이콘 (favicon.ico에서 생성)
│   ├── resources/                # (빌드 시 생성, gitignore)
│   ├── Cargo.toml                # tauri v2, tokio, serde
│   └── tauri.conf.json           # 윈도우 1920x1080, NSIS, resources 번들
├── scripts/
│   └── build-standalone.js       # Next.js standalone + worker 패키징
├── prisma/                       # DB 스키마 + 마이그레이션
├── splash/index.html             # 부팅 스플래시 (frontendDist) — 서버 폴링 + 프로그레스바
├── next.config.ts                # output: 'standalone'
└── package.json                  # tauri:dev, tauri:build, tauri:build-frontend
```

## Tauri 핵심 파일

- **`src-tauri/src/lib.rs`** — 자식 프로세스 supervise(재시작 + backoff), Job Object로 강제 정리. `setup()`에서 포트 7777 TCP 폴링 → 스플래시가 전환 실패 시 fallback으로 앱 전환.
- **`splash/index.html`** — 부팅 로딩 화면 (레이더 애니메이션 + 프로그레스바). no-cors fetch로 서버 준비 폴링 → `location.replace`로 앱 전환. 60초 초과 시 지연 경고 표시.
- **`src-tauri/tauri.conf.json`** — 메인 윈도우는 `url: "/"`로 스플래시(`frontendDist: "../splash"`) 먼저 로드, `withGlobalTauri: true` (스플래시 닫기 버튼용), `csp: null`, NSIS `installMode: "currentUser"`, `resources: ["resources/"]`
- **`scripts/build-standalone.js`** — `execSync`으로 `next build` + `esbuild` 실행, `fs.cpSync`으로 리소스 복사

## Supported System Types

- **Equipment** (`equipment`): 레이더, FMS, LCMS, VDL, MARC, 전송로 — 패턴 기반 상태 감지
- **UPS** (`ups`): 무정전 전원장치 — 구분자/커스텀코드 파싱, 다중 메트릭 감시 (전압, 전류, 주파수, 배터리, 부하)
- **Sensor** (`sensor`): 온습도 — 조건 기반 임계값, 스파이크 필터 (MAD 기반)

## Database Schema (Prisma)

SQLite + Prisma ORM. `prisma/schema.prisma` 참조.

핵심 모델: `System`, `Metric`, `MetricHistory`, `Alarm`, `AlarmLog`, `Setting`, `Siren`

- **System** — `type: 'equipment'|'ups'|'sensor'`, `status: 'normal'|'warning'|'critical'|'offline'`, `config` (JSON), `audioConfig` (JSON)
- **Metric** → System (cascade delete), MetricHistory
- **MetricHistory** — 시계열 데이터 (25시간 보관)
- **Alarm** → System (cascade delete) — 활성 알람 + acknowledge 추적
- **AlarmLog** — 영구 알람 이력
- **Setting** — key-value 설정 (오디오, 기능 토글, 뮤트 타이머)
- **Siren** — 물리 사이렌 (ip, port, protocol, messageOn/messageOff)

## WebSocket Message Types

포트 7778. 타입: `metric`, `alarm`, `alarm-resolved`, `system`, `init`, `ping`, `delete`, `raw`, `siren-sync`, `settings`, `systems-changed`, `wing15`

## wing15 뇌전 감시 연동

2026-09-08 사용자 요청에 따라 자동 수집은 항공기상청 웹 자료, 현장 확인은 WING으로 분리했다. **WING 조회·로그인·기록은 확인 버튼 클릭 때만** 수행한다. 자동 폴링·화면 GET·체크리스트 PUT에서 WING에 접속하면 안 된다. 뇌전특보는 제공하지 않는다.

- **`src/lib/amo-lightning.ts`** — 항공기상청 낙뢰 화면의 공개 지도 요청 `https://www.weather.go.kr/wgis-nuri/lgt?date=&dateNum=144&interval=10`을 키·로그인 없이 조회. `baseDateList` 자료시각, `lgtList` 항목의 `date`(UTC), `lat`, `lon`, `type`을 검증. `type 1` 지상낙뢰만 사용하고 `type 2` 공중낙뢰 제외. 형식 오류·자료시각 25분 초과 지연은 오류로 처리. HTTP 500·502·503·504와 시간 초과·연결 실패는 첫 요청 실패 후 최대 5회 즉시 재시도(총 6회, 각 15초 제한)한다. 60초를 넘겨도 진행 중인 모든 시도를 하나의 요청으로 공유하며 성공하면 즉시 중단한다. Retry-After가 있는 HTTP 응답·4xx·자료 오류는 즉시 재시도하지 않는다. 최종 완료 시점부터 성공·실패 모두 60초 요청 제한을 적용한다.
- **`src/lib/lightning-rules.ts`** — WING 김포공항 기준 좌표 37.56, 126.8에서 Haversine 거리 계산 후 반올림 전 `<= 5km` 판정. 1시간 진행, 기본 24시간 이력 유지(`WING15_LOOKBACK_HOURS`, 최대 24). 좌표·시각으로 동일 낙뢰를 식별하고 기존 좌표 없는 이력은 반올림 거리로 연결.
- **`src/lib/wing15.ts`** — 로컬 이력 병합 `mergeStrikes`, 상태 계산 `buildWing15State`, 현장 확인 `confirmOnWing15`. 버튼 클릭 당시 검토한 미확인 낙뢰 모두가 WING `events`에 있어야 TX `inspection_status`를 기록하며, 재조회로 저장 여부까지 검증. 페이지 조회·분할 저장 지원. 해당 낙뢰 미반영 시 전체 확인 보류, 재시도 시 이미 저장된 항목은 유지.
- **`src/worker/wing15-monitor.ts`** — 시작 시 바로 수집하고 이후 항공기상청 웹 자료만 기본 600초마다 수집 (`WING15_POLL_INTERVAL`, 최소 600초). 즉시 재시도를 모두 소진하면 다음 정기 조회까지 기다리며 별도의 60초 재조회는 없다. 실패 시각·원인과 수신 복구를 로그에 남긴다. `wing15Strikes`에 낙뢰별 `confirmed`를 저장하고 기존 `wing15ConfirmedAt` 이력을 이관. 확인 중 들어온 새 낙뢰나 늦게 들어온 과거 낙뢰가 이전 확인 시각 때문에 확인 처리되지 않도록 명시적인 상태 유지. Setting 저장과 WS 브로드캐스트는 최신 점검 상태를 트랜잭션에서 다시 읽어 수행.
- **`src/app/api/wing15/`** — GET 상태 조회와 PUT `/checklist`는 로컬 DB만 사용. POST `/confirm`만 WING에 접속하고 성공한 대상만 로컬에 확인 저장. 미반영·진행 중·오래된 점검은 409, 통신·저장 실패는 500. 확인 중 수신한 낙뢰는 미확인으로 유지.
- **`src/components/wing15/lightning-alert-panel.tsx`** — 첫/마지막 낙뢰 시각(KST), 마지막 낙뢰 후 1시간 대기, 특별점검·유지보수일지 두 항목 유지. 자료시각 표시, 수신 오류·지연 시 확인 보류. 성공·실패 후 모두 로컬 상태 재조회.
- **ON/OFF**: 설정 > 기능 표시 설정 > "뇌전감시" 스위치 (Setting `wing15Enabled`, 기본 켜짐). OFF면 외부 조회를 건너뛰고(타이머 유지) 패널을 숨긴다. 설정 API가 `settings` WS 메시지로 패널 표시를 즉시 전파한다. ON/OFF는 정기 조회 주기를 앞당기지 않으며, 수집 여부는 다음 정기 조회에서 설정을 읽어 결정한다.
- **데모 모드**: `PUT /api/settings {"wing15Demo":"true"}` 설정 시 다음 폴링(기본 ≤10분)부터 가짜 경보 카드 표시 (`src/lib/wing15-demo.ts`, 실데이터 조회 없음). `"false"`로 해제. 앱이 꺼진 상태에서는 `npx tsx scripts/set-wing15-demo.ts [off]`로 앱 DB에 직접 설정

## PC 클라이언트 자동 탐지 (TMS SoundSense)

2026-09-12 추가. 별도 Tauri 앱 `sound-client/`(같은 저장소, 독립 빌드: `cd sound-client && npm run build && cargo tauri build --no-bundle && npm run package`)(TMS SoundSense: 시스템 오디오 감지 + 자동 뮤트 해제)를 시설로 등록할 때 서버가 같은 서브넷의 PC를 자동 탐지한다. 와이어 계약은 **`docs/sound-client-protocol.md`** 하나로 관리하며 서버·클라이언트 양쪽이 이 파일을 따른다.

- **프로토콜**: 서버 주도 온디맨드 UDP. 서버가 인터페이스별 directed broadcast로 `probe`를 보내고(검색당 최대 2회, 약 2초 수집), 클라이언트(UDP 7790)가 유니캐스트 `here`로 응답. 같은 소켓 채널로 `identify`(PC 확인)와 `config`(서버 주소·페이로드 푸시)를 보내고 `ack`를 받는다. 클라이언트는 절대 브로드캐스트하거나 주기 광고하지 않는다. mDNS는 Windows 내장 응답기와의 5353 충돌 때문에 쓰지 않는다.
- **`src/lib/client-discovery.ts`** — `discoverClients`, `sendClientCommand`, 순수 헬퍼(`computeBroadcast`, `parseHereReply`, `suggestSoundClientPort`). 2026-09-13부터 서버·클라이언트 모두 토큰과 서명 없이 탐지·확인·설정 전송을 수행한다. SoundSense 3.1.0은 기존 설정 파일의 토큰을 자동 제거한다. 자동 배정 포트 범위 6100~6199(기본 포트 테이블·등록 시설 제외).
- **API**: `GET /api/discovery/clients`(스캔 + 등록 여부 + 추천 포트), `POST /api/discovery/identify {ip}`, `POST /api/discovery/provision {ip, port, on, off, name?}`. 응답 없음은 504, 클라이언트 거부는 409.
- **UI**: 장비상태(equipment) 시설 추가/수정의 기본정보 바 아래 `SoundClientSection`(등록 방식 수동/자동, 연결된 PC, PC 확인, 다른 PC 선택, 연결 해제) + `ClientDiscoveryPanel`(탐지 목록, 행별 PC 확인·선택). PC 선택 시 시설명=클라이언트 장비명(없으면 PC 이름), UDP, UTF-8, 포트 자동, 패턴 `SILENCE`/`SOUND`. 저장 성공 후 `provision`을 보내고 성공하면 `config.client.provisionedAt`을 PATCH한다. 전송 실패는 토스트 경고만 하고 시설 저장은 유지한다.
- **저장 위치**: 스키마 변경 없음. `System.config` JSON의 `client: { id, name, host, ip, mac, ver, provisionedAt }`. `validateSystemBody`가 `client.id`/`client.ip`를 검증한다.
- **데이터 경로**: 클라이언트가 상태 변화 시 + 5초 하트비트로 `SOUND`/`SILENCE`를 보내므로 기존 오프라인 감지가 그대로 동작한다. 장비(equipment) 시설의 심각 판정은 **기본 1회**(첫 심각 메시지에 바로 알람)다. 2026-09-12까지 워커가 일괄로 "3회 연속"을 요구해 5초 하트비트 클라이언트는 약 10초 늦었는데, 사용자 확인 결과 1레이더 LCMS만 아날로그 탐지장비이고 나머지는 전부 프로그램식 송신이라 일괄 필터는 부적절했다. 횟수는 시설별 `config.criticalConfirmations`(1~10, 장비 추가/수정 폼의 "심각 판정 연속 횟수")로만 올리고, 비어 있으면 `src/lib/equipment-alarm.ts`의 `DEFAULT_CRITICAL_CONFIRMATIONS`(1)를 쓴다. 1레이더 LCMS는 폼에서 3으로 지정한다. UPS/센서 metric 경로의 `CRITICAL_THRESHOLD`(3, `db-updater.ts`)는 스파이크 방지용으로 별개다. 짧은 소음까지 알람이 되는 것이 문제면 클라이언트 쪽에 최소 지속 시간(attack) 설정을 넣는다.
- **설정 화면**: `SettingsWorkspace`의 한 화면 정리형. 검토안처럼 기능은 세로 목록, 사이렌은 장비·사용 여부·관리의 3열 표, 양쪽 영역은 세로 구분선으로 정리한다. 설정 영역에 Pretendard를 직접 적용하고 본문 17~18px·설명 14~15px·제목 24px·입력 높이 38px의 밀집형 규격을 사용한다. 왼쪽은 기능 표시·게이트 연결·데이터 관리, 오른쪽은 알람 사이렌 전용이다. 사이렌 목록은 가용 높이를 넘을 때만 내부 스크롤되며 제목과 추가 버튼은 고정된다. 연결 정보는 입력 종료 500ms 후 또는 포커스 이동 시 자동 저장하며 프로토콜·이력 용량 선택은 즉시 저장한다. 저장 큐는 요청을 직렬화하고 최신 입력만 반영하며 실패 시 자동 재시도한다. 유효하지 않은 연결은 저장하지 않고 미저장 상태의 게이트 테스트는 비활성화한다. PC 클라이언트 토큰 설정은 제거했고, 서버 시작 시 기존 키를 삭제하며 API·백업 복원으로 다시 저장하지 않는다.
- **방화벽**: 서버는 새 인바운드 규칙이 필요 없다(응답은 상태 추적 UDP로 허용). 클라이언트는 UDP 7790 인바운드를 스스로 등록한다.
- **테스트**: `tests/discovery.test.ts`가 루프백 가짜 클라이언트로 탐지·토큰 없는 확인/설정 전송·거부·타임아웃을 검증한다. Rust 테스트는 기존 설정의 토큰 제거와 무서명 설정 전송의 입력값 검증을 확인한다.

## 두 번째 클라이언트: 네트워크 ping 감시

2026-09-13 추가. `ping-client/`는 `chelly1221/network-surveillance`의 ICMP·토폴로지·경보·Npcap 기능을 Rust/Tauri 2로 이관한 별도 앱이다. 이름은 **네트워크 ping 감시**, 실행 파일 `tms-ping-monitor.exe`, 기본 배포 파일 `tms-ping-monitor-setup.exe` (한국어 NSIS). 포터블 ZIP도 별도로 생성할 수 있다. 원본 커밋과 이관 범위는 `ping-client/NOTICE.md`에 기록한다.

- 자동 연결은 `docs/sound-client-protocol.md`의 v1 메시지를 사용한다. 음성탐지기 UDP 7790, ping 감시 UDP 7791로 분리하여 같은 PC에서 동시 실행한다. 서버가 두 포트를 온디맨드 검색하고 `kind`, `discoveryPort`, `serverIp`를 시설 `config.client`에 보존한다. ping 기본 패턴은 `PING_OK`/`PING_FAIL`, 데이터 포트 범위는 기존 6100~6199를 공유한다.
- 감시 대상 최대 20개, Windows ICMP API, RTT·손실률·최근 60회 그래프, 1~10회 연속 실패 판정, 최근 100건 장애/복구 영속 이력. 정지/미측정 시 정상 하트비트를 보내지 않는다. 설정 변경 시 세대 번호로 이전 감시 결과를 무효화한다.
- `ping-client/src-tauri/src/capture.rs`는 시스템 Npcap DLL만 선택적으로 로드하며 Ethernet IPv4·VLAN·ASTERIX를 해석한다. Npcap 미설치 PC에서도 ping·자동 연결은 동작한다. 로컬 캡처 실제 검증은 Npcap 설치 환경이 필요하다.
- `ping-settings.json`·`ping-history.json`은 EXE 옆 또는 APPDATA에 저장한다. `MoveFileExW`로 원자적 교체. 기존 PingTester 설정 가져오기는 감시 대상·토폴로지 등을 가져오고 새 앱 식별자와 서버 연결은 유지한다.
- 빌드: `cd ping-client && npm ci && npm run build && npm test && npm run tauri:build && npm run smoke && npm run package`. `smoke`는 실제 EXE와 격리 설정으로 UDP 연결·재시작·장애를 검증하며 방화벽/자동 시작 등록을 건너뛴다. `npm run smoke:setup`은 별도 경로에 Setup 설치·재설치·EXE 실행·제거와 설정 보존을 검증한다. 두 클라이언트를 먼저 빌드한 뒤 서버의 `npm run tauri:build`를 실행하면 음성 ZIP과 Ping Setup·버전이 포함된다.
- Setup은 사용자 요청에 따라 폐쇄망용 한 종류만 생성한다. Npcap 공식 설치 파일과 WebView2를 내장하며 설치 PC에서 다운로드하지 않는다. `windows/hooks.nsh`와 `install-network.ps1`로 방화벽·Npcap을 준비한다. 빌드 시 해시·전자서명을 확인하고 설치 시 고정 해시로 오프라인 검증한다. 무료판은 조직 내 최대 5대의 내부 사용용이며 Npcap 자체 약관 마법사를 연다. OEM 빌드는 `TMS_NPCAP_OEM_INSTALLER`에 적절한 내부 사용 라이선스의 설치 파일 경로를 지정한다. 드라이버 바이너리는 Git에 넣지 않는다. `/SKIPNETWORK`는 네트워크 구성 요소가 별도로 준비된 PC와 격리 설치 검증용이다.

## 파일 전송 · V3 자동설치 (헤더 아이콘)

2026-09-16 추가. 헤더의 모니터 업로드 아이콘(`src/components/layout/transfer-dialog.tsx`)을 누르면 이 PC의 파일을 골라 음성탐지기(SoundSense 3.2.0+)가 실행 중인 시설 PC들(한 작업당 최대 50대, 각 PC가 독립적으로 내려받음)로 보내고, exe/msi면 받은 뒤 자동 실행한다. 사용자 요청으로 실행 인수(무음 설치 `/S`) 기능은 두지 않는다. 설치 프로그램 창이 시설 PC 화면에 그대로 뜨고, 프로세스가 끝나면 종료 코드로 완료를 보고한다. 와이어 계약은 `docs/sound-client-protocol.md`의 `transfer` 절이다.

- **흐름**: 대화상자에서 파일을 고르면 `POST /api/transfers/files?name=`으로 원본 바디를 스트리밍 업로드(`TRANSFERS_DIR`, 데스크톱 앱은 데이터 폴더 `transfers/`, 개발은 OS 임시 폴더; 진행 중인 작업이 쓰지 않는 이전 파일은 삭제). 이어 `POST /api/transfers {fileId, run, elevate, targets}`가 각 대상에 UDP `transfer` 명령을 보내고, 클라이언트가 서버의 7777 HTTP에서 파일을 **끌어간 뒤** SHA-256 검증·실행하고 `POST /api/transfers/<id>/report`로 진행률을 올린다. 대화상자는 1초마다 `GET /api/transfers/<id>`를 폴링하며, 닫았다 열면 진행 중인 최신 작업을 이어서 보여준다.
- **코드**: 순수 규칙(`src/lib/transfer-rules.ts`: 파일명 정리, 실행 가능 판정, 버전 판정, 보고 적용, 정체 판정)은 브라우저 번들에서도 쓰므로 Node 모듈을 import하지 않는다. 저장소·스테이징은 `src/lib/transfers.ts`(메모리 작업 목록 최대 20개, `globalThis`에 보관). 대상 phase는 `pending → sent → downloading → verifying → running → done`, 실패는 `error`/`unreachable`(ack 없음)/`rejected`(클라이언트 거부: 잘못된 페이로드·다른 전송 진행 중). 보고가 끊기면 `expireStalledTargets`가 단계별 시간(sent 60초, 다운로드 3분, 실행 30분)으로 `error` 처리한다.
- **클라이언트**: `sound-client/src-tauri/src/transfer.rs`. `received/` 폴더(설정 파일 옆)에 `.part`로 받고 검증 후 이름 변경, 최신 3개만 보관. 실행은 `ShellExecuteExW`(창 표시 SW_SHOWNORMAL, `runas` 승격, msi는 `msiexec /i`)로 인수 없이 띄우고 종료까지 대기해 종료 코드를 보고한다. 시설 PC의 UAC 확인이 켜져 있으면 그 PC에서 승인해야 하며 취소 시 "관리자 권한 요청이 취소" 오류로 보고한다. 상태 탭 칩(`chip-transfer`)에 진행률·결과를 2분간 표시. reqwest(HTTP 전용, TLS 없음)·sha2는 이미 tauri 의존 트리에 있던 크레이트다.
- **테스트**: `tests/transfers.test.ts`(규칙, 스테이징·정리, 루프백 가짜 클라이언트로 `transfer` ack). Rust는 `transfer::tests`가 페이로드 검증을 확인한다. 실제 설치 검증은 Windows 시설 PC에서 V3 파일로 수행해야 한다.

## 클라이언트 프로그램 다운로드 메뉴

2026-09-12 추가. 헤더의 다운로드 아이콘(`src/components/layout/download-menu.tsx`)을 누르면 서버가 배포하는 클라이언트 프로그램 목록이 뜬다. 메뉴는 프로그램명과 버전만 한 줄에 표시하며 설명·파일명·용량·사용 안내는 표시하지 않는다. 브라우저에서는 항목이 `GET /api/downloads/<id>` 첨부 링크이고, 데스크톱 앱 안에서는 WebView2가 링크 다운로드를 조용히 처리해 아무 반응이 없어 보이므로 대신 Rust 명령 `save_download`를 호출한다. 이 명령은 `tauri-plugin-dialog`로 Windows "다른 이름으로 저장" 창을 띄우고(기본 위치는 다운로드 폴더) 고른 경로에 `resources/downloads/<file>`을 복사한다. 취소하면 `null`을 돌려주고 토스트를 띄우지 않는다.

- **카탈로그**: `src/lib/downloads.ts`의 `DOWNLOAD_ITEMS`. 새 프로그램은 여기에 `{ id, name, description, file }`을 추가하고 파일을 다운로드 폴더에 넣으면 메뉴에 나타난다(목록은 메뉴를 열 때마다 조회).
- **파일 위치**: `DOWNLOADS_DIR`(패키지 앱에서 Tauri가 `resources/downloads`로 지정) → 개발용 `downloads/`(gitignore) → `sound-client/src-tauri/target/release` 순서로 찾는다. 파일이 없으면 메뉴에 비활성으로 표시된다.
- **번들링**: `scripts/build-standalone.js`가 `sound-client/scripts/package.mjs`를 호출해 릴리스 exe와 `webview2/` 폴더를 `tms-soundsense.zip`으로 묶어 `resources/downloads/`에 넣고 버전이 든 `manifest.json`을 만든다. 서버 전체 빌드 전에 `cd sound-client && npm run build && cargo tauri build --no-bundle`로 클라이언트를 먼저 빌드해야 최신 exe가 포함된다.
- **WebView2 Fixed Version**: 시설 PC는 폐쇄망이고 WebView2 런타임이 없는 Windows 10도 있어 클라이언트는 런타임을 exe 옆 `webview2/` 폴더로 함께 배포한다(`sound-client/src-tauri/tauri.conf.json`의 `webviewInstallMode: fixedRuntime`, Tauri가 실행 시 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`를 `exe 폴더/<path>`로 고정). `path`는 반드시 `"webview2"`처럼 접두·후행 슬래시 없이 쓴다 — `"./webview2/"`로 두면 로더가 경로를 무시하고 설치된 Evergreen 런타임으로 조용히 되돌아가 폐쇄망 PC에서만 실패한다(2026-09-12 확인). 검증은 실행 후 `msedgewebview2.exe` 프로세스의 경로가 exe 옆 `webview2\`인지 본다. 런타임은 `sound-client/scripts/fetch-webview2.mjs`가 Microsoft CAB(버전·주소는 스크립트 상수, 2026-09-12 기준 153.0.4234.32 x64)을 받아 풀며 `npm run build`에 포함된다. 폴더는 gitignore이며 약 670MB, zip은 약 300MB다. 클라이언트는 시작 시 `ensure_webview2`로 런타임 로드를 확인하고 실패하면 "압축 파일을 통째로 풀라"는 한국어 대화상자를 띄우고 종료한다. 런타임 갱신은 스크립트 상수 수정 후 `src-tauri/webview2/` 삭제·재빌드.
- **API**: `GET /api/downloads`(항목, 존재 여부, 크기, 수정 시각, 버전), `GET /api/downloads/[id]`(스트리밍, Content-Disposition attachment). 테스트는 `tests/discovery.test.ts`의 카탈로그 테스트.

## Code Style

### 이력 DB 관리

- `src/worker/history-maintenance.ts`: 시작 시 전체 `metric_history` 삭제·집계를 실행하지 않는다. 1분 후부터 작은 작업을 순차 실행하고 기존 `(metricId, recordedAt)` 인덱스와 날짜 인덱스를 사용한다. 한 작업이 끝난 뒤 다음 작업을 예약하여 중첩 실행을 막는다.
- `historyMaxSizeMb` 기본 5120MB, 설정 > DB 관리에서 변경. `src/lib/history-storage.ts`의 실제 SQLite 사용 페이지 기준 90%부터 오래된 이력을 정리하고 98%에서는 `history-writer.ts`가 측정 이력 추가만 일시 보류한다. 실시간 값·설정·알람 쓰기는 계속한다.
- 새 DB는 `auto_vacuum=INCREMENTAL`로 만들고 빈 페이지를 소량씩 회수한다. 기존 DB에서 이를 활성화하고 파일 자체를 축소하려면 오프라인 재구성이 필요하다.
- `scripts/compact-history.cjs`는 Node.js 22.13+ 오프라인 도구. 원본을 읽기 전용으로 열고 별도 파일에 모든 설정·장비·알람 및 최신 이력을 복사한다. 운영 DB 교체 전 원본 DB/WAL 백업과 생성 결과 무결성 검증이 필요하다. 런타임 DB와 백업을 Git에 추가하지 않는다.
- SQLite 날짜는 정수 밀리초 또는 기존 ISO 텍스트일 수 있다. 문자열에만 동작하는 `strftime` 집계를 정수 날짜에 사용하지 않는다. 불완전한 조밀한 시간 구간은 원자료를 유지하고 부분 평균으로 덮어쓰지 않는다.

- 한국어: UI 라벨, 도메인 용어
- 영어: 코드 식별자, 주석
- TypeScript strict mode
- PascalCase 컴포넌트, camelCase 유틸리티

## Design Constraints

- **해상도:** 1920x1080 (Tauri 윈도우 기본값)
- **스크롤 없음** — 모든 페이지가 뷰포트 내 표시
- **다크 모드 전용**
- 상태 색상: `#22c55e` 정상 | `#eab308` 경고 | `#ef4444` 장애 | `#71717a` 오프라인

## Tech Stack

| 구분 | 기술 |
|------|------|
| 데스크톱 | Tauri v2 (Rust + WebView2) |
| 프론트엔드 | Next.js 16 (App Router), React 19, TypeScript |
| DB | SQLite + Prisma ORM |
| UI | shadcn/ui, Radix UI, Tailwind CSS 4 |
| 차트 | uPlot (canvas 기반) |
| 실시간 | WebSocket (ws) |
| 번들러 | esbuild (worker), Turbopack (frontend) |

## Prerequisites

모두 **Windows 측**에 설치되어 있어야 한다 (WSL 내부가 아님):

- **Node.js 20+** — nvm4w로 관리, 시스템 PATH에 `node` 필요 (Tauri가 sidecar로 호출)
- **Rust toolchain** — `rustup` (Windows), `cargo.exe`로 접근
- **cargo-tauri CLI** — `cargo install tauri-cli --version "^2"`
- **WSL** — 코드 편집 및 Claude Code 실행 환경

## Ports

| 용도 | 포트 |
|------|------|
| Dashboard (Next.js) | 7777 |
| WebSocket (Worker) | 7778 |
| UDP/TCP 데이터 수집 | 1884-1898, 1990-1991, 5555 (`src/worker/config.ts`) |

## 감시 화면 카드 순서

- 메인 장비 목록, 온습도 장비/그래프, UPS 장비/그래프는 `SortableGroup`과 `SortableCard`로 기존 영역 안에서 바로 드래그해 재정렬한다. 별도 배치 변경/완료 모드는 없다. 6px를 넘는 포인터 이동에서만 드래그를 시작하고 놓으면 즉시 저장한다. 일반 클릭과 수정키 클릭은 기존 상세보기 동작을 유지하며, 드래그 직후 클릭은 차단한다. 호버 시 이동 버튼은 표시하지 않는다. 카드 자체에 키보드 포커스를 두고 Enter → 방향키 → Enter 및 Escape 취소도 지원한다.
- `useCardOrder`는 이 PC의 브라우저/WebView 저장소에 화면·영역별 순서를 자동 저장한다. 키는 `tms:card-order:<group>:v1`. 삭제된 ID는 무시하고 새 장비는 뒤에 추가한다. 온습도 표시 개수를 바꿔도 숨겨진 장비의 순서를 보존한다. 센서/UPS 그래프 색상은 원래 장비 ID의 색상 매핑을 유지한다.
- 실시간 알람의 심각도 우선순위와 장비 설정은 카드 순서와 별개다. 테스트는 `tests/card-order.test.ts`이며 브라우저에서는 일반 클릭과 직접 드래그가 구분되는지도 확인한다.

## 음성탐지기 ZIP 압축 풀기 문제 (2026-09-16 조사)

- 증상: 다른 PC로 복사한 `tms-soundsense.zip`을 탐색기에서 열면 "내용이 없음"으로 보이거나 "다중 볼륨 세트의 마지막 디스크를 삽입하십시오"가 뜬다. 둘 다 탐색기가 ZIP 끝의 중앙 디렉터리를 찾지 못할 때 내는 메시지이며, 거의 항상 파일이 끝까지 복사되지 않은(잘린) 경우다.
- 서버 쪽은 정상임을 확인했다: 빌드된 ZIP(3.2.0, 313,434,371바이트)은 탐색기 엔진(Shell.Application)·Expand-Archive·tar.exe 모두로 풀리고, 빌드된 서버가 `/api/downloads/sound-client`로 내보낸 파일은 원본과 SHA-256이 같다. ZIP64·경로 길이·`./` 접두사 문제도 없다.
- 확인 방법: 시설 PC에서 파일 속성의 크기(바이트)를 서버의 `src-tauri/resources/downloads/tms-soundsense.zip` 크기와 비교한다. 다르면 다시 복사한다. USB는 복사 완료 후 "안전하게 제거"로 뺀 뒤 옮기고, 브라우저 다운로드는 완료 표시를 확인한다.
- 탐색기 대신 `tar -xf tms-soundsense.zip`(Windows 10 1803+)으로 풀면 잘린 파일은 즉시 오류를 낸다. 정상 파일이면 `tms-soundsense.exe`와 `webview2` 폴더가 함께 나온다.
