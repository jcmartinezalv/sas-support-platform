param(
  [string]$InstallPath = "C:\SAS\Client",
  [string]$TaskName = "SAS Client ClamAV Definitions"
)

$ErrorActionPreference = "Stop"
$clamRoot = Join-Path $InstallPath "tools\clamav"
$freshClam = Join-Path $clamRoot "freshclam.exe"
$database = Join-Path $clamRoot "database"
$config = Join-Path $clamRoot "freshclam.conf"
$statusPath = Join-Path $InstallPath "updates\last-clamav-update.json"
$logPath = Join-Path $InstallPath "logs\clamav-definitions.log"
$created = $false
$mutex = New-Object Threading.Mutex($true, "Global\SASClientClamAVDefinitions", [ref]$created)

function Write-ClamStatus([string]$Status, [string]$Message, [hashtable]$Extra = @{}) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statusPath) | Out-Null
  $body = [ordered]@{
    status = $Status
    message = $Message
    taskName = $TaskName
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  foreach ($key in $Extra.Keys) { $body[$key] = $Extra[$key] }
  $body | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusPath -Encoding UTF8
}

try {
  if (-not $created) {
    Write-ClamStatus "skipped" "Ya existe otra actualización de firmas ClamAV en ejecución."
    exit 0
  }
  if (-not (Test-Path -LiteralPath $freshClam -PathType Leaf)) {
    throw "No se encontró el actualizador integrado de ClamAV."
  }
  New-Item -ItemType Directory -Force -Path $database,(Split-Path -Parent $logPath) | Out-Null
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 2097152) {
    Move-Item -LiteralPath $logPath -Destination "$logPath.previous" -Force
  }
  $arguments = @("--datadir=$database", "--stdout")
  if (Test-Path -LiteralPath $config -PathType Leaf) {
    $arguments = @("--config-file=$config") + $arguments
  }
  Write-ClamStatus "running" "Actualizando las firmas de ClamAV en segundo plano."
  $process = Start-Process -FilePath $freshClam -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError "$logPath.error"
  if ($process.ExitCode -ne 0) {
    $detail = if (Test-Path "$logPath.error") { (Get-Content "$logPath.error" -Raw -ErrorAction SilentlyContinue).Trim() } else { "" }
    throw "freshclam terminó con código $($process.ExitCode). $detail".Trim()
  }
  $definitions = @(Get-ChildItem -LiteralPath $database -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @(".cvd", ".cld") })
  if (-not $definitions.Count) {
    throw "ClamAV terminó sin dejar definiciones utilizables."
  }
  Write-ClamStatus "pass" "Firmas de ClamAV actualizadas correctamente." @{
    definitions = $definitions.Count
    newestDefinitionUtc = ($definitions | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc.ToString("o")
    exitCode = $process.ExitCode
  }
} catch {
  Write-ClamStatus "fail" $_.Exception.Message
  throw
} finally {
  if ($created) { $mutex.ReleaseMutex() | Out-Null }
  $mutex.Dispose()
}
