param(
  [string]$InstallPath = "C:\SAS\Client",
  [switch]$LeaveBrokerDisabled,
  [switch]$AllowSideBySide,
  [switch]$RestoreOnly
)

$ErrorActionPreference = "Stop"
$brokerServiceName = "SAS Secure Attention Broker"
$agentTaskName = "SAS Support Client Agent"
$inputTaskName = "SAS Input Desktop Helper"
$brokerFallbackTaskName = "SAS Privileged Desktop Broker Recovery"
$clamTaskName = "SAS Client ClamAV Definitions"
$diagnosticPath = Join-Path $env:ProgramData "SAS\Client\last-component-release.json"
$diagnosticErrorPath = Join-Path $env:ProgramData "SAS\Client\last-component-release-error.txt"
$nativeNames = @("SasCaptureHelper.exe", "SasDxgiCapture.exe", "SasInputHelper.exe", "SasSecureAttentionBroker.exe")
$clamRoot = Join-Path $InstallPath "tools\clamav"
$clamRootPrefix = [IO.Path]::GetFullPath($clamRoot).TrimEnd('\') + '\'
$clamTaskWasEnabled = $false

function Invoke-NativeProcessBounded([string]$FilePath, [string[]]$Arguments, [int]$TimeoutMilliseconds = 5000) {
  $process = New-Object Diagnostics.Process
  $process.StartInfo = New-Object Diagnostics.ProcessStartInfo
  $process.StartInfo.FileName = $FilePath
  $process.StartInfo.Arguments = (@($Arguments | ForEach-Object { '"' + ([string]$_).Replace('"', '\"') + '"' }) -join ' ')
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  if (-not $process.Start()) { throw "No se pudo iniciar $FilePath." }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $timedOut = -not $process.WaitForExit($TimeoutMilliseconds)
  if ($timedOut) {
    try { $process.Kill() } catch {}
    try { $process.WaitForExit(1000) | Out-Null } catch {}
  }
  $exitCode = if ($timedOut) { -1 } else { $process.ExitCode }
  $stdoutText = try { $stdout.GetAwaiter().GetResult() } catch { "" }
  $stderrText = try { $stderr.GetAwaiter().GetResult() } catch { "" }
  return [pscustomobject]@{ ExitCode = $exitCode; TimedOut = $timedOut; StdOut = $stdoutText; StdErr = $stderrText }
}

function Get-ProcessPathSafe($Process) {
  try { return [string]$Process.Path } catch { return "" }
}

function Stop-KnownClientProcesses {
  $installPrefix = [IO.Path]::GetFullPath($InstallPath).TrimEnd('\') + '\'
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    $path = Get-ProcessPathSafe $process
    $isKnown = $process.ProcessName -in @("SasCaptureHelper", "SasDxgiCapture", "SasInputHelper", "SasSecureAttentionBroker", "freshclam", "clamscan")
    $isInstalledRuntime = -not [string]::IsNullOrWhiteSpace($path) -and $path.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
    if ($isKnown -or $isInstalledRuntime) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
}

function Get-RemainingClientProcesses {
  $installPrefix = [IO.Path]::GetFullPath($InstallPath).TrimEnd('\') + '\'
  $remaining = @()
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    $path = Get-ProcessPathSafe $process
    $isKnown = $process.ProcessName -in @("SasCaptureHelper", "SasDxgiCapture", "SasInputHelper", "SasSecureAttentionBroker", "freshclam", "clamscan")
    $isInstalledRuntime = -not [string]::IsNullOrWhiteSpace($path) -and $path.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)
    if ($isKnown -or $isInstalledRuntime) {
      $remaining += [ordered]@{ name = $process.ProcessName + ".exe"; pid = $process.Id; path = $path; commandLine = "" }
    }
  }
  return @($remaining)
}

function Test-ExclusiveWrite([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $true }
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $stream.Dispose()
    return $true
  } catch { return $false }
}

function Get-TargetFiles {
  $items = @(
    (Join-Path $InstallPath "tools\sas-capture-helper\bin\Release\SasCaptureHelper.exe"),
    (Join-Path $InstallPath "tools\sas-dxgi-capture\bin\Release\SasDxgiCapture.exe"),
    (Join-Path $InstallPath "tools\sas-input-helper\bin\Release\SasInputHelper.exe"),
    (Join-Path $InstallPath "tools\sas-secure-attention-broker\bin\Release\SasSecureAttentionBroker.exe")
  )
  $nativeRoot = Join-Path $InstallPath "native"
  if (Test-Path -LiteralPath $nativeRoot -PathType Container) {
    $items += @(Get-ChildItem -LiteralPath $nativeRoot -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $nativeNames -contains $_.Name } | ForEach-Object { $_.FullName })
  }
  if (Test-Path -LiteralPath $clamRoot -PathType Container) {
    $items += @(Get-ChildItem -LiteralPath $clamRoot -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in @(".exe", ".dll", ".conf", ".json") } |
      ForEach-Object { $_.FullName })
  }
  return @($items | Select-Object -Unique)
}

