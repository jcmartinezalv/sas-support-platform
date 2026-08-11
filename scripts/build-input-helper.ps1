param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$helperDir = Join-Path $ProjectDir "tools\sas-input-helper"
$outDir = Join-Path $helperDir "bin\$Configuration"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
  throw "No se encontro csc.exe de .NET Framework 4.x."
}

$exe = Join-Path $outDir "SasInputHelper.exe"
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /out:$exe (Join-Path $helperDir "Program.cs")
if ($LASTEXITCODE -ne 0) {
  throw "Fallo la compilacion de SasInputHelper.exe"
}

Get-FileHash -Algorithm SHA256 -Path $exe | Select-Object Algorithm, Hash, Path
