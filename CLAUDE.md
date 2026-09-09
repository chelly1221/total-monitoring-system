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
- **`src/worker/wing15-monitor.ts`** — 항공기상청 웹 자료만 180초마다 수집 (`WING15_POLL_INTERVAL`, 최소 60초). 실패 시 60초 후 재시도하며 실패 시각·원인과 수신 복구를 로그에 남긴다. `wing15Strikes`에 낙뢰별 `confirmed`를 저장하고 기존 `wing15ConfirmedAt` 이력을 이관. 확인 중 들어온 새 낙뢰나 늦게 들어온 과거 낙뢰가 이전 확인 시각 때문에 확인 처리되지 않도록 명시적인 상태 유지. Setting 저장과 WS 브로드캐스트는 최신 점검 상태를 트랜잭션에서 다시 읽어 수행.
- **`src/app/api/wing15/`** — GET 상태 조회와 PUT `/checklist`는 로컬 DB만 사용. POST `/confirm`만 WING에 접속하고 성공한 대상만 로컬에 확인 저장. 미반영·진행 중·오래된 점검은 409, 통신·저장 실패는 500. 확인 중 수신한 낙뢰는 미확인으로 유지.
- **`src/components/wing15/lightning-alert-panel.tsx`** — 첫/마지막 낙뢰 시각(KST), 마지막 낙뢰 후 1시간 대기, 특별점검·유지보수일지 두 항목 유지. 자료시각 표시, 수신 오류·지연 시 확인 보류. 성공·실패 후 모두 로컬 상태 재조회.
- **ON/OFF**: 설정 > 기능 표시 설정 > "뇌전감시" 스위치 (Setting `wing15Enabled`, 기본 켜짐). OFF면 외부 조회를 건너뛰고(타이머 유지) 패널을 숨긴다. 설정 API가 `settings` WS 메시지로 즉시 전파 (`setSettingsChangedHandler` → `triggerWing15Poll`).
- **데모 모드**: `PUT /api/settings {"wing15Demo":"true"}` 설정 시 다음 폴링(≤3분)부터 가짜 경보 카드 표시 (`src/lib/wing15-demo.ts`, 실데이터 조회 없음). `"false"`로 해제. 앱이 꺼진 상태에서는 `npx tsx scripts/set-wing15-demo.ts [off]`로 앱 DB에 직접 설정

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
