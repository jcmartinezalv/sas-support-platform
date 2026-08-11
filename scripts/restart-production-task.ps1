param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$TaskName = "SAS Support Server Production",
  [int]$WaitSeconds = 6,
  [string]$ReportPath = "output\production-restart-report.json"
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path $ProjectDir).Path
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  throw "No existe la tarea programada '$TaskName'. Ejecuta scripts\install-production-task.ps1 como Administrador."
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds $WaitSeconds

$statusScript = Join-Path $root "scripts\get-production-status.ps1"
$status = $null
if (Test-Path $statusScript) {
  $statusJson = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $statusScript -ProjectDir $root -LocalOnly
  $status = $statusJson | ConvertFrom-Json
}

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  taskName = $TaskName
  restarted = $true
  waitSeconds = $WaitSeconds
  status = $status
}

$target = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $root $ReportPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$report | ConvertTo-Json -Depth 10 | Set-Content -Path $target -Encoding UTF8
$report | ConvertTo-Json -Depth 10
