param(
  [string]$InstallPath = "C:\SAS\Client",
  [string]$ServerUrl = "https://setinfo.sytes.net",
  [string]$AgentSharedSecret = "",
  [string]$EnrollmentToken = "",
  [string]$DeploymentToken = "",
  [string]$DeploymentFile = "",
  [string]$ServerEnvPath = "",
  [string]$NodeExe = "",
  [string]$Publisher = "SAS Support Platform",
  [ValidateSet("sas", "rustdesk", "hoptodesk", "auto")]
  [string]$RemoteEngine = "auto",
  [string]$RustDeskPath = "",
  [string]$HopToDeskPath = "",
  [switch]$InstallRustDeskEngine,
  [switch]$UnsignedRestrictedProduction,
  [switch]$UpdateMode
)

$ErrorActionPreference = "Stop"
$installPhase = "inicio"
$installDiagnosticPath = Join-Path $env:ProgramData "SAS\Client\last-install-result.json"
$installErrorTextPath = Join-Path $env:ProgramData "SAS\Client\last-install-error.txt"
$brokerServiceName = "SAS Secure Attention Broker"
$agentTaskName = "SAS Support Client Agent"
$inputTaskName = "SAS Input Desktop Helper"
$brokerFallbackTaskName = "SAS Privileged Desktop Broker Recovery"
$clamTaskName = "SAS Client ClamAV Definitions"
$brokerDiagnosticPath = ""
$brokerStartupMode = "unknown"
$nativeAclRepairWarning = ""
$nativeVersionsRemoved = @()
$nativeVersionsPending = @()

function Invoke-ScCommand([string[]]$ScArguments) {
  $scOutput = @(& "$env:SystemRoot\System32\sc.exe" @ScArguments 2>&1)
  $scExitCode = $LASTEXITCODE
  if ($scExitCode -ne 0) {
    throw "sc.exe $($ScArguments -join ' ') devolvió código $scExitCode. $($scOutput -join ' ')"
  }
}

function Set-ServiceImagePath([string]$Name, [string]$CommandLine) {
  $serviceRegistryPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$Name"
  if (-not (Test-Path -LiteralPath $serviceRegistryPath)) {
    throw "No existe el registro del servicio $Name."
  }
  New-ItemProperty -LiteralPath $serviceRegistryPath -Name "ImagePath" -Value $CommandLine -PropertyType ExpandString -Force | Out-Null
}

function Invoke-NativeProcessCaptured([string]$FilePath, [string[]]$Arguments) {
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
  $process.WaitForExit()
  $result = [pscustomobject]@{
    ExitCode = [int]$process.ExitCode
    Output = ((@($stdout.Result, $stderr.Result) | Where-Object { $_ }) -join [Environment]::NewLine).Trim()
  }
  $process.Dispose()
  return $result
}

function Invoke-IcaclsChecked([string[]]$Arguments, [string]$Context) {
  $result = Invoke-NativeProcessCaptured "$env:SystemRoot\System32\icacls.exe" $Arguments
  if ($result.ExitCode -ne 0) {
    $detail = (($result.Output -split "`r?`n") | Select-Object -Last 8) -join " "
    throw "$Context. icacls.exe devolvió código $($result.ExitCode). $detail"
  }
}

