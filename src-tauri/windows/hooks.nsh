!macro NSIS_HOOK_PREINSTALL
  ; Seamless migration from legacy Electron (v1.x) installation:
  ; Silently uninstall %LOCALAPPDATA%\Programs\bitkit while preserving %APPDATA%\BitKit user data
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\bitkit\Uninstall BitKit.exe"
    DetailPrint "Removing previous BitKit version..."
    ExecWait '"$LOCALAPPDATA\Programs\bitkit\Uninstall BitKit.exe" /S _?=$LOCALAPPDATA\Programs\bitkit'
    Sleep 400
    RMDir /r "$LOCALAPPDATA\Programs\bitkit"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Auto-relaunch as normal user when triggered by legacy electron-updater (--force-run)
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--force-run" $R1
  ${IfNot} ${Errors}
    nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
  ${EndIf}
!macroend
