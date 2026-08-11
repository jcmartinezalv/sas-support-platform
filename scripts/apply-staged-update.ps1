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
$started=(Get-Date).ToUniversalTime()
$checks=@()
$exitCode=0
$stage="starting"
if([string]::IsNullOrWhiteSpace($ReceiptPath)){$ReceiptPath=Join-Path (Split-Path -Parent $ResultPath) "last-update-schedule.json"}
function Add-Check($Name,$Status,$Message){$script:checks += [pscustomobject]@{name=$Name;status=$Status;message=$Message}}
function Write-Receipt($Status,$ErrorMessage=$null){
  $parent=Split-Path -Parent $ReceiptPath;if($parent){New-Item -ItemType Directory -Force -Path $parent|Out-Null}
  [pscustomobject]@{status=$Status;stage=$script:stage;taskName=$UpdaterTaskName;serverTaskName=$ServerTaskName;currentVersion=$CurrentVersion;targetVersion=$TargetVersion;stagingPath=$StagingPath;installPath=$InstallPath;updatedAtUtc=(Get-Date).ToUniversalTime().ToString("o");error=$ErrorMessage}|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
}
function Write-Result($Status,$ErrorMessage=$null,$RolledBack=$false){
  $parent=Split-Path -Parent $ResultPath;if($parent){New-Item -ItemType Directory -Force -Path $parent|Out-Null}
  [pscustomobject]@{status=$Status;stage=$script:stage;currentVersion=$CurrentVersion;targetVersion=$TargetVersion;startedAtUtc=$started.ToString("o");completedAtUtc=(Get-Date).ToUniversalTime().ToString("o");rolledBack=$RolledBack;error=$ErrorMessage;checks=$checks}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $ResultPath -Encoding UTF8
}
function Assert-SafePath([string]$Value,[string]$Label){$full=[IO.Path]::GetFullPath($Value).TrimEnd('\');$root=[IO.Path]::GetPathRoot($full);if($full -eq $root -or $full.Length -lt 8){throw "$Label no es una ruta segura: $full"};return $full}
try{
  Write-Receipt "applying"
  $stage="preflight"
  $StagingPath=Assert-SafePath $StagingPath "StagingPath"
  $InstallPath=Assert-SafePath $InstallPath "InstallPath"
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent();$principal=New-Object Security.Principal.WindowsPrincipal($identity)
  if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw "La actualización requiere Administrador."}
  $manifestPath=Join-Path $StagingPath "manifest.json";$packagePath=Join-Path $StagingPath "sas-update.zip"
  if(-not(Test-Path -LiteralPath $manifestPath)-or-not(Test-Path -LiteralPath $packagePath)){throw "Falta el paquete o manifiesto preparado."}
  $manifest=Get-Content $manifestPath -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$manifest.version -ne $TargetVersion){throw "La versión del manifiesto no coincide."}
  $stage="package_hash"
  $actual=(Get-FileHash $packagePath -Algorithm SHA256).Hash.ToUpperInvariant()
  if($actual -ne [string]$manifest.package.sha256.ToUpperInvariant()){throw "SHA-256 externo incorrecto."}
  Add-Check "package_hash" "pass" "SHA-256 externo correcto."

  $stage="expand_package"
  $release=Join-Path $StagingPath "release"
  if(Test-Path -LiteralPath $release){Remove-Item -LiteralPath $release -Recurse -Force}
  New-Item -ItemType Directory -Force -Path $release|Out-Null
  Expand-Archive -LiteralPath $packagePath -DestinationPath $release -Force
  $releaseManifestPath=Join-Path $release "release-manifest.json"
  if(-not(Test-Path -LiteralPath $releaseManifestPath)){throw "El paquete no contiene release-manifest.json."}
  $releaseManifest=Get-Content $releaseManifestPath -Raw -Encoding UTF8|ConvertFrom-Json
  if([string]$releaseManifest.version -ne $TargetVersion){throw "La versión interna no coincide."}
  $stage="internal_manifest"
  foreach($file in $releaseManifest.files){
    $relative=[string]$file.path
    if([IO.Path]::IsPathRooted($relative)-or $relative.Split([IO.Path]::DirectorySeparatorChar)-contains '..'){throw "Ruta interna insegura: $relative"}
    $candidate=[IO.Path]::GetFullPath((Join-Path $release $relative))
    if(-not $candidate.StartsWith($release+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw "Ruta interna fuera del paquete: $relative"}
    if(-not(Test-Path -LiteralPath $candidate -PathType Leaf)){throw "Falta archivo interno: $relative"}
    if((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -ne [string]$file.sha256){throw "Hash interno incorrecto: $relative"}
  }
  Add-Check "internal_manifest" "pass" "$($releaseManifest.fileCount) archivos internos verificados."
  $deployer=Join-Path $release "scripts\update-server-deployment.ps1"
  if(-not(Test-Path -LiteralPath $deployer)){throw "El paquete no contiene el actualizador seguro."}
  $stage="deployment"
  Write-Receipt "applying"
  $deploymentLines=@(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $deployer -SourcePath $release -InstallPath $InstallPath -StartAfterUpdate 1 -HealthUrl $HealthUrl 2>&1|ForEach-Object{"$_"})
  $deploymentExitCode=$LASTEXITCODE
  $deploymentOutput=($deploymentLines -join [Environment]::NewLine)
  if($deploymentOutput.Length -gt 12000){$deploymentOutput=$deploymentOutput.Substring($deploymentOutput.Length-12000)}
  if($deploymentExitCode -ne 0){
    $checklist=Join-Path $InstallPath "post-install-checklist.json"
    $rolledBack=$false
    $specific=""
    if(Test-Path $checklist){try{$report=Get-Content $checklist -Raw|ConvertFrom-Json;$rolledBack=[bool]$report.RolledBack;foreach($item in @($report.Checks)){Add-Check ("deployment_"+[string]$item.Name) ([string]$item.Status) ([string]$item.Message)};$failed=@($report.Checks|Where-Object{$_.Status -eq "fail"})|Select-Object -Last 1;if($failed){$specific=[string]$failed.Message}}catch{}}
    if($deploymentOutput){Add-Check "deployment_output" "fail" $deploymentOutput}
    throw "La instalación falló en deployment (exit=$deploymentExitCode; rollback=$rolledBack)$(if($specific){': '+$specific}else{''})."
  }
  Add-Check "deployment" "pass" "Versión instalada, iniciada y validada en /health."
  $stage="completed"
  Write-Result "pass"
  Write-Receipt "completed"
}catch{
  $exitCode=1
  $failure="${stage}: $($_.Exception.Message)"
  Add-Check "update" "fail" $failure
  $rolledBack=$false;$checklist=Join-Path $InstallPath "post-install-checklist.json"
  if(Test-Path $checklist){try{$rolledBack=[bool](Get-Content $checklist -Raw|ConvertFrom-Json).RolledBack}catch{}}
  Write-Result "fail" $failure $rolledBack
  Write-Receipt "failed" $failure
}finally{
  Unregister-ScheduledTask -TaskName $UpdaterTaskName -Confirm:$false -ErrorAction SilentlyContinue
}
exit $exitCode

