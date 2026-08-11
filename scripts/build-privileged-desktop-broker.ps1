param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [ValidateSet("Debug", "Release")][string]$Configuration = "Release"
)
$ErrorActionPreference = "Stop"
$helperDir = Join-Path $ProjectDir "tools\sas-secure-attention-broker"
$outDir = Join-Path $helperDir "bin\$Configuration"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$csc = @("$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe", "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "No se encontro csc.exe de .NET Framework 4.x." }
$exe = Join-Path $outDir "SasSecureAttentionBroker.exe"
& $csc /nologo /target:exe /platform:anycpu /optimize+ /out:$exe /reference:System.ServiceProcess.dll (Join-Path $helperDir "Program.cs")
if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion de SasSecureAttentionBroker.exe" }
Get-FileHash -Algorithm SHA256 -Path $exe | Select-Object Algorithm, Hash, Path