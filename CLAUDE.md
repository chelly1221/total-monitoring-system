# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tms-portable** — 통합알람감시체계 (Unified Alarm Monitoring System)의 Windows 데스크톱 앱. [unified-monitoring](https://github.com/chelly1221/unified-monitoring) 프로젝트를 Tauri v2로 패키징하여 단일 EXE로 배포한다.

### 아키텍처

Tauri 앱이 두 개의 Node.js 자식 프로세스를 spawn하고, WebView가 localhost를 로드한다:

```
Tauri (Rust) — tms-portable.exe
├── WebView → http://localhost:7777
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
- `out/index.html` 존재 (Tauri가 `frontendDist: "../out"` 검증 — 실제로는 localhost URL 사용)

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
├── out/index.html                # Tauri frontendDist 더미 (gitignore)
├── next.config.ts                # output: 'standalone'
└── package.json                  # tauri:dev, tauri:build, tauri:build-frontend
```

## Tauri 핵심 파일

- **`src-tauri/src/lib.rs`** — `tokio::sync::Mutex`로 자식 프로세스 관리. `spawn_server()`, `spawn_worker()`는 동기 spawn, `kill_processes()`는 async. `setup()`에서 spawn 후 3초 대기 → WebView reload.
- **`src-tauri/tauri.conf.json`** — `url: "http://localhost:7777"`, `csp: null`, NSIS `installMode: "currentUser"`, `resources: ["resources/"]`
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

포트 7778. 타입: `metric`, `alarm`, `alarm-resolved`, `system`, `init`, `ping`, `delete`, `raw`, `siren-sync`, `settings`

## Code Style

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
