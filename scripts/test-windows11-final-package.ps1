param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [string]$InstallerExe = "",
  [string]$ReportPath = "output\windows11-installer-validation-report.json"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$manifestPath = Join-Path $package "release-manifest.json"
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail })
}

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "No se encontró release-manifest.json en $package."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$required = @(
  "INSTALAR-SAS.cmd",
  "DESINSTALAR-SAS.cmd",
  "LEEME-INSTALACION.txt",
  "package.json",
  "runtime\node\node.exe",
  "runtime\node\LICENSE-NODE.txt",
  "downloads\SAS-Cliente-Setup.exe",
  "downloads\SAS-Cliente-Setup.exe.manifest.json",
  "downloads\SAS-Cliente-Setup.exe.sha256.txt",
  "scripts\install-windows11-final.ps1",
  "scripts\uninstall-windows11-final.ps1",
  "scripts\install-rustdesk-engine.ps1",
  "docs\RUSTDESK-INTEGRATION.md",
  "vendor\remote-engines\rustdesk-1.4.9-x86_64.msi"
)

$missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $package $_) -PathType Leaf) })
Add-Check "required_files" ($missing.Count -eq 0) $(if ($missing.Count) { "Faltan: $($missing -join ', ')" } else { "$($required.Count) archivos requeridos presentes" })

$actualFiles = @(Get-ChildItem -LiteralPath $package -Recurse -File | Where-Object { $_.FullName -ne $manifestPath })
$manifestFiles = @($manifest.files)
Add-Check "manifest_file_count" ($actualFiles.Count -eq $manifestFiles.Count -and $manifest.fileCount -eq $manifestFiles.Count) "disco=$($actualFiles.Count), manifiesto=$($manifestFiles.Count), declarado=$($manifest.fileCount)"

$hashFailures = New-Object System.Collections.Generic.List[string]
foreach ($entry in $manifestFiles) {
  $file = Join-Path $package $entry.path
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
    $hashFailures.Add("ausente:$($entry.path)")
    continue
  }
  $item = Get-Item -LiteralPath $file
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  if ($item.Length -ne [long]$entry.size -or $hash -ne $entry.sha256) {
    $hashFailures.Add("no_coincide:$($entry.path)")
  }
}
Add-Check "manifest_hashes" ($hashFailures.Count -eq 0) $(if ($hashFailures.Count) { $hashFailures -join "; " } else { "$($manifestFiles.Count) hashes SHA-256 correctos" })

