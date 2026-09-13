!define TMS_HOOK_DIR "${__FILEDIR__}"
!include "${TMS_HOOK_DIR}\generated\npcap.nsh"

!macro NSIS_HOOK_PREINSTALL
  ; This switch is also useful for managed PCs whose network dependencies are preinstalled.
  ClearErrors
  ${GetOptions} $CMDLINE "/SKIPNETWORK" $R0
  ${IfNot} ${Errors}
    Goto tms_network_done
  ${EndIf}
  ; Never open an interactive third-party installer during a silent application deployment.
  ${If} ${Silent}
  ${OrIf} $PassiveMode = 1
    !ifndef TMS_NPCAP_OEM
      DetailPrint "Npcap 무료판은 대화형 설치가 필요합니다. /SKIPNETWORK 또는 OEM 배포를 사용하세요."
      SetErrorLevel 20
      Abort
    !endif
  ${EndIf}
  InitPluginsDir
  File /oname=$PLUGINSDIR\install-network.ps1 "${TMS_HOOK_DIR}\install-network.ps1"
  File /oname=$PLUGINSDIR\npcap-installer.exe "${TMS_HOOK_DIR}\generated\npcap-installer.exe"
  StrCpy $R1 ""
  !ifdef TMS_NPCAP_OEM
    StrCpy $R1 '-Capture -Installer "$PLUGINSDIR\npcap-installer.exe" -ExpectedHash "${TMS_NPCAP_HASH}" -Oem'
  !else
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "프로그램과 WebView2를 설치하고 서버 자동 연결용 방화벽을 설정합니다.$\r$\n$\r$\n패킷·ASTERIX 감시용 Npcap도 설치하시겠습니까?$\r$\n$\r$\n예: Setup에 포함된 Npcap 설치 마법사를 엽니다. 인터넷 연결은 필요하지 않습니다. 무료판은 조직 내 최대 5대입니다.$\r$\n아니요: Ping 감시와 자동 연결만 준비합니다.$\r$\n$\r$\n네트워크 설정에는 관리자 승인이 필요합니다." IDYES tms_capture_selected IDNO tms_network_prepare
    Abort
    tms_capture_selected:
      StrCpy $R1 '-Capture -Installer "$PLUGINSDIR\npcap-installer.exe" -ExpectedHash "${TMS_NPCAP_HASH}"'
  !endif
  tms_network_prepare:
  tms_network_retry:
    DetailPrint "네트워크 구성 요소를 준비하고 있습니다. 관리자 승인과 Npcap 설치 창을 확인하세요."
    ; Keep the application per-user. Only the dependency helper requests elevation.
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\install-network.ps1" -Action Install $R1' $R0
    ${If} $R0 = 3010
      SetRebootFlag true
    ${ElseIf} $R0 != 0
      ${If} ${Silent}
      ${OrIf} $PassiveMode = 1
        SetErrorLevel $R0
        Abort
      ${EndIf}
      MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "네트워크 구성 요소 설치를 완료하지 못했습니다 (코드 $R0).$\r$\n$\r$\n다시 시도: 관리자 승인·Npcap 설치 결과를 확인한 뒤 재시도합니다.$\r$\n무시: 프로그램 설치를 계속합니다. Npcap 미설치 시 패킷 감시는 사용할 수 없습니다.$\r$\n중단: 설치를 취소합니다." IDRETRY tms_network_retry IDIGNORE tms_network_done
      Abort
    ${EndIf}
  tms_network_done:
!macroend

; Npcap and the shared discovery firewall rule survive app removal because portable
; copies or other capture tools may still use them. Tauri removes its own shortcuts/autostart.
