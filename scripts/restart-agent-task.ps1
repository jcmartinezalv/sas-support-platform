param(
  [string]$TaskName = "SAS Support Client Agent"
)

$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  throw "No existe la tarea programada '$TaskName'."
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $TaskName
Write-Host "Agente SAS reiniciado mediante tarea programada: $TaskName"
