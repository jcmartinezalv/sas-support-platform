param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$EnvPath = ".env.production",
  [string]$NodeExe = "",
  [switch]$RequireAdmin = $true
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecuta este script como Administrador para usar puertos 80/443."
  }
}

function Resolve-NodeExe([string]$Requested) {
  $candidates = @()
  if ($Requested) { $candidates += $Requested }
  $candidates += @(
    (Join-Path $PSScriptRoot "..\runtime\node\node.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    "node"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -eq "node") {
      $cmd = Get-Command node -ErrorAction SilentlyContinue
      if ($cmd) { return $cmd.Source }
    } elseif (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "No se encontro Node.js. Instala Node.js o pasa -NodeExe."
}

function Import-EnvFile([string]$PathValue) {
  Get-Content $PathValue | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
  }
}

function Read-Bool([string]$Value, [bool]$Default) {
  if ($null -eq $Value -or $Value -eq "") { return $Default }
  return @("1", "true", "yes", "on") -contains $Value.ToLowerInvariant()
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

  throw "No se puede iniciar SAS: el puerto $Port esta ocupado por $($details -join '; ')."
}

if ($RequireAdmin) { Assert-Admin }
$root = (Resolve-Path $ProjectDir).Path
Set-Location $root
$envFile = if ([System.IO.Path]::IsPathRooted($EnvPath)) { $EnvPath } else { Join-Path $root $EnvPath }
if (-not (Test-Path $envFile)) {
  throw "No se encontro archivo de entorno: $envFile"
}

Import-EnvFile $envFile

$enableHttp = Read-Bool $env:ENABLE_HTTP $true
$enableHttps = Read-Bool $env:ENABLE_HTTPS $true
if (-not $enableHttp -and -not $enableHttps) {
  throw "ENABLE_HTTP y ENABLE_HTTPS estan desactivados. Activa al menos un protocolo."
}

$keyRelative = if ($env:TLS_KEY_PATH) { $env:TLS_KEY_PATH } else { "certs/server.key" }
$certRelative = if ($env:TLS_CERT_PATH) { $env:TLS_CERT_PATH } else { "certs/server.crt" }
$keyPath = Join-Path $root ($keyRelative -replace '/', '\')
$certPath = Join-Path $root ($certRelative -replace '/', '\')
if ($enableHttps -and (-not (Test-Path $keyPath) -or -not (Test-Path $certPath))) {
  Write-Warning "Certificados TLS ausentes; se iniciara solo HTTP. Esperados: $keyPath y $certPath."
  $enableHttps = $false
  $env:ENABLE_HTTPS = "false"
}
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "sas-production.out.log"
$errLog = Join-Path $logDir "sas-production.err.log"
$pidFile = Join-Path $logDir "sas-production.pid"

$PID | Set-Content -Path $pidFile -Encoding ASCII
"[$(Get-Date -Format o)] Starting SAS production server with $envFile wrapperPID=$PID" | Add-Content -Path $outLog -Encoding UTF8
Write-Host "Iniciando SAS en modo produccion..."
Write-Host "PUBLIC_BASE_URL=$env:PUBLIC_BASE_URL"
Write-Host "HTTP_PORT=$env:HTTP_PORT HTTPS_PORT=$env:HTTPS_PORT ENABLE_HTTP=$env:ENABLE_HTTP ENABLE_HTTPS=$env:ENABLE_HTTPS"
Write-Host "Wrapper PID=$PID"

$exitCode = 1
try {
  & $node "src\server.js" 1>> $outLog 2>> $errLog
  $exitCode = if ($null -eq $LASTEXITCODE) { 1 } else { [int]$LASTEXITCODE }
  "[$(Get-Date -Format o)] SAS production server exited with code $exitCode" | Add-Content -Path $outLog -Encoding UTF8
} catch {
  "[$(Get-Date -Format o)] SAS production server failed: $($_.Exception.Message)" | Add-Content -Path $errLog -Encoding UTF8
  $exitCode = 1
} finally {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

exit $exitCode