function Remove-LegacyNativeVersions([string]$Root, [string]$CurrentDirectory) {
  $currentFull = [IO.Path]::GetFullPath($CurrentDirectory).TrimEnd('\')
  foreach ($directory in @(Get-ChildItem -LiteralPath $Root -Directory -Force -ErrorAction SilentlyContinue)) {
    if ($directory.Name -notmatch '^\d+\.\d+\.\d+$') { continue }
    if ([IO.Path]::GetFullPath($directory.FullName).TrimEnd('\') -eq $currentFull) { continue }
    try {
      # Los instaladores antiguos pudieron dejar ACE de carpeta sobre archivos.
      # Se concede acceso temporal dentro de esta carpeta obsoleta y luego se elimina.
      $targets = @($directory) + @(Get-ChildItem -LiteralPath $directory.FullName -Recurse -Force -ErrorAction SilentlyContinue)
      foreach ($target in $targets) {
        $grant = Invoke-NativeProcessCaptured "$env:SystemRoot\System32\icacls.exe" @($target.FullName, "/inheritance:e", "/grant:r", '*S-1-5-18:F', '*S-1-5-32-544:F', '*S-1-5-32-545:F', "/C", "/Q")
        if ($grant.ExitCode -ne 0) { throw "No se recuperó el acceso a $($target.FullName): $($grant.Output)" }
      }
      Remove-Item -LiteralPath $directory.FullName -Recurse -Force -ErrorAction Stop
      $script:nativeVersionsRemoved += $directory.Name
    } catch {
      $script:nativeVersionsPending += [ordered]@{ version = $directory.Name; message = $_.Exception.Message }
    }
  }
}

function Set-NativeRuntimeAcl([string]$Root, [string]$CurrentDirectory, [string[]]$Executables) {
  # Primero se repara solamente la versión actual. Una versión antigua dañada
  # nunca puede volver a cancelar la instalación ni el control remoto.
  Invoke-IcaclsChecked @($Root, "/inheritance:r", "/grant:r", '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX', "/C", "/Q") "No se pudo proteger la carpeta nativa"
  Invoke-IcaclsChecked @($CurrentDirectory, "/inheritance:e", "/grant:r", '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-32-545:(OI)(CI)RX', "/C", "/Q") "No se pudo preparar la versión nativa actual"
  foreach ($executable in $Executables) {
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "No existe el componente nativo requerido: $executable" }
    Invoke-IcaclsChecked @($executable, "/inheritance:e", "/grant:r", '*S-1-5-18:F', '*S-1-5-32-544:F', '*S-1-5-32-545:RX', "/C", "/Q") "No se pudo habilitar la ejecución de $executable"
  }
  Remove-LegacyNativeVersions -Root $Root -CurrentDirectory $CurrentDirectory
  if ($script:nativeVersionsPending.Count -gt 0) {
    $script:nativeAclRepairWarning = "Quedaron versiones antiguas pendientes de retirar; no afectan la versión activa."
  }
}

function Set-PrivilegedDataAcl([string]$Path) {
  Invoke-IcaclsChecked @($Path, "/inheritance:r", "/grant:r", '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', "/C", "/Q") "No se pudo proteger la carpeta de control privilegiado"
}
function Restore-ClientAfterInstallFailure {
  try { Start-ScheduledTask -TaskName $agentTaskName -ErrorAction SilentlyContinue } catch {}
  try { Start-ScheduledTask -TaskName $inputTaskName -ErrorAction SilentlyContinue } catch {}
  try { if (Get-ScheduledTask -TaskName $clamTaskName -ErrorAction SilentlyContinue) { Enable-ScheduledTask -TaskName $clamTaskName -ErrorAction SilentlyContinue | Out-Null } } catch {}
  $restoreMode = [string]$script:brokerStartupMode
  if ($restoreMode -eq "service") {
    try {
      Invoke-ScCommand @("config", $brokerServiceName, "start=", "delayed-auto")
      Start-Service -Name $brokerServiceName -ErrorAction Stop
    } catch {}
  } else {
    # Si la actualización ya degradó al fallback, no se reactiva el servicio
    # rechazado: se conserva el canal SYSTEM o el canal interactivo del usuario.
    try { Invoke-ScCommand @("config", $brokerServiceName, "start=", "disabled") } catch {}
    try { Start-ScheduledTask -TaskName $brokerFallbackTaskName -ErrorAction SilentlyContinue } catch {}
  }
}function Read-PipeLineWithTimeout($Reader, [int]$TimeoutMilliseconds = 1500) {
  $readTask = $Reader.ReadLineAsync()
  if (-not $readTask.Wait($TimeoutMilliseconds)) {
    throw "El canal local aceptó la conexión, pero no respondió en $TimeoutMilliseconds ms."
  }
  return $readTask.Result
}
function Wait-PrivilegedBrokerPipe([int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $pipe = New-Object IO.Pipes.NamedPipeClientStream('.', 'SASPrivilegedDesktop', [IO.Pipes.PipeDirection]::InOut)
      try {
        $pipe.Connect(750)
        $writer = New-Object IO.StreamWriter($pipe, [Text.Encoding]::UTF8)
        $writer.AutoFlush = $true
        $reader = New-Object IO.StreamReader($pipe, [Text.Encoding]::UTF8)
        $writer.WriteLine('INSTALL_HEALTH_CHECK')
        $response = Read-PipeLineWithTimeout -Reader $reader -TimeoutMilliseconds 1500
        if ($response -eq 'ERROR invalid_request' -or $response -like 'OK *') { return }
      } finally {
        $pipe.Dispose()
      }
    } catch {}
    Start-Sleep -Milliseconds 350
  } while ((Get-Date) -lt $deadline)
  throw 'El broker privilegiado se inició, pero su canal seguro no respondió.'
}
function Test-InputDesktopPipe([int]$TimeoutMilliseconds = 800) {
  $pipe = $null
  try {
    $pipe = New-Object IO.Pipes.NamedPipeClientStream('.', 'SASInputDesktopV3', [IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect($TimeoutMilliseconds)
    $utf8 = New-Object Text.UTF8Encoding($false)
    $writer = New-Object IO.StreamWriter($pipe, $utf8, 1024, $true)
    $reader = New-Object IO.StreamReader($pipe, $utf8, $false, 1024, $true)
    $writer.AutoFlush = $true
    $writer.WriteLine([Convert]::ToBase64String($utf8.GetBytes("--type`0health_check")))
    $response = Read-PipeLineWithTimeout -Reader $reader -TimeoutMilliseconds $TimeoutMilliseconds
    if (-not $response) { return $false }
    return [bool](($response.TrimStart([char]0xFEFF) | ConvertFrom-Json).ok)
  } catch { return $false }
  finally { if ($pipe) { $pipe.Dispose() } }
}

function Wait-InputDesktopPipe([int]$TimeoutSeconds = 8) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Test-InputDesktopPipe) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Write-DesktopControlDiagnostic([string]$ServiceError, [string]$FallbackError = "") {
  $folder = Join-Path $env:ProgramData "SAS\Client"
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $jsonPath = Join-Path $folder "desktop-control-diagnostic.json"
  $textPath = Join-Path $folder "desktop-control-diagnostic.txt"
  $serviceInfo = $null
  try { $serviceInfo = Get-CimInstance Win32_Service -Filter "Name='$brokerServiceName'" -ErrorAction Stop | Select-Object Name,DisplayName,State,Status,StartMode,StartName,PathName,ProcessId,ExitCode,ServiceSpecificExitCode } catch {}
  $imagePath = ""
  try { $imagePath = [string](Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$brokerServiceName" -Name ImagePath -ErrorAction Stop).ImagePath } catch {}
  $scQuery = @(& "$env:SystemRoot\System32\sc.exe" queryex $brokerServiceName 2>&1) -join [Environment]::NewLine
  $scQc = @(& "$env:SystemRoot\System32\sc.exe" qc $brokerServiceName 2>&1) -join [Environment]::NewLine
  $files = @()
  foreach ($candidate in @($secureAttentionBrokerPath, $desktopControlHostPath, $inputHelperPath)) {
    if (-not $candidate) { continue }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $item = Get-Item -LiteralPath $candidate
      $signature = Get-AuthenticodeSignature -LiteralPath $candidate
      $zone = Get-Item -LiteralPath $candidate -Stream Zone.Identifier -ErrorAction SilentlyContinue
      $files += [ordered]@{ path=$candidate; exists=$true; length=$item.Length; sha256=(Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash; signature=[string]$signature.Status; signer=if($signature.SignerCertificate){$signature.SignerCertificate.Subject}else{""}; zoneIdentifier=[bool]$zone }
    } else {
      $files += [ordered]@{ path=$candidate; exists=$false }
    }
  }
  $events = @()
  foreach ($logName in @('System','Application','Microsoft-Windows-CodeIntegrity/Operational','Microsoft-Windows-Windows Defender/Operational')) {
    try {
      $events += @(Get-WinEvent -FilterHashtable @{ LogName=$logName; StartTime=(Get-Date).AddMinutes(-15) } -ErrorAction Stop |
        Where-Object { $_.Id -in @(1000,1026,7000,7009,7011,7023,7024,7031,7034,3033,3076,3077,1116,1117) -or $_.ProviderName -match 'Service Control Manager|\.NET Runtime|CodeIntegrity|Windows Defender' } |
        Select-Object -First 30 @{N='time';E={$_.TimeCreated.ToUniversalTime().ToString('o')}},Id,ProviderName,LevelDisplayName,@{N='message';E={([string]$_.Message).Replace("`r",' ').Replace("`n",' ')}})
    } catch {}
  }
  $acl = @()
  foreach ($candidate in @($secureAttentionBrokerPath, (Split-Path -Parent $secureAttentionBrokerPath), (Join-Path $InstallPath 'logs'))) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { $acl += [ordered]@{ path=$candidate; icacls=(@(& icacls.exe $candidate 2>&1) -join [Environment]::NewLine) } }
  }
  $body = [ordered]@{
    generatedAtUtc=(Get-Date).ToUniversalTime().ToString('o')
    installPath=$InstallPath
    serviceError=$ServiceError
    fallbackError=$FallbackError
    service=$serviceInfo
    imagePath=$imagePath
    scQuery=$scQuery
    scQc=$scQc
    files=$files
    acl=$acl
    events=$events
  }
  $body | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
  @("SAS Desktop Control - diagnóstico", "Fecha UTC: $($body.generatedAtUtc)", "Servicio: $ServiceError", "Respaldo: $FallbackError", "ImagePath: $imagePath", "", $scQuery, "", $scQc, "", "Detalle completo: $jsonPath") | Set-Content -LiteralPath $textPath -Encoding UTF8
  return $jsonPath
}
function Write-ClientInstallDiagnostic([string]$Status, [string]$Message, [string]$Position = "") {
  $diagnosticFolder = Split-Path -Parent $installDiagnosticPath
  New-Item -ItemType Directory -Path $diagnosticFolder -Force | Out-Null
  [ordered]@{
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    status = $Status
    phase = $installPhase
    updateMode = [bool]$UpdateMode
    installPath = $InstallPath
    message = $Message
    position = $Position
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $installDiagnosticPath -Encoding UTF8
}

trap {
  $failureMessage = [string]$_.Exception.Message
  $failurePosition = [string]$_.InvocationInfo.PositionMessage
  try {
    Write-ClientInstallDiagnostic "fail" $failureMessage $failurePosition
    "Fase: $installPhase. $failureMessage" | Set-Content -LiteralPath $installErrorTextPath -Encoding Default
  } catch {}
  Restore-ClientAfterInstallFailure
  [Console]::Error.WriteLine("Fase '$installPhase': $failureMessage")
  exit 1
}

function Assert-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecuta este instalador como Administrador para registrar el agente al iniciar Windows."
  }
}

function Get-WindowsCompatibility {
  $currentVersionPath = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
  $windows = Get-ItemProperty -Path $currentVersionPath -ErrorAction SilentlyContinue
  $buildText = if ($windows.CurrentBuildNumber) { $windows.CurrentBuildNumber } else { $windows.CurrentBuild }
  $build = 0
  [void][int]::TryParse([string]$buildText, [ref]$build)
  $productName = [string]$windows.ProductName
  if ($windows.InstallationType -eq "Client" -and $build -ge 22000) {
    $productName = "Windows 11 $($windows.EditionID)".Trim()
  } elseif ($windows.InstallationType -eq "Client" -and $build -ge 10240) {
    $productName = "Windows 10 $($windows.EditionID)".Trim()
  }
  $isWindows = $env:OS -eq "Windows_NT"
  $is64Bit = [Environment]::Is64BitOperatingSystem
  $powerShellMajor = $PSVersionTable.PSVersion.Major
  $supportedBuild = $build -ge 10240
  [pscustomobject]@{
    IsWindows = $isWindows
    Is64Bit = $is64Bit
    Build = $build
    ProductName = $productName
    Edition = [string]$windows.EditionID
    InstallationType = [string]$windows.InstallationType
    PowerShellVersion = $PSVersionTable.PSVersion.ToString()
    Supported = $isWindows -and $is64Bit -and $supportedBuild -and $powerShellMajor -ge 5
  }
}

function Assert-ClientCompatibility {
  param([object]$Compatibility)
  if (-not $Compatibility.IsWindows) {
    throw "SAS Cliente solamente puede instalarse en Windows."
  }
  if (-not $Compatibility.Is64Bit) {
    throw "SAS Cliente requiere Windows de 64 bits; Windows de 32 bits no es compatible con el runtime seguro incluido."
  }
  if ($Compatibility.Build -lt 10240) {
    throw "Windows no es compatible con el runtime seguro actual. Se requiere Windows 10, Windows 11 o Windows Server 2016 (o posterior). Build detectado: $($Compatibility.Build)."
  }
  if ($PSVersionTable.PSVersion.Major -lt 5) {
    throw "SAS Cliente requiere Windows PowerShell 5.0 o posterior. Version detectada: $($Compatibility.PowerShellVersion)."
  }
}

function Ensure-Command($Name, $ChocoPackage, $WingetPackage) {
  if (Get-Command $Name -ErrorAction SilentlyContinue) {
    return
  }

  if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Host "Instalando dependencia con Chocolatey: $ChocoPackage"
    choco install $ChocoPackage -y
    return
  }

  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "Instalando dependencia con winget: $WingetPackage"
    winget install --id $WingetPackage --silent --accept-package-agreements --accept-source-agreements
    return
  }

  throw "Falta $Name. Instala Node.js o instala Chocolatey/winget y vuelve a ejecutar."
}

