param(
  [string]$OutputRoot = "dist",
  [string]$PackageName = "sas-windows11-final",
  [string]$NodeVersion = "24.18.0",
  [string]$NodeArchivePath = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Invoke-VerifiedDownload([string]$Uri, [string]$OutFile = "") {
  $lastError = $null
  for ($attempt = 1; $attempt -le 4; $attempt += 1) {
    try {
      $parameters = @{ Uri = $Uri; UseBasicParsing = $true; TimeoutSec = 45 }
      if ($OutFile) { $parameters.OutFile = $OutFile }
      return Invoke-WebRequest @parameters
    } catch {
      $lastError = $_
      if ($attempt -lt 4) { Start-Sleep -Seconds ([Math]::Min(2 * $attempt, 6)) }
    }
  }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    if ($OutFile) {
      & $curl.Source --fail --silent --show-error --location --retry 4 --retry-delay 2 --output $OutFile $Uri
      if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $OutFile -PathType Leaf)) { return $null }
    } else {
      $content = (& $curl.Source --fail --silent --show-error --location --retry 4 --retry-delay 2 $Uri | Out-String)
      if ($LASTEXITCODE -eq 0 -and $content) { return [pscustomobject]@{ Content = $content } }
    }
  }
  throw "No fue posible descargar $Uri después de 4 intentos: $($lastError.Exception.Message)"
}
$root = (Resolve-Path "$PSScriptRoot\..").Path
$buildMutex = New-Object Threading.Mutex($false, "Global\SASReleaseBuild")
$buildLockAcquired = $false
try { $buildLockAcquired = $buildMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $buildLockAcquired = $true }
if (-not $buildLockAcquired) { throw "Ya existe otra compilación de SAS en curso. Espera a que termine antes de iniciar otra." }
$baseBuilder = Join-Path $root "scripts\build-windows11-mvp-release.ps1"
$baseJson = & $baseBuilder -OutputRoot $OutputRoot -PackageName $PackageName -IncludeWinAcme -Zip:$false | Out-String
$base = $baseJson | ConvertFrom-Json
$outDir = $base.outputDir

Copy-Item (Join-Path $root "INSTALAR-SAS.cmd") (Join-Path $outDir "INSTALAR-SAS.cmd") -Force
Copy-Item (Join-Path $root "DESINSTALAR-SAS.cmd") (Join-Path $outDir "DESINSTALAR-SAS.cmd") -Force

$nodeFile = "node-v$NodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeFile"
$checksumsUrl = "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"
if (-not $NodeArchivePath) {
  $cacheDir = Join-Path $root "tools\cache\node"
  New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
  $NodeArchivePath = Join-Path $cacheDir $nodeFile
  if (-not (Test-Path $NodeArchivePath)) { Invoke-VerifiedDownload -Uri $nodeUrl -OutFile $NodeArchivePath | Out-Null }
}
$NodeArchivePath = (Resolve-Path $NodeArchivePath).Path
$checksumCachePath = Join-Path $root "tools\cache\node\SHASUMS256-$NodeVersion.txt"
try {
  $checksumText = (Invoke-VerifiedDownload -Uri $checksumsUrl).Content
  [IO.File]::WriteAllText($checksumCachePath, $checksumText, (New-Object Text.UTF8Encoding($false)))
} catch {
  if (-not (Test-Path -LiteralPath $checksumCachePath -PathType Leaf)) { throw }
  $checksumText = [IO.File]::ReadAllText($checksumCachePath)
  Write-Warning "Node.js no respondió; se usa el catálogo SHA-256 verificado en una compilación anterior."
}
$match = [regex]::Match($checksumText, "(?m)^([a-fA-F0-9]{64})\s+$([regex]::Escape($nodeFile))$")
if (-not $match.Success) { throw "No se encontró el SHA-256 oficial de $nodeFile." }
$expectedHash = $match.Groups[1].Value.ToUpperInvariant()
$actualHash = (Get-FileHash $NodeArchivePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) { throw "El SHA-256 del runtime Node.js no coincide con el oficial." }

$runtimeRoot = Join-Path $outDir "runtime\node"
$stagingRoot = Join-Path $outDir "runtime\node-staging"
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
Expand-Archive -Path $NodeArchivePath -DestinationPath $stagingRoot -Force
$expanded = Get-ChildItem $stagingRoot -Directory | Select-Object -First 1
if (-not $expanded -or -not (Test-Path (Join-Path $expanded.FullName "node.exe"))) { throw "El archivo oficial de Node.js no contiene node.exe." }
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
Copy-Item (Join-Path $expanded.FullName "node.exe") (Join-Path $runtimeRoot "node.exe") -Force
Copy-Item (Join-Path $expanded.FullName "LICENSE") (Join-Path $runtimeRoot "LICENSE-NODE.txt") -Force
Remove-Item -LiteralPath $stagingRoot -Recurse -Force

