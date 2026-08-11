param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [string]$ExpectedVersion = "",
  [string]$ExpectedSha256 = "",
  [string]$InstallPath = "C:\SAS\Client",
  [string]$StatusPath = "",
  [string]$TaskName = "SAS Support Client Update"
)

$ErrorActionPreference = "Stop"
if (-not $StatusPath) { $StatusPath = Join-Path $InstallPath "updates\last-update.json" }
$logPath = Join-Path $InstallPath "updates\client-update.log"
$installedVersion = ""
$requiredInputHelperRevision = "input-v9-pointer-recovery"

function Write-UpdateStatus([string]$Status, [string]$Message, [hashtable]$Extra = @{}) {
  $parent = Split-Path -Parent $StatusPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $body = [ordered]@{
    status = $Status
    message = $Message
    expectedVersion = $ExpectedVersion
    taskName = $TaskName
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  foreach ($key in $Extra.Keys) { $body[$key] = $Extra[$key] }
  $body | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusPath -Encoding UTF8
}

function Write-UpdateLog([string]$Message) {
  $parent = Split-Path -Parent $logPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] $Message"
}

function Restore-PreviousClientStartup {
  try {
    if (Get-ScheduledTask -TaskName "SAS Client ClamAV Definitions" -ErrorAction SilentlyContinue) {
      Enable-ScheduledTask -TaskName "SAS Client ClamAV Definitions" -ErrorAction SilentlyContinue | Out-Null
    }
  } catch {}
  $brokerRestored = $false
  try {
    & sc.exe config "SAS Secure Attention Broker" start= delayed-auto | Out-Null
    Start-Service -Name "SAS Secure Attention Broker" -ErrorAction Stop
    $brokerRestored = (Get-Service -Name "SAS Secure Attention Broker" -ErrorAction SilentlyContinue).Status -eq "Running"
  } catch {}
  if (-not $brokerRestored) {
    try { Start-ScheduledTask -TaskName "SAS Privileged Desktop Broker Recovery" -ErrorAction SilentlyContinue } catch {}
  }
  try { Start-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction SilentlyContinue } catch {}
}
function Test-PrivilegedBrokerPipe {
  $pipe = $null
  try {
    $pipe = New-Object IO.Pipes.NamedPipeClientStream(".", "SASPrivilegedDesktop", [IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(1000)
    return $true
  } catch { return $false }
  finally { if ($pipe) { $pipe.Dispose() } }
}

function Test-InputDesktopPipe {
  $pipe = $null
  try {
    $runtimeStatusPath = Join-Path $InstallPath "runtime\input-desktop-status.json"
    if (-not (Test-Path -LiteralPath $runtimeStatusPath -PathType Leaf)) { return $false }
    $runtimeStatus = Get-Content -LiteralPath $runtimeStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $checkedAt = [DateTime]::MinValue
    if (-not [DateTime]::TryParse([string]$runtimeStatus.checkedAt, [ref]$checkedAt) -or ((Get-Date).ToUniversalTime() - $checkedAt.ToUniversalTime()).TotalSeconds -gt 45) { return $false }
    $pipeName = [string]$runtimeStatus.pipe
    if ($pipeName -notmatch '^SASInputDesktopV3_S\d+$') { return $false }
    $pipe = New-Object IO.Pipes.NamedPipeClientStream(".", $pipeName, [IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(1000)
    $utf8 = New-Object Text.UTF8Encoding($false)
    $writer = New-Object IO.StreamWriter($pipe, $utf8, 1024, $true)
    $reader = New-Object IO.StreamReader($pipe, $utf8, $false, 1024, $true)
    $writer.AutoFlush = $true
    $writer.WriteLine([Convert]::ToBase64String($utf8.GetBytes("--type`0health_check")))
    $response = $reader.ReadLine()
    if (-not $response) { return $false }
    $result = $response.TrimStart([char]0xFEFF) | ConvertFrom-Json
    if (-not [bool]$result.ok) { return $false }
    $diagnostic = $result.diagnostic
    if ([string]$diagnostic.helperRevision -ne $requiredInputHelperRevision) { return $false }
    $helperProcessId = [int]$diagnostic.processId
    if ($helperProcessId -le 0) { return $false }
    $helperProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$helperProcessId" -ErrorAction SilentlyContinue
    if (-not $helperProcess -or [string]$helperProcess.Name -ne "SasInputHelper.exe") { return $false }
    $expectedHelperPath = if ($ExpectedVersion) { Join-Path $InstallPath "native\$ExpectedVersion\SasInputHelper.exe" } else { [string]$runtimeStatus.helperPath }
    if (-not $expectedHelperPath -or -not (Test-Path -LiteralPath $expectedHelperPath -PathType Leaf)) { return $false }
    return [IO.Path]::GetFullPath([string]$helperProcess.ExecutablePath).Equals([IO.Path]::GetFullPath($expectedHelperPath), [StringComparison]::OrdinalIgnoreCase)
  } catch { return $false }
  finally { if ($pipe) { $pipe.Dispose() } }
}
function Resolve-ValidatedInstaller {
  $resolved = (Resolve-Path -LiteralPath $InstallerPath).Path
  $allowedRoot = [IO.Path]::GetFullPath((Join-Path $InstallPath "updates")).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "La actualización está fuera del directorio autorizado."
  }
  if ([IO.Path]::GetExtension($resolved) -ne ".exe") {
    throw "El paquete de actualización no es ejecutable."
  }
  if ($ExpectedSha256) {
    $actualSha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
    if ($actualSha256 -ne $ExpectedSha256.ToUpperInvariant()) {
      throw "El instalador cambió después de descargarse. SAS canceló la actualización."
    }
  }
  return $resolved
}

function Stop-SasClientProcesses {
  $cleanupScript = Join-Path $PSScriptRoot "stop-client-components.ps1"
  if (-not (Test-Path -LiteralPath $cleanupScript -PathType Leaf)) {
    throw "Falta el liberador de componentes nativos de SAS Cliente."
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $cleanupScript -InstallPath $InstallPath -LeaveBrokerDisabled -AllowSideBySide
  if ($LASTEXITCODE -ne 0) {
    throw "No fue posible liberar SasCaptureHelper, SasInputHelper y SasSecureAttentionBroker."
  }
  Stop-ScheduledTask -TaskName "SAS Input Desktop Helper" -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName "SAS Privileged Desktop Broker Recovery" -ErrorAction SilentlyContinue
  Stop-Service -Name "SAS Secure Attention Broker" -Force -ErrorAction SilentlyContinue
  $service = Get-Service -Name "SAS Secure Attention Broker" -ErrorAction SilentlyContinue
  if ($service) {
    try { $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(20)) } catch {}
  }

  $installPrefix = [IO.Path]::GetFullPath($InstallPath).TrimEnd('\') + '\'
  $deadline = (Get-Date).AddSeconds(35)
  do {
    $blocking = @(
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
          $_.ProcessId -ne $PID -and (
            ([string]$_.ExecutablePath).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) -or
            ([string]$_.CommandLine).IndexOf($installPrefix, [StringComparison]::OrdinalIgnoreCase) -ge 0
          )
        }
    )
    foreach ($process in $blocking) {
      Write-UpdateLog "Deteniendo proceso SAS $($process.Name), PID $($process.ProcessId)."
      Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($blocking.Count -eq 0) { return }
    Start-Sleep -Milliseconds 750
  } while ((Get-Date) -lt $deadline)

  $remaining = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.ProcessId -ne $PID -and (
          ([string]$_.ExecutablePath).StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase) -or
          ([string]$_.CommandLine).IndexOf($installPrefix, [StringComparison]::OrdinalIgnoreCase) -ge 0
        )
      } |
      ForEach-Object { "$($_.Name) (PID $($_.ProcessId))" }
  )
  if ($remaining.Count) {
    throw "No fue posible liberar los ejecutables de SAS Cliente: $($remaining -join ', ')."
  }
}

