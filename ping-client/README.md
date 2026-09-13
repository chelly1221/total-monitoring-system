# 네트워크 ping 감시

통합알람감시체계의 두 번째 시설 PC 클라이언트. Tauri 2 + Rust + Vite 기반 Windows x64 앱이다. Electron이나 Node.js를 시설 PC에 설치할 필요가 없다.

## 기능

- 최대 20개 IPv4/호스트명 ICMP 감시, 응답 시간·손실률·최근 60회 이력
- 1~3600초 감시 주기, 100~10000ms 응답 대기, 1~10회 연속 실패 판정
- 물리 토폴로지 배치·연결 편집, 장비 상태·통신 흐름 표시
- 장애·복구 전환 이력 최근 100건을 파일로 보존
- 기본 WAV 경보음 및 사용자 WAV, 음소거
- Npcap 설치 시 여러 어댑터의 IPv4 트래픽·미등록 노드·ASTERIX 흐름 감지
- 서버 주도 자동 탐지, PC 확인, 서버 설정 수신, 상태 변화/하트비트 UDP 전송
- Windows 로그인 시 자동 실행, 앱 실행 시 감시 자동 시작, 트레이 상주
- 기존 PingTester `settings.json`의 감시 대상·토폴로지·경보·캡처 설정 가져오기

## 자동 연결

1. `tms-ping-monitor-setup.exe`를 실행해 설치한다. 포터블 배포는 압축을 통째로 풀고 `tms-ping-monitor.exe`를 실행한다. `webview2/`는 EXE 옆에 둔다.
2. 클라이언트 설정에서 장비명을 입력하고 감시 대상을 등록한다.
3. 통합알람감시체계의 시설 추가 → 자동 탐지 (PC)에서 ‘네트워크 ping 감시’를 선택한다.
4. 시설을 저장하면 서버 IP·수신 포트·`PING_FAIL`/`PING_OK`가 자동 전송·저장된다.

음성탐지기는 UDP 7790, ping 감시는 UDP 7791을 사용하므로 같은 PC에서 함께 실행할 수 있다. 클라이언트는 주기적으로 광고하거나 브로드캐스트하지 않는다. 첫 실행의 방화벽 등록을 허용해야 다른 PC에서 탐지할 수 있다. 자세한 계약은 [공통 프로토콜](../docs/sound-client-protocol.md)을 따른다.

한 개라도 확정 장애이면 `PING_FAIL`, 활성 대상 모두 정상일 때만 `PING_OK`를 전송한다. 감시 정지·대상 없음·첫 응답 대기에는 정상 신호를 보내지 않으므로 서버의 기존 오프라인 감시가 동작한다. 저장한 서버로 재실행 후 자동 전송을 재개한다. UDP 전송 시각은 로컬 송신 성공을 뜻하며 서버의 수신 확인은 아니다.

닫기 버튼은 트레이로 숨긴다. 종료는 트레이 우클릭 메뉴에서 선택한다. 감시 대상이나 주기를 저장하면 진행 중인 감시에도 자동 반영된다. 설정 가져오기는 새 클라이언트의 식별자·서버 연결을 유지한다.

## 빌드·검증

Windows Node.js, Rust MSVC, cargo-tauri가 필요하다.

```powershell
cd ping-client
npm ci
npm run build
npm run lint
npm test
npm run tauri:build
npm run smoke
npm run package
```

개발 실행은 `npm run tauri:dev`. 빌드는 기존 음성 클라이언트의 WebView2 런타임을 재사용하거나 Microsoft Fixed Version 런타임을 받아 포함한다. 결과는 `src-tauri/target/release/tms-ping-monitor.exe`, `tms-ping-monitor-setup.exe`, `bundle/nsis/네트워크 ping 감시_1.0.1_x64-setup.exe`. `npm run package`는 별도로 포터블 ZIP을 만든다. 설치 파일 없이 EXE만 빌드하려면 `npm run tauri:portable`. 그 뒤 부모 폴더에서 `npm run tauri:build`를 실행하면 서버 다운로드 메뉴에 Setup을 포함한다. Setup의 버전·해시가 맞지 않으면 서버 빌드를 중단한다.