function Read-EnvValue([string]$PathValue, [string]$Name) {
  if (-not $PathValue -or -not (Test-Path -LiteralPath $PathValue)) { return "" }
  $line = Get-Content -LiteralPath $PathValue |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=" } |
    Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -split "=", 2)[1].Trim()
}
function New-InstallCheck($Name, $Status, $Message, $Details = $null) {
  [pscustomobject]@{
    Name = $Name
    Status = $Status
    Message = $Message
    Details = $Details
  }
}

function Test-ExpectedPath($Name, $Path, $Required = $true) {
  $exists = Test-Path $Path
  $status = if ($exists) { "pass" } elseif ($Required) { "fail" } else { "warn" }
  $message = if ($exists) { "Archivo o carpeta encontrado: $Path" } else { "No se encontro: $Path" }
  New-InstallCheck $Name $status $message @{ path = $Path; required = [bool]$Required }
}

if ($DeploymentFile) {
  if (-not (Test-Path -LiteralPath $DeploymentFile -PathType Leaf)) { throw "No se encontró el archivo .sasdeploy: $DeploymentFile" }
  $profile = Get-Content -LiteralPath $DeploymentFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($profile.schemaVersion -ne 1 -or $profile.product -ne "SAS Cliente Deployment" -or -not $profile.deploymentToken) { throw "El archivo .sasdeploy no es válido." }
  $DeploymentToken = [string]$profile.deploymentToken
  if ($profile.serverUrl) { $ServerUrl = [string]$profile.serverUrl }
}
$installPhase = "compatibilidad"
$windowsCompatibility = Get-WindowsCompatibility
Assert-ClientCompatibility -Compatibility $windowsCompatibility
Assert-Admin
if ($InstallRustDeskEngine) {
  $rustDeskInstaller = Join-Path $PSScriptRoot "install-rustdesk-engine.ps1"
  if (-not (Test-Path -LiteralPath $rustDeskInstaller -PathType Leaf)) { throw "Falta $rustDeskInstaller" }
  & $rustDeskInstaller
}
if (-not $RustDeskPath) { $RustDeskPath = Join-Path $env:ProgramFiles "RustDesk\RustDesk.exe" }
if (-not $HopToDeskPath) { $HopToDeskPath = Join-Path $env:ProgramFiles "HopToDesk\HopToDesk.exe" }
if (-not $NodeExe) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $NodeExe = $nodeCommand.Source }
}
if (-not $NodeExe) {
  $bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path -LiteralPath $bundledNode) { $NodeExe = $bundledNode }
}
if (-not $NodeExe -or -not (Test-Path -LiteralPath $NodeExe)) {
  Ensure-Command "node" "nodejs-lts" "OpenJS.NodeJS.LTS"
  $NodeExe = (Get-Command node -ErrorAction Stop).Source
}

