<div align="center">

# 통합알람감시체계 — Windows Desktop

### TMS Portable

레이더 / 전송로 / UPS / 온습도 — 실시간 시설 감시 데스크톱 앱

[![Tauri](https://img.shields.io/badge/Tauri_v2-24C8D8?style=flat-square&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js_16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)

</div>

---

## 개요

[unified-monitoring](https://github.com/chelly1221/unified-monitoring) 프로젝트를 **Tauri v2**로 패키징한 Windows 데스크톱 앱입니다. 별도 서버 설치 없이 exe 하나로 실행할 수 있습니다.

항공관제 시설의 장비 상태, UPS 전원 시스템, 온습도 센서를 실시간으로 감시하며, 장애 발생 시 브라우저 오디오 및 물리 사이렌을 통해 즉시 알람을 발생시킵니다.

## 아키텍처

```
Tauri (Rust) — Windows EXE
├── WebView → http://localhost:7777  (대시보드 UI)
├── spawns: node standalone/server.js (Next.js 서버)
└── spawns: node worker/index.js     (데이터 수집기)
```

Tauri 앱이 두 개의 Node.js 프로세스를 관리합니다:

| 프로세스 | 포트 | 역할 |
|----------|------|------|
| **Next.js Server** | 7777 | 웹 UI + REST API |
| **Worker** | 7778 | UDP/TCP 데이터 수집, 알람 처리, WebSocket 브로드캐스트 |

앱 종료 시 모든 자식 프로세스가 자동 정리됩니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| **Windows 데스크톱 앱** | Tauri v2 기반, 설치 또는 포터블 실행 |
| **실시간 감시** | WebSocket 기반 즉시 상태 업데이트, 자동 재연결 |
| **3가지 시스템 유형** | 장비(패턴 기반), UPS(다중 메트릭), 센서(임계값 기반) |
| **알람 관리** | 자동 생성/해제, acknowledge, 심각도 구분, 이력 로그 |
| **오디오 알림** | 시스템/메트릭별 커스텀 브라우저 오디오 |
| **물리 사이렌** | TCP/UDP 사이렌 제어 (상태 기반) |
| **스파이크 필터** | MAD 기반 이상치 탐지 (센서 데이터 안정화) |
| **커스텀 파서** | 비표준 데이터용 샌드박스 JavaScript (vm.Script) |

## 상태 표시

```
🟢 정상   #22c55e     🟡 경고   #eab308     🔴 장애   #ef4444     ⚫ 오프라인  #71717a
```

## 사전 요구사항

- **Node.js 20+** (Windows, 시스템 PATH에 등록)
- **Rust toolchain** ([rustup](https://rustup.rs/))
- **cargo-tauri CLI** (`cargo install tauri-cli --version "^2"`)

## 빌드

```bash
# 의존성 설치
npm install

# 데이터베이스 초기화
npx prisma db push
npx tsx prisma/seed.ts

# Tauri 빌드 (NSIS 인스톨러 생성)
cargo tauri build
```

빌드 결과: `src-tauri/target/release/bundle/nsis/TMS Portable_x.x.x_x64-setup.exe`

### 빌드 파이프라인

`cargo tauri build` 실행 시 자동으로:

1. `next build` (standalone 모드)
2. standalone server + static assets → `src-tauri/resources/`
3. worker를 esbuild로 번들 → `src-tauri/resources/worker/`
4. Prisma client + schema 복사
5. Rust 컴파일 → NSIS 인스톨러 생성

## 개발 모드

```bash
npm run dev           # Next.js 개발 서버 (포트 7777)
npm run worker:dev    # Worker (별도 터미널)
cargo tauri dev       # Tauri 앱 (위 서버에 연결)
```

## WSL 환경 참고

WSL에서 개발하는 경우, Tauri 빌드는 **Windows 측 도구**를 사용해야 합니다:

```bash
cargo.exe tauri build    # Windows Rust toolchain 사용
cargo.exe tauri dev      # 개발 모드
```

## 기술 스택

| 구분 | 기술 |
|------|------|
| 데스크톱 프레임워크 | Tauri v2 (Rust + WebView2) |
| 프론트엔드 | Next.js 16 (App Router), React 19, TypeScript |
| 데이터베이스 | SQLite + Prisma ORM |
| UI | shadcn/ui, Radix UI, Tailwind CSS 4 |
| 차트 | uPlot |
| 실시간 통신 | WebSocket (ws) |
| 번들러 | esbuild (worker), Turbopack (frontend) |

## 프로젝트 구조

```
tms-portable/
├── src/                          # Next.js 소스
│   ├── app/                      # App Router (pages + API)
│   ├── components/               # React 컴포넌트
│   ├── worker/                   # 데이터 수집 Worker
│   └── ...
├── src-tauri/                    # Tauri (Rust)
│   ├── src/lib.rs                # 앱 로직 (프로세스 관리)
│   ├── src/main.rs               # Windows 진입점
│   ├── tauri.conf.json           # Tauri 설정
│   └── resources/                # (빌드 시 생성)
├── scripts/
│   └── build-standalone.js       # 빌드 스크립트
├── prisma/                       # DB 스키마 + 마이그레이션
└── package.json
```

## 원본 프로젝트

서버 배포용 버전: [unified-monitoring](https://github.com/chelly1221/unified-monitoring)

## 라이선스

비공개 — All rights reserved.
