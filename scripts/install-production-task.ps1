param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$EnvPath = ".env.production",
  [string]$TaskName = "SAS Support Server Production",
  [string]$NodeExe = "",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecuta este script como Administrador para registrar tarea programada y firewall."
  }
}

function New-Check($Name, $Status, $Message, $Details = $null) {
  [pscustomobject]@{ Name = $Name; Status = $Status; Message = $Message; Details = $Details }
}

function Read-EnvFile([string]$PathValue) {
  $values = @{}
  Get-Content $PathValue | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      $values[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $values
}

function EnvOrDefault($Values, [string]$Key, $Default) {
  if ($Values.ContainsKey($Key) -and $null -ne $Values[$Key] -and [string]$Values[$Key] -ne "") { return $Values[$Key] }
  return $Default
}

function Resolve-NodeExe([string]$Requested) {
  $candidates = @()
  if ($Requested) { $candidates += $Requested }
  $candidates += @(
    (Join-Path $PSScriptRoot "..\runtime\node\node.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    "node"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -eq "node") {
      $cmd = Get-Command node -ErrorAction SilentlyContinue
      if ($cmd) { return $cmd.Source }
    } elseif (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "No se encontro Node.js. Instala Node.js o pasa -NodeExe."
}

Assert-Admin
$root = (Resolve-Path $ProjectDir).Path
$envFile = if ([System.IO.Path]::IsPathRooted($EnvPath)) { $EnvPath } else { Join-Path $root $EnvPath }
if (-not (Test-Path $envFile)) { throw "No se encontro $envFile" }
$envValues = Read-EnvFile $envFile
$publicBaseUrl = EnvOrDefault $envValues "PUBLIC_BASE_URL" ""
$enableHttp = EnvOrDefault $envValues "ENABLE_HTTP" "true"
$enableHttps = EnvOrDefault $envValues "ENABLE_HTTPS" "true"
$node = Resolve-NodeExe $NodeExe
$keyPath = Join-Path $root ((EnvOrDefault $envValues "TLS_KEY_PATH" "certs/server.key") -replace '/', '\')
$certPath = Join-Path $root ((EnvOrDefault $envValues "TLS_CERT_PATH" "certs/server.crt") -replace '/', '\')

$checks = @()
$checks += New-Check "admin_context" "pass" "El script se ejecuto como Administrador."
$checks += New-Check "env_file" "pass" "Archivo productivo encontrado." @{ envPath = $envFile }
$checks += New-Check "node" "pass" "Node.js disponible para arrancar SAS." @{ nodeExe = $node }
$checks += New-Check "tls_key" $(if (Test-Path $keyPath) { "pass" } else { "fail" }) "Llave TLS esperada." @{ path = $keyPath }
$checks += New-Check "tls_cert" $(if (Test-Path $certPath) { "pass" } else { "fail" }) "Certificado TLS esperado." @{ path = $certPath }
$checks += New-Check "public_base_url" $(if ((EnvOrDefault $envValues "PUBLIC_BASE_URL" "") -like "https://*") { "pass" } else { "warn" }) "PUBLIC_BASE_URL debe usar HTTPS." @{ publicBaseUrl = $publicBaseUrl }

New-NetFirewallRule -DisplayName "SAS Support Production HTTP 80" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "SAS Support Production HTTPS 443" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -ErrorAction SilentlyContinue | Out-Null
$checks += New-Check "firewall" "pass" "Reglas de firewall 80/443 solicitadas."

$taskScript = Join-Path $root "scripts\start-production-server.ps1"
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$taskScript`" -ProjectDir `"$root`" -EnvPath `"$envFile`" -NodeExe `"$node`""
$taskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$taskTrigger = New-ScheduledTaskTrigger -AtStartup
$taskTrigger.Delay = "PT15S"
$recoveryTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$taskSettings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew
Register-ScheduledTask -Description "SAS Support Server en produccion con HTTPS y .env.production" -TaskName $TaskName -Action $taskAction -Trigger @($taskTrigger, $recoveryTrigger) -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
$checks += New-Check "scheduled_task" "pass" "Tarea programada registrada." @{ taskName = $TaskName }
$checks += New-Check "scheduled_task_recovery" "pass" "Tarea sin limite de tiempo y con reinicio automatico cada minuto." @{ restartCount = 999; restartIntervalMinutes = 1; executionTimeLimit = "unlimited" }

$manifest = [pscustomobject]@{
  Product = "SAS Support Server"
  Publisher = "SAS Support Platform"
  InstallPath = $root
  PublicBaseUrl = $publicBaseUrl
  HttpPort = [int](EnvOrDefault $envValues "HTTP_PORT" 80)
  HttpsPort = [int](EnvOrDefault $envValues "HTTPS_PORT" 443)
  EnableHttp = $enableHttp
  EnableHttps = $enableHttps
  TaskName = $TaskName
  ProductionTask = $true
  StartCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-production-server.ps1"
  InstalledAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  EnvPath = $envFile
  Logs = @("logs\sas-production.out.log", "logs\sas-production.err.log")
  DataPath = (EnvOrDefault $envValues "DATA_FILE_PATH" "data/sas-db.json")
  ConsoleTokenConfigured = [bool](EnvOrDefault $envValues "CONSOLE_SHARED_TOKEN" "")
  GeneratedSecrets = @()
  PostInstallChecklist = "post-install-checklist.json"
  SecurityDocs = @("docs\security-manifest.md", "docs\letsencrypt-tls.md")
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $root "install-manifest.json") -Encoding UTF8

$checklist = [pscustomobject]@{
  GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  InstallPath = $root
  PublicBaseUrl = $publicBaseUrl
  ProductionTask = $true
  Checks = $checks
  NextSteps = @(
    "Ejecutar Start-ScheduledTask -TaskName '$TaskName' o reiniciar Windows.",
    "Validar https con scripts\test-production-smoke.ps1 -BaseUrl $publicBaseUrl.",
    "Revisar logs\sas-production.err.log si el servicio no responde."
  )
}
$checklist | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $root "post-install-checklist.json") -Encoding UTF8

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
}

$summary = [pscustomobject]@{
  taskName = $TaskName
  installPath = $root
  publicBaseUrl = $publicBaseUrl
  startNow = [bool]$StartNow
  checks = $checks
}
$summary | ConvertTo-Json -Depth 8