$manifestPaths = @($manifestFiles | ForEach-Object { ([string]$_.path).Replace('/', '\').ToLowerInvariant() })
$forbidden = @($manifestPaths | Where-Object {
  $_ -eq ".env" -or ($_.StartsWith(".env.") -and $_ -ne ".env.example") -or
  $_ -like "data\*" -or $_ -like "logs\*" -or $_ -like "output\*" -or $_ -like "tmp\*" -or
  $_ -like "certs\*.key" -or $_ -like "certs\*.crt" -or $_ -like "certs\*.pfx" -or
  $_ -like "*\sas-db.json"
})
Add-Check "no_private_state" ($forbidden.Count -eq 0) $(if ($forbidden.Count) { "Incluidos: $($forbidden -join ', ')" } else { "sin entornos, datos, logs ni certificados privados" })

$node = Join-Path $package "runtime\node\node.exe"
$nodeVersion = if (Test-Path -LiteralPath $node) { (& $node --version).Trim() } else { "missing" }
Add-Check "bundled_node" ($nodeVersion -match '^v(2[4-9]|[3-9][0-9])\.') "versión=$nodeVersion"

$rustDeskInstaller = Join-Path $package "vendor\remote-engines\rustdesk-1.4.9-x86_64.msi"
$rustDeskExpectedHash = "C87D2F4CEF2A5ACD6003B6507DCFBF5D5168A256DB082CD90B54D35193224AAA"
$rustDeskActualHash = if (Test-Path -LiteralPath $rustDeskInstaller -PathType Leaf) { (Get-FileHash -LiteralPath $rustDeskInstaller -Algorithm SHA256).Hash } else { "missing" }
Add-Check "bundled_rustdesk" ($rustDeskActualHash -eq $rustDeskExpectedHash) "version=1.4.9; sha256=$rustDeskActualHash"

$preflightScript = Join-Path $package "scripts\install-windows11-final.ps1"
$preflightOutput = ""
$preflightPassed = $false
if (Test-Path -LiteralPath $preflightScript) {
  try {
    $preflightOutput = & $preflightScript -SourcePath $package -PreflightOnly -NonInteractive | Out-String
    $preflight = $preflightOutput | ConvertFrom-Json
    $preflightPassed = $preflight.status -eq "pass"
  } catch {
    $preflightOutput = $_.Exception.Message
  }
}
Add-Check "non_elevated_preflight" $preflightPassed $preflightOutput.Trim()

$installerDetail = "no proporcionado"
$installerPassed = $true
if ($InstallerExe) {
  $exe = (Resolve-Path -LiteralPath $InstallerExe).Path
  $exeManifestPath = "$exe.manifest.json"
  if (-not (Test-Path -LiteralPath $exeManifestPath -PathType Leaf)) {
    $installerPassed = $false
    $installerDetail = "falta $exeManifestPath"
  } else {
    $exeManifest = Get-Content -LiteralPath $exeManifestPath -Raw | ConvertFrom-Json
    $exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
    $installerPassed = $exeHash -eq $exeManifest.sha256 -and (Get-Item -LiteralPath $exe).Length -eq [long]$exeManifest.size
    $installerDetail = "sha256=$exeHash; compiler=$($exeManifest.compiler)"
  }
}
Add-Check "installer_exe_integrity" $installerPassed $installerDetail

$embeddedInstaller = Join-Path $package "downloads\SAS-Cliente-Setup.exe"
$embeddedManifestPath = "$embeddedInstaller.manifest.json"
$embeddedPassed = $false
$embeddedDetail = "faltan instalador o manifiesto"
if ((Test-Path -LiteralPath $embeddedInstaller -PathType Leaf) -and (Test-Path -LiteralPath $embeddedManifestPath -PathType Leaf)) {
  $embeddedManifest = Get-Content -LiteralPath $embeddedManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $embeddedHash = (Get-FileHash -LiteralPath $embeddedInstaller -Algorithm SHA256).Hash
  $embeddedPassed = [string]$embeddedManifest.version -eq [string]$manifest.version -and [long]$embeddedManifest.size -eq (Get-Item -LiteralPath $embeddedInstaller).Length -and [string]$embeddedManifest.sha256 -eq $embeddedHash
  $embeddedDetail = "paquete=$($manifest.version); instalador=$($embeddedManifest.version); sha256=$embeddedHash"
}
Add-Check "embedded_client_alignment" $embeddedPassed $embeddedDetail

$sevenZip = @("C:\Program Files\7-Zip\7z.exe", "C:\Program Files (x86)\7-Zip\7z.exe") | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$nsisArchivePassed = $false
$nsisArchiveDetail = "7-Zip no está instalado para validar la estructura NSIS"
if ($sevenZip -and (Test-Path -LiteralPath $embeddedInstaller -PathType Leaf)) {
  $nsisOutput = & $sevenZip t $embeddedInstaller 2>&1 | Out-String
  $nsisListing = & $sevenZip l $embeddedInstaller 2>&1 | Out-String
  $nsisArchivePassed = $LASTEXITCODE -eq 0 -and $nsisOutput -match "Everything is Ok" -and $nsisListing -match "rustdesk-1\.4\.9-x86_64\.msi"
  $nsisArchiveDetail = if ($nsisArchivePassed) { "estructura NSIS y RustDesk integrado correctos" } else { $nsisOutput.Trim() }
}
Add-Check "nsis_archive_integrity" $nsisArchivePassed $nsisArchiveDetail

$failed = @($checks | Where-Object { -not $_.passed })
$report = [pscustomobject]@{
  product = "SAS Support Platform"
  status = if ($failed.Count) { "fail" } else { "pass" }
  packagePath = $package
  packageVersion = $manifest.version
  nodeVersion = $nodeVersion
  installerExe = if ($InstallerExe) { (Resolve-Path -LiteralPath $InstallerExe).Path } else { $null }
  checks = $checks
  failedChecks = @($failed | ForEach-Object { $_.name })
  validatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  requiresElevation = $false
}

$target = if ([IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $root $ReportPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $target -Encoding UTF8
$report | ConvertTo-Json -Depth 8
if ($failed.Count) { exit 1 }


