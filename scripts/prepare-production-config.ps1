param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$OutputEnvPath = ".env.production",
  [string]$ReportPath = "output\production-config-report.json",
  [string]$PublicBaseUrl = "https://soporte.tuempresa.com",
  [string]$WhatsappVerifyToken = "",
  [string]$WhatsappAccessToken = "",
  [string]$WhatsappPhoneNumberId = "",
  [string]$WhatsappAppSecret = "",
  [string]$WhatsappApiVersion = "v25.0",
  [ValidateSet("auto", "tinyurl", "bitly", "internal")]
  [string]$ShortUrlProvider = "auto",
  [string]$TinyUrlApiToken = "",
  [string]$BitlyAccessToken = "",
  [ValidateSet("stable", "testing")]
  [string]$UpdateChannel = "stable",
  [switch]$EnableUpdateApply,
  [switch]$RequireUpdateSignature,
  [string]$UpdatePublicKey = "",
  [switch]$EnableGoogleAi,
  [string]$GeminiApiKey = "",
  [string]$GoogleAiModel = "gemini-2.5-flash",
  [switch]$EnableOpenAi,
  [string]$OpenAiApiKey = "",
  [string]$OpenAiModel = "gpt-5.6-terra",
  [string]$MobileBootstrapUsername = "",
  [string]$MobileBootstrapPassword = "",
  [string]$MobileBootstrapDisplayName = "Administrador movil",
  [switch]$RefreshReportOnly,
  [switch]$WriteMainEnv
)

$ErrorActionPreference = "Stop"

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

function Resolve-OutputPath([string]$Root, [string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) { return $PathValue }
  return Join-Path $Root $PathValue
}

function Test-PublicHttpsUrl([string]$Value) {
  try {
    $uri = [System.Uri]$Value
    return $uri.Scheme -eq "https" -and @("localhost", "127.0.0.1", "::1") -notcontains $uri.Host.ToLowerInvariant()
  } catch {
    return $false
  }
}

