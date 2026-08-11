param(
  [string]$OutputRoot = "dist",
  [string]$PackageName = "sas-support-portable",
  [switch]$SignPackage,
  [string]$CertificateThumbprint = "",
  [switch]$UnsignedRestrictedProduction
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path "$PSScriptRoot\.."
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $projectRoot "$OutputRoot\$PackageName-$stamp"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not $UnsignedRestrictedProduction) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\build-capture-helper.ps1") | Out-Host
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\build-dxgi-capture.ps1") | Out-Host
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\build-input-helper.ps1") | Out-Host
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\build-privileged-desktop-broker.ps1") | Out-Host
} else {
  Write-Host "Perfil sin firma: no se compilan helpers nativos."
}

$includeDirs = @("src", "client", "public", "scripts", "docs", "tools")
$includeFiles = @("package.json", "README.md", ".env.example")

foreach ($dir in $includeDirs) {
  Copy-Item -Path (Join-Path $projectRoot $dir) -Destination (Join-Path $outDir $dir) -Recurse -Force
}

foreach ($file in $includeFiles) {
  Copy-Item -Path (Join-Path $projectRoot $file) -Destination (Join-Path $outDir $file) -Force
}

if ($UnsignedRestrictedProduction) {
  foreach ($helperRelativePath in @(
    "tools\sas-capture-helper\bin\Release\SasCaptureHelper.exe",
    "tools\sas-dxgi-capture\bin\Release\SasDxgiCapture.exe",
    "tools\sas-input-helper\bin\Release\SasInputHelper.exe"
  )) {
    $helperPath = Join-Path $outDir $helperRelativePath
    if (Test-Path $helperPath) {
      Remove-Item -Path $helperPath -Force
    }
  }

@"
SAS_SERVER_URL=https://tu-dominio.com
SAS_AGENT_SECRET=change-agent-secret
SAS_AGENT_HEARTBEAT_SECONDS=2
SAS_AGENT_STOP_FILE=C:\SAS\Client\sas-agent-stop.flag
SAS_AGENT_LOCAL_PORT=37655
SAS_CAPTURE_HELPER_PATH=
SAS_DXGI_CAPTURE_HELPER_PATH=
SAS_INPUT_HELPER_PATH=
SAS_ENABLE_REAL_INPUT=false
SAS_UNSIGNED_RESTRICTED_PRODUCTION=true
NODE_TLS_REJECT_UNAUTHORIZED=0
SAS_AGENT_PRODUCT_NAME=SAS Support Client Agent
SAS_AGENT_PUBLISHER=SAS Support Platform
"@ | Set-Content -Path (Join-Path $outDir "CLIENT_ENV_UNSIGNED_RESTRICTED.txt") -Encoding UTF8
}
if ($SignPackage) {
  if (-not $CertificateThumbprint) {
    throw "Usa -CertificateThumbprint cuando actives -SignPackage."
  }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\sign-release.ps1") -PackagePath $outDir -CertificateThumbprint $CertificateThumbprint | Out-Host
}

$signatureReportPath = Join-Path $outDir "signature-report.json"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\verify-signatures.ps1") -PackagePath $outDir -OutputPath $signatureReportPath | Out-Host

$manifest = Get-ChildItem -Path $outDir -Recurse -File | ForEach-Object {
  $hash = Get-FileHash -Path $_.FullName -Algorithm SHA256
  [pscustomobject]@{
    Path = $_.FullName.Replace($outDir, "").TrimStart("\")
    Size = $_.Length
    Sha256 = $hash.Hash
  }
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $outDir "manifest.json") -Encoding UTF8

$allowlistPath = Join-Path $outDir "sas-allowlist.json"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts\generate-allowlist.ps1") -RootPath $outDir -OutputPath $allowlistPath | Out-Host

@"
SAS Support Portable Package
Generated: $(Get-Date -Format o)

Server:
  powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1

Client:
  powershell -ExecutionPolicy Bypass -File scripts\start-client.ps1

Install server as Windows task:
  powershell -ExecutionPolicy Bypass -File scripts\install-server.ps1

Install client as Windows task:
  powershell -ExecutionPolicy Bypass -File scripts\install-client.ps1

Production restricted without code signing:
  powershell -ExecutionPolicy Bypass -File scripts\install-client.ps1 -UnsignedRestrictedProduction

Verify signatures:
  powershell -ExecutionPolicy Bypass -File scripts\verify-signatures.ps1 -PackagePath . -OutputPath signature-report.json
"@ | Set-Content -Path (Join-Path $outDir "QUICKSTART.txt") -Encoding UTF8

Write-Host "Paquete creado: $outDir"
Write-Host "Manifest: $(Join-Path $outDir 'manifest.json')"
Write-Host "Allowlist: $(Join-Path $outDir 'sas-allowlist.json')"
Write-Host "Signature report: $signatureReportPath"
if ($UnsignedRestrictedProduction) { Write-Host "Perfil: produccion restringida sin firma, helpers nativos deshabilitados." }


