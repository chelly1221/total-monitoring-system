# 2026 1레이더 UPS

통합알람감시체계의 세 번째 시설 PC 클라이언트. 김포 제1레이더 UPS 2대(UPS#1 3상, UPS#2 단상)를 SNMP v2c(RFC 1628 UPS-MIB)로 감시하던 기존 프로그램(`chelly1221/gpradar1-snmpups`, 원본 PyQt6 snmpups.py)을 Tauri 2 + Rust + Vite 기반 Windows x64 앱으로 다시 만들었다. Electron이나 Node.js를 시설 PC에 설치할 필요가 없다. 서버 다운로드 메뉴는 음성탐지기·ping 감시와 같은 포터블 ZIP(`tms-ups-monitor.zip`: 실행 파일 + `webview2` 폴더)을 배포한다. 원하는 폴더에 **통째로** 풀고 `tms-ups-monitor.exe`를 실행하면 된다(설치 불필요).

## 기능

- UPS#1(입력 전압/전류/전력 R·S·T, 입력 주파수, 출력 상태·전압·전류·부하 R·S·T, 출력 주파수, 배터리 상태·전압·잔량 = 24항목)과 UPS#2(출력 상태, 입력/출력 전압, 입력/출력 주파수, 배터리 상태·전압·잔량·온도 = 9항목)를 유닛별 갱신 간격(기본 5초)으로 한 번의 GET으로 조회. 값 변환 규칙(주파수 /10, 전력 /1000, UPS#2 배터리 전압 /100, 전류 /10 등)과 상태 코드 표는 원본과 같다.
- 항목별 최소/최대 임계값(원본 기본값), 낮음/높음/정상 복귀 로그, 출력·배터리 상태 변경 로그, SNMP 응답 없음 로그. 이벤트 로그는 유닛별 500줄.
- 출력 상태·배터리 상태가 5회 연속 비정상이면 경보. 내장 경보음(UPS1.wav/UPS2.wav) 또는 사용자 WAV를 4초마다 반복, 유닛별 음소거.
- 통합감시 서버로 원본과 같은 `{"UPS": n, "Data": {...}}` JSON을 UDP로 폴링마다 전송(유닛별 서버 IP·포트). 서버 주도 자동 탐지(UDP 7792)로 시설 등록 시 서버 주소와 UPS 번호가 자동 저장된다.
- 서버가 보낸 파일 수신(`received/`, exe/msi 자동 실행, 진행률 보고), PC 확인, 트레이 상주, Windows 로그인 시 자동 실행, 실행 시 감시 자동 시작.
- PC 음소거 자동 해제: Windows 소리를 음소거하면 트레이 옆에 해제 시간을 묻는 창이 뜨고 시간이 지나면 자동으로 해제한다(음성탐지기와 같은 기능).
- 설정 가져오기/내보내기: 자체 JSON 백업과 원본 프로그램의 `settings.json`/`ups2_settings.json`을 읽는다.

## 자동 연결

1. ZIP을 풀고 `tms-ups-monitor.exe`를 실행한다. 첫 실행의 방화벽 등록(UDP 7792)을 허용한다.
2. UPS#1/UPS#2 메뉴에서 UPS 주소와 Community를 입력한다. 설정 메뉴에서 장비명을 입력한다.
3. 통합알람감시체계의 UPS 추가 → 등록 방식 "자동 탐지 (PC)"에서 이 PC를 고르고 UPS#1 또는 UPS#2를 선택한 뒤 저장한다. 시설명·포트·수신 파서·표시 항목이 자동으로 채워지고, 저장 시 서버 IP·포트·UPS 번호가 이 프로그램에 전송된다. 두 UPS는 각각 다른 시설로 등록한다.

세부 계약은 [공통 프로토콜](../docs/sound-client-protocol.md)의 "UPS client extension"을 따른다.

## 빌드·검증

Windows Node.js, Rust MSVC, cargo-tauri가 필요하다.

```powershell
cd ups-client
npm ci
npm run build        # WebView2 런타임 복사 + Vite
npm run lint
npm test             # cargo test (SNMP BER, 설정, 폴링 규칙, 탐지 응답)
npm run tauri:portable
npm run smoke        # 실제 EXE + 가짜 SNMP 에이전트 + 루프백 UDP
npm run package      # src-tauri/target/release/tms-ups-monitor.zip
```

개발 실행은 `npm run tauri:dev`. `npm run tauri:build`는 한국어 NSIS Setup(`tms-ups-monitor-setup.exe`, WebView2 내장, 방화벽 규칙 등록)을 만든다. 클라이언트를 먼저 빌드한 뒤 서버의 `npm run tauri:build`를 실행하면 다운로드 메뉴에 ZIP과 버전이 포함된다.

## 저장

`ups-settings.json`은 EXE 옆, 쓰기 불가 시 `%APPDATA%/tms-ups-monitor/`. Windows 원자적 파일 교체로 저장한다. 수신 파일은 같은 폴더의 `received/`.
