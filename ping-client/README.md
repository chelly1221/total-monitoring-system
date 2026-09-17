# 네트워크 ping 감시

서버 다운로드 메뉴는 음성탐지기와 같은 포터블 ZIP(`tms-ping-monitor.zip`: 실행 파일 + `webview2` 폴더)을 배포합니다. 원하는 폴더에 **통째로** 풀고 `tms-ping-monitor.exe`를 실행하면 됩니다(설치 불필요). ZIP에는 Npcap이 없으므로 패킷 캡처를 쓰려면 Npcap을 따로 설치해야 하고, ping·경보·자동 연결·파일 전송·장애 내역 공유는 Npcap 없이 동작합니다.

1.1.0부터 두 가지가 추가되었습니다. (1) 서버가 보낸 파일을 받아 `received/` 폴더에 저장하고 exe/msi는 자동 실행하며 진행률을 서버에 보고합니다(음성탐지기와 같은 방식, SHA-256 검증 통과 파일만 실행). (2) 장애 발생·정상 복구 이력을 서버 HTTP(`/api/ping-events`, 기본 7777)로 공유해 서버 알람에 어느 감시 대상이 끊겼는지 표시됩니다. 서버가 자동 연결되어 있을 때만 전송합니다.

통합알람감시체계의 두 번째 시설 PC 클라이언트. Tauri 2 + Rust + Vite 기반 Windows x64 앱이다. Electron이나 Node.js를 시설 PC에 설치할 필요가 없다.

## 기능

- 최대 20개 IPv4/호스트명 ICMP 감시, 응답 시간·손실률·최근 60회 이력
- 1~3600초 감시 주기, 100~10000ms 응답 대기, 1~10회 연속 실패 판정
- 물리 구성도 배치·연결 편집, 장비 상태·통신 흐름 표시
- SoundSense와 같은 흰색·연회색·벽돌색 테마. 설정 메뉴를 타이틀바에 통합하고, 시작·정지 및 화면 전환 토글은 바로 아래 제어줄에 배치한다. 넓은 구성도 옆에 장애·복구 이력을 항상 표시한다. 정상은 초록색·실선, 장애는 빨간색·점선으로 구분한다. 목록 모드에서도 같은 배치를 유지한다.
- 장애·복구 이력을 합계 최대 5 GB(5,000,000,000바이트)까지 파일로 보존하고 오래된 파일부터 자동 삭제. 메인 화면은 최근 100건, 상세 조회는 전체 저장 이력을 장비명·주소·상태로 검색하고 100건씩 조회
- 기본 WAV 경보음 및 사용자 WAV, 음소거
- Npcap 설치 시 여러 어댑터의 IPv4 트래픽·ASTERIX 흐름 감지
- 서버 주도 자동 탐지, PC 확인, 서버 설정 수신, 상태 변화/하트비트 UDP 전송
- Windows 로그인 시 자동 실행 기본 활성화, 앱 실행 시 감시 자동 시작, 트레이 상주
- 설정 창에서 JSON 가져오기·내보내기: 감시 대상·구성도·서버 연결·환경 설정 백업. 기존 PingTester 파일도 같은 가져오기 버튼으로 지원

## 자동 연결

1. `tms-ping-monitor-setup.exe`를 실행해 설치한다. 포터블 배포는 압축을 통째로 풀고 `tms-ping-monitor.exe`를 실행한다. `webview2/`는 EXE 옆에 둔다.
2. 설정에서 장비명을 입력하고 감시 대상을 등록한다.
3. 통합알람감시체계의 시설 추가 → 자동 탐지 (PC)에서 ‘네트워크 ping 감시’를 선택한다.
4. 시설을 저장하면 서버 IP·수신 포트·`PING_FAIL`/`PING_OK`가 자동 전송·저장된다.

음성탐지기는 UDP 7790, ping 감시는 UDP 7791을 사용하므로 같은 PC에서 함께 실행할 수 있다. 클라이언트는 주기적으로 광고하거나 브로드캐스트하지 않는다. 첫 실행의 방화벽 등록을 허용해야 다른 PC에서 탐지할 수 있다. 자세한 계약은 [공통 프로토콜](../docs/sound-client-protocol.md)을 따른다.

한 개라도 확정 장애이면 `PING_FAIL`, 활성 대상 모두 정상일 때만 `PING_OK`를 전송한다. 감시 정지·대상 없음·첫 응답 대기에는 정상 신호를 보내지 않으므로 서버의 기존 오프라인 감시가 동작한다. 저장한 서버로 재실행 후 자동 전송을 재개한다. UDP 전송 시각은 로컬 송신 성공을 뜻하며 서버의 수신 확인은 아니다.

닫기 버튼은 트레이로 숨긴다. 종료는 트레이 우클릭 메뉴에서 선택한다. 감시 대상이나 주기를 저장하면 진행 중인 감시에도 자동 반영된다. 자체 백업은 서버 연결을 포함해 복원하되 이 PC의 식별자는 유지한다. 기존 PingTester 파일은 감시 대상·구성도·경보·캡처 설정만 가져온다. 가져오기는 즉시 적용된다. `ping-history/`의 약 1 MB JSONL 파일로 저장하며, 기존 `ping-history.json`은 첫 실행 시 한 번 이관한다. 상세 조회는 요청당 최대 약 16 MB를 백그라운드에서 읽어 전체 로그를 메모리에 적재하지 않는다. 새 로그에는 발생 당시 응답·손실·판정 조건을 함께 기록하며, 이전 로그에 없는 항목은 ‘기록 없음’으로 표시한다.

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

