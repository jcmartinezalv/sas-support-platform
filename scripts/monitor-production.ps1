param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$TaskName = "SAS Support Server Production",
  [string]$BaseUrl = "",
  [string]$HostName = "",
  [string]$ReportPath = "output\production-monitor-report.json",
  [switch]$LocalOnly,
  [switch]$RemoteOnly,
  [switch]$RestartOnFail
)

$ErrorActionPreference = "Stop"

function Invoke-ProductionStatus([string]$Root, [string]$Url, [string]$TargetHost, [bool]$UseLocalOnly, [bool]$UseRemoteOnly) {
  $script = Join-Path $Root "scripts\get-production-status.ps1"
  if (-not (Test-Path $script)) { throw "No se encontro $script" }

  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script, "-ProjectDir", $Root)
  if ($UseLocalOnly) {
    $args += "-LocalOnly"
  } elseif ($UseRemoteOnly) {
    $args += "-RemoteOnly"
    if ($Url) { $args += @("-BaseUrl", $Url) }
    if ($TargetHost) { $args += @("-HostName", $TargetHost) }
  } else {
    if ($Url) { $args += @("-BaseUrl", $Url) }
    if ($TargetHost) { $args += @("-HostName", $TargetHost) }
  }

  $json = & powershell.exe @args
  return $json | ConvertFrom-Json
}

$root = (Resolve-Path $ProjectDir).Path
if($LocalOnly -and $RemoteOnly){throw "LocalOnly y RemoteOnly no pueden usarse juntos."}
if($RemoteOnly -and $RestartOnFail){throw "RemoteOnly no puede reiniciar una tarea de otra maquina."}
$before = Invoke-ProductionStatus -Root $root -Url $BaseUrl -TargetHost $HostName -UseLocalOnly ([bool]$LocalOnly) -UseRemoteOnly ([bool]$RemoteOnly)
$restarted = $false
$after = $null
$nextActions = @()

if ($before.status -eq "fail" -and $RestartOnFail) {
  $restartScript = Join-Path $root "scripts\restart-production-task.ps1"
  if (-not (Test-Path $restartScript)) { throw "No se encontro $restartScript" }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $restartScript -ProjectDir $root -TaskName $TaskName | Out-Null
  $restarted = $true
  $after = Invoke-ProductionStatus -Root $root -Url $BaseUrl -TargetHost $HostName -UseLocalOnly ([bool]$LocalOnly) -UseRemoteOnly ([bool]$RemoteOnly)
} elseif ($before.status -eq "fail" -and $RemoteOnly) {
  $nextActions += "Revisar SERVER, DNS, HTTPS y la tarea productiva desde la maquina definitiva."
} elseif ($before.status -eq "fail") {
  $nextActions += "Ejecutar scripts\restart-production-task.ps1 si la tarea productiva ya esta instalada."
}

if ($before.status -eq "warn" -and $LocalOnly) {
  $nextActions += "Revisar listener local, health local y logs\sas-production.err.log."
} elseif ($before.status -eq "warn") {
  $nextActions += "Validar desde red externa: NAT 443, DDNS setinfo.sytes.net y firewall."
}

$effective = if ($after) { $after } else { $before }
$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  status = $effective.status
  taskName = $TaskName
  localOnly = [bool]$LocalOnly
  remoteOnly = [bool]$RemoteOnly
  restartOnFail = [bool]$RestartOnFail
  restarted = $restarted
  before = $before
  after = $after
  nextActions = $nextActions
}

$target = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $root $ReportPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$report | ConvertTo-Json -Depth 12 | Set-Content -Path $target -Encoding UTF8
$report | ConvertTo-Json -Depth 12