# Componentes nativos requeridos por SAS Cliente. ClamAV viaja sin firmas; freshclam las descarga despues.
$clientToolsRoot = Join-Path $outDir "tools"
New-Item -ItemType Directory -Force -Path $clientToolsRoot | Out-Null
foreach ($toolName in @("sas-capture-helper", "sas-dxgi-capture", "sas-input-helper", "sas-secure-attention-broker")) {
  $toolSource = Join-Path $root "tools\$toolName"
  if (-not (Test-Path -LiteralPath $toolSource -PathType Container)) { throw "Falta componente requerido: $toolSource" }
  Copy-Item -LiteralPath $toolSource -Destination (Join-Path $clientToolsRoot $toolName) -Recurse -Force
}
$coturnSource = Join-Path $root "tools\coturn"
$coturnExe = Join-Path $coturnSource "turnserver.exe"
if (-not (Test-Path -LiteralPath $coturnExe -PathType Leaf)) { throw "Falta el motor coturn oficial para Windows: $coturnExe" }
Copy-Item -LiteralPath $coturnSource -Destination (Join-Path $clientToolsRoot "coturn") -Recurse -Force
$clamSource = Join-Path $root "tools\clamav"
$clamTarget = Join-Path $clientToolsRoot "clamav"
if (-not (Test-Path -LiteralPath (Join-Path $clamSource "clamscan.exe") -PathType Leaf)) { throw "Falta el motor ClamAV integrado." }
New-Item -ItemType Directory -Force -Path $clamTarget | Out-Null
Get-ChildItem -LiteralPath $clamSource -Recurse -File | Where-Object {
  $_.FullName -notlike "*\database\*" -and $_.Extension -notin @(".cvd", ".cld", ".sign") -and $_.Name -ne "freshclam.dat"
} | ForEach-Object {
  $relative = $_.FullName.Substring($clamSource.Length).TrimStart('\')
  $destination = Join-Path $clamTarget $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
}
if (Test-Path -LiteralPath (Join-Path $clamTarget "database")) { throw "Las firmas ClamAV no deben viajar dentro del instalador." }

# Windows PowerShell 5.1 interpreta UTF-8 sin BOM como ANSI. Normalizamos los
# scripts empaquetados para evitar texto corrupto y errores de análisis regionales.
$utf8WithBom = New-Object System.Text.UTF8Encoding($true)
Get-ChildItem -LiteralPath $outDir -Recurse -File -Filter "*.ps1" | ForEach-Object {
  $content = [IO.File]::ReadAllText($_.FullName)
  [IO.File]::WriteAllText($_.FullName, $content, $utf8WithBom)
}

$clientBuilder = Join-Path $root "scripts\build-client-installer.ps1"
$clientVersion = (Get-Content (Join-Path $outDir "package.json") -Raw | ConvertFrom-Json).version
& $clientBuilder -SourceRoot $outDir -OutputDir $OutputRoot -PublishDir "downloads" | Out-Host
$clientInstallerPath = Join-Path $root "$OutputRoot\SAS-Cliente-Setup-$clientVersion.exe"
if (-not (Test-Path -LiteralPath $clientInstallerPath -PathType Leaf)) { throw "No se genero el instalador cliente esperado: $clientInstallerPath" }
$clientInstallerHash = (Get-FileHash -LiteralPath $clientInstallerPath -Algorithm SHA256).Hash
$embeddedClientPath = Join-Path $outDir "downloads\SAS-Cliente-Setup.exe"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $embeddedClientPath) | Out-Null
$clientInstallerManifestPath = "$clientInstallerPath.manifest.json"
$clientInstallerSidecarPath = "$clientInstallerPath.sha256.txt"
if (-not (Test-Path -LiteralPath $clientInstallerManifestPath -PathType Leaf)) { throw "No se genero el manifiesto del instalador cliente." }
if (-not (Test-Path -LiteralPath $clientInstallerSidecarPath -PathType Leaf)) { throw "No se genero el SHA-256 lateral del instalador cliente." }
$clientInstallerManifest = Get-Content -LiteralPath $clientInstallerManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$clientInstallerSidecar = Get-Content -LiteralPath $clientInstallerSidecarPath -Raw -Encoding ASCII
if ([string]$clientInstallerManifest.version -ne [string]$clientVersion) { throw "El manifiesto del instalador cliente corresponde a $($clientInstallerManifest.version), no a $clientVersion." }
if ([long]$clientInstallerManifest.size -ne (Get-Item -LiteralPath $clientInstallerPath).Length) { throw "El tamaño del instalador cliente no coincide con su manifiesto." }
if ([string]$clientInstallerManifest.sha256 -ne [string]$clientInstallerHash) { throw "El SHA-256 del instalador cliente no coincide con su manifiesto." }
if ($clientInstallerSidecar -notmatch [regex]::Escape($clientInstallerHash)) { throw "El SHA-256 lateral del instalador cliente no coincide con el EXE." }
Copy-Item -LiteralPath $clientInstallerPath -Destination $embeddedClientPath -Force
Copy-Item -LiteralPath $clientInstallerManifestPath -Destination "$embeddedClientPath.manifest.json" -Force
Copy-Item -LiteralPath $clientInstallerSidecarPath -Destination "$embeddedClientPath.sha256.txt" -Force
$embeddedClientHash = (Get-FileHash -LiteralPath $embeddedClientPath -Algorithm SHA256).Hash
$embeddedClientSidecar = Get-Content -LiteralPath "$embeddedClientPath.sha256.txt" -Raw -Encoding ASCII
if ($embeddedClientHash -ne $clientInstallerHash -or $embeddedClientSidecar -notmatch [regex]::Escape($clientInstallerHash)) { throw "El instalador cliente integrado no conserva su SHA-256." }

