Unicode True
RequestExecutionLevel admin
ManifestSupportedOS Win10
SetCompressor /SOLID lzma
SetCompressorDictSize 64
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!ifndef SourceRoot
  !error "SourceRoot is required"
!endif
!ifndef OutputDir
  !define OutputDir "."
!endif
!ifndef AppVersion
  !define AppVersion "0.1.0"
!endif
!ifndef PublicBaseUrl
  !define PublicBaseUrl "https://setinfo.sytes.net"
!endif
!define RustDeskVersion "1.4.9"
Name "SAS Cliente"
OutFile "${OutputDir}\SAS-Cliente-Setup-${AppVersion}.exe"
InstallDir "C:\SAS\Client"
BrandingText "SAS Cliente - soporte con autorizacion"
ShowInstDetails show
VIProductVersion "${AppVersion}.0"
VIAddVersionKey /LANG=1034 "ProductName" "SAS Cliente"
VIAddVersionKey /LANG=1034 "CompanyName" "SAS Support Platform"
VIAddVersionKey /LANG=1034 "FileDescription" "Agente de soporte SAS para usuarios"
VIAddVersionKey /LANG=1034 "FileVersion" "${AppVersion}"
VIAddVersionKey /LANG=1034 "LegalCopyright" "Copyright (C) 2026 SAS Support Platform"
Var TokenField
Var EnrollmentToken
Var DeploymentToken
Var DeploymentFile
Var DeploymentFileField
Var IsUpdate
!insertmacro MUI_PAGE_WELCOME
Page custom EnrollmentPage EnrollmentLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"
Function .onInit
  StrCpy $IsUpdate "0"
  ${GetParameters} $0
  ${GetOptions} $0 "/ENROLLMENTTOKEN=" $EnrollmentToken
  ${GetOptions} $0 "/DEPLOYMENTTOKEN=" $DeploymentToken
  ${GetOptions} $0 "/DEPLOYMENTFILE=" $DeploymentFile
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Esta version de SAS Cliente requiere Windows 10, Windows 11 o Windows Server 2016 (o posterior). Windows 7, 8 y 8.1 ya no reciben componentes seguros compatibles."
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "SAS Cliente requiere Windows de 64 bits. Este paquete no puede ejecutarse en Windows de 32 bits."
    Abort
  ${EndIf}
FunctionEnd
Function .onInstFailed
  IfFileExists "$PLUGINSDIR\stop-client-components.ps1" 0 restore_finished
  nsExec::ExecToLog /TIMEOUT=20000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-client-components.ps1" -InstallPath "$INSTDIR" -RestoreOnly'
  Pop $0
  restore_finished:
FunctionEnd

Function EnrollmentPage
  IfFileExists "$INSTDIR\agent-credential.json" 0 enrollment_required
  StrCpy $IsUpdate "1"
  Abort
  enrollment_required:
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 28u "Pega el codigo corto de 8 caracteres mostrado en la liga que Fisher envio por WhatsApp."
  Pop $0
  ${NSD_CreateText} 0 38u 100% 14u ""
  Pop $TokenField
  ${NSD_CreateLabel} 0 62u 100% 24u "El codigo vincula solamente este equipo y no autoriza control remoto."
  Pop $0
  ${NSD_CreateLabel} 0 92u 100% 14u "Opciones avanzadas: archivo de implementacion masiva .sasdeploy"
  Pop $0
  ${NSD_CreateFileRequest} 0 110u 100% 14u ""
  Pop $DeploymentFileField
  nsDialogs::Show
