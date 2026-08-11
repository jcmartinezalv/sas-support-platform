param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [string]$OutputDir = "dist",
  [string]$PublishDir = "downloads",
  [string]$PublicBaseUrl = "https://setinfo.sytes.net",
  [string]$MakeNsisPath = ""
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$buildMutex = New-Object Threading.Mutex($false, "Global\SASClientInstallerBuild")
$buildLockAcquired = $false
try { $buildLockAcquired = $buildMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $buildLockAcquired = $true }
if (-not $buildLockAcquired) { throw "Ya existe otra compilación del instalador de SAS Cliente en curso. Espera a que termine antes de iniciar otra." }
$source = (Resolve-Path $SourceRoot).Path
if (-not $MakeNsisPath) {
  $MakeNsisPath = @("C:\Program Files (x86)\NSIS\makensis.exe", "C:\Program Files\NSIS\makensis.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $MakeNsisPath) { throw "No se encontro NSIS." }
$version = (Get-Content (Join-Path $source "package.json") -Raw | ConvertFrom-Json).version
$output = if ([IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $root $OutputDir }
$publish = if ([IO.Path]::IsPathRooted($PublishDir)) { $PublishDir } else { Join-Path $root $PublishDir }
New-Item -ItemType Directory -Force -Path $output,$publish | Out-Null
$nsi = Join-Path $root "installer\windows11\SAS-Cliente.nsi"
$nsisOutput = @(& $MakeNsisPath "/INPUTCHARSET" "UTF8" "/DSourceRoot=$source" "/DOutputDir=$output" "/DAppVersion=$version" "/DPublicBaseUrl=$PublicBaseUrl" $nsi 2>&1)
$nsisExitCode = $LASTEXITCODE
$nsisOutput | ForEach-Object { Write-Host ([string]$_) }
if ($nsisExitCode -ne 0) { throw "NSIS cliente fallo con codigo $nsisExitCode." }
$nsisWarnings = @($nsisOutput | Where-Object { [string]$_ -match '(?i)warning\s+\d+:' })
if ($nsisWarnings.Count -gt 0) { throw "NSIS cliente produjo advertencias y el paquete no se publicara: $($nsisWarnings -join ' | ')" }
$exe = Join-Path $output "SAS-Cliente-Setup-$version.exe"
$published = Join-Path $publish "SAS-Cliente-Setup.exe"
Copy-Item -LiteralPath $exe -Destination $published -Force
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash
$signatureStatus = (Get-AuthenticodeSignature $exe).Status.ToString()
$installerManifest = [pscustomobject]@{
  product = "SAS Cliente"
  version = $version
  compiler = "NSIS"
  size = (Get-Item $exe).Length
  sha256 = $hash
  signatureStatus = $signatureStatus
  generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
}
$installerManifest | ConvertTo-Json -Depth 4 | Set-Content "$exe.manifest.json" -Encoding UTF8
$installerManifest | ConvertTo-Json -Depth 4 | Set-Content "$published.manifest.json" -Encoding UTF8
"$hash  $([IO.Path]::GetFileName($exe))" | Set-Content "$exe.sha256.txt" -Encoding ASCII
"$hash  $([IO.Path]::GetFileName($published))" | Set-Content "$published.sha256.txt" -Encoding ASCII
$buildResult = [pscustomobject]@{ path=$exe; publishedPath=$published; version=$version; target="Windows 10/11 x64 y Windows Server 2016+"; minimumBuild=10240; size=(Get-Item $exe).Length; sha256=$hash; signatureStatus=$signatureStatus }
[void]$buildMutex.ReleaseMutex()
$buildMutex.Dispose()
$buildResult | ConvertTo-Json -Depth 4