try {
  Start-Sleep -Seconds 8
  $resolved = Resolve-ValidatedInstaller
  Write-UpdateStatus "applying" "La tarea programada está cerrando SAS Cliente para instalar $ExpectedVersion." @{
    installerPath = $resolved
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    progressPercent = 74
  }
  Write-UpdateLog "Iniciando actualización programada a $ExpectedVersion."
  Stop-SasClientProcesses
  $resolved = Resolve-ValidatedInstaller
  Write-UpdateStatus "installing" "Instalando SAS Cliente $ExpectedVersion." @{ progressPercent = 86; installerPath = $resolved }

  $process = Start-Process -FilePath $resolved -ArgumentList "/S" -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "El instalador terminó con código $($process.ExitCode)."
  }

  Restore-PreviousClientStartup

  Write-UpdateStatus "validating" "Validando versión, servicios y arranque de SAS Cliente." @{ progressPercent = 95; installerExitCode = $process.ExitCode }
  try { Start-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction SilentlyContinue } catch {}
  $deadline = (Get-Date).AddSeconds(90)
  do {
    $packagePath = Join-Path $InstallPath "package.json"
    if (Test-Path -LiteralPath $packagePath) {
      try { $installedVersion = [string](Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json).version } catch {}
    }
    $agentTask = Get-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction SilentlyContinue
    $brokerReady = Test-PrivilegedBrokerPipe
    $inputDesktopReady = Test-InputDesktopPipe
    if (((-not $ExpectedVersion) -or $installedVersion -eq $ExpectedVersion) -and $agentTask -and $inputDesktopReady) { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  if ($ExpectedVersion -and $installedVersion -ne $ExpectedVersion) {
    throw "La instalación terminó, pero reporta $installedVersion en lugar de $ExpectedVersion."
  }
  $brokerReady = Test-PrivilegedBrokerPipe
  $inputDesktopReady = Test-InputDesktopPipe
  if (-not $inputDesktopReady) { throw "La versión se instaló, pero el helper interactivo activo no corresponde a $ExpectedVersion / $requiredInputHelperRevision." }
  Start-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction SilentlyContinue
  Write-UpdateStatus "pass" "SAS Cliente se actualizó correctamente a $installedVersion." @{
    installedVersion = $installedVersion
    exitCode = $process.ExitCode
    completedAt = (Get-Date).ToUniversalTime().ToString("o")
    progressPercent = 100
    inputHelperRevision = $requiredInputHelperRevision
    inputDesktopReady = $inputDesktopReady
    privilegedBrokerReady = $brokerReady
  }
  Write-UpdateLog "Actualización terminada correctamente en $installedVersion."
} catch {
  Restore-PreviousClientStartup
  Write-UpdateStatus "fail" $_.Exception.Message @{
    installedVersion = $installedVersion
    failedAt = (Get-Date).ToUniversalTime().ToString("o")
    progressPercent = 100
    inputDeliveryMode = $(if ($brokerReady) { "privileged_broker" } else { "interactive_desktop_pipe" })
  }
  Write-UpdateLog "ERROR: $($_.Exception.Message)"
  throw
} finally {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}