function Read-EnvFile([string]$PathValue) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $PathValue)) { return $values }
  Get-Content -LiteralPath $PathValue | ForEach-Object {
    if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
      $values[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $values
}

function Is-Enabled($Values, [string]$Name) {
  return $Values.ContainsKey($Name) -and $Values[$Name].ToLowerInvariant() -eq "true"
}
function New-Check($Name, $Status, $Message) {
  [pscustomobject]@{ name = $Name; status = $Status; message = $Message }
}

function Get-RequiredConfigStatus($Checks) {
  $requiredNames = @("public_base_url", "agent_secret", "console_token", "whatsapp_verify_token")
  $required = @($Checks | Where-Object { $requiredNames -contains $_.name })
  if ($required | Where-Object { $_.status -eq "fail" }) { return "fail" }
  if ($required | Where-Object { $_.status -eq "warn" }) { return "warn" }
  return "pass"
}
$root = (Resolve-Path $ProjectDir).Path
$envTarget = if ($WriteMainEnv) { Join-Path $root ".env" } else { Resolve-OutputPath -Root $root -PathValue $OutputEnvPath }
$reportTarget = Resolve-OutputPath -Root $root -PathValue $ReportPath

if ($RefreshReportOnly) {
  if (-not (Test-Path -LiteralPath $envTarget)) {
    throw "No existe $envTarget; no se puede refrescar el reporte sin una configuracion productiva."
  }
  $values = Read-EnvFile $envTarget
  $updateDefaults = [ordered]@{
    UPDATE_CHECK_ENABLED = "true"; UPDATE_APPLY_ENABLED = "true"; UPDATE_CHANNEL = "stable";
    UPDATE_BASE_URL = "$($values["PUBLIC_BASE_URL"])/updates"; UPDATE_ROOT = "C:\SAS\Updates";
    UPDATE_TASK_NAME = "SAS Support Server Production"; UPDATE_SCHEDULER_TASK_NAME = "SAS Support Platform Update";
    UPDATE_HEALTH_URL = "$($values["PUBLIC_BASE_URL"])/health"; UPDATE_TIMEOUT_MS = "10000"; UPDATE_CHECK_INTERVAL_MINUTES = "360";
    UPDATE_DOWNLOAD_TIMEOUT_MS = "180000"; UPDATE_MAX_BYTES = "536870912";
    UPDATE_REQUIRE_SIGNATURE = "false"; UPDATE_PUBLIC_KEY = ""; UPDATE_ALLOW_HTTP = "false"
  }
  $addedUpdateConfig = @()
  foreach ($entry in $updateDefaults.GetEnumerator()) { if (-not $values.ContainsKey($entry.Key)) { Add-Content -LiteralPath $envTarget -Value "$($entry.Key)=$($entry.Value)" -Encoding UTF8; $addedUpdateConfig += $entry.Key } }
  if ($addedUpdateConfig.Count -gt 0) { $values = Read-EnvFile $envTarget }
  $currentPublicUrl = $values["PUBLIC_BASE_URL"]
  $currentAgentSecret = $values["AGENT_SHARED_SECRET"]
  $currentConsoleToken = $values["CONSOLE_SHARED_TOKEN"]
  $currentVerifyToken = $values["WHATSAPP_VERIFY_TOKEN"]
  $currentAccessToken = $values["WHATSAPP_ACCESS_TOKEN"]
  $currentPhoneId = $values["WHATSAPP_PHONE_NUMBER_ID"]
  $currentAppSecret = $values["WHATSAPP_APP_SECRET"]
  $currentShortProvider = if ($values["SHORT_URL_PROVIDER"]) { $values["SHORT_URL_PROVIDER"] } else { "auto" }
  $currentTinyUrlToken = $values["TINYURL_API_TOKEN"]
  $currentBitlyToken = $values["BITLY_ACCESS_TOKEN"]
  $currentShortUrlReady = $currentShortProvider -eq "internal" -or ($currentShortProvider -in @("auto", "tinyurl") -and [bool]$currentTinyUrlToken) -or ($currentShortProvider -in @("auto", "bitly") -and [bool]$currentBitlyToken)
  $currentGoogleEnabled = Is-Enabled $values "GOOGLE_AI_ENABLED"
  $currentOpenAiEnabled = Is-Enabled $values "OPENAI_ENABLED"
  $currentMobileUser = $values["MOBILE_BOOTSTRAP_USERNAME"]
  $currentMobilePassword = $values["MOBILE_BOOTSTRAP_PASSWORD"]
  $checks = @(
    New-Check "public_base_url" $(if (Test-PublicHttpsUrl $currentPublicUrl) { "pass" } else { "warn" }) "PUBLIC_BASE_URL debe ser dominio HTTPS publico."
    New-Check "agent_secret" $(if ($currentAgentSecret -and $currentAgentSecret -ne "change-agent-secret" -and $currentAgentSecret.Length -ge 24) { "pass" } else { "fail" }) "AGENT_SHARED_SECRET debe ser fuerte y distinto al valor de ejemplo."
    New-Check "console_token" $(if ($currentConsoleToken -and $currentConsoleToken -ne "change-console-token" -and $currentConsoleToken.Length -ge 24) { "pass" } else { "fail" }) "CONSOLE_SHARED_TOKEN debe ser fuerte y distinto al valor de ejemplo."
    New-Check "whatsapp_verify_token" $(if ($currentVerifyToken) { "pass" } else { "warn" }) "WHATSAPP_VERIFY_TOKEN debe estar configurado."
    New-Check "whatsapp_access_token" $(if ($currentAccessToken) { "pass" } else { "warn" }) "Agregar WHATSAPP_ACCESS_TOKEN cuando Meta lo entregue."
    New-Check "whatsapp_phone_number" $(if ($currentPhoneId) { "pass" } else { "warn" }) "Agregar WHATSAPP_PHONE_NUMBER_ID cuando Meta lo entregue."
    New-Check "whatsapp_app_secret" $(if ($currentAppSecret) { "pass" } else { "warn" }) "Agregar WHATSAPP_APP_SECRET para validar firmas de Meta."
    New-Check "short_url" $(if ($currentShortUrlReady) { "pass" } else { "warn" }) "Configura token TinyURL o Bitly; SAS mantendra su liga interna como respaldo."
    New-Check "google_ai" $(if (-not $currentGoogleEnabled -or $values["GEMINI_API_KEY"]) { "pass" } else { "warn" }) "Si Google AI esta habilitado, GEMINI_API_KEY debe existir y mantener revision humana."
    New-Check "openai" $(if (-not $currentOpenAiEnabled -or $values["OPENAI_API_KEY"]) { "pass" } else { "warn" }) "Si OpenAI esta habilitado, OPENAI_API_KEY debe existir."
    New-Check "mobile_bootstrap" $(if ((-not $currentMobileUser -and -not $currentMobilePassword) -or ($currentMobileUser -and $currentMobilePassword.Length -ge 12)) { "pass" } else { "warn" }) "Bootstrap movil debe tener usuario y clave de al menos 12 caracteres, o quedar completamente vacio."
  )
  $report = [pscustomobject]@{
    status = Get-RequiredConfigStatus $checks
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    envPath = $envTarget
    writeMainEnv = [bool]$WriteMainEnv
    refreshReportOnly = $true
    publicBaseUrl = $currentPublicUrl
    configured = @{
      agentSharedSecret = [bool]$currentAgentSecret
      consoleSharedToken = [bool]$currentConsoleToken
      whatsappVerifyToken = [bool]$currentVerifyToken
      whatsappAccessToken = [bool]$currentAccessToken
      whatsappPhoneNumberId = [bool]$currentPhoneId
      whatsappAppSecret = [bool]$currentAppSecret
      shortUrlProvider = $currentShortProvider
      tinyUrlApiToken = [bool]$currentTinyUrlToken
      bitlyAccessToken = [bool]$currentBitlyToken
      googleAiEnabled = $currentGoogleEnabled
      geminiApiKey = [bool]$values["GEMINI_API_KEY"]
      openAiEnabled = $currentOpenAiEnabled
      openAiApiKey = [bool]$values["OPENAI_API_KEY"]
      mobileBootstrapConfigured = [bool]($currentMobileUser -and $currentMobilePassword)
    }
    checks = $checks
    nextSteps = @("Completar solamente las integraciones opcionales que se vayan a utilizar.")
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportTarget) | Out-Null
  $report | ConvertTo-Json -Depth 6 | Set-Content -Path $reportTarget -Encoding UTF8
  Write-Host "Reporte productivo actualizado sin modificar secretos: $reportTarget"
  exit 0
}
$agentSecret = New-StrongSecret -Bytes 32
$consoleToken = New-StrongSecret -Bytes 32
$verifyToken = if ($WhatsappVerifyToken) { $WhatsappVerifyToken } else { New-StrongSecret -Bytes 24 }
$googleEnabled = [bool]$EnableGoogleAi

$envLines = @(
  "HTTP_PORT=80",
  "HTTPS_PORT=443",
  "ENABLE_HTTP=true",
  "ENABLE_HTTPS=true",
  "TLS_KEY_PATH=certs/server.key",
  "TLS_CERT_PATH=certs/server.crt",
  "WHATSAPP_VERIFY_TOKEN=$verifyToken",
  "WHATSAPP_ACCESS_TOKEN=$WhatsappAccessToken",
  "WHATSAPP_PHONE_NUMBER_ID=$WhatsappPhoneNumberId",
  "WHATSAPP_APP_SECRET=$WhatsappAppSecret",
  "WHATSAPP_API_VERSION=$WhatsappApiVersion",
  "PUBLIC_BASE_URL=$PublicBaseUrl",
  "SHORT_URL_PROVIDER=$ShortUrlProvider",
  "SHORT_URL_TIMEOUT_MS=5000",
  "TINYURL_API_TOKEN=$TinyUrlApiToken",
  "TINYURL_DOMAIN=tinyurl.com",
  "BITLY_ACCESS_TOKEN=$BitlyAccessToken",
  "BITLY_DOMAIN=bit.ly",
  "AGENT_SHARED_SECRET=$agentSecret",
  "CONSOLE_SHARED_TOKEN=$consoleToken",
  "AGENT_HEARTBEAT_SECONDS=30",
  "DATA_FILE_PATH=data/sas-db.json",
  "BACKUP_DIR=data/backups",
  "UPDATE_CHECK_ENABLED=true",
  "UPDATE_APPLY_ENABLED=$($EnableUpdateApply.ToString().ToLowerInvariant())",
  "UPDATE_CHANNEL=$UpdateChannel",
  "UPDATE_BASE_URL=$PublicBaseUrl/updates",
  "UPDATE_ROOT=C:\SAS\Updates",
  "UPDATE_TASK_NAME=SAS Support Server Production",
  "UPDATE_SCHEDULER_TASK_NAME=SAS Support Platform Update",
  "UPDATE_HEALTH_URL=$PublicBaseUrl/health",
  "UPDATE_TIMEOUT_MS=10000",
  "UPDATE_CHECK_INTERVAL_MINUTES=360",
  "UPDATE_DOWNLOAD_TIMEOUT_MS=180000",
  "UPDATE_MAX_BYTES=536870912",
  "UPDATE_REQUIRE_SIGNATURE=$($RequireUpdateSignature.ToString().ToLowerInvariant())",
  "UPDATE_PUBLIC_KEY=$UpdatePublicKey",
  "UPDATE_ALLOW_HTTP=false",
  "GOOGLE_AI_ENABLED=$($googleEnabled.ToString().ToLowerInvariant())",
  "GOOGLE_AI_MOCK=false",
  "GOOGLE_AI_REQUIRE_REVIEW=true",
  "GEMINI_API_KEY=$GeminiApiKey",
  "GOOGLE_AI_MODEL=$GoogleAiModel",
  "OPENAI_ENABLED=$($EnableOpenAi.ToString().ToLowerInvariant())",
  "OPENAI_MOCK=false",
  "OPENAI_API_KEY=$OpenAiApiKey",
  "OPENAI_MODEL=$OpenAiModel",
  "OPENAI_WEB_SEARCH=true",
  "OPENAI_REASONING_EFFORT=low",
  "AI_RESEARCH_MODE=balanced",
  "MOBILE_BOOTSTRAP_USERNAME=$MobileBootstrapUsername",
  "MOBILE_BOOTSTRAP_PASSWORD=$MobileBootstrapPassword",
  "MOBILE_BOOTSTRAP_DISPLAY_NAME=$MobileBootstrapDisplayName",
  "MOBILE_ACCESS_TTL_MINUTES=15",
  "MOBILE_REFRESH_TTL_DAYS=30",
  "MOBILE_MAX_FAILED_ATTEMPTS=5",
  "MOBILE_LOCK_MINUTES=15",
  "REMOTE_SESSION_TTL_MINUTES=60",
  "REMOTE_CONSENT_MAX_ATTEMPTS=5",
  "REMOTE_CONTROL_MAX_ATTEMPTS=5"
)

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $envTarget) | Out-Null
$envLines | Set-Content -Path $envTarget -Encoding UTF8

