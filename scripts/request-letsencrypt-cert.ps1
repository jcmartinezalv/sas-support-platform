param(
  [Parameter(Mandatory = $true)]
  [string]$Domain,
  [Parameter(Mandatory = $true)]
  [string]$Email,
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$WacsPath = "",
  [ValidateSet("http-01-selfhosting")]
  [string]$Challenge = "http-01-selfhosting",
  [switch]$Staging
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecuta este script en PowerShell como Administrador. win-acme selfhosting necesita permisos para event log y puerto 80."
  }
}

function Resolve-WacsPath([string]$Command, [string]$Root) {
  $candidates = @()
  if ($Command) { $candidates += $Command }
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

function Resolve-CommandPath($Command) {
  if (Test-Path $Command) {
    return (Resolve-Path $Command).Path
  }
  $cmd = Get-Command $Command -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
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

  throw "El puerto $Port esta ocupado: $($details -join '; '). Deten ese servicio temporal o cambia la configuracion antes de solicitar Let's Encrypt."
}

Assert-Admin
Assert-PortAvailable -Port 80
$wacs = Resolve-WacsPath -Command $WacsPath -Root $ProjectDir
if (-not $wacs) {
  throw "No se encontro win-acme (wacs.exe). Instala win-acme o pasa -WacsPath con la ruta completa."
}

$certRoot = Join-Path $ProjectDir "certs\letsencrypt"
$pemDir = Join-Path $certRoot $Domain
New-Item -ItemType Directory -Force -Path $pemDir | Out-Null

$args = @(
  "--target", "manual",
  "--host", $Domain,
  "--validation", "selfhosting",
  "--store", "pemfiles",
  "--pemfilespath", $pemDir,
  "--installation", "none",
  "--accepttos",
  "--emailaddress", $Email
)

if ($Staging) {
  $args += @("--baseuri", "https://acme-staging-v02.api.letsencrypt.org/")
}

Write-Host "Solicitando certificado Let's Encrypt para $Domain"
Write-Host "Requisitos: DNS publico apuntando a este servidor y puerto 80 accesible desde Internet."
& $wacs @args
if ($LASTEXITCODE -ne 0) {
  throw "win-acme fallo con codigo $LASTEXITCODE"
}

$key = Get-ChildItem -Path $pemDir -Recurse -File | Where-Object { $_.Name -match 'key.*\.pem$|\.key$' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$certCandidates = Get-ChildItem -Path $pemDir -Recurse -File | Where-Object { $_.Name -match 'fullchain.*\.pem$|chain\.pem$|crt.*\.pem$|\.crt$' -and $_.Name -notmatch 'chain-only' }
$cert = $certCandidates | Sort-Object @{ Expression = {
  if ($_.Name -match 'fullchain') { 0 }
  elseif ($_.Name -match '-chain\.pem$|chain\.pem$') { 1 }
  elseif ($_.Name -match 'crt') { 2 }
  else { 3 }
}}, LastWriteTime | Select-Object -First 1

if (-not $key -or -not $cert) {
  throw "No pude localizar key/cert PEM en $pemDir. Revisa la salida de win-acme."
}

$serverKey = Join-Path $ProjectDir "certs\server.key"
$serverCert = Join-Path $ProjectDir "certs\server.crt"
Copy-Item -Path $key.FullName -Destination $serverKey -Force
Copy-Item -Path $cert.FullName -Destination $serverCert -Force

[pscustomobject]@{
  Domain = $Domain
  PemDirectory = $pemDir
  TlsKeyPath = $serverKey
  TlsCertPath = $serverCert
  PublicBaseUrl = "https://$Domain"
  Env = @{
    PUBLIC_BASE_URL = "https://$Domain"
    TLS_KEY_PATH = "certs/server.key"
    TLS_CERT_PATH = "certs/server.crt"
    ENABLE_HTTPS = "true"
    HTTPS_PORT = "443"
  }
} | ConvertTo-Json -Depth 5



