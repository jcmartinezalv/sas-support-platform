param(
  [string]$InstallPath = "C:\SAS\Server",
  [string]$PublicBaseUrl = "https://localhost",
  [string]$WhatsappVerifyToken = "change-me",
  [string]$AgentSharedSecret = "change-agent-secret",
  [string]$ConsoleSharedToken = "",
  [switch]$NoGenerateSecrets,
  [string]$Publisher = "SAS Support Platform"
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ejecuta este instalador como Administrador para usar puertos 80/443, firewall y tareas programadas."
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

  throw "Falta $Name. Instala Node.js/OpenSSL o instala Chocolatey/winget y vuelve a ejecutar."
}

function New-StrongSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($buffer)
    return [Convert]::ToBase64String($buffer).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  } finally {
    $rng.Dispose()
  }
}

function Test-PortStatus([int]$Port) {
  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($connections.Count -gt 0) {
    return [pscustomobject]@{
      Port = $Port
      Status = "warn"
      Message = "El puerto $Port ya esta ocupado. Revisa si IIS, Apache u otro servicio lo esta usando."
      ProcessIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    }
  }

  [pscustomobject]@{
    Port = $Port
    Status = "pass"
    Message = "El puerto $Port esta libre antes de instalar."
    ProcessIds = @()
  }
}

function New-InstallCheck($Name, $Status, $Message, $Details = $null) {
  [pscustomobject]@{
    Name = $Name
    Status = $Status
    Message = $Message
    Details = $Details
  }
}

Assert-Admin
$preInstallPortChecks = @(
  Test-PortStatus -Port 80
  Test-PortStatus -Port 443
)

Ensure-Command "node" "nodejs-lts" "OpenJS.NodeJS.LTS"
Ensure-Command "openssl" "openssl.light" "ShiningLight.OpenSSL.Light"

$generatedSecrets = @()
if (-not $NoGenerateSecrets -and $AgentSharedSecret -eq "change-agent-secret") {
  $AgentSharedSecret = New-StrongSecret
  $generatedSecrets += "AGENT_SHARED_SECRET"
}
if (-not $NoGenerateSecrets -and -not $ConsoleSharedToken) {
  $ConsoleSharedToken = New-StrongSecret
  $generatedSecrets += "CONSOLE_SHARED_TOKEN"
}
if (-not $NoGenerateSecrets -and $WhatsappVerifyToken -eq "change-me") {
  $WhatsappVerifyToken = New-StrongSecret -Bytes 24
  $generatedSecrets += "WHATSAPP_VERIFY_TOKEN"
}

New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
Copy-Item -Path "$PSScriptRoot\..\*" -Destination $InstallPath -Recurse -Force
Set-Location $InstallPath

