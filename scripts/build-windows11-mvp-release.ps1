param(
  [string]$OutputRoot = "dist",
  [string]$PackageName = "sas-windows11-mvp-release",
  [switch]$IncludeWinAcme = $true,
  [switch]$Zip = $true
)

$ErrorActionPreference = "Stop"

function Copy-IfExists($Source, $Destination) {
  if (Test-Path $Source) {
    Copy-Item -Path $Source -Destination $Destination -Recurse -Force
  }
}

function Should-ExcludeFile($FullName) {
  if ($FullName -like "*\client\webrtc-runtime\node_modules\*") { return $false }
  $patterns = @(
    '\\.env$',
    '\\.env\.local$',
    '\\.env\.production',
    '\\data\\',
    '\\logs\\',
    '\\tmp\\',
    '\\.git\\',
    '\\.agents\\',
    '\\.codex\\',
    '\\node_modules\\',
    '\\output\\',
    '\\dist\\',
    '\\certs\\.*\.(key|crt|pfx)$'
  )

  foreach ($pattern in $patterns) {
    if ($FullName -match $pattern) { return $true }
  }
  return $false
}

$projectRoot = (Resolve-Path "$PSScriptRoot\..").Path
$packageVersion = [string](Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $projectRoot "$OutputRoot\$PackageName-$stamp"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$includeDirs = @("src", "public", "scripts", "docs", "client", "downloads")
$includeFiles = @("package.json", "README.md", ".env.example")

foreach ($dir in $includeDirs) {
  $sourceDir = Join-Path $projectRoot $dir
  $targetDir = Join-Path $outDir $dir
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Get-ChildItem -Path $sourceDir -Recurse -File | Where-Object { -not (Should-ExcludeFile $_.FullName) } | ForEach-Object {
    $relative = $_.FullName.Substring($sourceDir.Length).TrimStart('\')
    $target = Join-Path $targetDir $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -Path $_.FullName -Destination $target -Force
  }
}

foreach ($file in $includeFiles) {
  Copy-IfExists (Join-Path $projectRoot $file) (Join-Path $outDir $file)
}

if (Test-Path (Join-Path $projectRoot "tools\sas-service-host")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $outDir "tools") | Out-Null
  Copy-Item -Path (Join-Path $projectRoot "tools\sas-service-host") -Destination (Join-Path $outDir "tools\sas-service-host") -Recurse -Force
}
if (Test-Path (Join-Path $projectRoot "tools\sas-admin-console")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $outDir "tools") | Out-Null
  Copy-Item -Path (Join-Path $projectRoot "tools\sas-admin-console") -Destination (Join-Path $outDir "tools\sas-admin-console") -Recurse -Force
}


if ($IncludeWinAcme -and (Test-Path (Join-Path $projectRoot "tools\win-acme\wacs.exe"))) {
  New-Item -ItemType Directory -Force -Path (Join-Path $outDir "tools") | Out-Null
  Copy-Item -Path (Join-Path $projectRoot "tools\win-acme") -Destination (Join-Path $outDir "tools\win-acme") -Recurse -Force
}

@"
SAS Windows 11 Pro MVP Release
Generated: $(Get-Date -Format o)

Destino sugerido en Windows 11 Pro:
  C:\SAS\Release

Instalacion inicial:
  cd C:\SAS\Release
  .\scripts\prepare-production-config.ps1 -PublicBaseUrl https://setinfo.sytes.net -WriteMainEnv
  .\scripts\request-letsencrypt-elevated.ps1 -Domain setinfo.sytes.net -Email jcmtza@gmail.com
  .\scripts\install-production-task.ps1 -StartNow
  .\scripts\test-production-smoke.ps1 -BaseUrl https://setinfo.sytes.net

Actualizacion futura:
  .\scripts\update-server-deployment.ps1 -SourcePath C:\SAS\ReleaseNueva -InstallPath C:\SAS\Server -StartAfterUpdate

No incluir secretos en este paquete. Configuracion real vive en .env/.env.production del servidor.
"@ | Set-Content -Path (Join-Path $outDir "WINDOWS11-MVP-README.txt") -Encoding UTF8

$files = Get-ChildItem -Path $outDir -Recurse -File | ForEach-Object {
  $hash = Get-FileHash -Path $_.FullName -Algorithm SHA256
  [pscustomobject]@{
    Path = $_.FullName.Substring($outDir.Length).TrimStart('\')
    Size = $_.Length
    Sha256 = $hash.Hash
  }
}

$manifest = [pscustomobject]@{
  Product = "SAS Support Server"
  Version = $packageVersion
  Target = "Windows 11 Pro MVP"
  GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  PackagePath = $outDir
  PublicBaseUrl = "https://setinfo.sytes.net"
  IncludesWinAcme = [bool]($IncludeWinAcme -and (Test-Path (Join-Path $outDir "tools\win-acme\wacs.exe")))
  FileCount = @($files).Count
  Files = $files
  Excludes = @(".env", ".env.production", "data", "logs", "tmp", "certs/*.key", "certs/*.crt", "certs/*.pfx")
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $outDir "release-manifest.json") -Encoding UTF8

$zipPath = $null
if ($Zip) {
  $zipPath = "$outDir.zip"
  if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }
  Compress-Archive -Path (Join-Path $outDir '*') -DestinationPath $zipPath -Force
  $zipHash = Get-FileHash -Path $zipPath -Algorithm SHA256
  [pscustomobject]@{ Path = $zipPath; Sha256 = $zipHash.Hash; Size = (Get-Item $zipPath).Length } | ConvertTo-Json | Set-Content -Path (Join-Path $outDir "release-zip-sha256.json") -Encoding UTF8
}

[pscustomobject]@{
  outputDir = $outDir
  zipPath = $zipPath
  manifest = (Join-Path $outDir "release-manifest.json")
  readme = (Join-Path $outDir "WINDOWS11-MVP-README.txt")
} | ConvertTo-Json -Depth 4

