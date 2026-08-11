param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$NodeExe = "node"
)

Set-Location $ProjectDir
$envFile = Join-Path $ProjectDir ".env.client"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
  }
}

$logDir = Join-Path $ProjectDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "sas-agent.log"
$errLog = Join-Path $logDir "sas-agent.err.log"

$trayScript = Join-Path $ProjectDir "scripts\sas-client-tray.ps1"
if (Test-Path -LiteralPath $trayScript) {
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-Sta", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", $trayScript, "-InstallPath", $ProjectDir) -WindowStyle Hidden | Out-Null
}

$arguments = @("client\agent-client.js")
$process = Start-Process -FilePath $NodeExe -ArgumentList $arguments -WorkingDirectory $ProjectDir -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
exit $process.ExitCode

