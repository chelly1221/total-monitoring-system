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

1. 압축을 통째로 풀고 `tms-ping-monitor.exe`를 실행한다. `webview2/`는 EXE 옆에 둔다.
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

개발 실행은 `npm run tauri:dev`. 빌드는 기존 음성 클라이언트의 WebView2 런타임을 재사용하거나 Microsoft Fixed Version 런타임을 받아 포함한다. 결과는 `src-tauri/target/release/tms-ping-monitor.exe`, `tms-ping-monitor.zip`. 그 뒤 부모 폴더에서 `npm run tauri:build`를 실행하면 서버 다운로드 메뉴에 함께 포함된다.

`npm run smoke`는 실제 EXE를 별도 `.review/ping-smoke/` 설정으로 실행하고 루프백 탐지·설정 전송·하트비트·재시작 연결·장애·연결 해제를 검증한다. 실행 중인 ping 클라이언트를 먼저 종료해야 한다. 이 검증은 방화벽·자동 실행 등록과 운영 DB 접근을 하지 않는다.

## 저장과 선택 기능

- `ping-settings.json`, `ping-history.json`: EXE 옆, 쓰기 불가 시 `%APPDATA%/tms-ping-monitor/`. Windows 원자적 파일 교체로 저장한다.
- Npcap 드라이버는 포함하지 않는다. 미설치 상태에서도 ping·알람·자동 연결은 동작한다. 실제 Npcap 캡처는 설치된 드라이버와 어댑터 권한이 필요하다. 캡처는 Ethernet IPv4를 지원하며 VLAN을 해석하고 조각난 UDP를 ASTERIX로 오인하지 않는다.
- `System32/Npcap/wpcap.dll`을 `libloading`으로 읽는다. 이 의존성은 선택 기능을 위해 드라이버 미설치 PC에서 앱 전체가 실행 불가해지는 것을 피한다. `tauri-plugin-dialog`는 WAV·기존 설정 파일을 선택하는 네이티브 대화상자에 사용한다.

원본과 이관 범위는 [NOTICE.md](NOTICE.md)를 참고한다.