New-Item -ItemType Directory -Force -Path "certs" | Out-Null
New-Item -ItemType Directory -Force -Path "logs" | Out-Null
New-Item -ItemType Directory -Force -Path "data" | Out-Null
if (-not (Test-Path "certs\server.key") -or -not (Test-Path "certs\server.crt")) {
  & openssl req -x509 -newkey rsa:4096 -nodes -sha256 -days 825 `
    -keyout "certs\server.key" `
    -out "certs\server.crt" `
    -subj "/CN=localhost"
}

@"
HTTP_PORT=80
HTTPS_PORT=443
ENABLE_HTTP=true
ENABLE_HTTPS=true
TLS_KEY_PATH=certs/server.key
TLS_CERT_PATH=certs/server.crt
WHATSAPP_VERIFY_TOKEN=$WhatsappVerifyToken
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_API_VERSION=v25.0
PUBLIC_BASE_URL=$PublicBaseUrl
SHORT_URL_PROVIDER=auto
SHORT_URL_TIMEOUT_MS=5000
TINYURL_API_TOKEN=
TINYURL_DOMAIN=tinyurl.com
BITLY_ACCESS_TOKEN=
BITLY_DOMAIN=bit.ly
AGENT_SHARED_SECRET=$AgentSharedSecret
CONSOLE_SHARED_TOKEN=$ConsoleSharedToken
AGENT_HEARTBEAT_SECONDS=30
DATA_FILE_PATH=data/sas-db.json
BACKUP_DIR=data/backups
UPDATE_CHECK_ENABLED=true
UPDATE_APPLY_ENABLED=true
UPDATE_CHANNEL=stable
UPDATE_BASE_URL=$PublicBaseUrl/updates
UPDATE_ROOT=C:\SAS\Updates
UPDATE_TASK_NAME=SAS Support Server Production
UPDATE_SCHEDULER_TASK_NAME=SAS Support Platform Update
UPDATE_HEALTH_URL=$PublicBaseUrl/health
UPDATE_TIMEOUT_MS=10000
UPDATE_CHECK_INTERVAL_MINUTES=360
UPDATE_DOWNLOAD_TIMEOUT_MS=180000
UPDATE_MAX_BYTES=536870912
UPDATE_REQUIRE_SIGNATURE=false
UPDATE_PUBLIC_KEY=
UPDATE_ALLOW_HTTP=false
PRODUCT_NAME=SAS Support Server
PRODUCT_PUBLISHER=$Publisher
"@ | Set-Content -Path ".env" -Encoding UTF8

$manifest = [pscustomobject]@{
  Product = "SAS Support Server"
  Publisher = $Publisher
  InstallPath = $InstallPath
  PublicBaseUrl = $PublicBaseUrl
  HttpPort = 80
  HttpsPort = 443
  TaskName = "SAS Support Server"
  InstalledAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  Logs = @("logs\\sas-server.log", "logs\\sas-server.err.log")
  DataPath = "data\\sas-db.json"
  ConsoleTokenConfigured = [bool]$ConsoleSharedToken
  GeneratedSecrets = $generatedSecrets
  PostInstallChecklist = "post-install-checklist.json"
  SecurityDocs = @("docs\\security-manifest.md", "docs\\antivirus-allowlist.md")
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path "install-manifest.json" -Encoding UTF8

New-NetFirewallRule -DisplayName "SAS Support HTTP 80" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "SAS Support HTTPS 443" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -ErrorAction SilentlyContinue | Out-Null

$taskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$InstallPath\scripts\start-server.ps1`" -ProjectDir `"$InstallPath`""
$taskTrigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
Register-ScheduledTask -Description "SAS Support Server - plataforma de tickets, WhatsApp y soporte remoto con consentimiento" -TaskName "SAS Support Server" -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Force | Out-Null
Start-ScheduledTask -TaskName "SAS Support Server"

$postInstallChecks = @(
  New-InstallCheck "admin_context" "pass" "El instalador se ejecuto con privilegios de Administrador."
  New-InstallCheck "node" "pass" "Node.js esta disponible para ejecutar el servidor."
  New-InstallCheck "openssl" "pass" "OpenSSL esta disponible para generar o validar certificados."
)

foreach ($portCheck in $preInstallPortChecks) {
  $postInstallChecks += New-InstallCheck "port_$($portCheck.Port)" $portCheck.Status $portCheck.Message @{ processIds = $portCheck.ProcessIds }
}

$tlsStatus = if ((Test-Path "certs\server.key") -and (Test-Path "certs\server.crt")) { "pass" } else { "fail" }
$postInstallChecks += New-InstallCheck "tls_files" $tlsStatus "Archivos TLS esperados: certs\\server.key y certs\\server.crt."
$postInstallChecks += New-InstallCheck "env_file" $(if (Test-Path ".env") { "pass" } else { "fail" }) "Archivo .env generado con puertos, URL publica y secretos."
$postInstallChecks += New-InstallCheck "server_task" "pass" "Tarea programada 'SAS Support Server' registrada para iniciar con Windows."
$postInstallChecks += New-InstallCheck "secrets" $(if ($generatedSecrets.Count -gt 0 -or $NoGenerateSecrets) { "pass" } else { "warn" }) "Secretos de servidor configurados. Los valores se guardan solo en .env." @{ generated = $generatedSecrets; noGenerateSecrets = [bool]$NoGenerateSecrets }

$nextSteps = @(
  "Abrir https://localhost o $PublicBaseUrl desde la red autorizada.",
  "Guardar respaldo seguro de .env; contiene tokens operativos.",
  "Configurar WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID y WHATSAPP_APP_SECRET con las credenciales de Meta.",
  "Reemplazar el certificado local por Let's Encrypt cuando el dominio y los puertos 80/443 esten listos.",
  "Revisar docs\security-manifest.md y docs\antivirus-allowlist.md antes de abrir acceso externo."
)

$checklist = [pscustomobject]@{
  GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  InstallPath = $InstallPath
  PublicBaseUrl = $PublicBaseUrl
  GeneratedSecrets = $generatedSecrets
  Checks = $postInstallChecks
  NextSteps = $nextSteps
}
$checklist | ConvertTo-Json -Depth 6 | Set-Content -Path "post-install-checklist.json" -Encoding UTF8

$secretSummary = if ($generatedSecrets.Count -gt 0) {
  " - " + ($generatedSecrets -join "`r`n - ")
} else {
  " - Ninguno. Se usaron los parametros recibidos o -NoGenerateSecrets."
}
$validationSummary = ($postInstallChecks | ForEach-Object { " - [$($_.Status)] $($_.Name): $($_.Message)" } | Out-String)
$nextStepSummary = ($nextSteps | ForEach-Object { " - $_" } | Out-String)

$text = @"
SAS - CHECKLIST POST-INSTALACION
=================================

Instalacion: $InstallPath
URL publica: $PublicBaseUrl
Fecha UTC: $($checklist.GeneratedAtUtc)

Secretos generados automaticamente:
$secretSummary

Validaciones:
$validationSummary
Siguientes pasos:
$nextStepSummary
Nota: los valores reales de secretos estan en .env. Protege ese archivo y no lo envies por chat.
"@
$text | Set-Content -Path "POST-INSTALL-CHECKLIST.txt" -Encoding UTF8

Write-Host "SAS Server instalado en $InstallPath"
Write-Host "HTTP:  http://localhost"
Write-Host "HTTPS: https://localhost"
Write-Host "Webhook WhatsApp: $PublicBaseUrl/webhooks/whatsapp"
Write-Host "Checklist JSON: $InstallPath\post-install-checklist.json"
Write-Host "Checklist TXT:  $InstallPath\POST-INSTALL-CHECKLIST.txt"
if ($generatedSecrets.Count -gt 0) {
  Write-Host "Secretos generados: $($generatedSecrets -join ', ')"
  Write-Host "Los valores reales quedaron solo en $InstallPath\.env"
}
