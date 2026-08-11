param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$TaskName = "SAS Support Server Production",
  [string]$ReportPath = "output\production-task-verification.json",
  [switch]$SkipStatus
)

$ErrorActionPreference = "Stop"

function New-Check([string]$Name, [string]$Status, [string]$Message, $Details = $null) {
  [pscustomobject]@{ name = $Name; status = $Status; message = $Message; details = $Details }
}

function Test-TaskWithScheduledTasks([string]$Name) {
  try {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    return New-Check "get_scheduled_task" "pass" "Tarea encontrada con Get-ScheduledTask." @{
      taskName = $task.TaskName
      taskPath = $task.TaskPath
      state = [string]$task.State
    }
  } catch {
    return New-Check "get_scheduled_task" "fail" $_.Exception.Message @{ taskName = $Name }
  }
}

function Test-TaskRecoverySettings([string]$Name) {
  try {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    $settings = $task.Settings
    $executionLimit = [string]$settings.ExecutionTimeLimit
    $restartInterval = [string]$settings.RestartInterval
    $executionUnlimited = $executionLimit -in @("PT0S", "00:00:00", "0.00:00:00")
    $restartConfigured = $settings.RestartCount -ge 3 -and $restartInterval -and $restartInterval -notin @("PT0S", "00:00:00", "0.00:00:00")
    $startAvailable = [bool]$settings.StartWhenAvailable
    $singleInstance = [string]$settings.MultipleInstances -eq "IgnoreNew"
    $recoveryTriggerEveryMinute = @($task.Triggers | Where-Object { $_.Repetition -and [string]$_.Repetition.Interval -eq "PT1M" }).Count -gt 0
    $valid = $executionUnlimited -and $restartConfigured -and $startAvailable -and $singleInstance -and $recoveryTriggerEveryMinute
    return New-Check "task_recovery_settings" $(if ($valid) { "pass" } else { "fail" }) "Persistencia y recuperacion automatica de la tarea." @{
      executionTimeLimit = $executionLimit
      restartCount = [int]$settings.RestartCount
      restartInterval = $restartInterval
      startWhenAvailable = $startAvailable
      multipleInstances = [string]$settings.MultipleInstances
      recoveryTriggerEveryMinute = $recoveryTriggerEveryMinute
    }
  } catch {
    return New-Check "task_recovery_settings" "fail" $_.Exception.Message @{ taskName = $Name }
  }
}

function Test-TaskWithSchtasks([string]$Name) {
  $variants = @($Name, "\$Name")
  foreach ($variant in $variants) {
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & schtasks.exe /Query /TN $variant /FO LIST /V 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousEap
    if ($exitCode -eq 0) {
      return New-Check "schtasks_query" "pass" "Tarea encontrada con schtasks." @{ taskName = $Name; queryName = $variant; output = ($output -join "`n").Substring(0, [Math]::Min(1200, ($output -join "`n").Length)) }
    }
  }
  return New-Check "schtasks_query" "fail" "schtasks no encontro la tarea." @{ taskName = $Name }
}

function Test-TaskWithCom([string]$Name) {
  try {
    $service = New-Object -ComObject "Schedule.Service"
    $service.Connect()
    $folder = $service.GetFolder("\")
    $task = $folder.GetTask($Name)
    return New-Check "schedule_service_com" "pass" "Tarea encontrada con Schedule.Service COM." @{
      name = $task.Name
      enabled = [bool]$task.Enabled
      state = [int]$task.State
      lastRunTime = [string]$task.LastRunTime
      nextRunTime = [string]$task.NextRunTime
    }
  } catch {
    return New-Check "schedule_service_com" "fail" $_.Exception.Message @{ taskName = $Name }
  }
}

function Read-JsonFile($PathValue) {
  if (-not (Test-Path $PathValue)) { return $null }
  try { return Get-Content $PathValue -Raw | ConvertFrom-Json } catch { return $null }
}

$root = (Resolve-Path $ProjectDir).Path
$checks = @()
$checks += Test-TaskWithScheduledTasks $TaskName
$checks += Test-TaskRecoverySettings $TaskName
$checks += Test-TaskWithSchtasks $TaskName
$checks += Test-TaskWithCom $TaskName

$manifestPath = Join-Path $root "install-manifest.json"
$checklistPath = Join-Path $root "post-install-checklist.json"
$manifest = Read-JsonFile $manifestPath
$checklist = Read-JsonFile $checklistPath
$manifestTaskMatches = $manifest -and $manifest.TaskName -eq $TaskName -and $manifest.ProductionTask
$checks += New-Check "install_manifest" $(if ($manifestTaskMatches) { "pass" } else { "warn" }) "Manifiesto de instalacion productiva." @{ path = $manifestPath; taskName = $manifest.TaskName; productionTask = $manifest.ProductionTask }

$checklistTask = $null
if ($checklist -and $checklist.Checks) {
  $checklistTask = $checklist.Checks | Where-Object { $_.Name -eq "scheduled_task" } | Select-Object -First 1
}
$checks += New-Check "post_install_checklist" $(if ($checklistTask -and $checklistTask.Status -eq "pass") { "pass" } else { "warn" }) "Checklist post-instalacion." @{ path = $checklistPath; scheduledTaskStatus = $checklistTask.Status }

$status = $null
if (-not $SkipStatus) {
  $statusScript = Join-Path $root "scripts\get-production-status.ps1"
  if (Test-Path $statusScript) {
    try {
      $status = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $statusScript -ProjectDir $root -LocalOnly) | ConvertFrom-Json
      $checks += New-Check "local_status" $(if ($status.status -eq "pass") { "pass" } else { "fail" }) "Estado local de SAS." @{ status = $status.status; httpsListening = $status.listeners.https.listening; processPid = $status.process.pid }
    } catch {
      $checks += New-Check "local_status" "fail" $_.Exception.Message @{ script = $statusScript }
    }
  } else {
    $checks += New-Check "local_status" "warn" "No se encontro script de estado local." @{ script = $statusScript }
  }
}

$taskFound = @($checks | Where-Object { $_.name -in @("get_scheduled_task", "schtasks_query", "schedule_service_com") -and $_.status -eq "pass" }).Count -gt 0
$fail = @($checks | Where-Object { $_.status -eq "fail" }).Count
$warn = @($checks | Where-Object { $_.status -eq "warn" }).Count
$overall = if (-not $taskFound) { "fail" } elseif ($fail -gt 0) { "warn" } elseif ($warn -gt 0) { "warn" } else { "pass" }
$nextActions = @()
if (-not $taskFound) { $nextActions += "Ejecutar scripts\install-production-task-elevated.ps1 y aceptar UAC." }
if ($status -and $status.status -ne "pass") { $nextActions += "Revisar logs\sas-production.err.log y ejecutar scripts\restart-production-task.ps1 si la tarea existe." }

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  status = $overall
  taskName = $TaskName
  taskFound = $taskFound
  checks = $checks
  localStatus = $status
  nextActions = $nextActions
}

$target = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $root $ReportPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$report | ConvertTo-Json -Depth 12 | Set-Content -Path $target -Encoding UTF8
$report | ConvertTo-Json -Depth 12

