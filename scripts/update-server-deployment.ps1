param(
  [Parameter(Mandatory = $true)][string]$SourcePath,
  [string]$InstallPath = "C:\SAS\Server",
  [string]$TaskName = "SAS Support Server Production",
  [bool]$StartAfterUpdate = $true,
  [string]$HealthUrl = "http://127.0.0.1/health",
  [int]$HealthTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
$script:CaptureAdminConsoleUpdate = $false
$script:PendingAdminConsole = $null

function Assert-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Ejecuta este proceso como Administrador." }
}
function New-Check($Name, $Status, $Message, $Details = $null) { [pscustomobject]@{ Name=$Name; Status=$Status; Message=$Message; Details=$Details } }
function Copy-DirectoryContents([string]$Source,[string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    $target = Join-Path $Destination $_.Name
    if ($_.PSIsContainer) { Copy-DirectoryContents $_.FullName $target }
    else {
      $sourceFile = $_
      try { Copy-Item -LiteralPath $sourceFile.FullName -Destination $target -Force }
      catch {
        if ($sourceFile.Name -ieq 'SasAdminConsole.exe') {
          if ($script:CaptureAdminConsoleUpdate) {
            $pending = "$target.pending"
            Copy-Item -LiteralPath $sourceFile.FullName -Destination $pending -Force
            $script:PendingAdminConsole = [pscustomobject]@{ Pending=$pending; Target=$target }
          }
        } else { throw }
      }
    }
  }
}
function Start-PendingAdminConsoleReplacement([string]$Root) {
  if (-not $script:PendingAdminConsole -or -not (Test-Path -LiteralPath $script:PendingAdminConsole.Pending)) { return $false }
  $watcher = Join-Path $Root 'updates\replace-admin-console.ps1'
  $pending = $script:PendingAdminConsole.Pending.Replace("'","''")
  $target = $script:PendingAdminConsole.Target.Replace("'","''")
  $watcherText = @(
    '$ErrorActionPreference=''Stop'''
    '$target=''__TARGET__'''
    '$pending=''__PENDING__'''
    'for($i=0;$i -lt 3600;$i++){'
    '  $running=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -and $_.ExecutablePath -ieq $target}'
    '  if(-not $running){Move-Item -LiteralPath $pending -Destination $target -Force;exit 0}'
    '  Start-Sleep -Seconds 1'
    '}'
    'exit 1'
  ) -join [Environment]::NewLine
  $watcherText = $watcherText.Replace('__TARGET__',$target).Replace('__PENDING__',$pending)
  $watcherText | Set-Content -LiteralPath $watcher -Encoding UTF8
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$watcher) -WindowStyle Hidden
  return $true
}function Copy-CertificateTree([string]$Source,[string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "(?i)(\\certs){2,}\\" } |
    ForEach-Object {
      $relative = $_.FullName.Substring($Source.Length).TrimStart('\')
      $target = Join-Path $Destination $relative
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
}
function Copy-BackupItem([string]$Name,[string]$FromRoot,[string]$ToRoot) {
  $sourceItem = Join-Path $FromRoot $Name
  if (-not (Test-Path -LiteralPath $sourceItem)) { return }
  $targetItem = Join-Path $ToRoot $Name
  if ((Get-Item -LiteralPath $sourceItem).PSIsContainer) {
    if ($Name -eq 'certs') { Copy-CertificateTree $sourceItem $targetItem } else { Copy-DirectoryContents $sourceItem $targetItem }
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetItem) | Out-Null
    Copy-Item -LiteralPath $sourceItem -Destination $targetItem -Force
  }
}
function Test-SasBackupRoot([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $false }
  foreach ($relative in @('package.json','src\server.js','scripts\install-sas-services.ps1','tools\sas-service-host\SasServiceHost.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Path $relative) -PathType Leaf)) { return $false }
  }
  try { $null = Get-Content -LiteralPath (Join-Path $Path 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $false }
  return $true
}
function Find-LatestValidBackup([string]$Root,[string]$Exclude) {
  $backupRoot = Join-Path $Root 'updates\backups'
  foreach ($candidate in @(Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
    if ($candidate.FullName -ne $Exclude -and (Test-SasBackupRoot $candidate.FullName)) { return $candidate.FullName }
  }
  return $null
}
function Get-SasServiceSnapshot {
  @('SAS Support Server','SAS Support TURN','SAS Support Client Agent') | ForEach-Object {
    $service = Get-Service -Name $_ -ErrorAction SilentlyContinue
    [pscustomobject]@{ Name=$_; Installed=$null -ne $service; WasRunning=$null -ne $service -and $service.Status -eq 'Running' }
  }
}
function Stop-SasRuntime([string]$Root) {
  foreach ($serviceName in @('SAS Support Client Agent','SAS Support TURN','SAS Support Server')) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Stopped') {
      Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
      try { (Get-Service $serviceName).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(20)) } catch {}
    }
  }
  $runtimeNode = Join-Path $Root 'runtime\node\node.exe'
  $turnServer = Join-Path $Root 'tools\coturn\turnserver.exe'
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      ($_.ExecutablePath -and $_.ExecutablePath -ieq $turnServer) -or
      ($_.ExecutablePath -and $_.ExecutablePath -ieq $runtimeNode -and $_.CommandLine -and
        $_.CommandLine -match [regex]::Escape($Root) -and
        $_.CommandLine -match '(?i)(src\\server\.js|src\\turn\\turn-service\.js|client\\agent-client\.js)')
    } |
    ForEach-Object { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 700
  $remaining = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath -ieq $turnServer) -or
    ($_.ExecutablePath -and $_.ExecutablePath -ieq $runtimeNode -and $_.CommandLine -and $_.CommandLine -match [regex]::Escape($Root))
  })
  if ($remaining.Count) { throw "No fue posible liberar todos los procesos de SAS: $($remaining.ProcessId -join ', ')." }
}
function Restore-SasSecondaryServices($Snapshot) {
  foreach ($item in @($Snapshot | Where-Object { $_.Name -ne 'SAS Support Server' -and $_.Installed -and $_.WasRunning })) {
    $service = Get-Service -Name $item.Name -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Running') {
      Start-Service -Name $item.Name -ErrorAction Stop
      (Get-Service $item.Name).WaitForStatus('Running',[TimeSpan]::FromSeconds(20))
    }
  }
}
function Start-SasRuntime([string]$Root) {
  $installer = Join-Path $Root 'scripts\install-sas-services.ps1'
  $node = Join-Path $Root 'runtime\node\node.exe'
  if (-not (Test-Path -LiteralPath $installer)) { throw "Falta install-sas-services.ps1" }
  if (-not (Test-Path -LiteralPath $node)) { throw "Falta runtime Node" }
  & $installer -ProjectDir $Root -NodeExe $node | Out-Null
}
function Wait-SasHealth([string]$Url,[string]$ExpectedVersion,[int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds([Math]::Max(10,$TimeoutSeconds))
  do {
    try {
      $health = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5 -Headers @{ 'Cache-Control'='no-cache' }
      if ($health.status -eq 'ok' -and [string]$health.version -eq $ExpectedVersion) { return $health }
    } catch {}
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "El servicio no confirmó salud y versión $ExpectedVersion en $Url."
}
function Remove-ReleaseTargets([string]$Root) {
  foreach ($name in @('src','public','scripts','client','docs')) {
    $target = Join-Path $Root $name
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  }
}
function Copy-Release([string]$Source,[string]$Destination) {
  $protected = @('.env','.env.production','data','certs','updates','logs')
  Get-ChildItem -LiteralPath $Source -Force | Where-Object { $protected -notcontains $_.Name } | ForEach-Object {
    $target = Join-Path $Destination $_.Name
    if ($_.PSIsContainer) { Copy-DirectoryContents $_.FullName $target }
    else {
      $sourceFile = $_
      try { Copy-Item -LiteralPath $sourceFile.FullName -Destination $target -Force }
      catch {
        if ($sourceFile.Name -ieq 'SasAdminConsole.exe') {
          if ($script:CaptureAdminConsoleUpdate) {
            $pending = "$target.pending"
            Copy-Item -LiteralPath $sourceFile.FullName -Destination $pending -Force
            $script:PendingAdminConsole = [pscustomobject]@{ Pending=$pending; Target=$target }
          }
        } else { throw }
      }
    }
  }
}
function Assert-Deployment([string]$Source,[string]$Destination) {
  foreach ($relative in @('package.json','src\server.js','src\contacts\contact-store.js','src\agent\image-analysis-service.js','src\mobile\technician-notification-service.js','src\remote\remote-session-store.js','public\app.js','public\remote-workspace.html','scripts\install-sas-services.ps1','downloads\SAS-Cliente-Setup.exe','downloads\SAS-Cliente-Setup.exe.manifest.json','downloads\SAS-Cliente-Setup.exe.sha256.txt')) {
    $from = Join-Path $Source $relative; $to = Join-Path $Destination $relative
    if (-not (Test-Path -LiteralPath $from -PathType Leaf) -or -not (Test-Path -LiteralPath $to -PathType Leaf)) { throw "Archivo crítico faltante: $relative" }
    if ((Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash) { throw "Archivo crítico no coincide después de copiar: $relative" }
  }
  $clientInstaller = Join-Path $Destination 'downloads\SAS-Cliente-Setup.exe'
  $clientManifestPath = "$clientInstaller.manifest.json"
  $clientSidecarPath = "$clientInstaller.sha256.txt"
  $clientManifest = Get-Content -LiteralPath $clientManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $clientHash = (Get-FileHash -LiteralPath $clientInstaller -Algorithm SHA256).Hash.ToUpperInvariant()
  $clientSidecar = Get-Content -LiteralPath $clientSidecarPath -Raw -Encoding ASCII
  $sourceVersion = [string](Get-Content -LiteralPath (Join-Path $Source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
  if ([string]$clientManifest.version -ne $sourceVersion -or [string]$clientManifest.compiler -ne 'NSIS' -or [long]$clientManifest.size -ne (Get-Item -LiteralPath $clientInstaller).Length -or [string]$clientManifest.sha256 -ne $clientHash -or $clientSidecar -notmatch [regex]::Escape($clientHash)) {
    throw 'El instalador de SAS Cliente copiado no coincide con versión, tamaño o SHA-256 del release.'
  }
}
function Restore-Backup([string]$Backup,[string]$Root) {
  Remove-ReleaseTargets $Root
  foreach ($name in @('src','public','scripts','client','docs','tools')) {
    $sourceItem = Join-Path $Backup $name
    if (Test-Path -LiteralPath $sourceItem) { Copy-DirectoryContents $sourceItem (Join-Path $Root $name) }
  }
  foreach ($name in @('package.json','README.md','.env.example','.env','.env.production','install-manifest.json','post-install-checklist.json')) {
    $sourceItem = Join-Path $Backup $name
    if (Test-Path -LiteralPath $sourceItem) { Copy-Item -LiteralPath $sourceItem -Destination (Join-Path $Root $name) -Force }
  }
  foreach ($name in @('data','certs')) {
    $sourceItem = Join-Path $Backup $name
    if (Test-Path -LiteralPath $sourceItem) { Copy-DirectoryContents $sourceItem (Join-Path $Root $name) }
  }
}

Assert-Admin
$source = (Resolve-Path -LiteralPath $SourcePath).Path
$install = [IO.Path]::GetFullPath($InstallPath).TrimEnd('\')
if (-not (Test-Path -LiteralPath (Join-Path $source 'package.json'))) { throw "Paquete SAS inválido: falta package.json." }
New-Item -ItemType Directory -Force -Path $install | Out-Null
$targetVersion = [string](Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$currentVersion = if (Test-Path -LiteralPath (Join-Path $install 'package.json')) { [string](Get-Content -LiteralPath (Join-Path $install 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version } else { '0.0.0' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $install "updates\backups\backup-$stamp"
$checks = @()
$rolledBack = $false
$serviceSnapshot = @()
$rollbackPath = $null
try {
  $serviceSnapshot = @(Get-SasServiceSnapshot)
  New-Item -ItemType Directory -Force -Path $backupPath | Out-Null
  foreach ($name in @('.env','.env.production','data','certs','src','public','scripts','client','docs','tools','package.json','README.md','.env.example','install-manifest.json','post-install-checklist.json')) { Copy-BackupItem $name $install $backupPath }
  $rollbackPath = $backupPath
  $backupMessage = 'Respaldo integral creado.'
  if (-not (Test-SasBackupRoot $backupPath)) {
    $rollbackPath = Find-LatestValidBackup $install $backupPath
    if (-not $rollbackPath) { throw 'La instalación actual está incompleta y no existe un respaldo integral utilizable. No se modificó ningún archivo adicional.' }
    $backupMessage = 'La instalación estaba incompleta; se seleccionó el último respaldo integral anterior para una reversión segura.'
  }
  $checks += New-Check 'backup' 'pass' $backupMessage @{ backupPath=$backupPath; rollbackPath=$rollbackPath; previousVersion=$currentVersion }
} catch {
  $requiredBackupFiles = @('package.json','src\server.js','scripts\install-sas-services.ps1','tools\sas-service-host\SasServiceHost.exe')
  $missingBackupFiles = @($requiredBackupFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $backupPath $_) -PathType Leaf) })
  $checks += New-Check 'backup_preflight' 'fail' $_.Exception.Message @{ backupPath=$backupPath; missingFiles=$missingBackupFiles; installPath=$install; previousVersion=$currentVersion }
  $preflightReport = [pscustomobject]@{ GeneratedAtUtc=(Get-Date).ToUniversalTime().ToString('o'); InstallPath=$install; Update=$true; PreviousVersion=$currentVersion; TargetVersion=$targetVersion; RolledBack=$false; Stage='backup_preflight'; Checks=$checks; NextSteps=@('Revisar los archivos faltantes del respaldo.','Reparar la instalación actual antes de reintentar.','No se detuvo ni reemplazó el servicio.') }
  $preflightReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $install 'post-install-checklist.json') -Encoding UTF8
  $preflightReport | ConvertTo-Json -Depth 8
  exit 1
}

try {
  Stop-SasRuntime $install
  $checks += New-Check 'stop_service' 'pass' 'Servicios Server, TURN y procesos SAS anteriores detenidos.' @{ services=$serviceSnapshot }
  $legacy = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($legacy) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
  Remove-ReleaseTargets $install
  $script:CaptureAdminConsoleUpdate = $true
  try { Copy-Release $source $install } finally { $script:CaptureAdminConsoleUpdate = $false }
  Assert-Deployment $source $install
  $checks += New-Check 'copy_release' 'pass' 'Archivos copiados y verificados por SHA-256.' @{ source=$source; installPath=$install }
  if ($StartAfterUpdate) {
    Start-SasRuntime $install
    Restore-SasSecondaryServices $serviceSnapshot
    $health = Wait-SasHealth $HealthUrl $targetVersion $HealthTimeoutSeconds
    $checks += New-Check 'health' 'pass' 'Servicios restaurados y servidor saludable.' @{ version=$health.version; url=$HealthUrl }
  }
  if (Start-PendingAdminConsoleReplacement $install) {
    $checks += New-Check 'admin_console_pending' 'pass' 'SAS Administrador se reemplazará automáticamente al cerrar esta ventana.'
  }
} catch {
  $failure = $_.Exception.Message
  if ($script:PendingAdminConsole -and (Test-Path -LiteralPath $script:PendingAdminConsole.Pending)) { Remove-Item -LiteralPath $script:PendingAdminConsole.Pending -Force -ErrorAction SilentlyContinue }
  try {
    Stop-SasRuntime $install
    Restore-Backup $rollbackPath $install
    if ($StartAfterUpdate -and $currentVersion -ne '0.0.0') {
      Start-SasRuntime $install
      Restore-SasSecondaryServices $serviceSnapshot
      Wait-SasHealth $HealthUrl $currentVersion $HealthTimeoutSeconds | Out-Null
    }
    $rolledBack = $true
    $checks += New-Check 'rollback' 'pass' 'Se restauró automáticamente la versión anterior.' @{ version=$currentVersion; backupPath=$rollbackPath }
  } catch {
    $checks += New-Check 'rollback' 'fail' $_.Exception.Message
  }
  $checks += New-Check 'update' 'fail' $failure
}

$report = [pscustomobject]@{ GeneratedAtUtc=(Get-Date).ToUniversalTime().ToString('o'); InstallPath=$install; Update=$true; PreviousVersion=$currentVersion; TargetVersion=$targetVersion; RolledBack=$rolledBack; Checks=$checks; NextSteps=@('Confirmar /health y los puertos 80/443.','Conservar el respaldo hasta validar operación.','Revisar logs\sas-server.err.log si la salud falla.') }
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $install 'post-install-checklist.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 8
if ($checks.Status -contains 'fail') { exit 1 }