$checks = @(
  New-Check "public_base_url" $(if (Test-PublicHttpsUrl $PublicBaseUrl) { "pass" } else { "warn" }) "PUBLIC_BASE_URL debe ser dominio HTTPS publico."
  New-Check "agent_secret" "pass" "AGENT_SHARED_SECRET fuerte generado."
  New-Check "console_token" "pass" "CONSOLE_SHARED_TOKEN fuerte generado."
  New-Check "whatsapp_verify_token" "pass" "WHATSAPP_VERIFY_TOKEN configurado."
  New-Check "whatsapp_access_token" $(if ($WhatsappAccessToken) { "pass" } else { "warn" }) "Agregar WHATSAPP_ACCESS_TOKEN cuando Meta lo entregue."
  New-Check "whatsapp_phone_number" $(if ($WhatsappPhoneNumberId) { "pass" } else { "warn" }) "Agregar WHATSAPP_PHONE_NUMBER_ID cuando Meta lo entregue."
  New-Check "whatsapp_app_secret" $(if ($WhatsappAppSecret) { "pass" } else { "warn" }) "Agregar WHATSAPP_APP_SECRET para validar firmas de Meta."
  New-Check "short_url" $(if ($ShortUrlProvider -eq "internal" -or ($ShortUrlProvider -in @("auto", "tinyurl") -and $TinyUrlApiToken) -or ($ShortUrlProvider -in @("auto", "bitly") -and $BitlyAccessToken)) { "pass" } else { "warn" }) "Configura token TinyURL o Bitly; SAS mantendra su liga interna como respaldo."
  New-Check "google_ai" $(if (-not $EnableGoogleAi -or $GeminiApiKey) { "pass" } else { "warn" }) "Si Google AI esta habilitado, GEMINI_API_KEY debe existir y mantener revision humana."
  New-Check "openai" $(if (-not $EnableOpenAi -or $OpenAiApiKey) { "pass" } else { "warn" }) "Si OpenAI esta habilitado, OPENAI_API_KEY debe existir."
  New-Check "mobile_bootstrap" $(if ((-not $MobileBootstrapUsername -and -not $MobileBootstrapPassword) -or ($MobileBootstrapUsername -and $MobileBootstrapPassword.Length -ge 12)) { "pass" } else { "warn" }) "Bootstrap movil debe tener usuario y clave de al menos 12 caracteres, o quedar completamente vacio."
)

