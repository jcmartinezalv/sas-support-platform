param(
  [Parameter(Mandatory=$true)][string]$StagingPath,
  [Parameter(Mandatory=$true)][string]$InstallPath,
  [string]$ServerTaskName="SAS Support Server Production",
  [string]$UpdaterTaskName="SAS Support Platform Update",
  [Parameter(Mandatory=$true)][string]$HealthUrl,
  [Parameter(Mandatory=$true)][string]$CurrentVersion,
  [Parameter(Mandatory=$true)][string]$TargetVersion,
  [Parameter(Mandatory=$true)][string]$ResultPath,
  [string]$ReceiptPath=""
)
$ErrorActionPreference="Stop"
if([string]::IsNullOrWhiteSpace($ReceiptPath)){
  $ReceiptPath=Join-Path (Split-Path -Parent $ResultPath) "last-update-schedule.json"
}
function Write-Receipt([string]$Status,[string]$ErrorMessage=""){
  $parent=Split-Path -Parent $ReceiptPath
  if($parent){New-Item -ItemType Directory -Force -Path $parent|Out-Null}
  [pscustomobject]@{
    status=$Status
    taskName=$UpdaterTaskName
    serverTaskName=$ServerTaskName
    currentVersion=$CurrentVersion
    targetVersion=$TargetVersion
    stagingPath=$StagingPath
    installPath=$InstallPath
    requestedBy=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    updatedAtUtc=(Get-Date).ToUniversalTime().ToString("o")
    error=$(if($ErrorMessage){$ErrorMessage}else{$null})
  }|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
}
try{
  Write-Receipt "validating"
  $current=[Security.Principal.WindowsIdentity]::GetCurrent()
  $principal=New-Object Security.Principal.WindowsPrincipal($current)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
    throw "SAS debe ejecutarse con privilegios de Administrador para programar la actualizacion."
  }
  $apply=Join-Path $StagingPath "apply-staged-update.ps1"
  if(-not(Test-Path -LiteralPath $apply)){throw "No existe el aplicador preparado."}
  if(-not(Test-Path -LiteralPath $InstallPath -PathType Container)){throw "No existe la ruta de instalacion: $InstallPath"}
  $q=[char]34
  $arguments="-NoProfile -ExecutionPolicy Bypass -File $q$apply$q -StagingPath $q$StagingPath$q -InstallPath $q$InstallPath$q -ServerTaskName $q$ServerTaskName$q -UpdaterTaskName $q$UpdaterTaskName$q -HealthUrl $q$HealthUrl$q -CurrentVersion $q$CurrentVersion$q -TargetVersion $q$TargetVersion$q -ResultPath $q$ResultPath$q -ReceiptPath $q$ReceiptPath$q"
  $action=New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
  $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2)
  $principalTask=New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -StartWhenAvailable
  Register-ScheduledTask -TaskName $UpdaterTaskName -Description "Aplica una version SAS verificada y revierte si falla" -Action $action -Trigger $trigger -Principal $principalTask -Settings $settings -Force|Out-Null
  $registered=Get-ScheduledTask -TaskName $UpdaterTaskName -ErrorAction Stop
  if(-not $registered){throw "La tarea fue registrada pero no pudo confirmarse."}
  Write-Receipt "registered"
  Start-ScheduledTask -TaskName $UpdaterTaskName -ErrorAction Stop
  Write-Receipt "started"
  [pscustomobject]@{
    status="scheduled"
    receiptStatus="started"
    taskName=$UpdaterTaskName
    targetVersion=$TargetVersion
    receiptPath=$ReceiptPath
    scheduledAtUtc=(Get-Date).ToUniversalTime().ToString("o")
  }|ConvertTo-Json -Depth 5
}catch{
  Write-Receipt "failed" $_.Exception.Message
  throw
}
