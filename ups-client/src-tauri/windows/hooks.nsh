!define TMS_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  ; /SKIPNETWORK: managed PCs whose firewall rule is preinstalled, and isolated install tests.
  ClearErrors
  ${GetOptions} $CMDLINE "/SKIPNETWORK" $R0
  ${IfNot} ${Errors}
    Goto tms_network_done
  ${EndIf}
  InitPluginsDir
  File /oname=$PLUGINSDIR\install-network.ps1 "${TMS_HOOK_DIR}\install-network.ps1"
  tms_network_retry:
    DetailPrint "서버 자동 연결용 방화벽 규칙(UDP 7792)을 준비하고 있습니다. 관리자 승인을 확인하세요."
    ; Keep the application per-user. Only the firewall helper requests elevation.
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\install-network.ps1"' $R0
    ${If} $R0 != 0
      ${If} ${Silent}
      ${OrIf} $PassiveMode = 1
        SetErrorLevel $R0
        Abort
      ${EndIf}
      MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "방화벽 규칙을 등록하지 못했습니다 (코드 $R0).$\r$\n$\r$\n다시 시도: 관리자 승인 결과를 확인한 뒤 재시도합니다.$\r$\n무시: 프로그램 설치를 계속합니다. 서버 자동 탐지는 첫 실행 시 다시 등록을 시도합니다.$\r$\n중단: 설치를 취소합니다." IDRETRY tms_network_retry IDIGNORE tms_network_done
      Abort
    ${EndIf}
  tms_network_done:
!macroend

; The discovery firewall rule survives app removal because a portable copy may still use it.
