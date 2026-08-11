param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$NodeExe = "node"
)

Set-Location $ProjectDir
$envFile = Join-Path $ProjectDir ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
  }
}

$logDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "sas-server.log"
$errLog = Join-Path $logDir "sas-server.err.log"

"[$(Get-Date -Format o)] Starting SAS Support Server" | Add-Content -Path $outLog -Encoding UTF8
& $NodeExe "src\server.js" 1>> $outLog 2>> $errLog
