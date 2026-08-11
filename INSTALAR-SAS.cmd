@echo off
setlocal
title Instalador SAS para Windows 11
echo SAS Support Platform - Instalador Windows 11
echo Se solicitara permiso de Administrador.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%~dp0scripts\install-windows11-final.ps1"" -SourcePath ""%~dp0"" -InstallPath ""C:\SAS\Server"" -PublicBaseUrl ""https://setinfo.sytes.net"" -Domain ""setinfo.sytes.net"" -InstallAgent -UnsignedRestrictedProduction'"
if errorlevel 1 (
  echo La instalacion no se completo. Revisa el mensaje anterior.
  pause
  exit /b 1
)
echo Instalacion finalizada. Revisa C:\SAS\Server\output\windows11-install-report.json
pause

