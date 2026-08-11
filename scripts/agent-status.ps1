param(
  [string]$TaskName = "SAS Support Client Agent",
  [string]$StopFile = "C:\SAS\Client\sas-agent-stop.flag",
  [string]$CaptureHelperPath = "",
  [string]$InputHelperPath = ""
)

$installPath = Split-Path -Parent $StopFile
$nativeVersion = Get-ChildItem -LiteralPath (Join-Path $installPath "native") -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $CaptureHelperPath) { $CaptureHelperPath = if ($nativeVersion) { Join-Path $nativeVersion.FullName "SasCaptureHelper.exe" } else { Join-Path $installPath "tools\sas-capture-helper\bin\Release\SasCaptureHelper.exe" } }
if (-not $InputHelperPath) { $InputHelperPath = if ($nativeVersion) { Join-Path $nativeVersion.FullName "SasInputHelper.exe" } else { Join-Path $installPath "tools\sas-input-helper\bin\Release\SasInputHelper.exe" } }

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$inputTask = Get-ScheduledTask -TaskName "SAS Input Desktop Helper" -ErrorAction SilentlyContinue
$inputProcess = Get-Process -Name "SasInputHelper" -ErrorAction SilentlyContinue | Select-Object -First 1
$brokerService = Get-Service -Name "SAS Secure Attention Broker" -ErrorAction SilentlyContinue
$brokerFallbackTask = Get-ScheduledTask -TaskName "SAS Privileged Desktop Broker Recovery" -ErrorAction SilentlyContinue
$brokerProcess = Get-Process -Name "SasSecureAttentionBroker" -ErrorAction SilentlyContinue | Select-Object -First 1
$brokerStartupMode = if ($brokerService.Status -eq "Running") { "service" } elseif ($brokerFallbackTask.State -eq "Running" -and $brokerProcess) { "system_task_fallback" } else { "unavailable" }
$processAccess = "ok"
$helperHash = $null
$inputHelperHash = $null
if (Test-Path $CaptureHelperPath) {
  $helperHash = (Get-FileHash -Algorithm SHA256 -Path $CaptureHelperPath).Hash
}
if (Test-Path $InputHelperPath) {
  $inputHelperHash = (Get-FileHash -Algorithm SHA256 -Path $InputHelperPath).Hash
}
try {
  $nodeProcesses = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction Stop | Where-Object { $_.CommandLine -like '*agent-client.js*' }
} catch {
  $nodeProcesses = @()
  $processAccess = "denied"
}

[pscustomobject]@{
  TaskName = $TaskName
  TaskExists = [bool]$task
  TaskState = $task.State
  InputDesktopTaskExists = [bool]$inputTask
  InputDesktopTaskState = $inputTask.State
  InputDesktopProcessId = $inputProcess.Id
  InputDeliveryMode = $(if ($inputTask -and $inputProcess) { "desktop_pipe" } elseif ($inputTask) { "task_waiting" } else { "legacy_process_fallback" })
  PrivilegedBrokerMode = $brokerStartupMode
  PrivilegedBrokerServiceStatus = $brokerService.Status
  PrivilegedBrokerFallbackTaskState = $brokerFallbackTask.State
  PrivilegedBrokerProcessId = $brokerProcess.Id
  AgentProcesses = @($nodeProcesses).Count
  ProcessAccess = $processAccess
  StopFileExists = Test-Path $StopFile
  StopFile = $StopFile
  CaptureHelperExists = Test-Path $CaptureHelperPath
  CaptureHelperPath = $CaptureHelperPath
  CaptureHelperSha256 = $helperHash
  InputHelperExists = Test-Path $InputHelperPath
  InputHelperPath = $InputHelperPath
  InputHelperSha256 = $inputHelperHash
} | Format-List



