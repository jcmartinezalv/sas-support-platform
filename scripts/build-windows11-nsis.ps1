param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,
  [string]$OutputDir = "dist",
  [string]$MakeNsisPath = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$source = (Resolve-Path $SourceRoot).Path
if (-not (Test-Path (Join-Path $source "release-manifest.json"))) { throw "SourceRoot no contiene release-manifest.json." }
if (-not $MakeNsisPath) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\NSIS\makensis.exe"),
    "C:\Program Files (x86)\NSIS\makensis.exe",
    "C:\Program Files\NSIS\makensis.exe"
  )
  $MakeNsisPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $MakeNsisPath -or -not (Test-Path $MakeNsisPath)) { throw "No se encontró makensis.exe de NSIS." }

$output = if ([IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $root $OutputDir }
New-Item -ItemType Directory -Force -Path $output | Out-Null
$version = (Get-Content (Join-Path $source "package.json") -Raw | ConvertFrom-Json).version
$nsi = Join-Path $root "installer\windows11\SAS-Windows11.nsi"
& $MakeNsisPath "/DSourceRoot=$source" "/DOutputDir=$output" "/DAppVersion=$version" $nsi
if ($LASTEXITCODE -ne 0) { throw "NSIS falló con código $LASTEXITCODE." }

$exe = Join-Path $output "SAS-Windows11-Setup-$version.exe"
if (-not (Test-Path $exe)) { throw "No se generó el instalador esperado: $exe" }
$signature = Get-AuthenticodeSignature $exe
$result = [pscustomobject]@{
  path = $exe
  size = (Get-Item $exe).Length
  sha256 = (Get-FileHash $exe -Algorithm SHA256).Hash
  signatureStatus = $signature.Status.ToString()
  signed = $signature.Status -eq "Valid"
  sourceRoot = $source
  compiler = "NSIS 3.12"
  compilerPath = $MakeNsisPath
  commercialUseLicense = "zlib/libpng"
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
}
$result | ConvertTo-Json -Depth 5 | Set-Content "$exe.manifest.json" -Encoding UTF8
"$($result.sha256)  $([IO.Path]::GetFileName($exe))" | Set-Content "$exe.sha256.txt" -Encoding ASCII
$result | ConvertTo-Json -Depth 5