function Restore-ClientStartup([switch]$Force) {
  if ($Force -or -not $LeaveBrokerDisabled) {
    $sc = Join-Path $env:SystemRoot "System32\sc.exe"
    $null = Invoke-NativeProcessBounded $sc @("config", $brokerServiceName, "start=", "delayed-auto") 5000
    $start = Invoke-NativeProcessBounded $sc @("start", $brokerServiceName) 8000
    $serviceRestored = $start.ExitCode -in @(0, 1056)
    if (-not $serviceRestored) {
      try { Start-ScheduledTask -TaskName $brokerFallbackTaskName -ErrorAction SilentlyContinue } catch {}
      try { Start-ScheduledTask -TaskName $inputTaskName -ErrorAction SilentlyContinue } catch {}
    }
    if ($clamTaskWasEnabled -or $Force) {
      try {
        if (Get-ScheduledTask -TaskName $clamTaskName -ErrorAction SilentlyContinue) { Enable-ScheduledTask -TaskName $clamTaskName -ErrorAction SilentlyContinue | Out-Null }
      } catch {}
    }
    if ($Force) { try { Start-ScheduledTask -TaskName $agentTaskName -ErrorAction SilentlyContinue } catch {} }
  }
}

function Write-Diagnostic([string]$Status, [string]$Message, $Details) {
  $folder = Split-Path -Parent $diagnosticPath
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
  [ordered]@{
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    status = $Status
    message = $Message
    details = $Details
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $diagnosticPath -Encoding UTF8
  if ($Status -eq "fail") {
    $Message | Set-Content -LiteralPath $diagnosticErrorPath -Encoding Default
  } else {
    Remove-Item -LiteralPath $diagnosticErrorPath -Force -ErrorAction SilentlyContinue
  }
}

if ($RestoreOnly) {
  Restore-ClientStartup -Force
  exit 0
}

try {
  $clamTask = Get-ScheduledTask -TaskName $clamTaskName -ErrorAction SilentlyContinue
  $clamTaskWasEnabled = $null -ne $clamTask -and $clamTask.State -ne "Disabled"
  try { Stop-ScheduledTask -TaskName $clamTaskName -ErrorAction SilentlyContinue } catch {}
  try { Disable-ScheduledTask -TaskName $clamTaskName -ErrorAction SilentlyContinue | Out-Null } catch {}
  try { Stop-ScheduledTask -TaskName $inputTaskName -ErrorAction SilentlyContinue } catch {}
  try { Stop-ScheduledTask -TaskName $agentTaskName -ErrorAction SilentlyContinue } catch {}
  try { Stop-ScheduledTask -TaskName $brokerFallbackTaskName -ErrorAction SilentlyContinue } catch {}
  $sc = Join-Path $env:SystemRoot "System32\sc.exe"
  $service = Get-Service -Name $brokerServiceName -ErrorAction SilentlyContinue
  if ($service) {
    $null = Invoke-NativeProcessBounded $sc @("config", $brokerServiceName, "start=", "disabled") 5000
    $null = Invoke-NativeProcessBounded $sc @("stop", $brokerServiceName) 5000
    $query = Invoke-NativeProcessBounded $sc @("queryex", $brokerServiceName) 5000
    $pidMatch = [regex]::Match(($query.StdOut + "`n" + $query.StdErr), "PID\s*:\s*(\d+)", "IgnoreCase")
    if ($pidMatch.Success -and [int]$pidMatch.Groups[1].Value -gt 0) { Stop-Process -Id ([int]$pidMatch.Groups[1].Value) -Force -ErrorAction SilentlyContinue }
  }

  $deadline = (Get-Date).AddSeconds(15)
  do {
    Stop-KnownClientProcesses
    Start-Sleep -Milliseconds 300
    $lockedFiles = @(Get-TargetFiles | Where-Object { -not (Test-ExclusiveWrite $_) })
    $remainingProcesses = @(Get-RemainingClientProcesses)
  } while (($lockedFiles.Count -gt 0 -or $remainingProcesses.Count -gt 0) -and (Get-Date) -lt $deadline)

  $details = [ordered]@{
    installPath = $InstallPath
    allowSideBySide = [bool]$AllowSideBySide
    clamTaskWasEnabled = [bool]$clamTaskWasEnabled
    lockedFiles = @($lockedFiles)
    remainingProcesses = @($remainingProcesses)
  }
  $lockedClamFiles = @($lockedFiles | Where-Object { ([string]$_).StartsWith($clamRootPrefix, [StringComparison]::OrdinalIgnoreCase) })
  $remainingClamProcesses = @($remainingProcesses | Where-Object {
    ([string]$_.path).StartsWith($clamRootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    $_.name -in @("freshclam.exe", "clamscan.exe") -or
    ([string]$_.commandLine) -match "update-clamav-definitions\.ps1"
  })
  if ($lockedClamFiles.Count -gt 0 -or $remainingClamProcesses.Count -gt 0) {
    $clamNames = @($lockedClamFiles + @($remainingClamProcesses | ForEach-Object { "$($_.name) (PID $($_.pid))" }))
    throw "No fue posible liberar ClamAV antes de actualizar: $($clamNames -join ', ')."
  }
  if ($lockedFiles.Count -gt 0 -or $remainingProcesses.Count -gt 0) {
    if (-not $AllowSideBySide) { throw "No fue posible liberar los componentes nativos del cliente." }
    Write-Diagnostic "warn" "Quedaron componentes nativos antiguos bloqueados; la actualización continuará en una carpeta versionada." $details
    Write-Warning "Quedaron componentes nativos antiguos bloqueados. Se continuará con instalación paralela por versión."
  } else {
    Write-Diagnostic "pass" "Los componentes del cliente y ClamAV fueron liberados." $details
  }
} catch {
  Write-Diagnostic "fail" $_.Exception.Message ([ordered]@{ installPath = $InstallPath; allowSideBySide = [bool]$AllowSideBySide })
  Restore-ClientStartup -Force
  throw
} finally {
  Restore-ClientStartup
}