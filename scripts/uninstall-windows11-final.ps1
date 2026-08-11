param(
  [string]$InstallPath = "C:\SAS\Server",
  [switch]$PurgeData
)

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "La desinstalación requiere permisos de Administrador." }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\SAS\Backups\uninstall-$stamp"
if (-not $PurgeData -and (Test-Path $InstallPath)) {
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  foreach ($name in @(".env", ".env.production", "data", "certs", "install-manifest.json")) {
    $item = Join-Path $InstallPath $name
    if (Test-Path $item) { Copy-Item -LiteralPath $item -Destination (Join-Path $backup $name) -Recurse -Force }
  }
}

foreach ($taskName in @("SAS Support Server Production", "SAS Support Client Agent")) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
}
foreach ($rule in @("SAS Support Production HTTP 80", "SAS Support Production HTTPS 443")) {
  Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue
}

[pscustomobject]@{
  status = "uninstalled"
  installPath = $InstallPath
  dataPurged = [bool]$PurgeData
  backupPath = if (-not $PurgeData) { $backup } else { $null }
  completedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 4