$report = [pscustomobject]@{
  status = Get-RequiredConfigStatus $checks
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  envPath = $envTarget
  writeMainEnv = [bool]$WriteMainEnv
  publicBaseUrl = $PublicBaseUrl
  configured = @{
    agentSharedSecret = $true
    consoleSharedToken = $true
    whatsappVerifyToken = $true
    whatsappAccessToken = [bool]$WhatsappAccessToken
    whatsappPhoneNumberId = [bool]$WhatsappPhoneNumberId
    whatsappAppSecret = [bool]$WhatsappAppSecret
    updateChannel = $UpdateChannel
    updateApplyEnabled = [bool]$EnableUpdateApply
    updateSignatureRequired = [bool]$RequireUpdateSignature
    updatePublicKey = [bool]$UpdatePublicKey
    shortUrlProvider = $ShortUrlProvider
    tinyUrlApiToken = [bool]$TinyUrlApiToken
    bitlyAccessToken = [bool]$BitlyAccessToken
    googleAiEnabled = $googleEnabled
    geminiApiKey = [bool]$GeminiApiKey
    openAiEnabled = [bool]$EnableOpenAi
    openAiApiKey = [bool]$OpenAiApiKey
    mobileBootstrapConfigured = [bool]($MobileBootstrapUsername -and $MobileBootstrapPassword)
  }
  checks = $checks
  nextSteps = @(
    "Revisar $envTarget y copiarlo como .env cuando se vaya a ejecutar en produccion.",
    "Preparar dominio publico y abrir puertos 80/443 antes de Let's Encrypt.",
    "Completar credenciales reales de WhatsApp Cloud API.",
    "Agregar un token TinyURL o Bitly si se desea acortamiento externo; SAS conserva respaldo interno.",
    "Guardar copia segura del archivo .env; contiene secretos reales."
  )
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportTarget) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $reportTarget -Encoding UTF8

Write-Host "Configuracion productiva generada: $envTarget"
Write-Host "Reporte sin secretos: $reportTarget"
Write-Host "No compartas el archivo .env por chat; contiene secretos reales."




