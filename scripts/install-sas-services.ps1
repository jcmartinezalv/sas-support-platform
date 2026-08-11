param([string]$ProjectDir=(Resolve-Path "$PSScriptRoot\..").Path,[string]$NodeExe="")
$ErrorActionPreference='Stop'
$admin=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent(); if(!$admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Ejecuta como Administrador.'}
$root=(Resolve-Path $ProjectDir).Path; if(!$NodeExe){$NodeExe=Join-Path $root 'runtime\node\node.exe'}; if(!(Test-Path $NodeExe)){throw "No existe Node: $NodeExe"}
$hostExe=Join-Path $root 'tools\sas-service-host\SasServiceHost.exe'; if(!(Test-Path $hostExe)){throw "No existe $hostExe"}
$log=Join-Path $root 'logs'; New-Item -ItemType Directory -Force $log | Out-Null
function Stop-StaleSasProcesses {
  # El servicio nuevo no puede enlazar 80/443 si quedó vivo un Node de una tarea antigua.
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match '(?i)src\\server\.js' -and $_.CommandLine -match [regex]::Escape($root) } |
    ForEach-Object {
      try { Stop-Process -Id ([int]$_.ProcessId) -Force -ErrorAction SilentlyContinue; Write-Output ("Proceso SAS anterior detenido: PID {0}" -f $_.ProcessId) } catch {}
    }
}
function Install-SasService($name,$display,$script,$envFile,$out,$err){
  $args='"'+$hostExe+'" "'+$name+'" "'+$display+'" "'+$NodeExe+'" "'+(Join-Path $root $script)+'" "'+$root+'" "'+(Join-Path $root $envFile)+'" "'+(Join-Path $root $out)+'" "'+(Join-Path $root $err)+'"'
  $svc=Get-Service -Name $name -ErrorAction SilentlyContinue
  if($svc){
    if($svc.Status -ne 'Stopped'){ Stop-Service $name -Force -ErrorAction SilentlyContinue; $svc.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(20)) }
    $serviceInfo=Get-CimInstance Win32_Service -Filter ("Name='{0}'" -f $name.Replace("'","''")) -ErrorAction SilentlyContinue
    $currentPath=if($serviceInfo){[string]$serviceInfo.PathName}else{''}
    if(-not $currentPath.Trim().Equals($args.Trim(),[StringComparison]::OrdinalIgnoreCase)){
      $scOutput=(& sc.exe config $name binPath= $args start= auto DisplayName= $display 2>&1 | Out-String).Trim()
      $scExitCode=$LASTEXITCODE
      if($scExitCode -ne 0){ throw "No se pudo actualizar el servicio $name. sc.exe devolvio $scExitCode. $scOutput" }
      Write-Output "Configuracion del servicio actualizada."
    } else {
      Write-Output "Configuracion del servicio ya correcta; no fue necesario modificarla."
    }
    Set-Service -Name $name -StartupType Automatic
  } else {
    New-Service -Name $name -BinaryPathName $args -DisplayName $display -Description $display -StartupType Automatic | Out-Null
  }
  & sc.exe failure $name reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
  Start-Service $name
  (Get-Service -Name $name).WaitForStatus('Running',[TimeSpan]::FromSeconds(20))
}
# Depurar recibos de actualizaciones ya superadas.
try {
  $installedVersion = [string](Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
  $receipt = Join-Path 'C:\SAS\Updates' 'last-update-schedule.json'
  if (Test-Path $receipt) {
    $r = Get-Content $receipt -Raw | ConvertFrom-Json
    if ($r.targetVersion -and ([version]$r.targetVersion -le [version]$installedVersion)) {
      Remove-Item $receipt -Force -ErrorAction SilentlyContinue
      Remove-Item (Join-Path 'C:\SAS\Updates' 'last-update-result.json') -Force -ErrorAction SilentlyContinue
      Write-Output ("Recibo histórico eliminado: {0}" -f $r.targetVersion)
    }
  }
} catch {}Stop-StaleSasProcesses
# Verificar puertos sin tocar servicios ajenos: solo procesos Node que ejecutan SAS.
Get-NetTCPConnection -LocalPort 80,443 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  Where-Object { $_ -and $_ -gt 4 } |
  ForEach-Object {
    try {
      $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $_) -ErrorAction SilentlyContinue
      $cmd = [string]$proc.CommandLine
      if ($cmd -match '(?i)node(\.exe)?' -and $cmd -match '(?i)src\\server\.js' -and $cmd -match [regex]::Escape($root)) {
        Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue
        Write-Output ("Proceso SAS que ocupaba puerto detenido: PID {0}" -f $_)
      } else {
        Write-Output ("Puerto ocupado por proceso ajeno; no se detuvo: PID {0}" -f $_)
      }
    } catch {}
  }
Install-SasService 'SAS Support Server' 'SAS Support Server' 'src\server.js' '.env.production' 'logs\sas-server.out.log' 'logs\sas-server.err.log'
foreach($task in @('SAS Support Server Production','SAS Support Client Agent')){if(Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue){Stop-ScheduledTask $task -ErrorAction SilentlyContinue; Unregister-ScheduledTask $task -Confirm:$false}}
Get-Service 'SAS Support Server','SAS Support Client Agent' -ErrorAction SilentlyContinue | Select Name,Status,StartType


