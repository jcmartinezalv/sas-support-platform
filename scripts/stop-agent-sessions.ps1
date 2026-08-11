param(
  [string]$StopFile = "C:\SAS\Client\sas-agent-stop.flag"
)

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $StopFile
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

@"
STOP_REQUESTED=$(Get-Date -Format o)
REQUESTED_BY=$env:USERNAME
"@ | Set-Content -Path $StopFile -Encoding ASCII

Write-Host "Solicitud de paro enviada al agente SAS."
Write-Host "Archivo: $StopFile"
Write-Host "El agente cerrara las sesiones activas en su siguiente ciclo de revision."