개발 실행은 `npm run tauri:dev`. 빌드는 기존 음성 클라이언트의 WebView2 런타임을 재사용하거나 Microsoft Fixed Version 런타임을 받아 포함한다. 결과는 `src-tauri/target/release/tms-ping-monitor.exe`, `tms-ping-monitor-setup.exe`, `bundle/nsis/네트워크 ping 감시_1.0.2_x64-setup.exe`. `npm run package`는 별도로 포터블 ZIP을 만든다. 설치 파일 없이 EXE만 빌드하려면 `npm run tauri:portable`. 그 뒤 부모 폴더에서 `npm run tauri:build`를 실행하면 서버 다운로드 메뉴에 Setup을 포함한다. Setup의 버전·해시가 맞지 않으면 서버 빌드를 중단한다.

## 설치 마법사

- 한국어 마법사에서 프로그램·WebView2를 현재 사용자 폴더에 설치하고 시작 메뉴·바탕 화면 바로가기와 제거 항목을 만든다. 앱과 WebView2는 인터넷 없이 설치된다.
- 네트워크 구성 단계에서는 관리자 승인을 받아 UDP 7791 방화벽을 등록한다. 이미 준비된 구성 요소는 건너뛴다.
- 폐쇄망용 Setup 한 종류를 생성한다. Npcap 1.89 공식 설치 파일과 WebView2를 모두 내장하며 설치 PC에서 파일을 다운로드하지 않는다. Npcap 선택 시 포함된 설치 마법사를 열고 무료판 약관은 사용자가 직접 동의한다. 취소·설치 실패 시 재시도, 프로그램만 설치, 전체 중단을 선택할 수 있다. 재부팅이 필요한 경우 NSIS가 안내한다.
- Npcap 파일은 빌드 PC에서 SHA-256과 Nmap 전자서명을 확인한다. 설치 PC에서는 Setup에 고정된 SHA-256으로 파일을 검증해 인증서 체인·CRL 온라인 조회에 의존하지 않는다. 다운로드 코드는 빌드 스크립트에만 있다.
- 사용자가 요청한 조직 내부용 패키지다. 무료 Npcap은 조직 내 최대 5대 조건이며 자동 무인 설치는 OEM 기능이다. [공식 내부 사용 조건](https://npcap.com/oem/internal), [설치 옵션](https://npcap.com/guide/npcap-users-guide.html). 설치 바이너리는 Git에 포함하지 않으며 외부 배포용 패키지로 사용하지 않는다.
- 보유한 적절한 내부 사용 라이선스의 OEM 설치 파일을 빌드 입력으로 지정하면 내장 파일을 OEM으로 교체한다.

```powershell
$env:TMS_NPCAP_OEM_INSTALLER = 'C:\배포자료\npcap-oem.exe'
npm run tauri:build
Remove-Item Env:TMS_NPCAP_OEM_INSTALLER
```

OEM 빌드는 설치 파일을 Setup에 포함하고 `/S`로 설치한다. 환경 변수를 해제하면 Npcap 무료판을 내장하는 내부용 빌드로 돌아온다. 기존 WinPcap을 교체하거나 다른 캡처 프로그램을 강제 종료하지 않는다. 앱 제거 시 공유 Npcap·방화벽과 감시 설정·이력을 보존한다.

네트워크가 이미 준비된 관리 PC는 `tms-ping-monitor-setup.exe /S /SKIPNETWORK`로 앱만 설치할 수 있다. 표준 무료판 빌드의 `/S` 단독 실행은 약관 화면을 우회하지 않도록 중단한다. 일반 사용자 테스트도 `/SKIPNETWORK`로 드라이버와 방화벽을 변경하지 않고 진행할 수 있다.

`npm run smoke`는 실제 EXE를 별도 `.review/ping-smoke/` 설정으로 실행하고 루프백 탐지·설정 전송·하트비트·재시작 연결·장애·연결 해제를 검증한다. 실행 중인 ping 클라이언트를 먼저 종료해야 한다. 이 검증은 방화벽·자동 실행 등록과 운영 DB 접근을 하지 않는다.

## 저장과 선택 기능

- `ping-settings.json`, `ping-history.json`: EXE 옆, 쓰기 불가 시 `%APPDATA%/tms-ping-monitor/`. Windows 원자적 파일 교체로 저장한다.
- 포터블 ZIP에는 Npcap 드라이버를 포함하지 않는다. Setup은 위 설치 단계에서 처리한다. 미설치 상태에서도 ping·알람·자동 연결은 동작한다. 실제 Npcap 캡처는 설치된 드라이버와 어댑터 권한이 필요하다. 캡처는 Ethernet IPv4를 지원하며 VLAN을 해석하고 조각난 UDP를 ASTERIX로 오인하지 않는다.
- `System32/Npcap/wpcap.dll`을 `libloading`으로 읽는다. 이 의존성은 선택 기능을 위해 드라이버 미설치 PC에서 앱 전체가 실행 불가해지는 것을 피한다. `tauri-plugin-dialog`는 WAV·기존 설정 파일을 선택하는 네이티브 대화상자에 사용한다.

원본과 이관 범위는 [NOTICE.md](NOTICE.md)를 참고한다.
