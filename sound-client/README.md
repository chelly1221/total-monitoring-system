# 통합알람감시 음성탐지기 (TMS SoundSense)

통합알람감시체계(TMS) 서버에 PC의 **소리 발생 여부**를 보고하고, PC가 **뮤트된 채로 방치되지 않도록** 일정 시간 뒤 자동으로 뮤트를 해제하는 Windows 데스크톱 클라이언트입니다. Tauri 2 + Rust로 만든 단일 실행 파일이며, 설치 없이 실행됩니다.

이전 두 도구를 하나로 합쳤습니다.

| 이전 도구 | 기능 | 현재 |
|-----------|------|------|
| soundsense (Electron) | WASAPI 루프백으로 시스템 오디오를 캡처해 소리/무음을 UDP로 전송 | 포함 |
| unmute (C# WPF) | 뮤트 감지 후 카운트다운, 만료 시 뮤트 해제 + 볼륨 100% | 포함 |
| (신규) | 서버 LAN 자동탐지 응답기 (UDP 7790) | 추가 |

## 기능

- **소리 감지**: 기본 출력 장치의 루프백을 캡처해 피크 진폭이 임계값(기본 0.01)을 넘으면 "소리 감지됨", 무음 판정 시간(기본 3000ms) 동안 연속 무음이면 "무음"으로 판정합니다.
- **서버 전송**: 상태가 바뀔 때마다 즉시, 그리고 하트비트 주기(기본 5000ms)마다 `SOUND` / `SILENCE`(변경 가능) 문자열을 UTF-8 UDP로 서버 대상에 보냅니다. 대상이 없으면 아무것도 보내지 않고 화면에 "서버 미등록"으로 표시합니다.
- **자동 뮤트 해제**: 예전 UnmuteTimer와 같은 흐름입니다. PC가 음소거되면 화면 오른쪽(작업표시줄 소리 설정 창에 가려지지 않는 위쪽)에 시간 선택 팝업(1분/10분/30분/1시간/2시간/3시간/5시간, 2열 버튼)이 자동으로 뜹니다. 시간을 고르면 카운트다운이 시작되고, 끝나면 뮤트를 해제하고 마스터 볼륨을 100%로 올립니다. "나중에"를 누르면 타이머 없이 닫히고(뮤트가 풀렸다가 다시 걸리면 다시 뜸), "지금 해제"는 즉시 해제합니다. 트레이 아이콘 툴팁에 "음소거 해제까지 MM:SS"가 표시되고 트레이 메뉴의 "타이머 취소"로 중단할 수 있습니다. 손으로 뮤트를 풀면 타이머와 팝업이 자동으로 정리됩니다. 설정 탭의 "음소거 팝업 기본 선택 시간"은 팝업에서 미리 강조되는 값입니다.
- **자동탐지 응답**: 서버가 보내는 `probe`에 `here`로 응답하고, `identify`(이 PC 확인)와 `config`(서버 주소 자동 설정)를 처리합니다. 프로토콜은 `../docs/sound-client-protocol.md`를 따릅니다.
- **화면 구성**: 흰 바탕에 포인트 컬러(CMYK 0·90·100·50 ≈ `#7F0D00`)를 쓰는 창(460×300)입니다. 별도 타이틀바 없이 탭 줄이 드래그 손잡이 역할을 하며 오른쪽 끝에 최소화·닫기 버튼이 있습니다. 글꼴은 Pretendard Variable을 앱에 내장해(`src/fonts/`, SIL OFL) 모든 화면에 동일하게 적용합니다. 첫 화면인 **상태** 탭은 예전 soundsense처럼 큰 글자로 "무음 / 소리 감지"만 보여주고, 나머지 기능은 **음소거**(자동 해제 시간·즉시 해제), **설정**(장비명·음소거 팝업 기본 시간·임계값·무음 판정 시간·자동 실행), **서버**(전송 대상 IP/포트·on/off 문자열·하트비트·탐지 포트·토큰), **정보**(서버 대상·전송 이력·PC 정보·버전) 탭에 있습니다. 모든 탭은 300px 높이 안에 스크롤 없이 들어갑니다. 타이틀바의 X는 트레이로 숨깁니다.
- **상태 아이콘**: 트레이 아이콘과 작업표시줄 창 아이콘이 상태에 따라 바뀝니다. 초록 = 정상(무음), 회색 = 뮤트됨, 빨강 = 소리 감지. 원본은 `src-tauri/icons/src/state-*.png`(여백 없이 잘라낸 정사각형)이고, 앱 아이콘(exe)은 초록 아이콘에서 `cargo tauri icon`으로 생성했습니다.
- **트레이 상주**: 창을 닫아도 종료되지 않고 트레이로 숨습니다. 트레이 메뉴 `열기` / `종료`. 중복 실행 시 기존 창을 앞으로 가져옵니다.
- **Windows 시작 시 자동 실행** 토글(기본 켜짐; 첫 실행 때 시작 프로그램에 등록됩니다).

## 포터블 사용법

1. `tms-soundsense.exe`를 원하는 폴더에 복사합니다.
2. 실행하면 같은 폴더에 `soundsense-settings.json`이 생성됩니다. exe와 설정 파일을 **나란히** 두고 함께 옮기면 됩니다.
   - exe 폴더에 쓸 수 없는 경우(예: 읽기 전용 위치)에만 `%APPDATA%\tms-soundsense\soundsense-settings.json`을 사용합니다.
3. 설정 파일 예시:

```json
{
  "id": "6d0c0a1e-....",
  "name": "1레이더 LCMS PC",
  "target": { "ip": "192.168.0.10", "port": 6100 },
  "on": "SOUND",
  "off": "SILENCE",
  "intervalMs": 5000,
  "threshold": 0.01,
  "silenceMs": 3000,
  "discoveryPort": 7790,
  "token": "",
  "unmuteMinutes": 10,
  "autostart": true
}
```

`id`는 첫 실행 때 자동 생성되는 고유 식별자입니다. 서버는 이 값으로 PC를 구분하므로 임의로 바꾸지 마세요.

## 첫 실행: 장비명 등록

처음 실행하면 창이 열리고 **"장비명을 등록해주세요"** 대화상자가 나타납니다. 서버 자동탐지 목록에 표시될 이름(예: `1레이더 LCMS PC`)을 입력하고 저장해야 닫힙니다. 장비명이 등록된 뒤에는 실행 시 창을 띄우지 않고 트레이로 바로 시작합니다. 장비명은 설정 탭에서 언제든 바꿀 수 있고, 서버에서 `config`로 덮어쓸 수도 있습니다.

## 서버에서 탐지·등록하는 방법

1. 서버(통합알람감시체계) 장비 추가 화면에서 **자동탐지**를 누르면 서버가 서브넷에 `probe`를 브로드캐스트합니다.
2. 이 클라이언트는 UDP 7790에서 `probe`를 받아 `here`(id, 장비명, PC 이름, 버전, MAC, 현재 대상, 뮤트/소리 상태)로 응답합니다.
3. 목록에서 **PC 확인**을 누르면 `identify`가 도착해 창이 앞으로 나오고, 작업표시줄이 깜박이며, 비프음과 함께 "이 PC를 확인 중입니다" 배너가 지정된 초 동안 표시됩니다.
4. PC를 선택해 저장하면 서버가 `config`(대상 IP/포트, on/off 문자열, 주기, 장비명)를 보내고, 클라이언트는 이를 저장·즉시 적용한 뒤 `ack`를 돌려줍니다. 이후부터 서버로 데이터 전송이 시작됩니다.

서버 설정의 `clientToken`과 이 앱의 **인증 토큰**을 같은 값으로 두면 `identify`/`config`에 HMAC-SHA256 서명이 요구되며, 서명이 없거나 틀리거나 시각 차이가 60초를 넘는 명령은 거부됩니다. 토큰이 비어 있으면 서명 없이 동작합니다.

## 방화벽

자동탐지를 받으려면 **UDP 7790 인바운드**가 허용되어야 합니다. 앱은 시작할 때 `netsh advfirewall`로 `TMS SoundSense Discovery` 규칙이 있는지 확인하고, 없으면 관리자 권한 상승(UAC) 창을 한 번 띄워 규칙을 추가합니다. UAC를 거부하면 규칙이 없는 채로 동작하며, 그 경우 같은 PC에서의 테스트는 되지만 다른 PC(서버)의 탐지에는 응답하지 못할 수 있습니다. 탐지 포트를 바꾸면 새 포트로 규칙을 다시 추가합니다.

서버로 보내는 데이터(아웃바운드 UDP)는 별도 규칙이 필요 없습니다.

## 화면

- **상태**: 소리 감지됨/무음 표시와 피크 미터, 뮤트 상태와 자동 해제까지 남은 시간(프리셋 선택·지금 해제), 서버 대상 `ip:port`·마지막 전송 시각·전송 횟수, 장비명, PC 이름, 이 PC의 IP, 클라이언트 ID, 오디오/탐지 상태.
- **설정**: 장비명, 감지 임계값, 무음 판정 시간(ms), 하트비트 주기(ms), 자동 뮤트 해제 시간, 탐지 포트, 인증 토큰, Windows 시작 시 자동 실행, 서버 전송 대상(읽기 전용 + `수동 설정` 펼침에서 IP/포트/on/off 직접 입력).

## 빌드

요구 사항: Windows 10/11, Rust(cargo) 1.80+, `cargo install tauri-cli --version "^2"`, Node.js 20+.

```powershell
npm install
npm run icon                      # icon.png 생성 후 src-tauri/icons 재생성 (아이콘을 바꿀 때만)
npm run build                     # 프런트엔드 (dist/)
cargo tauri build --no-bundle     # 포터블 exe: src-tauri\target\release\tms-soundsense.exe
cargo tauri build                 # + NSIS 설치 파일 (선택)
```

개발 모드는 `cargo tauri dev`(Vite dev 서버 자동 실행)입니다. 로그는 `RUST_LOG=info`로 제어합니다(릴리스 exe는 콘솔이 없습니다).

> **주의**: `cargo build --release`만 실행하면 `custom-protocol` 기능이 빠져 프런트 자산이 포함되지 않은 개발 모드 exe가 만들어집니다. 그 exe는 실행 시 "localhost 연결을 거부했습니다" 오류를 띄웁니다. 배포용 exe는 반드시 `cargo tauri build`(또는 `--no-bundle`)로 만드세요.

## 프로토콜 테스트

```powershell
node scripts/probe-test.mjs                     # 브로드캐스트 probe 후 2초간 here 응답 출력
node scripts/probe-test.mjs identify 127.0.0.1 5
node scripts/probe-test.mjs config 127.0.0.1 192.168.0.10 6100 "1레이더 LCMS PC"
$env:TOKEN="secret"; node scripts/probe-test.mjs identify 127.0.0.1   # 서명 포함
```

## 구조

```
sound-client/
├── index.html, src/main.ts, src/style.css   # Vite + 순수 TypeScript UI
├── scripts/make-icon.mjs                    # 의존성 없는 PNG 아이콘 생성기
├── scripts/probe-test.mjs                   # 프로토콜 테스트 도구
└── src-tauri/
    ├── tauri.conf.json, capabilities/default.json
    └── src/
        ├── lib.rs        # 앱 조립, 트레이, 명령, identify 처리
        ├── settings.rs   # 포터블 설정 파일
        ├── state.rs      # 공유 상태 + UI 스냅샷
        ├── audio.rs      # cpal WASAPI 루프백 캡처 + 소리/무음 판정
        ├── mute.rs       # IAudioEndpointVolume 뮤트 감시 + 자동 해제
        ├── sender.rs     # 서버로 UDP 전송 (상태 변화 + 하트비트)
        ├── discovery.rs  # probe/identify/config 응답기 (UDP 7790)
        └── firewall.rs   # netsh 방화벽 규칙 등록 (UAC 1회)
```