## 설치 마법사

- 한국어 마법사에서 프로그램·WebView2를 현재 사용자 폴더에 설치하고 시작 메뉴·바탕 화면 바로가기와 제거 항목을 만든다. 앱과 WebView2는 인터넷 없이 설치된다.
- 네트워크 구성 단계에서는 관리자 승인을 받아 UDP 7791 방화벽을 등록한다. 이미 준비된 구성 요소는 건너뛴다.
- Npcap 선택 시 미설치 PC에서 공식 HTTPS 주소의 1.89 설치 파일을 받고 SHA-256 및 Nmap 전자서명을 검증한 뒤 Npcap 설치 마법사를 연다. 무료판의 약관은 사용자가 직접 동의하며 인터넷 연결이 필요하다. 취소·다운로드 실패 시 재시도, 프로그램만 설치, 전체 중단을 선택할 수 있다. 재부팅이 필요한 경우 NSIS가 안내한다.
- 무료 Npcap은 조직 내 최대 5대 조건이 있으며 자동 무인 설치는 OEM 기능이다. [공식 내부 사용 조건](https://npcap.com/oem/internal), [설치 옵션](https://npcap.com/guide/npcap-users-guide.html). 표준 Setup에는 무료 Npcap 바이너리를 재배포하지 않는다.
- 폐쇄망에서 드라이버까지 함께 설치하려면 적절한 내부 사용 라이선스의 OEM 설치 파일을 빌드 입력으로 지정한다. 해당 파일은 생성 폴더에만 복사되며 Git에 포함되지 않는다.

```powershell
$env:TMS_NPCAP_OEM_INSTALLER = 'C:\배포자료\npcap-oem.exe'
npm run tauri:build
Remove-Item Env:TMS_NPCAP_OEM_INSTALLER
```

OEM 빌드는 설치 파일을 Setup에 포함하고 `/S`로 설치한다. 환경 변수를 해제해 표준 빌드를 하면 이전 OEM 파일을 다시 포함하지 않는다. 기존 WinPcap을 교체하거나 다른 캡처 프로그램을 강제 종료하지 않는다. 앱 제거 시 공유 Npcap·방화벽과 감시 설정·이력을 보존한다.

네트워크가 이미 준비된 관리 PC는 `tms-ping-monitor-setup.exe /S /SKIPNETWORK`로 앱만 설치할 수 있다. 표준 무료판 빌드의 `/S` 단독 실행은 약관 화면을 우회하지 않도록 중단한다. 일반 사용자 테스트도 `/SKIPNETWORK`로 드라이버와 방화벽을 변경하지 않고 진행할 수 있다.

`npm run smoke`는 실제 EXE를 별도 `.review/ping-smoke/` 설정으로 실행하고 루프백 탐지·설정 전송·하트비트·재시작 연결·장애·연결 해제를 검증한다. 실행 중인 ping 클라이언트를 먼저 종료해야 한다. 이 검증은 방화벽·자동 실행 등록과 운영 DB 접근을 하지 않는다.

## 저장과 선택 기능

- `ping-settings.json`, `ping-history.json`: EXE 옆, 쓰기 불가 시 `%APPDATA%/tms-ping-monitor/`. Windows 원자적 파일 교체로 저장한다.
- 포터블 ZIP에는 Npcap 드라이버를 포함하지 않는다. Setup은 위 설치 단계에서 처리한다. 미설치 상태에서도 ping·알람·자동 연결은 동작한다. 실제 Npcap 캡처는 설치된 드라이버와 어댑터 권한이 필요하다. 캡처는 Ethernet IPv4를 지원하며 VLAN을 해석하고 조각난 UDP를 ASTERIX로 오인하지 않는다.
- `System32/Npcap/wpcap.dll`을 `libloading`으로 읽는다. 이 의존성은 선택 기능을 위해 드라이버 미설치 PC에서 앱 전체가 실행 불가해지는 것을 피한다. `tauri-plugin-dialog`는 WAV·기존 설정 파일을 선택하는 네이티브 대화상자에 사용한다.

원본과 이관 범위는 [NOTICE.md](NOTICE.md)를 참고한다.
