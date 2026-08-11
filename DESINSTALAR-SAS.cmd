@echo off
setlocal
title Desinstalador SAS
echo SAS conservara datos, certificados y configuracion en C:\SAS\Backups.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%~dp0scripts\uninstall-windows11-final.ps1"" -InstallPath ""C:\SAS\Server""'"
pause

