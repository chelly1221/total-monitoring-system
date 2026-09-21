# Fritzing 라즈베리파이 배선도

`public/pi-wiring/`의 채널별 `.fzz`는 Fritzing에서 열고 수정할 수 있는 원본이다. SVG는 Fritzing의 실제 내보내기 결과이며 웹 화면에서 배선 경로를 별도로 그리지 않는다. 서버 설치 파일에 포함되어 폐쇄망에서 표시·저장이 가능하다.

라즈베리파이 4B는 Fritzing 표준 부품을 사용한다. DHT22는 Fritzing 라이브러리의 센서 그래픽을 바탕으로 만든 3핀 모듈 부품, MC-58 NC는 두 개의 무극성 접점 단자와 별도 자석을 가진 사용자 부품이다. 센서 부품은 배선 안내용이며 외형 치수나 PCB 제작용 풋프린트를 제공하지 않는다. **Breadboard 뷰**에서 확인한다.

## 재생성

Python 3과 Fritzing이 설치된 환경에서 실행한다. 앱 실행에는 이 도구들이 필요하지 않다.

```sh
python3 scripts/build-pi-wiring.py
python3 scripts/verify-pi-wiring.py
```

`FRITZING` 환경변수로 실행 파일 경로를 지정할 수 있다. Ubuntu 패키지는 기본 `fritzing` 실행 래퍼가 부품 데이터베이스를 준비하므로 `-f`로 시스템 폴더를 강제 지정하지 않는다. 내보내기는 Qt offscreen으로 실행한다.

채널의 GPIO·물리 핀은 `src/lib/pi-sensor.ts`에서 읽는다. FZZ에 실제 커넥터 연결과 전선 구간이 저장되며 검증 스크립트는 연결 그래프를 추적해 단선·오접속·전원 단락을 검사한다. SVG 내보내기 뒤에는 브라우저에서 DHT22와 MC-58 도면 및 확대 기능을 확인한다.

출처와 자산 라이선스는 `public/pi-wiring/NOTICE.txt`에 기록했다. 다운로드 원본에도 같은 안내가 포함된다.