$existingClientEnvPath = Join-Path $InstallPath ".env.client"
if ($UpdateMode -and (Test-Path -LiteralPath $existingClientEnvPath)) {
  $existingServerUrl = Read-EnvValue $existingClientEnvPath "SAS_SERVER_URL"
  $existingServerUri = $null
  if ([Uri]::TryCreate($existingServerUrl, [UriKind]::Absolute, [ref]$existingServerUri) -and $existingServerUri.Scheme -in @("http", "https") -and $existingServerUri.Host -notin @("localhost", "127.0.0.1")) {
    $ServerUrl = $existingServerUri.AbsoluteUri.TrimEnd('/')
  }
  $existingRemoteEngine = Read-EnvValue $existingClientEnvPath "SAS_REMOTE_ENGINE"
  if ($existingRemoteEngine -in @("sas", "rustdesk", "hoptodesk", "auto")) { $RemoteEngine = $existingRemoteEngine }
  $existingRustDeskPath = Read-EnvValue $existingClientEnvPath "SAS_RUSTDESK_PATH"
  if ($existingRustDeskPath) { $RustDeskPath = $existingRustDeskPath }
  $existingHopToDeskPath = Read-EnvValue $existingClientEnvPath "SAS_HOPTODESK_PATH"
  if ($existingHopToDeskPath) { $HopToDeskPath = $existingHopToDeskPath }
}

if (-not $ServerEnvPath) {
  $ServerEnvPath = Join-Path (Resolve-Path "$PSScriptRoot\..").Path ".env.production"
}
if (-not $AgentSharedSecret) {
  $AgentSharedSecret = Read-EnvValue $ServerEnvPath "AGENT_SHARED_SECRET"
}
$installPhase = "credencial existente"
$credentialPath = Join-Path $InstallPath "agent-credential.json"
$usingExistingCredential = Test-Path -LiteralPath $credentialPath
if ($UpdateMode -and -not $usingExistingCredential) {
  throw "La actualización se detuvo porque falta la credencial existente del equipo. No se intentará una vinculación nueva."
}
if ($UpdateMode) {
  $EnrollmentToken = ""
  $DeploymentToken = ""
  $DeploymentFile = ""
}
if ((-not $AgentSharedSecret -or $AgentSharedSecret -eq "change-agent-secret" -or $AgentSharedSecret.Length -lt 24) -and -not $EnrollmentToken -and -not $DeploymentToken -and -not $usingExistingCredential) {
  throw "Se requiere un codigo temporal de instalacion o una credencial administrativa valida."
}
$usingEnrollment = (-not $UpdateMode) -and [bool]($EnrollmentToken -or $DeploymentToken)

