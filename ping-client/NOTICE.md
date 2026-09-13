# 원본 및 이관 기록

- 원본: [chelly1221/network-surveillance](https://github.com/chelly1221/network-surveillance)
- 기준 커밋: `e72ca6171f90f253ee2fceb3ec7d93bf02f39c31`
- 원본 라이선스 표기: UNLICENSED, 내부 사용 전용
- 저장소 소유자의 요청으로 동일 소유자의 TMS 저장소에 두 번째 클라이언트로 이관했다.

`src/topoEditor.js`, `src/view2d.js`, `src/renderer.js`, `src/styles.css`, `index.html`과 아이콘·기본 경보음은 원본을 바탕으로 수정했다. Electron main/preload 및 Node cap 바인딩은 포함하지 않는다. ICMP·설정·이력·경보·캡처·탐지·트레이는 Rust/Tauri로 다시 구현했다. ASTERIX 범주와 토폴로지 구조는 기존 앱과 호환한다.

기존 SoundSense의 자동 탐지 계약, 방화벽 등록·어댑터 조회·WebView2 패키징 방식을 참고했다. Pretendard의 라이선스는 `src/fonts/LICENSE.txt`에 포함한다.
