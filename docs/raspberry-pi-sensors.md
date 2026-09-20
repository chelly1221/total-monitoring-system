# 라즈베리파이 온습도·개폐 센서

상단 회로기판 아이콘에서 **입력 배선도 → SD 카드 설치 → 자동탐지·등록** 순서로 사용한다.
브라우저는 배선 안내와 등록을 지원하고 SD 기록은 Windows TMS 데스크톱 앱에서 수행한다.

## 모델과 설치

- 라즈베리파이 3/4: 제공된 `DietPi_RPi234-ARMv8-Trixie.img.xz` 기반.
- 라즈베리파이 5: 공식 `DietPi_RPi5-ARMv8-Trixie.img.xz` 기반의 별도 이미지.
- 첫 부팅부터 폐쇄망에서 동작한다. OS·Python·GPIO 라이브러리는 빌드 PC에서 미리 설치한다.
- 유선 LAN 사용. DHCP 서버가 없으면 카드 준비 화면에서 IP/접두 길이(예: `192.168.1.50/24`)를 입력한다. 같은 망 통신만 필요하면 게이트웨이는 비워 둔다. 다른 장비와 중복되지 않는 IP를 사용한다.
- SD 카드 권장 8GB 이상. Windows에 USB/SD/MMC 장치로 표시되는 리더기를 사용한다.
- 사용 채널과 장비 이름을 선택하고 대상 디스크 모델·용량·일련번호를 확인한다. 삭제 확인과 Windows UAC 승인 후 기록한다.
- 준비된 이미지의 SHA-256을 확인한 뒤 임시 복사본 FAT 파티션에 설정과 프로그램을 기록한다. 원본 이미지와 Linux 파티션은 보존한다.
- 쓰기 직전 디스크 번호·고유 ID·일련번호·용량·버스 종류를 재검사한다. 시스템/부팅/읽기 전용/오프라인 디스크는 거부한다. 볼륨 잠금에 실패하면 중단한다.
- 기록 후 전체 이미지 범위를 다시 읽어 SHA-256을 비교한다. 완료 후 안전하게 제거한다. Windows의 포맷 안내는 취소한다.
- 카드당 UUID·호스트 이름은 실제 첫 실행 때 생성한다. 같은 이미지로 만든 여러 장비가 서로 다른 장비로 탐지된다.

## 배선

전원을 끄고 배선한다. **BCM GPIO 번호와 물리 핀 번호를 구분한다.** 40핀 헤더의 핀 1 표시를 기준으로 확인한다.

| 채널 | 센서 | BCM GPIO | 물리 핀 |
| --- | --- | --- | --- |
| 온습도 1 | DHT22 | 4 | 7 |
| 온습도 2 | DHT22 | 17 | 11 |
| 온습도 3 | DHT22 | 27 | 13 |
| 온습도 4 | DHT22 | 22 | 15 |
| 개폐 1 | MC-38 | 23 | 16 |
| 개폐 2 | MC-38 | 24 | 18 |
| 개폐 3 | MC-38 | 25 | 22 |
| 개폐 4 | MC-38 | 26 | 37 |

DHT22 3핀 모듈: VCC/+ → 3.3V(물리 1번), GND/− → GND(물리 6번), DATA/OUT/S → 해당 채널 GPIO.
모듈별 핀 순서가 달라 외형 순서로 판단하지 않는다. 풀업 저항이 없는 모듈은 DATA와 3.3V 사이에 4.7~10kΩ을 넣는다. GPIO에 5V를 연결하지 않는다.

MC-38: 두 선을 해당 GPIO와 GND에 연결한다. 극성이 없고 별도 전원은 연결하지 않는다. 자석 쪽에는 배선하지 않는다. 기본은 자석 접근으로 접점이 이어지면 LOW=닫힘이며, 실제 모듈이 반대이면 등록 화면의 닫힘 입력을 HIGH로 바꾸고 다시 연결한다. 문을 실제로 열고 닫아 확인한다.

화면에는 채널 선택에 따라 해당 핀을 강조하는 40핀 도면과 센서 연결 도면을 함께 표시한다.

## 서버 등록과 알람

1. SD 카드를 라즈베리파이에 넣고 LAN과 전원을 연결한다.
2. 자동탐지 메뉴에서 장비와 활성 채널을 확인한다. 검색은 메뉴 진입 및 다시 탐지 버튼에서만 발생한다.
3. 채널마다 시설 이름을 입력하고 자동 추가를 누른다. 등록 후에는 전원이 꺼졌다 켜져도 저장된 서버로 자동 전송한다.
4. 온습도 채널은 온습도 감시, 개폐 채널은 장비상태에 표시된다. 온습도 알람 임계값은 시설 상세에서 지정한다.
5. 통신 실패나 센서 읽기 실패가 계속되면 기본 60초 후 오프라인이 된다. MC-38 열림은 심각, 닫힘은 정상 패턴이다.

UDP 7793은 탐지/설정용, 6300~6399는 서버 채널 수신용이다. 서브넷 경계를 넘는 탐지는 지원하지 않는다. 프로토콜 인증 방식은 기존 클라이언트와 동일하다.
설정 전송에 실패해도 저장한 시설은 유지한다. 다시 연결은 같은 시설을 사용하고 임계값을 덮어쓰지 않는다.

## 폐쇄망 이미지 재현 빌드

Linux/WSL root 환경에서 `qemu-user-static`, `xz-utils`, `util-linux`, `e2fsprogs`가 필요하다. 이 단계만 인터넷을 사용한다.

```bash
bash pi-client/build-offline-image.sh /path/DietPi_RPi234-ARMv8-Trixie.img.xz pi34 /path/tms-portable/downloads/tms-pi34.img.xz
bash pi-client/build-offline-image.sh /path/DietPi_RPi5-ARMv8-Trixie.img.xz pi5 /path/tms-portable/downloads/tms-pi5.img.xz
```

스크립트는 원본을 수정하지 않고 임시 디렉터리의 일반 이미지 파일에만 작업한다. 3GiB 이미지에 의존성을 설치하고 DietPi 온라인 최초 설치·자동 업데이트를 비활성화한다. `tms-sensor-setup.service`가 FAT의 설정을 적용하고 `tms-sensor.service`가 센서를 실행한다. SSH와 기본 계정 로그인은 비활성화한 센서 전용 이미지다. 유지보수 시 카드를 다시 준비한다.

`downloads/tms-pi34.img.xz`, `downloads/tms-pi5.img.xz` 및 각 `.sha256` 파일을 서버 빌드가 `resources/pi-images/`에 포함한다. 이미지가 빠지면 서버 패키징을 실패시켜 배포 누락을 방지한다. 이미지·생성 로그는 Git에 넣지 않는다. 각 `*-dependencies.txt`에 실제 설치된 Python 버전을 남긴다.

검증: `npm test`, `npm run lint -- --max-warnings=0`, `npm run typecheck`, `cargo test --manifest-path src-tauri/Cargo.toml`, `python -m unittest discover -s pi-client -v`, 별도 DB로 `npm run tauri:build`.
자동 검사는 GPIO 전기적 타이밍·실제 SD 리더기·실물 부팅을 대신하지 않는다. 모델별 현장 검증에서 부팅, 탐지, 온습도 측정, 개폐 반전, 전원 복구, LAN 단절을 확인한다.

참고: [DietPi 설치](https://dietpi.com/docs/install/), [공식 이미지](https://dietpi.com/downloads/images/), [Raspberry Pi GPIO](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html), [Adafruit DHT 라이브러리](https://github.com/adafruit/Adafruit_CircuitPython_DHT).