@"
SAS Support Platform - Instalador final para Windows 11 x64

INSTALACIÓN:
1. Extrae completamente este paquete.
2. Ejecuta INSTALAR-SAS.cmd.
3. Acepta el permiso de Administrador.
4. Si no existe certificado TLS, el instalador ofrecerá solicitar Let's Encrypt.

ACTUALIZACIÓN:
Ejecuta nuevamente INSTALAR-SAS.cmd. Se respaldan datos, certificados y configuración en C:\SAS\Backups.

DESINSTALACIÓN:
Ejecuta DESINSTALAR-SAS.cmd. De forma predeterminada conserva datos y secretos en C:\SAS\Backups.

SEGURIDAD:
- No se incluyen secretos, bases de datos ni certificados del equipo de desarrollo.
- Node.js $NodeVersion LTS x64 está incluido y verificado con el SHA-256 oficial.
- El paquete no tiene firma comercial. Verifica su SHA-256 antes de instalar.
- Sin certificado de firma, el agente se instala en modo productivo restringido: control y captura nativos quedan deshabilitados.
"@ | Set-Content (Join-Path $outDir "LEEME-INSTALACION.txt") -Encoding UTF8

$files = Get-ChildItem $outDir -Recurse -File | Where-Object { $_.Name -ne "release-manifest.json" } | ForEach-Object {
  [pscustomobject]@{
    path = $_.FullName.Substring($outDir.Length).TrimStart('\')
    size = $_.Length
    sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
  }
}
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$manifest = [pscustomobject]@{
  product = "SAS Support Platform"
  version = $version
  target = "Windows 11 x64 build 22000+"
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  installer = @{ launcher = "INSTALAR-SAS.cmd"; uninstaller = "DESINSTALAR-SAS.cmd"; requiresAdministrator = $true; signed = $false }
  nodeRuntime = @{ version = $NodeVersion; executable = "runtime\node\node.exe"; archiveSha256 = $actualHash; source = $nodeUrl }
  includesWinAcme = Test-Path (Join-Path $outDir "tools\win-acme\wacs.exe")
  fileCount = @($files).Count
  files = $files
  excludes = @(".env", ".env.production", "data", "logs", "tmp", "output", "certs/*.key", "certs/*.crt", "certs/*.pfx")
}
$manifestPath = Join-Path $outDir "release-manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content $manifestPath -Encoding UTF8

$zipPath = "$outDir.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -Force
$zipHash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
"$zipHash  $([IO.Path]::GetFileName($zipPath))" | Set-Content "$zipPath.sha256.txt" -Encoding ASCII

$buildResult = [pscustomobject]@{
  outputDir = $outDir
  zipPath = $zipPath
  zipSha256 = $zipHash
  manifestPath = $manifestPath
  nodeVersion = $NodeVersion
  nodeArchiveSha256 = $actualHash
  clientInstallerPath = $clientInstallerPath
  clientInstallerSha256 = $embeddedClientHash
}
[void]$buildMutex.ReleaseMutex()
$buildMutex.Dispose()
$buildResult | ConvertTo-Json -Depth 5

