# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tms-portable** — 통합알람감시체계 (Unified Alarm Monitoring System)의 Windows portable EXE 버전. Tauri v2로 Next.js 풀스택 앱을 데스크톱 앱으로 패키징한다.

원본 프로젝트: `github.com/chelly1221/unified-monitoring`

### 아키텍처

Tauri 앱이 두 개의 Node.js 프로세스를 sidecar로 관리한다:
- **Next.js standalone server** (포트 7777) — 웹 UI + API
- **Worker** (포트 7778) — UDP/TCP 데이터 수집, 알람, WebSocket 브로드캐스트

```
Tauri (Rust)
├── WebView → http://localhost:7777
├── spawns: node standalone/server.js  (Next.js)
└── spawns: node worker/index.js       (data collector)
```

SQLite DB는 앱 데이터 디렉토리에 저장. Prisma ORM 사용.

## 개발 환경 (WSL + Windows)

코드 편집은 WSL에서 하지만, **Tauri 빌드와 실행은 반드시 Windows 측 도구를 사용**해야 한다. WSL의 Linux 바이너리로는 Windows exe를 빌드할 수 없다.

| 용도 | WSL 명령 | 비고 |
|------|----------|------|
| Rust 빌드 | `cargo.exe` | Windows 측 Rust toolchain 사용 |
| Node.js 실행 | `node.exe` | Windows 측 Node.js (nvm4w) 사용 |
| npm 실행 | `node.exe -e "require('child_process').execSync('npm ...', {stdio:'inherit', cwd:'C:\\\\...'})"` | WSL의 `npm` 명령은 경로 문제로 실패할 수 있음 |
| Tauri CLI | `cargo.exe tauri ...` | `cargo install tauri-cli --version "^2"` 로 설치 |
| 아이콘 생성 | `cargo.exe tauri icon <source>` | |

**주의사항:**
- WSL 경로(`/mnt/c/...`)와 Windows 경로(`C:\...`)를 혼용하지 않도록 주의
- `cargo.exe`는 Windows 경로를 사용하므로 `--manifest-path`에 WSL 경로를 쓰면 자동 변환됨
- `npm.cmd`는 WSL에서 직접 호출 시 쉘 호환 문제로 실패할 수 있음 — `node.exe`를 통해 간접 호출

## Essential Commands

```bash
# 개발 모드 (Next.js dev server + Tauri webview)
npm run dev              # Next.js만 (포트 7777)
npm run worker:dev       # Worker만 (별도 터미널)
cargo.exe tauri dev      # Tauri 앱 (dev server에 연결)

# 프로덕션 빌드 (Windows 측 도구 사용)
cargo.exe tauri build    # 전체 빌드 → src-tauri/target/release/bundle/

# 프론트엔드만 빌드
node.exe scripts/build-standalone.js

# 데이터베이스
npx tsx prisma/seed.ts
npx prisma migrate reset --force && npm run db:seed
```

## Build Pipeline

`npm run tauri:build` 실행 시:

1. `scripts/build-standalone.js` 실행
   - `next build` (output: 'standalone')
   - standalone server → `src-tauri/resources/standalone/`
   - static assets, public → standalone 내부에 복사
   - worker → esbuild로 번들 → `src-tauri/resources/worker/`
   - prisma schema + generated client → `src-tauri/resources/`
2. `cargo tauri build` → NSIS 인스톨러 생성

빌드 결과: `src-tauri/target/release/bundle/nsis/`

## Project Structure

```
tms-portable/
├── src/                          # Next.js 소스 (원본과 동일)
│   ├── app/                      # App Router (pages + API)
│   ├── components/               # React 컴포넌트
│   ├── hooks/                    # React 훅
│   ├── lib/                      # 유틸리티
│   ├── types/                    # TypeScript 타입
│   └── worker/                   # 데이터 수집 Worker
├── src-tauri/                    # Tauri (Rust)
│   ├── src/
│   │   ├── main.rs               # Windows 진입점
│   │   └── lib.rs                # 앱 로직 (프로세스 관리)
│   ├── capabilities/             # Tauri 권한 설정
│   ├── icons/                    # 앱 아이콘
│   ├── resources/                # (빌드 시 생성) 번들 리소스
│   ├── Cargo.toml                # Rust 의존성
│   └── tauri.conf.json           # Tauri 설정
├── scripts/
│   └── build-standalone.js       # 빌드 스크립트
├── prisma/                       # DB 스키마 + 마이그레이션
├── next.config.ts                # output: 'standalone' 설정
└── package.json                  # npm 스크립트
```

## Tauri 관련 핵심 파일

- `src-tauri/src/lib.rs` — Tauri 앱 초기화. Node.js server/worker 프로세스 spawn, 종료 시 cleanup
- `src-tauri/tauri.conf.json` — 윈도우 설정, 번들 리소스 경로, NSIS 설정
- `scripts/build-standalone.js` — Next.js standalone + worker를 Tauri 리소스로 패키징

## Supported System Types

- **Equipment** (`equipment`): 레이더, FMS, LCMS, VDL, MARC, 전송로 — 패턴 기반 상태 감지
- **UPS** (`ups`): 무정전 전원장치 — 구분자/커스텀코드 파싱, 다중 메트릭 감시
- **Sensor** (`sensor`): 온습도 — 조건 기반 임계값, 스파이크 필터

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

## Prerequisites

모두 **Windows 측**에 설치되어 있어야 한다 (WSL 내부가 아님):

- **Node.js 20+** — nvm4w로 관리, 시스템 PATH에 `node` 필요 (Tauri가 sidecar로 호출)
- **Rust toolchain** — `rustup` (Windows 설치), `cargo.exe`로 접근
- **cargo-tauri CLI** — `cargo install tauri-cli --version "^2"`
- **WSL** — 코드 편집 및 Claude Code 실행 환경

## Database

SQLite + Prisma ORM. 핵심 모델: System, Metric, MetricHistory, Alarm, AlarmLog, Setting, Siren

## WebSocket

포트 7778. 메시지 타입: `metric`, `alarm`, `alarm-resolved`, `system`, `init`, `ping`, `delete`, `raw`, `siren-sync`, `settings`

## Ports

| 용도 | 포트 |
|------|------|
| Dashboard (Next.js) | 7777 |
| WebSocket (Worker) | 7778 |
| UDP/TCP 데이터 수집 | 1884-1898, 5555 등 (`src/worker/config.ts`) |
