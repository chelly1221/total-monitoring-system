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
| **뇌전 감시** | 항공기상청 웹 자료에서 김포공항 5km 이내 지상낙뢰 수집, 확인 버튼으로 WING 송신소 점검 기록 |

### 뇌전 감시와 현장 확인

항공기상청 [낙뢰 화면](https://global.amo.go.kr/weatherImage/lightning-stroke.do)이 사용하는 공개 웹 자료를 프로그램 시작 시 바로 조회하고, 이후 기본 10분마다 조회합니다. 일시적인 조회 오류는 최대 5회 즉시 재시도하며, 모두 실패하면 다음 정기 조회까지 기다립니다. API 키나 로그인이 필요하지 않습니다. WING과 같은 김포공항 기준 좌표(37.56, 126.8)에서 반경 5km 이내의 지상낙뢰만 판정하며, 공중낙뢰는 제외합니다. 발생 시각은 UTC에서 한국 시각으로 표시하고 최근 24시간 이력을 유지합니다.

**WING은 확인 버튼을 누를 때만 접속합니다.** 자동 수집, 화면 조회, 점검 체크 저장은 WING을 호출하지 않습니다. 마지막 낙뢰 후 1시간이 지나고 특별점검·유지보수일지를 모두 체크하면, 버튼으로 WING 송신소(TX)의 해당 낙뢰 확인 기록을 저장하고 저장 여부를 다시 검증합니다. WING에 아직 해당 낙뢰가 없거나 저장에 실패하면 확인을 완료하지 않으며 다시 시도할 수 있습니다. 확인 중 들어온 새 낙뢰와 늦게 수신된 과거 낙뢰는 별도로 미확인 상태를 유지합니다.

웹 자료 수신 실패 또는 자료시각 25분 초과 지연 시에는 기존 경보를 유지하고 확인을 보류합니다. 감시 OFF와 데모 모드에서는 외부 자료를 조회하지 않습니다. 웹 조회 형식이 바뀌면 수집기 수정이 필요할 수 있습니다.

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

### 이력 DB 용량 관리

설정 > DB 관리에서 용량 상한을 선택합니다(기본 5GB). DB 사용량 90%부터 오래된 측정 이력을 소량씩 정리하고, 98%에서는 이력 추가를 잠시 보류하여 실시간 값·장비 설정·알람 기록에 필요한 공간을 남깁니다. 이 상한은 측정 이력 관리 기준이며, 알람·설정까지 쓰기를 막는 SQLite 전체 파일의 강제 제한은 아닙니다.

이력 정리는 앱 시작 1분 후부터 장비별 인덱스를 이용해 나누어 실행합니다. 정상 여유 공간에서는 기존 보관 정책(원자료 7일, 10분 평균 31일, 30분 평균 365일)을 유지하고, 용량이 우선 한도에 도달하면 오래된 이력이 먼저 정리됩니다. 숫자형 및 기존 ISO 문자형 날짜를 모두 처리합니다. 신규 DB는 삭제된 공간을 점진적으로 회수합니다.

기존 대용량 DB의 파일 자체를 줄여야 할 때는 **앱·수집기를 종료하고 DB와 WAL을 백업한 후**, Node.js 22.13 이상에서 아래 도구로 별도 DB를 만듭니다. 원본은 수정하지 않으며, 설정·장비·알람을 보존하고 최근 측정 이력부터 용량에 맞게 복사합니다. 결과의 무결성을 검증한 후에만 운영 DB를 교체하세요.

```powershell
node scripts/compact-history.cjs "원본.db" "새파일.db" 5120
```

### 개발 서버

```bash
npm run dev           # Next.js 개발 서버 (포트 7777)
npm run worker:dev    # Worker (별도 터미널)
cargo tauri dev       # Tauri 앱 (위 서버에 연결)
```

### 검증

```bash
npm run lint
npm run typecheck
npm test
npm audit
cargo check --manifest-path src-tauri/Cargo.toml
```

테스트는 별도 임시 SQLite DB와 비어 있는 WebSocket 포트를 사용하며, 실제 감시 DB·장비·WING에는 쓰지 않습니다. 장비 설정, 알람 발생/복구, 공유 포트 수신 구분, 백업 복원, 음원 업로드와 함께 낙뢰 거리 경계·UTC 시각·자료 지연·수집 경로 분리·WING 기록 검증·확인 중 새 낙뢰 수신을 검증합니다.

데스크톱에서 업로드한 음원은 앱 데이터 폴더의 `audio/`에 보관합니다. 서버만 실행할 때는 `AUDIO_DIR`로 저장 위치를 지정할 수 있으며, 기본값은 `public/audio`입니다. `WS_PORT`는 수집기/API 알림 포트, `NEXT_PUBLIC_WS_PORT`는 프론트엔드 빌드 시 접속 포트입니다(기본 7778).

`tsx`가 사용하는 `esbuild`는 Windows 개발 서버의 파일 읽기 취약점 수정 버전인 0.28.2로 override했습니다. `tsx` 업데이트 시 override 제거 가능 여부를 함께 확인하세요.

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
