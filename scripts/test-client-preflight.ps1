param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$ServerUrl = "http://localhost:3110",
  [string]$AgentPanelUrl = "http://127.0.0.1:37655",
  [string]$OutputPath = "output\client-preflight-report.json",
  [switch]$BuildHelpers,
  [switch]$BuildPortable,
  [switch]$UnsignedRestrictedProduction
)

$ErrorActionPreference = "Continue"

function New-Check {
  param(
    [string]$Name,
    [string]$Status,
    [string]$Message,
    [object]$Details = $null
  )

  [pscustomobject]@{
    name = $Name
    status = $Status
    message = $Message
    details = $Details
  }
}

function Test-HttpEndpoint {
  param(
    [string]$Name,
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
    New-Check -Name $Name -Status "pass" -Message "Endpoint responde." -Details @{
      url = $Url
      statusCode = $response.StatusCode
    }
  } catch {
    New-Check -Name $Name -Status "warn" -Message "Endpoint no responde todavia." -Details @{
      url = $Url
      error = $_.Exception.Message
    }
  }
}

function Get-FileHashDetails {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  $item = Get-Item $Path
  $hash = Get-FileHash -Algorithm SHA256 -Path $Path
  return @{
    path = $item.FullName
    size = $item.Length
    sha256 = $hash.Hash
  }
}

function Get-SignatureDetails {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    $signature = Get-AuthenticodeSignature -FilePath $Path
    return @{
      path = (Get-Item $Path).FullName
      status = [string]$signature.Status
      statusMessage = $signature.StatusMessage
      signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
      thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
    }
  } catch {
    return @{
      path = $Path
      status = "Error"
      statusMessage = $_.Exception.Message
      signer = $null
      thumbprint = $null
    }
  }
}

