param(
  [string]$InstallPath = "C:\SAS\Client",
  [int]$Tail = 80
)

$logs = @(
  (Join-Path $InstallPath "logs\sas-agent.log"),
  (Join-Path $InstallPath "logs\sas-agent.err.log"),
  (Join-Path $InstallPath "agent.log"),
  (Join-Path $InstallPath "agent.err.log")
)

foreach ($log in $logs) {
  Write-Host "---- $log ----"
  if (Test-Path $log) {
    Get-Content $log -Tail $Tail
  } else {
    Write-Host "No existe."
  }
}
