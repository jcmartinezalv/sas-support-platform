param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$TaskName = "SAS Support Server Production",
  [switch]$KeepOpen = $true
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path $ProjectDir).Path
$verifier = Join-Path $root "scripts\verify-production-task.ps1"
if (-not (Test-Path $verifier)) {
  throw "No se encontro $verifier"
}

$command = @"
Set-Location '$root'
. '$verifier' -ProjectDir '$root' -TaskName '$TaskName'
Write-Host ""
Write-Host "Reporte: $root\output\production-task-verification.json"
"@

$args = @("-NoProfile", "-ExecutionPolicy", "Bypass")
if ($KeepOpen) { $args += "-NoExit" }
$args += @("-Command", $command)

Write-Host "Abriendo PowerShell como Administrador para verificar tarea productiva SAS..."
Write-Host "Proyecto: $root"
Write-Host "Tarea:    $TaskName"
Start-Process -FilePath "powershell.exe" -ArgumentList $args -Verb RunAs