FunctionEnd
Function EnrollmentLeave
  ${If} $IsUpdate == "1"
    Return
  ${EndIf}
  ${NSD_GetText} $TokenField $EnrollmentToken
  ${NSD_GetText} $DeploymentFileField $DeploymentFile
  ${If} $EnrollmentToken == ""
    ${If} $DeploymentFile == ""
      MessageBox MB_ICONEXCLAMATION "Escribe el codigo corto o selecciona un archivo .sasdeploy."
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd
Section "SAS Cliente" SEC_MAIN
  SetShellVarContext all
  DetailPrint "Liberando componentes nativos de SAS Cliente antes de reemplazar archivos..."
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=stop-client-components.ps1 "${SourceRoot}\scripts\stop-client-components.ps1"
  nsExec::ExecToStack /TIMEOUT=60000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-client-components.ps1" -InstallPath "$INSTDIR" -LeaveBrokerDisabled -AllowSideBySide'
  Pop $2
  Pop $3
  ${If} $2 != 0
    ClearErrors
    FileOpen $0 "$APPDATA\SAS\Client\last-component-release-error.txt" r
    IfErrors componentReleaseNoDetail
    FileRead $0 $3
    FileClose $0
    Goto componentReleaseShow
    componentReleaseNoDetail:
    StrCpy $3 "Windows mantiene abierto un componente de SAS Cliente o ClamAV, o la liberación excedió 60 segundos."
    componentReleaseShow:
    MessageBox MB_ICONSTOP "La actualización se detuvo antes de reemplazar archivos.$\r$\n$\r$\n$3$\r$\n$\r$\nCierra el análisis antivirus e inténtalo nuevamente. Código $2."
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /r "${SourceRoot}\client"
  File /r "${SourceRoot}\scripts"
  File /r "${SourceRoot}\docs"
  File /r "${SourceRoot}\runtime"
  SetOutPath "$INSTDIR\vendor\remote-engines"
  File "${SourceRoot}\vendor\remote-engines\rustdesk-${RustDeskVersion}-x86_64.msi"
  SetOutPath "$INSTDIR\tools"
  ; El motor viaja integrado, pero las firmas se descargan despues de instalar.
  File /r /x "database" /x "*.cvd" /x "*.cld" /x "*.sign" /x "freshclam.dat" "${SourceRoot}\tools\clamav"
  File /r /x "SasCaptureHelper.exe" "${SourceRoot}\tools\sas-capture-helper"
  File /r /x "SasDxgiCapture.exe" "${SourceRoot}\tools\sas-dxgi-capture"
  File /r /x "SasInputHelper.exe" "${SourceRoot}\tools\sas-input-helper"
  File /r /x "SasSecureAttentionBroker.exe" "${SourceRoot}\tools\sas-secure-attention-broker"
  SetOutPath "$INSTDIR\native\${AppVersion}"
  File "${SourceRoot}\tools\sas-capture-helper\bin\Release\SasCaptureHelper.exe"
  File "${SourceRoot}\tools\sas-dxgi-capture\bin\Release\SasDxgiCapture.exe"
  File "${SourceRoot}\tools\sas-input-helper\bin\Release\SasInputHelper.exe"
  File "${SourceRoot}\tools\sas-secure-attention-broker\bin\Release\SasSecureAttentionBroker.exe"
  File "${SourceRoot}\tools\sas-service-host\SasServiceHost.exe"
  SetOutPath "$INSTDIR"
  File "${SourceRoot}\package.json"
  WriteUninstaller "$INSTDIR\Desinstalar-SAS-Cliente.exe"
  DetailPrint "Instalando o actualizando SAS Cliente y su motor ClamAV integrado..."
  ${If} $IsUpdate == "1"
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\install-client.ps1" -InstallPath "$INSTDIR" -ServerUrl "${PublicBaseUrl}" -NodeExe "$INSTDIR\runtime\node\node.exe" -RemoteEngine auto -InstallRustDeskEngine -UpdateMode' $1
    ${If} $1 != 0
ClearErrors
      FileOpen $0 "$APPDATA\SAS\Client\last-install-error.txt" r
      IfErrors updateErrorNoDetail
      FileRead $0 $3
      FileClose $0
      Goto updateErrorShow
      updateErrorNoDetail:
      StrCpy $3 "Consulta C:\ProgramData\SAS\Client\last-install-result.json para ver la etapa que fallo."
      updateErrorShow:
      MessageBox MB_ICONSTOP "No fue posible actualizar SAS Cliente. La vinculación existente no fue reemplazada.$\r$\n$\r$\n$3$\r$\n$\r$\nCodigo $1."
      Abort
    ${EndIf}
  ${Else}
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\install-client.ps1" -InstallPath "$INSTDIR" -ServerUrl "${PublicBaseUrl}" -NodeExe "$INSTDIR\runtime\node\node.exe" -RemoteEngine auto -InstallRustDeskEngine -EnrollmentToken "$EnrollmentToken" -DeploymentToken "$DeploymentToken" -DeploymentFile "$DeploymentFile"' $1
    ${If} $1 != 0
      MessageBox MB_ICONSTOP "No fue posible instalar o vincular SAS Cliente. Verifica que la liga siga vigente. Codigo $1."
      Abort
    ${EndIf}
  ${EndIf}
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASClient" "DisplayName" "SAS Cliente"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASClient" "DisplayVersion" "${AppVersion}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASClient" "UninstallString" '"$INSTDIR\Desinstalar-SAS-Cliente.exe"'
  CreateDirectory "$SMPROGRAMS\SAS Cliente"
  CreateShortCut "$SMPROGRAMS\SAS Cliente\Abrir panel de seguridad.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\open-agent-panel.ps1"'
  CreateShortCut "$SMPROGRAMS\SAS Cliente\Desinstalar.lnk" "$INSTDIR\Desinstalar-SAS-Cliente.exe"
SectionEnd
Section "Uninstall"
  nsExec::ExecToLog 'schtasks.exe /End /TN "SAS Input Desktop Helper"'
  nsExec::ExecToLog 'schtasks.exe /Delete /F /TN "SAS Input Desktop Helper"'
  nsExec::ExecToLog 'schtasks.exe /End /TN "SAS Support Client Agent"'
  nsExec::ExecToLog 'schtasks.exe /Delete /F /TN "SAS Support Client Agent"'
  nsExec::ExecToLog 'schtasks.exe /End /TN "SAS Privileged Desktop Broker Recovery"'
  nsExec::ExecToLog 'schtasks.exe /Delete /F /TN "SAS Privileged Desktop Broker Recovery"'
  nsExec::ExecToLog 'schtasks.exe /End /TN "SAS Client ClamAV Definitions"'
  nsExec::ExecToLog 'schtasks.exe /Delete /F /TN "SAS Client ClamAV Definitions"'
  nsExec::ExecToLog 'sc.exe stop "SAS Secure Attention Broker"'
  nsExec::ExecToLog 'sc.exe delete "SAS Secure Attention Broker"'
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASClient"
  DeleteRegKey HKLM "Software\Classes\sas-client"
  RMDir /r "$SMPROGRAMS\SAS Cliente"
  RMDir /r "$INSTDIR"
SectionEnd
