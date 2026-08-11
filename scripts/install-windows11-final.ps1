param(
  [string]$SourcePath = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$InstallPath = "C:\SAS\Server",
  [string]$PublicBaseUrl = "https://setinfo.sytes.net",
  [string]$Domain = "",
  [string]$Email = "",
  [switch]$RequestCertificate,
  [switch]$InstallAgent,
  [switch]$UnsignedRestrictedProduction,
  [switch]$NonInteractive,
  [switch]$PreflightOnly
)

$ErrorActionPreference = "Stop"
$serverTask = "SAS Support Server Production"
$agentTask = "SAS Support Client Agent"

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Copy-Tree([string]$From, [string]$To) {
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  Get-ChildItem -LiteralPath $From -Recurse -File -Force | ForEach-Object {
    $relative = $_.FullName.Substring($From.Length).TrimStart('\')
    $target = Join-Path $To $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $target -Force
  }
}

function Save-State([string]$Root, [string]$Backup) {
  New-Item -ItemType Directory -Force -Path $Backup | Out-Null
  foreach ($name in @(".env", ".env.production", "data", "certs", "install-manifest.json", "post-install-checklist.json")) {
    $item = Join-Path $Root $name
    if (Test-Path -LiteralPath $item) { Copy-Item -LiteralPath $item -Destination (Join-Path $Backup $name) -Recurse -Force }
  }
}

if (-not $PreflightOnly -and -not (Test-Administrator)) { throw "Ejecuta INSTALAR-SAS.cmd y acepta el permiso de Administrador." }
if (-not [Environment]::Is64BitOperatingSystem) { throw "SAS requiere Windows 11 de 64 bits." }
$build = [Environment]::OSVersion.Version.Build
if ($build -lt 22000) { throw "SAS requiere Windows 11 (build 22000 o posterior). Build detectado: $build." }

$source = (Resolve-Path -LiteralPath $SourcePath).Path
if (-not (Test-Path -LiteralPath (Join-Path $source "package.json"))) { throw "El paquete no contiene package.json: $source" }
if (-not $Domain) { $Domain = ([Uri]$PublicBaseUrl).Host }
if ($PreflightOnly) {
  $preflightNode = Join-Path $source "runtime\node\node.exe"
  if (-not (Test-Path -LiteralPath $preflightNode)) { throw "El paquete no contiene runtime\node\node.exe." }
  $preflightVersion = & $preflightNode --version
  if ($preflightVersion -notmatch '^v(2[4-9]|[3-9][0-9])\.') { throw "El runtime Node.js incluido no es compatible." }
  [pscustomobject]@{ status = "pass"; windowsBuild = $build; sourcePath = $source; nodeVersion = $preflightVersion; publicBaseUrl = $PublicBaseUrl } | ConvertTo-Json
  exit 0
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = "C:\SAS\Backups\before-install-$stamp"

$existingServerTask = Get-ScheduledTask -TaskName $serverTask -ErrorAction SilentlyContinue
if ($existingServerTask) {
  Stop-ScheduledTask -TaskName $serverTask -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

if (Test-Path -LiteralPath $InstallPath) { Save-State -Root $InstallPath -Backup $backupPath }
if ($source.TrimEnd('\') -ne $InstallPath.TrimEnd('\')) {
  New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
  foreach ($name in @("src", "public", "scripts", "docs", "client", "runtime", "tools", "downloads")) {
    $item = Join-Path $source $name
    if (Test-Path -LiteralPath $item) { Copy-Tree -From $item -To (Join-Path $InstallPath $name) }
  }
  foreach ($name in @("package.json", "README.md", ".env.example")) {
    $item = Join-Path $source $name
    if (Test-Path -LiteralPath $item) { Copy-Item -LiteralPath $item -Destination (Join-Path $InstallPath $name) -Force }
  }
}

$node = Join-Path $InstallPath "runtime\node\node.exe"
if (-not (Test-Path -LiteralPath $node)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) { $node = $nodeCommand.Source } else { throw "El paquete no contiene runtime\node\node.exe." }
}
if ((& $node --version) -notmatch '^v(2[4-9]|[3-9][0-9])\.') { throw "El runtime Node.js incluido no es compatible." }

Set-Location $InstallPath
New-Item -ItemType Directory -Force -Path "output", "data", "logs", "certs" | Out-Null
$envPath = Join-Path $InstallPath ".env.production"
if (-not (Test-Path -LiteralPath $envPath)) {
  & (Join-Path $InstallPath "scripts\prepare-production-config.ps1") -ProjectDir $InstallPath -OutputEnvPath ".env.production" -PublicBaseUrl $PublicBaseUrl -EnableUpdateApply
} else {
  & (Join-Path $InstallPath "scripts\prepare-production-config.ps1") -ProjectDir $InstallPath -OutputEnvPath ".env.production" -RefreshReportOnly
}

$keyPath = Join-Path $InstallPath "certs\server.key"
$certPath = Join-Path $InstallPath "certs\server.crt"
if ((-not (Test-Path $keyPath) -or -not (Test-Path $certPath)) -and -not $RequestCertificate -and -not $NonInteractive) {
  $answer = Read-Host "No hay certificado TLS. ¿Solicitar Let's Encrypt ahora? [S/N]"
  if ($answer -match '^[sS]') { $RequestCertificate = $true }
}
if ($RequestCertificate -and (-not (Test-Path $keyPath) -or -not (Test-Path $certPath))) {
  if (-not $Email -and -not $NonInteractive) { $Email = Read-Host "Correo para avisos de Let's Encrypt" }
  if (-not $Email) { throw "Se requiere un correo para solicitar el certificado." }
  & (Join-Path $InstallPath "scripts\request-letsencrypt-cert.ps1") -Domain $Domain -Email $Email -ProjectDir $InstallPath
}

$tlsReady = (Test-Path $keyPath) -and (Test-Path $certPath)
$status = if ($tlsReady) { "installed" } else { "pending_certificate" }
if ($tlsReady) {
  $serviceInstaller = Join-Path $InstallPath "scripts\install-sas-services.ps1"
  if (Test-Path $serviceInstaller) { & $serviceInstaller -ProjectDir $InstallPath -NodeExe $node | Out-Null }
  else { & (Join-Path $InstallPath "scripts\install-production-task.ps1") -ProjectDir $InstallPath -EnvPath $envPath -TaskName $serverTask -NodeExe $node -StartNow | Out-Null }
  Start-Sleep -Seconds 5
  if ($InstallAgent) {
    $agentArgs = @{ InstallPath = "C:\SAS\Client"; ServerUrl = $PublicBaseUrl; ServerEnvPath = $envPath; NodeExe = $node }
    if ($UnsignedRestrictedProduction) { & (Join-Path $InstallPath "scripts\install-client.ps1") @agentArgs -UnsignedRestrictedProduction | Out-Null }
    else { & (Join-Path $InstallPath "scripts\install-client.ps1") @agentArgs | Out-Null }
  }
}

$report = [pscustomobject]@{
  product = "SAS Support Platform"
  version = (Get-Content (Join-Path $InstallPath "package.json") -Raw | ConvertFrom-Json).version
  status = $status
  windowsBuild = $build
  installPath = $InstallPath
  publicBaseUrl = $PublicBaseUrl
  node = @{ path = $node; version = (& $node --version) }
  tlsReady = $tlsReady
  serverTask = if ($tlsReady) { $serverTask } else { $null }
  agentRequested = [bool]$InstallAgent
  unsignedRestrictedProduction = [bool]$UnsignedRestrictedProduction
  backupPath = if (Test-Path $backupPath) { $backupPath } else { $null }
  completedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
}
$reportPath = Join-Path $InstallPath "output\windows11-install-report.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 6
if (-not $tlsReady) { Write-Warning "Instalación preparada, pero pendiente de certificado TLS. Ejecuta scripts\request-letsencrypt-elevated.ps1 y luego este instalador nuevamente." }