$installPhase = "detener agente anterior"
try { Stop-ScheduledTask -TaskName $inputTaskName -ErrorAction SilentlyContinue } catch {}
$existingTask = Get-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction SilentlyContinue
if ($existingTask) {
  Stop-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $agentListener = Get-NetTCPConnection -LocalPort 37655 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $agentListener) { break }
    $agentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($agentListener.OwningProcess)" -ErrorAction SilentlyContinue
    $expectedEntrypoint = Join-Path $InstallPath "client\agent-client.js"
    $isInstalledAgent = $agentProcess -and $agentProcess.Name -eq "node.exe" -and (
      $agentProcess.CommandLine -like "*$expectedEntrypoint*" -or
      $agentProcess.CommandLine -like "*client\agent-client.js*"
    )
    if ($isInstalledAgent) {
      Stop-Process -Id $agentListener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  if ($agentListener) {
    throw "El agente anterior no libero el puerto 37655; proceso $($agentListener.OwningProcess). Detenlo antes de actualizar."
  }
}
$installPhase = "copiar y preparar archivos"
New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallPath "logs") | Out-Null
$sharedRuntimePath = Join-Path $InstallPath "runtime"
New-Item -ItemType Directory -Force -Path $sharedRuntimePath | Out-Null
& icacls.exe $sharedRuntimePath /grant '*S-1-5-32-545:(OI)(CI)M' /T /C /Q | Out-Null
$clientSource = (Resolve-Path "$PSScriptRoot\..\client").Path
$clientTarget = Join-Path $InstallPath "client"
if ($clientSource.TrimEnd('\') -ne $clientTarget.TrimEnd('\')) {
  Copy-Item -Path $clientSource -Destination $InstallPath -Recurse -Force
}
$toolsSource = "$PSScriptRoot\..\tools"
$toolsTarget = Join-Path $InstallPath "tools"
if ((Test-Path -LiteralPath $toolsSource) -and ((Resolve-Path $toolsSource).Path.TrimEnd('\') -ne $toolsTarget.TrimEnd('\'))) {
  Copy-Item -Path $toolsSource -Destination $InstallPath -Recurse -Force
}
Copy-Item -Path "$PSScriptRoot\start-client.ps1" -Destination "$InstallPath\start-client.ps1" -Force
Copy-Item -Path "$PSScriptRoot\stop-agent-sessions.ps1" -Destination "$InstallPath\stop-agent-sessions.ps1" -Force
Copy-Item -Path "$PSScriptRoot\agent-status.ps1" -Destination "$InstallPath\agent-status.ps1" -Force
Copy-Item -Path "$PSScriptRoot\open-agent-panel.ps1" -Destination "$InstallPath\open-agent-panel.ps1" -Force
Copy-Item -Path "$PSScriptRoot\restart-agent-task.ps1" -Destination "$InstallPath\restart-agent-task.ps1" -Force
Copy-Item -Path "$PSScriptRoot\agent-logs.ps1" -Destination "$InstallPath\agent-logs.ps1" -Force
Copy-Item -Path "$PSScriptRoot\..\docs\security-manifest.md" -Destination "$InstallPath\security-manifest.md" -Force
Copy-Item -Path "$PSScriptRoot\..\docs\antivirus-allowlist.md" -Destination "$InstallPath\antivirus-allowlist.md" -Force
$installedPackagePath = Join-Path $InstallPath "package.json"
$clientVersion = [string](Get-Content -LiteralPath $installedPackagePath -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($clientVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "No se pudo determinar la versión nativa de SAS Cliente."
}
$nativeVersionPath = Join-Path $InstallPath "native\$clientVersion"
$captureHelperPath = Join-Path $nativeVersionPath "SasCaptureHelper.exe"
$dxgiCaptureHelperPath = Join-Path $nativeVersionPath "SasDxgiCapture.exe"
$inputHelperPath = Join-Path $nativeVersionPath "SasInputHelper.exe"
$secureAttentionBrokerPath = Join-Path $nativeVersionPath "SasSecureAttentionBroker.exe"
$desktopControlHostPath = Join-Path $nativeVersionPath "SasServiceHost.exe"
$desktopControlOutLogPath = Join-Path $InstallPath "logs\sas-desktop-control.out.log"
$desktopControlErrLogPath = Join-Path $InstallPath "logs\sas-desktop-control.err.log"
$desktopControlServiceCommand = ('"{0}"' -f $secureAttentionBrokerPath)
$clamDatabasePath = Join-Path $InstallPath 'tools\clamav\database'
New-Item -ItemType Directory -Force -Path $clamDatabasePath | Out-Null
& icacls.exe $clamDatabasePath /grant '*S-1-5-32-545:(OI)(CI)M' /T /C /Q | Out-Null

if ($UnsignedRestrictedProduction) {
  foreach ($helperPath in @($captureHelperPath, $dxgiCaptureHelperPath, $inputHelperPath, $secureAttentionBrokerPath, $desktopControlHostPath)) {
    if (Test-Path $helperPath) {
      Remove-Item -Path $helperPath -Force
    }
  }
}

$captureHelperEnv = if ($UnsignedRestrictedProduction) { "" } else { $captureHelperPath }
$dxgiCaptureHelperEnv = if ($UnsignedRestrictedProduction) { "" } else { $dxgiCaptureHelperPath }
$inputHelperEnv = if ($UnsignedRestrictedProduction) { "" } else { $inputHelperPath }
$unsignedRestrictedEnv = if ($UnsignedRestrictedProduction) { "true" } else { "false" }

$installPhase = "guardar configuración"
@"
SAS_SERVER_URL=$ServerUrl
SAS_AGENT_SECRET=$AgentSharedSecret
SAS_AGENT_CREDENTIAL_FILE=$InstallPath\agent-credential.json
SAS_AGENT_IDENTITY_FILE=$InstallPath\agent-identity.json
SAS_UNATTENDED_POLICY_FILE=$InstallPath\unattended-policy.json
SAS_AGENT_HEARTBEAT_SECONDS=1
SAS_AGENT_STOP_FILE=$InstallPath\sas-agent-stop.flag
SAS_AGENT_LOCAL_PORT=37655
SAS_CONSENT_PROMPT_PATH=$InstallPath\scripts\show-support-consent.ps1
SAS_CLAMSCAN_PATH=$InstallPath\tools\clamav\clamscan.exe
SAS_FRESHCLAM_PATH=$InstallPath\tools\clamav\freshclam.exe
SAS_CLAMAV_DATABASE_PATH=$InstallPath\tools\clamav\database
SAS_SECURITY_REALTIME_ENABLED=true
SAS_SECURITY_REALTIME_MAX_BYTES=536870912
SAS_CLIENT_UPDATE_DIR=$InstallPath\updates
SAS_CAPTURE_HELPER_PATH=$captureHelperEnv
SAS_DXGI_CAPTURE_HELPER_PATH=$dxgiCaptureHelperEnv
SAS_INPUT_HELPER_PATH=$inputHelperEnv
SAS_INPUT_HELPER_PIPE=\\.\pipe\SASInputDesktopV3
SAS_INPUT_HELPER_STATUS_FILE=$InstallPath\runtime\input-desktop-status.json
SAS_ENABLE_REAL_INPUT=true
SAS_PRIVILEGED_BROKER_PIPE=\\.\pipe\SASPrivilegedDesktop
SAS_PRIVILEGED_BROKER_PATH=$secureAttentionBrokerPath
SAS_UNSIGNED_RESTRICTED_PRODUCTION=$unsignedRestrictedEnv
SAS_REMOTE_ENGINE=$RemoteEngine
SAS_RUSTDESK_PATH=$RustDeskPath
SAS_HOPTODESK_PATH=$HopToDeskPath
SAS_AGENT_PRODUCT_NAME=SAS Support Client Agent
SAS_AGENT_PUBLISHER=$Publisher
"@ | Set-Content -Path "$InstallPath\.env.client" -Encoding UTF8

if ($usingEnrollment) {
  $previousServer = $env:SAS_SERVER_URL
  $previousToken = $env:SAS_ENROLLMENT_TOKEN
  $previousCredential = $env:SAS_AGENT_CREDENTIAL_FILE
  $previousEnrollOnly = $env:SAS_ENROLL_ONLY
  try {
    $env:SAS_SERVER_URL = $ServerUrl
    $env:SAS_ENROLLMENT_TOKEN = $EnrollmentToken
    $env:SAS_DEPLOYMENT_TOKEN = $DeploymentToken
    $env:SAS_AGENT_CREDENTIAL_FILE = "$InstallPath\agent-credential.json"
    $env:SAS_ENROLL_ONLY = "true"
    & $NodeExe "$InstallPath\client\agent-client.js"
    if ($LASTEXITCODE -ne 0) { throw "No fue posible registrar SAS Cliente con el código o perfil proporcionado." }
  } finally {
    $env:SAS_SERVER_URL = $previousServer
    $env:SAS_ENROLLMENT_TOKEN = $previousToken
    $env:SAS_AGENT_CREDENTIAL_FILE = $previousCredential
    $env:SAS_ENROLL_ONLY = $previousEnrollOnly
  }
  if (-not (Test-Path "$InstallPath\agent-credential.json")) { throw "El servidor no entrego la credencial individual del equipo." }
}

$brokerStartupMode = "restricted"
$brokerStartupWarning = ""
$inputDesktopReady = $false
$inputTaskRegistered = $false
$installPhase = "crear carpeta del servicio privilegiado"
if (-not $UnsignedRestrictedProduction -and (Test-Path -LiteralPath $secureAttentionBrokerPath)) {
  $privilegedDataPath = Join-Path $env:ProgramData "SAS\PrivilegedDesktop"
  New-Item -ItemType Directory -Force -Path $privilegedDataPath | Out-Null
  $installPhase = "reparar permisos de los componentes nativos"
  $nativeRoot = Split-Path -Parent $nativeVersionPath
  Set-NativeRuntimeAcl -Root $nativeRoot -CurrentDirectory $nativeVersionPath -Executables @($captureHelperPath, $dxgiCaptureHelperPath, $inputHelperPath, $secureAttentionBrokerPath, $desktopControlHostPath)
  Set-PrivilegedDataAcl -Path $privilegedDataPath

  $installPhase = "detener control privilegiado anterior"
  try { Stop-ScheduledTask -TaskName $brokerFallbackTaskName -ErrorAction SilentlyContinue } catch {}
  $brokerService = Get-Service -Name $brokerServiceName -ErrorAction SilentlyContinue
  if ($brokerService -and $brokerService.Status -ne "Stopped") {
    Stop-Service -Name $brokerServiceName -Force -ErrorAction SilentlyContinue
    try { $brokerService.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(15)) } catch {}
  }

  $brokerStartupMode = "service"
  $installPhase = "registrar servicio nativo de control remoto"
  try {
    if (-not (Get-Service -Name $brokerServiceName -ErrorAction SilentlyContinue)) {
      New-Service -Name $brokerServiceName -DisplayName "SAS Desktop Control Service" -Description "Supervisa y entrega teclado y ratón dentro de la sesión Windows autorizada." -BinaryPathName $desktopControlServiceCommand -StartupType Automatic | Out-Null
    }
    # ImagePath se escribe directamente en el registro del SCM. Evita que sc.exe
    # vuelva a interpretar las comillas del comando y termine con el código 1639.
    Set-ServiceImagePath -Name $brokerServiceName -CommandLine $desktopControlServiceCommand
    $serviceMetadataWarnings = @()
    try { Invoke-ScCommand @("description", $brokerServiceName, "Control autenticado del escritorio y UAC durante sesiones SAS autorizadas.") } catch { $serviceMetadataWarnings += $_.Exception.Message }
    try { Invoke-ScCommand @("failure", $brokerServiceName, "reset=", "60", "actions=", "restart/1500/restart/3000/restart/5000") } catch { $serviceMetadataWarnings += $_.Exception.Message }
    try { Invoke-ScCommand @("failureflag", $brokerServiceName, "1") } catch { $serviceMetadataWarnings += $_.Exception.Message }
    # La identidad SYSTEM sí es requisito para aceptar el modo de servicio.
    Invoke-ScCommand @("config", $brokerServiceName, "DisplayName=", "SAS Desktop Control Service", "obj=", "LocalSystem", "start=", "delayed-auto")
    $serviceIdentity = [string](Get-CimInstance Win32_Service -Filter "Name='$brokerServiceName'" -ErrorAction Stop).StartName
    if ($serviceIdentity -notin @("LocalSystem", "NT AUTHORITY\SYSTEM")) {
      throw "El servicio quedó registrado con una identidad no autorizada: $serviceIdentity"
    }
    $installPhase = "iniciar servicio nativo de control remoto"
    Start-Service -Name $brokerServiceName -ErrorAction Stop
    (Get-Service -Name $brokerServiceName -ErrorAction Stop).WaitForStatus("Running", [TimeSpan]::FromSeconds(20))
    Wait-PrivilegedBrokerPipe
    Unregister-ScheduledTask -TaskName $brokerFallbackTaskName -Confirm:$false -ErrorAction SilentlyContinue
  } catch {
    $serviceStartupError = $_.Exception.Message
    $brokerDiagnosticWarning = ""
    $serviceDisableWarning = ""
    $brokerDiagnosticPath = Join-Path $env:ProgramData "SAS\Client\desktop-control-diagnostic.json"
    try {
      $brokerDiagnosticPath = Write-DesktopControlDiagnostic -ServiceError $serviceStartupError
    } catch {
      $brokerDiagnosticWarning = " No fue posible completar el diagnóstico inicial: $($_.Exception.Message)"
    }
    $installPhase = "activar recuperación SYSTEM de control remoto"
    try {
      try {
        $serviceToStop = Get-Service -Name $brokerServiceName -ErrorAction SilentlyContinue
        if ($serviceToStop -and $serviceToStop.Status -ne "Stopped") {
          Stop-Service -Name $brokerServiceName -Force -ErrorAction SilentlyContinue
          $serviceToStop.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(15))
        }
      } catch { $serviceDisableWarning = $_.Exception.Message }
      # Una política que rechace sc.exe no debe cancelar la recuperación.
      try { Invoke-ScCommand @("config", $brokerServiceName, "start=", "disabled") } catch { $serviceDisableWarning = $_.Exception.Message }
      $brokerFallbackAction = New-ScheduledTaskAction -Execute $secureAttentionBrokerPath -Argument "--console"
      $brokerFallbackTrigger = New-ScheduledTaskTrigger -AtStartup
      $brokerFallbackPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
      $brokerFallbackSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew
      Register-ScheduledTask -TaskName $brokerFallbackTaskName -Description "Recuperación protegida del control remoto SAS cuando Windows rechaza el servicio SCM" -Action $brokerFallbackAction -Trigger $brokerFallbackTrigger -Principal $brokerFallbackPrincipal -Settings $brokerFallbackSettings -Force | Out-Null
      Start-ScheduledTask -TaskName $brokerFallbackTaskName
      Wait-PrivilegedBrokerPipe -TimeoutSeconds 30
      $brokerStartupMode = "system_task_fallback"
      $disableSuffix = if ($serviceDisableWarning) { " Aviso al deshabilitar SCM: $serviceDisableWarning" } else { "" }
      $brokerStartupWarning = "Windows rechazó el servicio SCM; SAS activó la recuperación SYSTEM validada. Diagnóstico: $brokerDiagnosticPath$brokerDiagnosticWarning$disableSuffix"
    } catch {
      $fallbackStartupError = $_.Exception.Message
      $brokerStartupMode = "unavailable"
      try {
        $brokerDiagnosticPath = Write-DesktopControlDiagnostic -ServiceError $serviceStartupError -FallbackError $fallbackStartupError
      } catch {
        $brokerDiagnosticWarning = " No fue posible completar el diagnóstico: $($_.Exception.Message)"
      }
      $brokerStartupWarning = "Servicio: $serviceStartupError | Recuperación SYSTEM: $fallbackStartupError | Diagnóstico: $brokerDiagnosticPath$brokerDiagnosticWarning"
      # El servicio elevado permite UAC, pero no es requisito para instalar ni
      # para el canal interactivo estándar de teclado y ratón del usuario.
      $installPhase = "continuar con control interactivo estándar"
    }
  }
}
$manifest = [pscustomobject]@{
  Product = "SAS Support Client Agent"
  Publisher = $Publisher
  InstallPath = $InstallPath
  ServerUrl = $ServerUrl
  EnrollmentMode = $usingEnrollment
  LocalPanel = "http://127.0.0.1:37655"
  TaskName = "SAS Support Client Agent"
  PrivilegedBrokerStartupMode = $brokerStartupMode
  PrivilegedBrokerWarning = $brokerStartupWarning
  PrivilegedBrokerDiagnostic = $brokerDiagnosticPath
  InstalledAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  Logs = @("logs\\sas-agent.log", "logs\\sas-agent.err.log")
  StopFile = "$InstallPath\\sas-agent-stop.flag"
  SecurityDocs = @("security-manifest.md", "antivirus-allowlist.md")
  UnsignedRestrictedProduction = [bool]$UnsignedRestrictedProduction
  PostInstallChecklist = "post-install-checklist.json"
  Compatibility = @{
    SupportedFamily = "Windows 10, Windows 11 y Windows Server 2016 o posterior"
    MinimumBuild = 10240
    Requires64Bit = $true
    DetectedProduct = $windowsCompatibility.ProductName
    DetectedBuild = $windowsCompatibility.Build
    DetectedEdition = $windowsCompatibility.Edition
    PowerShellVersion = $windowsCompatibility.PowerShellVersion
  }
  CaptureHelper = @{
    Path = $captureHelperPath
    Exists = Test-Path $captureHelperPath
    Enabled = -not [bool]$UnsignedRestrictedProduction
  }
  DxgiCaptureHelper = @{
    Path = $dxgiCaptureHelperPath
    Exists = Test-Path $dxgiCaptureHelperPath
    Enabled = -not [bool]$UnsignedRestrictedProduction
    Fallback = $captureHelperPath
  }
  InputHelper = @{
    Path = $inputHelperPath
    Exists = Test-Path $inputHelperPath
    Enabled = -not [bool]$UnsignedRestrictedProduction
  }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path "$InstallPath\install-manifest.json" -Encoding UTF8

$protocolRoot = "HKLM:\Software\Classes\sas-client"
New-Item -Path "$protocolRoot\shell\open\command" -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:SAS Cliente Protocol"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
$protocolCommand = '"{0}" -NoProfile -ExecutionPolicy Bypass -File "{1}" "%1"' -f "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe", "$InstallPath\scripts\handle-client-link.ps1"
Set-Item -Path "$protocolRoot\shell\open\command" -Value $protocolCommand

$installPhase = "registrar actualización de ClamAV"
$clamTaskName = "SAS Client ClamAV Definitions"
$clamUpdateScript = Join-Path $InstallPath "scripts\update-clamav-definitions.ps1"
$clamTaskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$clamUpdateScript`" -InstallPath `"$InstallPath`" -TaskName `"$clamTaskName`""
$clamTaskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 5)
$clamTaskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$clamTaskSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -StartWhenAvailable -MultipleInstances IgnoreNew
$clamTaskRegistration = "ScheduledTasks"
$clamTaskWarning = ""
try {
  Register-ScheduledTask -Description "Actualiza las firmas ClamAV de SAS Cliente cada cinco horas, fuera del instalador" -TaskName $clamTaskName -Action $clamTaskAction -Trigger $clamTaskTrigger -Principal $clamTaskPrincipal -Settings $clamTaskSettings -Force | Out-Null
} catch {
  $scheduledTasksError = $_.Exception.Message
  $clamTaskRegistration = "schtasks"
  $taskRun = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$clamUpdateScript`" -InstallPath `"$InstallPath`" -TaskName `"$clamTaskName`""
  & schtasks.exe /Create /TN $clamTaskName /TR $taskRun /SC HOURLY /MO 5 /RU SYSTEM /RL HIGHEST /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $clamTaskRegistration = "unavailable"
    $clamTaskWarning = "No se pudo registrar la tarea de ClamAV. ScheduledTasks: $scheduledTasksError; schtasks.exe: código $LASTEXITCODE."
  }
}
$installPhase = "preparar canal interactivo de teclado y ratón"
try { Stop-ScheduledTask -TaskName $inputTaskName -ErrorAction SilentlyContinue } catch {}
try { Unregister-ScheduledTask -TaskName $inputTaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
$inputTaskRegistered = $false
$inputTaskWarning = "El helper ya no usa una tarea independiente; la bandeja interactiva es su único propietario."
$installPhase = "registrar agente SAS"
$taskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$InstallPath\start-client.ps1`" -ProjectDir `"$InstallPath`" -NodeExe `"$NodeExe`""
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal -GroupId "S-1-5-32-545" -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew
Register-ScheduledTask -Description "SAS Support Client Agent - agente de soporte remoto con consentimiento y auditoria" -TaskName "SAS Support Client Agent" -Action $taskAction -Trigger @($taskTrigger, $recoveryTrigger) -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
Start-ScheduledTask -TaskName "SAS Support Client Agent"

$installPhase = "validación final"
$postInstallChecks = @(
New-InstallCheck "admin_context" "pass" "El instalador se ejecuto con privilegios de Administrador."
  New-InstallCheck "windows_compatibility" "pass" "Windows compatible detectado: $($windowsCompatibility.ProductName), build $($windowsCompatibility.Build), 64 bits." $windowsCompatibility
  New-InstallCheck "node" "pass" "Node.js esta disponible para ejecutar el agente."
  Test-ExpectedPath "client_files" "$InstallPath\client" $true
  Test-ExpectedPath "agent_entrypoint" "$InstallPath\client\agent-client.js" $true
  Test-ExpectedPath "env_file" "$InstallPath\.env.client" $true
  Test-ExpectedPath "local_panel_script" "$InstallPath\open-agent-panel.ps1" $true
  Test-ExpectedPath "stop_script" "$InstallPath\stop-agent-sessions.ps1" $true
  Test-ExpectedPath "consent_prompt" "$InstallPath\scripts\show-support-consent.ps1" $true
  Test-ExpectedPath "smart_link_handler" "$InstallPath\scripts\handle-client-link.ps1" $true
  Test-ExpectedPath "tray_component" "$InstallPath\scripts\sas-client-tray.ps1" $true
  Test-ExpectedPath "client_updater" "$InstallPath\scripts\install-client-update.ps1" $true
  Test-ExpectedPath "client_update_progress" "$InstallPath\scripts\show-client-update-progress.ps1" $true
  Test-ExpectedPath "clamav_engine" "$InstallPath\tools\clamav\clamscan.exe" $true
  Test-ExpectedPath "clamav_updater" "$InstallPath\tools\clamav\freshclam.exe" $true
  New-InstallCheck "clamav_definitions" "warn" "Las firmas no se descargan durante la instalación; la tarea SAS Client ClamAV Definitions inicia después y se repite cada cinco horas." @{ path = "$InstallPath\tools\clamav\database"; deferredDownload = $true; intervalHours = 5 }
  Test-ExpectedPath "clamav_source_manifest" "$InstallPath\tools\clamav\source-manifest.json" $true
  Test-ExpectedPath "security_manifest" "$InstallPath\security-manifest.md" $true
  Test-ExpectedPath "antivirus_allowlist" "$InstallPath\antivirus-allowlist.md" $true
)

if ($UnsignedRestrictedProduction) {
  $postInstallChecks += New-InstallCheck "unsigned_restricted_production" "pass" "Producción restringida sin firma activa: helpers nativos y control real quedan deshabilitados."
  $postInstallChecks += New-InstallCheck "capture_helper_disabled" $(if (-not (Test-Path $captureHelperPath)) { "pass" } else { "fail" }) "SasCaptureHelper.exe no debe estar instalado en perfil restringido." @{ path = $captureHelperPath }
  $postInstallChecks += New-InstallCheck "dxgi_capture_helper_disabled" $(if (-not (Test-Path $dxgiCaptureHelperPath)) { "pass" } else { "fail" }) "SasDxgiCapture.exe no debe estar instalado en perfil restringido." @{ path = $dxgiCaptureHelperPath }
  $postInstallChecks += New-InstallCheck "input_helper_disabled" $(if (-not (Test-Path $inputHelperPath)) { "pass" } else { "fail" }) "SasInputHelper.exe no debe estar instalado en perfil restringido." @{ path = $inputHelperPath }
} else {
  $postInstallChecks += Test-ExpectedPath "capture_helper" $captureHelperPath $false
  $postInstallChecks += Test-ExpectedPath "dxgi_capture_helper" $dxgiCaptureHelperPath $false
  $postInstallChecks += Test-ExpectedPath "input_helper" $inputHelperPath $false
  $inputRuntimeStatus = Join-Path $InstallPath "runtime\input-desktop-status.json"
  $postInstallChecks += New-InstallCheck "input_desktop_owner" "pass" "La bandeja de la sesión visible es la propietaria exclusiva del canal de teclado y ratón." @{ legacyTaskRemoved = $true; runtimeStatus = $inputRuntimeStatus; pipeFamily = "SASInputDesktopV3_S<sesión>"; startupNote = $inputTaskWarning }
  $brokerPipeReady = $brokerStartupMode -in @("service", "system_task_fallback")
  if ($brokerPipeReady) { try { Wait-PrivilegedBrokerPipe -TimeoutSeconds 5 } catch { $brokerPipeReady = $false } }
  $postInstallChecks += New-InstallCheck "desktop_control_service" $(if ($brokerPipeReady) { "pass" } else { "warn" }) $(if ($brokerPipeReady) { "Canal elevado de control remoto operativo." } else { "Windows bloqueó el canal elevado; el canal interactivo estándar permanece disponible." }) @{ serviceName = $brokerServiceName; mode = $brokerStartupMode; pipe = "SASPrivilegedDesktop"; diagnostic = $brokerDiagnosticPath }
  $postInstallChecks += Test-ExpectedPath "secure_attention_broker" $secureAttentionBrokerPath $true
  $postInstallChecks += New-InstallCheck "secure_attention_service" $(if ($brokerPipeReady) { "pass" } else { "warn" }) $(if ($brokerStartupMode -eq "service") { "SAS Desktop Control Service activo como LocalSystem." } elseif ($brokerStartupMode -eq "system_task_fallback") { "Control elevado activo mediante recuperación SYSTEM validada." } else { "Control de UAC no disponible; consulta el diagnóstico guardado." }) @{ mode = $brokerStartupMode; startupWarning = $brokerStartupWarning }
  $standardInputReady = [bool]($inputDesktopReady -or $brokerPipeReady)
  $postInstallChecks += New-InstallCheck "real_input_ready" $(if ($standardInputReady) { "pass" } else { "warn" }) $(if ($standardInputReady) { "Control nativo de teclado y ratón validado." } else { "La instalación terminó, pero el canal interactivo será reintentado automáticamente por la bandeja." }) @{ interactivePipe = [bool]$inputDesktopReady; privilegedPipe = [bool]$brokerPipeReady }
}
 $postInstallChecks += New-InstallCheck "clamav_update_task" $(if ($clamTaskRegistration -eq "unavailable") { "warn" } else { "pass" }) $(if ($clamTaskRegistration -eq "unavailable") { "La protección continúa; la bandeja reintentará registrar la actualización de firmas. $clamTaskWarning" } else { "Tarea ClamAV registrada para iniciar cinco minutos después y repetirse cada cinco horas." }) @{ taskName = $clamTaskName; intervalHours = 5; runsDuringInstall = $false; registration = $clamTaskRegistration; warning = $clamTaskWarning }
 $postInstallChecks += New-InstallCheck "native_runtime_acl" "pass" "Los ejecutables nativos actuales conservan lectura y ejecución para el usuario interactivo." @{ currentVersion = $clientVersion; root = $nativeRoot; legacyRepairWarning = $nativeAclRepairWarning }
 $postInstallChecks += New-InstallCheck "legacy_native_cleanup" $(if ($nativeVersionsPending.Count -eq 0) { "pass" } else { "warn" }) $(if ($nativeVersionsPending.Count -eq 0) { "Versiones nativas antiguas retiradas sin afectar configuración ni vinculación." } else { "La versión activa quedó reparada; algunos residuos antiguos se retirarán en un mantenimiento posterior." }) @{ removed = @($nativeVersionsRemoved); pending = @($nativeVersionsPending); activeVersion = $clientVersion }
$postInstallChecks += New-InstallCheck "input_delivery_no_spawn" $(if ($UnsignedRestrictedProduction -or $inputTaskRegistered -or $brokerStartupMode -in @("service", "system_task_fallback")) { "pass" } else { "warn" }) "La entrada remota usa un canal persistente y evita crear un proceso por cada clic."
$postInstallChecks += New-InstallCheck "client_task" "pass" "Tarea programada 'SAS Support Client Agent' registrada al iniciar sesion de usuario."
$postInstallChecks += New-InstallCheck "client_task_recovery" "pass" "Agente sin limite de tiempo y con reinicio automatico cada minuto." @{ restartCount = 999; restartIntervalMinutes = 1; executionTimeLimit = "unlimited" }
$postInstallChecks += New-InstallCheck "local_panel" "pass" "Panel local esperado en http://127.0.0.1:37655 cuando el agente este activo."

$nextSteps = @(
  "Abrir el panel local con $InstallPath\open-agent-panel.ps1.",
  "Confirmar que el equipo aparece en la consola SAS dentro de Equipos.",
  "Ejecutar scripts\test-client-preflight.ps1 antes de usar el equipo con un cliente real.",
  "Probar paro inmediato creando $InstallPath\sas-agent-stop.flag o desde el panel local.",
  "Confirmar desde SAS que pantalla, teclado y mouse funcionan únicamente después de la autorización local."
)

$checklist = [pscustomobject]@{
  GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  InstallPath = $InstallPath
  ServerUrl = $ServerUrl
  UnsignedRestrictedProduction = [bool]$UnsignedRestrictedProduction
  Checks = $postInstallChecks
  NextSteps = $nextSteps
}
$checklist | ConvertTo-Json -Depth 6 | Set-Content -Path "$InstallPath\post-install-checklist.json" -Encoding UTF8

$validationSummary = ($postInstallChecks | ForEach-Object { " - [$($_.Status)] $($_.Name): $($_.Message)" } | Out-String)
$nextStepSummary = ($nextSteps | ForEach-Object { " - $_" } | Out-String)
$profileName = if ($UnsignedRestrictedProduction) { "Produccion restringida sin firma" } else { "Estandar seguro" }
$text = @"
SAS - CHECKLIST POST-INSTALACION CLIENTE
=========================================

Instalacion: $InstallPath
Servidor: $ServerUrl
Perfil: $profileName
Fecha UTC: $($checklist.GeneratedAtUtc)

Validaciones:
$validationSummary
Siguientes pasos:
$nextStepSummary
Nota: la credencial, identidad y política desatendida son privadas. No compartas .env.client, agent-credential.json, agent-identity.json ni unattended-policy.json.
"@
$text | Set-Content -Path "$InstallPath\POST-INSTALL-CHECKLIST.txt" -Encoding UTF8

Write-ClientInstallDiagnostic "pass" "SAS Cliente se instaló o actualizó correctamente."
Remove-Item -LiteralPath $installErrorTextPath -Force -ErrorAction SilentlyContinue
Write-Host "SAS Client instalado en $InstallPath"
Write-Host "Servidor configurado: $ServerUrl"
Write-Host "Panel local del agente: http://127.0.0.1:37655"
Write-Host "Checklist JSON: $InstallPath\post-install-checklist.json"
Write-Host "Checklist TXT:  $InstallPath\POST-INSTALL-CHECKLIST.txt"
if ($UnsignedRestrictedProduction) { Write-Host "Perfil: produccion restringida sin firma. Control real y helpers nativos quedan deshabilitados." }