function Test-CurrentUserAdministrator {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

$projectRoot = (Resolve-Path $ProjectDir).Path
$unsignedRestrictedEnv = [Environment]::GetEnvironmentVariable("SAS_UNSIGNED_RESTRICTED_PRODUCTION", "Process")
$unsignedRestricted = [bool]$UnsignedRestrictedProduction -or (@("1", "true", "yes", "on") -contains ("$unsignedRestrictedEnv".ToLowerInvariant()))
$checks = New-Object System.Collections.Generic.List[object]

$checks.Add((New-Check -Name "project_root" -Status "pass" -Message "Directorio del proyecto localizado." -Details @{ path = $projectRoot }))
$checks.Add((New-Check -Name "production_profile" -Status "pass" -Message ($(if ($unsignedRestricted) { "Produccion restringida sin firma habilitada." } else { "Perfil estandar o firmado." })) -Details @{ unsignedRestrictedProduction = $unsignedRestricted }))

$isWindows = $PSVersionTable.Platform -eq "Win32NT" -or $env:OS -eq "Windows_NT"
$checks.Add((New-Check -Name "windows_os" -Status ($(if ($isWindows) { "pass" } else { "fail" })) -Message ($(if ($isWindows) { "Sistema Windows detectado." } else { "Este preflight esta disenado para Windows." })) -Details @{
  os = $env:OS
  platform = $PSVersionTable.Platform
  powershell = $PSVersionTable.PSVersion.ToString()
}))

$windowsInfo = if ($isWindows) { Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction SilentlyContinue } else { $null }
$windowsBuild = 0
$windowsBuildText = if ($windowsInfo.CurrentBuildNumber) { $windowsInfo.CurrentBuildNumber } else { $windowsInfo.CurrentBuild }
[void][int]::TryParse([string]$windowsBuildText, [ref]$windowsBuild)
$windowsProductName = [string]$windowsInfo.ProductName
if ($windowsInfo.InstallationType -eq "Client" -and $windowsBuild -ge 22000) {
  $windowsProductName = "Windows 11 $($windowsInfo.EditionID)".Trim()
} elseif ($windowsInfo.InstallationType -eq "Client" -and $windowsBuild -ge 10240) {
  $windowsProductName = "Windows 10 $($windowsInfo.EditionID)".Trim()
}
$is64BitWindows = $isWindows -and [Environment]::Is64BitOperatingSystem
$supportedWindows = $isWindows -and $is64BitWindows -and $windowsBuild -ge 10240 -and $PSVersionTable.PSVersion.Major -ge 5
$checks.Add((New-Check -Name "windows_compatibility" -Status ($(if ($supportedWindows) { "pass" } else { "fail" })) -Message ($(if ($supportedWindows) { "Windows compatible con SAS Cliente." } else { "Se requiere Windows 10, Windows 11 o Windows Server 2016 (o posterior), de 64 bits y PowerShell 5+." })) -Details @{
  productName = $windowsProductName
  edition = $windowsInfo.EditionID
  build = $windowsBuild
  is64Bit = $is64BitWindows
  minimumBuild = 10240
  powershell = $PSVersionTable.PSVersion.ToString()
}))

$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$checks.Add((New-Check -Name "dotnet_csc" -Status ($(if ($csc) { "pass" } else { "warn" })) -Message ($(if ($csc) { "Compilador .NET Framework disponible." } else { "No se encontro csc.exe; instala .NET Framework Developer Pack o compila en otra maquina." })) -Details @{
  selected = $csc
  candidates = $cscCandidates
}))

$requiredFiles = @(
  "client\agent-client.js",
  "scripts\start-client.ps1",
  "scripts\agent-status.ps1",
  "scripts\stop-agent-sessions.ps1",
  "tools\sas-capture-helper\Program.cs",
  "tools\sas-dxgi-capture\Program.cpp",
  "scripts\build-dxgi-capture.ps1",
  "tools\sas-input-helper\Program.cs"
)

foreach ($file in $requiredFiles) {
  $path = Join-Path $projectRoot $file
  $exists = Test-Path $path
  $checks.Add((New-Check -Name "file_$($file.Replace('\', '_'))" -Status ($(if ($exists) { "pass" } else { "fail" })) -Message ($(if ($exists) { "Archivo requerido disponible." } else { "Falta archivo requerido." })) -Details @{ path = $path }))
}

if ($BuildHelpers) {
  foreach ($script in @("scripts\build-capture-helper.ps1", "scripts\build-dxgi-capture.ps1", "scripts\build-input-helper.ps1")) {
    $scriptPath = Join-Path $projectRoot $script
    try {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -ProjectDir $projectRoot | Out-Null
      $checks.Add((New-Check -Name "build_$($script.Replace('\', '_'))" -Status "pass" -Message "Compilacion completada." -Details @{ script = $scriptPath }))
    } catch {
      $checks.Add((New-Check -Name "build_$($script.Replace('\', '_'))" -Status "fail" -Message "Fallo la compilacion." -Details @{ script = $scriptPath; error = $_.Exception.Message }))
    }
  }
}

$captureHelper = Join-Path $projectRoot "tools\sas-capture-helper\bin\Release\SasCaptureHelper.exe"
$dxgiCaptureHelper = Join-Path $projectRoot "tools\sas-dxgi-capture\bin\Release\SasDxgiCapture.exe"
$inputHelper = Join-Path $projectRoot "tools\sas-input-helper\bin\Release\SasInputHelper.exe"
$captureExists = Test-Path $captureHelper
$dxgiCaptureExists = Test-Path $dxgiCaptureHelper
$inputExists = Test-Path $inputHelper
$checks.Add((New-Check -Name "capture_helper_exe" -Status ($(if ($captureExists -or $unsignedRestricted) { "pass" } else { "warn" })) -Message ($(if ($unsignedRestricted -and $captureExists) { "Helper de captura presente pero deshabilitado por produccion restringida." } elseif ($unsignedRestricted) { "Helper de captura deshabilitado por produccion restringida." } elseif ($captureExists) { "Helper de captura compilado." } else { "Helper de captura aun no compilado." })) -Details (Get-FileHashDetails -Path $captureHelper)))
$checks.Add((New-Check -Name "dxgi_capture_helper_exe" -Status ($(if ($dxgiCaptureExists -or $unsignedRestricted) { "pass" } else { "warn" })) -Message ($(if ($unsignedRestricted) { "DXGI deshabilitado por producción restringida." } elseif ($dxgiCaptureExists) { "Capturador DXGI compilado." } else { "Capturador DXGI pendiente de compilar; SAS conservará GDI." })) -Details (Get-FileHashDetails -Path $dxgiCaptureHelper)))
$checks.Add((New-Check -Name "input_helper_exe" -Status ($(if ($inputExists -or $unsignedRestricted) { "pass" } else { "warn" })) -Message ($(if ($unsignedRestricted -and $inputExists) { "Helper de entrada presente pero deshabilitado por produccion restringida." } elseif ($unsignedRestricted) { "Helper de entrada deshabilitado por produccion restringida." } elseif ($inputExists) { "Helper de entrada compilado." } else { "Helper de entrada aun no compilado." })) -Details (Get-FileHashDetails -Path $inputHelper)))

$captureSignature = Get-SignatureDetails -Path $captureHelper
$dxgiCaptureSignature = Get-SignatureDetails -Path $dxgiCaptureHelper
$inputSignature = Get-SignatureDetails -Path $inputHelper
$captureSigned = $captureSignature -and $captureSignature.status -eq "Valid"
$dxgiCaptureSigned = $dxgiCaptureSignature -and $dxgiCaptureSignature.status -eq "Valid"
$inputSigned = $inputSignature -and $inputSignature.status -eq "Valid"
$checks.Add((New-Check -Name "capture_helper_signature" -Status ($(if ($captureSigned -or $unsignedRestricted) { "pass" } else { "warn" })) -Message ($(if ($captureSigned) { "Firma valida en helper de captura." } elseif ($unsignedRestricted) { "Firma no requerida: helper de captura deshabilitado en produccion restringida." } else { "Helper de captura sin firma valida; mantener en laboratorio o firmar antes de produccion." })) -Details $captureSignature))
$checks.Add((New-Check -Name "dxgi_capture_helper_signature" -Status ($(if ($dxgiCaptureSigned -or $unsignedRestricted) { "pass" } else { "warn" })) -Message ($(if ($dxgiCaptureSigned) { "Firma válida en el capturador DXGI." } elseif ($unsignedRestricted) { "Firma no requerida: DXGI está deshabilitado en producción restringida." } else { "Capturador DXGI sin firma válida; firmar antes de producción." })) -Details $dxgiCaptureSignature))
$checks.Add((New-Check -Name "input_helper_signature" -Status ($(if ($inputSigned -or $unsignedRestricted) { "pass" } else { "warn" })) -Message ($(if ($inputSigned) { "Firma valida en helper de control." } elseif ($unsignedRestricted) { "Firma no requerida: helper de control deshabilitado en produccion restringida." } else { "Helper de control sin firma valida; no usar control real en produccion." })) -Details $inputSignature))

$isAdmin = Test-CurrentUserAdministrator
$checks.Add((New-Check -Name "windows_user_context" -Status ($(if ($isWindows) { "pass" } else { "fail" })) -Message ($(if ($isWindows) { "Contexto de usuario Windows detectado." } else { "No hay contexto Windows compatible para control real." })) -Details @{
  username = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  isAdministrator = $isAdmin
  note = "No se requiere administrador para la prueba normal; registrar este dato ayuda a diagnosticar UAC o EDR."
}))

$realInputRaw = [Environment]::GetEnvironmentVariable("SAS_ENABLE_REAL_INPUT", "Process")
$realInputFlag = @("1", "true", "yes", "on") -contains ("$realInputRaw".ToLowerInvariant())
$realInputReady = (-not $unsignedRestricted) -and $isWindows -and $inputExists -and $inputSigned
$checks.Add((New-Check -Name "real_input_guard" -Status ($(if ($realInputFlag) { "warn" } else { "pass" })) -Message ($(if ($realInputFlag) { "Control real activo en modo laboratorio; confirmar consentimiento, firma y auditoria antes de usar." } else { "Control real desactivado; modo seguro para pruebas normales." })) -Details @{
  SAS_ENABLE_REAL_INPUT = $realInputRaw
  enabled = $realInputFlag
  helperExists = $inputExists
  helperSignatureValid = $inputSigned
  labReady = $realInputReady
}))

$checks.Add((New-Check -Name "real_input_lab_ready" -Status ($(if ($realInputReady -or $unsignedRestricted) { "pass" } else { "warn" })) -Message ($(if ($realInputReady) { "Control real listo para laboratorio controlado, pero sigue desactivado salvo bandera explicita." } elseif ($unsignedRestricted) { "No aplica: produccion restringida bloquea control real." } else { "Control real aun no listo para laboratorio: revisar Windows, helper compilado y firma valida." })) -Details @{
  windows = $isWindows
  inputHelperExists = $inputExists
  inputHelperSignatureValid = $inputSigned
  realInputEnabled = $realInputFlag
  unsignedRestrictedProduction = $unsignedRestricted
}))

$healthUrl = $ServerUrl.TrimEnd("/") + "/health"
$checks.Add((Test-HttpEndpoint -Name "server_health" -Url $healthUrl))
$checks.Add((Test-HttpEndpoint -Name "agent_panel" -Url $AgentPanelUrl))

if ($BuildPortable) {
  $scriptPath = Join-Path $projectRoot "scripts\build-portable.ps1"
  try {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath 2>&1
    $checks.Add((New-Check -Name "build_portable" -Status "pass" -Message "Paquete portable generado." -Details @{ output = ($output -join "`n") }))
  } catch {
    $checks.Add((New-Check -Name "build_portable" -Status "fail" -Message "Fallo la generacion del paquete portable." -Details @{ error = $_.Exception.Message }))
  }
}

$failCount = @($checks | Where-Object { $_.status -eq "fail" }).Count
$warnCount = @($checks | Where-Object { $_.status -eq "warn" }).Count
$overall = if ($failCount -gt 0) { "fail" } elseif ($warnCount -gt 0) { "warn" } else { "pass" }

$report = [pscustomobject]@{
  generatedAt = (Get-Date -Format o)
  status = $overall
  serverUrl = $ServerUrl
  agentPanelUrl = $AgentPanelUrl
  checks = $checks
  nextSteps = @(
    "Si server_health esta en warn, iniciar el servidor con scripts\start-server.ps1.",
    "Si agent_panel esta en warn, iniciar el cliente con scripts\start-client.ps1.",
    $(if ($unsignedRestricted) { "Produccion restringida: mantener helpers nativos y SAS_ENABLE_REAL_INPUT deshabilitados." } else { "Mantener SAS_ENABLE_REAL_INPUT=false hasta validar firma, permisos y antivirus." }),
    "Durante la prueba, usar perfil Baja latencia para mejorar fluidez de pantalla."
  )
}

$outputFullPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $projectRoot $OutputPath }
$outputDir = Split-Path -Parent $outputFullPath
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $outputFullPath -Encoding UTF8

$report | ConvertTo-Json -Depth 8
Write-Host "Reporte: $outputFullPath"
if ($overall -eq "fail") {
  exit 1
}

