!macro customInit
  ; Force-kill any running Notely AI processes before installing.
  ; This handles cases where the app crashed and left zombie processes
  ; that won't respond to graceful WM_CLOSE messages.
  ; Note: Do NOT use /T (tree kill) as it can kill the installer itself.
  nsExec::ExecToStack 'taskkill /F /IM "Notely AI.exe"'
  Pop $0 ; discard exit code
  Pop $1 ; discard output
  ; Allow time for processes to fully terminate and release file locks
  Sleep 2000
!macroend
