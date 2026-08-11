param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [string]$ExpectedVersion = "",
  [string]$ExpectedSha256 = "",
  [string]$InstallPath = "C:\SAS\Client",
  [string]$StatusPath = "",
  [string]$TaskName = "SAS Support Client Update"
)

$ErrorActionPreference = "Stop"
if (-not $StatusPath) { $StatusPath = Join-Path $InstallPath "updates\last-update.json" }

function Write-UpdateStatus([string]$Status, [string]$Message, [hashtable]$Extra = @{}) {
  $parent = Split-Path -Parent $StatusPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $body = [ordered]@{
    status = $Status
    message = $Message
    expectedVersion = $ExpectedVersion
    taskName = $TaskName
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  foreach ($key in $Extra.Keys) { $body[$key] = $Extra[$key] }
  $body | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusPath -Encoding UTF8
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$resolved = (Resolve-Path -LiteralPath $InstallerPath).Path
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $InstallPath "updates")).TrimEnd('\') + '\'
if (-not $resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "La actualización está fuera del directorio autorizado."
}
if ([IO.Path]::GetExtension($resolved) -ne ".exe") {
  throw "El paquete de actualización no es ejecutable."
}
if ($ExpectedSha256) {
  $actualSha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
  if ($actualSha256 -ne $ExpectedSha256.ToUpperInvariant()) {
    throw "El instalador cambió después de descargarse. SAS canceló la actualización."
  }
}

if (-not (Test-Administrator)) {
  $arguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"' + $PSCommandPath + '"'),
    "-InstallerPath", ('"' + $resolved + '"'),
    "-ExpectedVersion", ('"' + $ExpectedVersion + '"'),
    "-ExpectedSha256", ('"' + $ExpectedSha256 + '"'),
    "-InstallPath", ('"' + $InstallPath + '"'),
    "-StatusPath", ('"' + $StatusPath + '"'),
    "-TaskName", ('"' + $TaskName + '"')
  )
  Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments | Out-Null
  exit 0
}

try {
  $updatesRoot = Join-Path $InstallPath "updates"
  New-Item -ItemType Directory -Force -Path $updatesRoot | Out-Null
  $sourceWorker = Join-Path (Split-Path -Parent $PSCommandPath) "apply-client-update.ps1"
  if (-not (Test-Path -LiteralPath $sourceWorker -PathType Leaf)) {
    throw "Falta el aplicador programado de SAS Cliente."
  }
  $worker = Join-Path $updatesRoot "apply-client-update.ps1"
  Copy-Item -LiteralPath $sourceWorker -Destination $worker -Force
  $sourceCleanup = Join-Path (Split-Path -Parent $PSCommandPath) "stop-client-components.ps1"
  if (-not (Test-Path -LiteralPath $sourceCleanup -PathType Leaf)) {
    throw "Falta el liberador de componentes nativos de SAS Cliente."
  }
  Copy-Item -LiteralPath $sourceCleanup -Destination (Join-Path $updatesRoot "stop-client-components.ps1") -Force

  $taskArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$worker`" -InstallerPath `"$resolved`" -ExpectedVersion `"$ExpectedVersion`" -ExpectedSha256 `"$ExpectedSha256`" -InstallPath `"$InstallPath`" -StatusPath `"$StatusPath`" -TaskName `"$TaskName`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArguments
  $scheduledAt = (Get-Date).AddSeconds(15)
  $trigger = New-ScheduledTaskTrigger -Once -At $scheduledAt
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Description "Actualiza SAS Cliente fuera de sus procesos y elimina esta tarea al terminar" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

  Write-UpdateStatus "scheduled" "Actualización $ExpectedVersion programada. SAS Cliente se cerrará y reiniciará automáticamente." @{
    installerPath = $resolved
    scheduledAt = $scheduledAt.ToUniversalTime().ToString("o")
    progressPercent = 65
  }
} catch {
  Write-UpdateStatus "fail" $_.Exception.Message
  throw
}