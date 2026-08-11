Unicode True
RequestExecutionLevel admin
ManifestSupportedOS Win10
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

!ifndef SourceRoot
  !error "SourceRoot is required"
!endif
!ifndef OutputDir
  !define OutputDir "."
!endif
!ifndef AppVersion
  !define AppVersion "0.2.1"
!endif

Name "SAS Support Platform"
OutFile "${OutputDir}\SAS-Windows11-Setup-${AppVersion}.exe"
InstallDir "C:\SAS\Server"
InstallDirRegKey HKLM "Software\SAS Support Platform" "InstallDir"
BrandingText "SAS Support Platform"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${AppVersion}.0"
VIAddVersionKey /LANG=1034 "ProductName" "SAS Support Platform"
VIAddVersionKey /LANG=1034 "CompanyName" "SAS Support Platform"
VIAddVersionKey /LANG=1034 "LegalCopyright" "Copyright (C) 2026 SAS Support Platform"
VIAddVersionKey /LANG=1034 "FileDescription" "Instalador SAS para Windows 11"
VIAddVersionKey /LANG=1034 "FileVersion" "${AppVersion}"
VIAddVersionKey /LANG=1034 "ProductVersion" "${AppVersion}"

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

Function .onInit
  ${IfNot} ${AtLeastWin11}
    MessageBox MB_ICONSTOP "SAS requiere Windows 11."
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "SAS requiere Windows 11 de 64 bits."
    Abort
  ${EndIf}
FunctionEnd

Section "SAS Support Platform" SEC_MAIN
  SetShellVarContext all
  SetRegView 64
  DetailPrint "Deteniendo servicios SAS para actualizar sin perder configuracion..."
  ExecWait 'sc.exe stop "SAS Support Server"'
  ExecWait 'sc.exe stop "SAS Support Client Agent"'
  SetOutPath "$INSTDIR"
  File /r "${SourceRoot}\*"
  WriteUninstaller "$INSTDIR\Desinstalar-SAS.exe"

  WriteRegStr HKLM "Software\SAS Support Platform" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASSupportPlatform" "DisplayName" "SAS Support Platform"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASSupportPlatform" "DisplayVersion" "${AppVersion}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASSupportPlatform" "Publisher" "SAS Support Platform"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASSupportPlatform" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASSupportPlatform" "UninstallString" '"$INSTDIR\Desinstalar-SAS.exe"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASSupportPlatform" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASSupportPlatform" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\SAS Support Platform"
  CreateShortCut "$SMPROGRAMS\SAS Support Platform\Desinstalar SAS.lnk" "$INSTDIR\Desinstalar-SAS.exe"

  ${GetOptions} $CMDLINE "/SKIPCONFIG=" $0
  ${If} $0 != "1"
    DetailPrint "Configurando servidor y agente SAS..."
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\install-windows11-final.ps1" -SourcePath "$INSTDIR" -InstallPath "$INSTDIR" -PublicBaseUrl "https://setinfo.sytes.net" -Domain "setinfo.sytes.net" -InstallAgent -UnsignedRestrictedProduction' $1
    ${If} $1 != 0
      MessageBox MB_ICONSTOP "La configuración de SAS terminó con código $1. Revisa el registro del instalador."
      Abort
    ${EndIf}
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64
  StrCmp $INSTDIR "C:\SAS\Server" 0 skipLifecycle
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\uninstall-windows11-final.ps1" -InstallPath "$INSTDIR"' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "No se pudo respaldar y retirar el servicio SAS. Código $0."
    Abort
  ${EndIf}
  skipLifecycle:
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SASSupportPlatform"
  DeleteRegKey HKLM "Software\SAS Support Platform"
  RMDir /r "$SMPROGRAMS\SAS Support Platform"
  RMDir /r "$INSTDIR"
SectionEnd

