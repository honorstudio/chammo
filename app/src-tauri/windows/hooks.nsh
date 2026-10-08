; 앱을 켠 채 같은/새 판을 깔거나 지우면 NSIS 기본 "실행 중입니다! 'OK'를 누르면 종료" 창이 떴다(윈도우 0.2.4 QA) — 그 전에 조용히 끈다.
; 세션은 claude daemon 소속이라 앱을 꺼도 안 죽는다(OK 를 눌렀을 때와 같은 끄기). 못 끄면 기본 확인(CheckIfAppIsRunning)이 그대로 뒤를 받친다.
; 0.2.4 이하에서 올릴 때 '옛 판 제거'를 고르면 그 옛 제거기(훅 없음)가 한 번 더 물을 수 있다 — 이 판부터는 제거기도 조용히 끈다
!macro CHAMMO_QUIET_KILL
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::KillProcessCurrentUser "${MAINBINARYNAME}.exe"
  !else
    nsis_tauri_utils::KillProcess "${MAINBINARYNAME}.exe"
  !endif
  Pop $R0
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CHAMMO_QUIET_KILL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CHAMMO_QUIET_KILL
!macroend
