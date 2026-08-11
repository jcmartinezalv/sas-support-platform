param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$Domain = "",
  [string]$WacsPath = "",
  [string]$TaskName = "SAS Support Server Production",
  [switch]$RestartTask
)

$ErrorActionPreference = "Stop"

function Resolve-CommandPath($Command) {
  if ($Command -and (Test-Path $Command)) {
    return (Resolve-Path $Command).Path
  }
  if ($Command) {
    $cmd = Get-Command $Command -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

function Resolve-WacsPath([string]$Requested, [string]$Root) {
  $candidates = @()
  if ($Requested) { $candidates += $Requested }
  $candidates += @(
    (Join-Path $Root "tools\win-acme\wacs.exe"),
    "wacs.exe"
  )

  foreach ($candidate in $candidates) {
    $resolved = Resolve-CommandPath $candidate
    if ($resolved) { return $resolved }
  }
  return $null
}

function Read-EnvValue([string]$PathValue, [string]$Name, [string]$Default = "") {
  if (-not (Test-Path $PathValue)) { return $Default }
  $line = Get-Content $PathValue | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return $Default }
  return ($line -split "=", 2)[1].Trim()
}

function Assert-PortAvailable([int]$Port) {
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $listeners) { return }

  $details = @()
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($process) { $process.ProcessName } else { "desconocido" }
    $details += "PID $($listener.OwningProcess) ($name) en $($listener.LocalAddress):$Port"
  }

  throw "El puerto $Port esta ocupado: $($details -join '; '). Deten SAS o cualquier listener temporal antes de renovar Let's Encrypt."
}

function Select-LetsEncryptCert([string]$PemDir) {
  $candidates = Get-ChildItem -Path $PemDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'fullchain.*\.pem$|chain\.pem$|crt.*\.pem$|\.crt$' -and $_.Name -notmatch 'chain-only' }

  return $candidates | Sort-Object @{ Expression = {
    if ($_.Name -match 'fullchain') { 0 }
    elseif ($_.Name -match '-chain\.pem$|chain\.pem$') { 1 }
    elseif ($_.Name -match 'crt') { 2 }
    else { 3 }
  }}, LastWriteTime | Select-Object -First 1
}

function Select-LetsEncryptKey([string]$PemDir) {
  Get-ChildItem -Path $PemDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'key.*\.pem$|\.key$' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

$root = (Resolve-Path $ProjectDir).Path
$envFile = Join-Path $root ".env.production"
if (-not $Domain) {
  $publicBaseUrl = Read-EnvValue $envFile "PUBLIC_BASE_URL" ""
  if ($publicBaseUrl) { $Domain = ([Uri]$publicBaseUrl).Host }
}
if (-not $Domain) { throw "No se pudo determinar dominio. Pasa -Domain o configura PUBLIC_BASE_URL en .env.production." }

$wacs = Resolve-WacsPath -Requested $WacsPath -Root $root
if (-not $wacs) {
  throw "No se encontro win-acme (wacs.exe). Instala win-acme o pasa -WacsPath con la ruta completa."
}

Assert-PortAvailable -Port 80

& $wacs --renew --baseuri "https://acme-v02.api.letsencrypt.org/"
if ($LASTEXITCODE -ne 0) {
  throw "Renovacion win-acme fallo con codigo $LASTEXITCODE"
}

$pemDir = Join-Path $root ("certs\letsencrypt\" + $Domain)
$key = Select-LetsEncryptKey $pemDir
$cert = Select-LetsEncryptCert $pemDir
if (-not $key -or -not $cert) {
  throw "No pude localizar key/cert PEM renovados en $pemDir. Revisa la salida de win-acme."
}

Copy-Item -Path $key.FullName -Destination (Join-Path $root "certs\server.key") -Force
Copy-Item -Path $cert.FullName -Destination (Join-Path $root "certs\server.crt") -Force

if ($RestartTask) {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $TaskName
  } else {
    Write-Warning "No existe la tarea programada '$TaskName'. Reinicia SAS manualmente para recargar TLS."
  }
}

[pscustomobject]@{
  Domain = $Domain
  PemDirectory = $pemDir
  TlsKeyPath = "certs/server.key"
  TlsCertPath = "certs/server.crt"
  RestartTask = [bool]$RestartTask
  TaskName = $TaskName
  RenewedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 5
