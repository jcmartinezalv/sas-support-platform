param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$TaskName = "SAS Support Server Production",
  [switch]$KeepOpen = $true
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path $ProjectDir).Path
$installer = Join-Path $root "scripts\install-production-task.ps1"
if (-not (Test-Path $installer)) {
  throw "No se encontro $installer"
}

$command = @"
Set-Location '$root'
`$listener = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (`$listener) {
  Write-Host "Deteniendo listener actual en 443 PID `$(`$listener.OwningProcess) para evitar choque con la tarea..."
  Stop-Process -Id `$listener.OwningProcess -Force
  Start-Sleep -Seconds 2
}
. '$installer' -TaskName '$TaskName' -StartNow
Start-Sleep -Seconds 8
. '$root\scripts\get-production-status.ps1' -LocalOnly
Write-Host ""
Write-Host "Si el estado aparece PASS, la tarea productiva quedo instalada e iniciada."
"@

$args = @("-NoProfile", "-ExecutionPolicy", "Bypass")
if ($KeepOpen) { $args += "-NoExit" }
$args += @("-Command", $command)

Write-Host "Abriendo PowerShell como Administrador para instalar tarea productiva SAS..."
Write-Host "Proyecto: $root"
Write-Host "Tarea:    $TaskName"
Start-Process -FilePath "powershell.exe" -ArgumentList $args -Verb RunAs

