param(
  [string]$BaseUrl = "https://setinfo.sytes.net",
  [string]$VerifyToken = "",
  [string]$ConsoleToken = "",
  [string]$ReportPath = "output\production-smoke-report.json"
)

$ErrorActionPreference = "Stop"

function New-Result($Name, $Status, $Message, $Details = $null) {
  [pscustomobject]@{ name = $Name; status = $Status; message = $Message; details = $Details }
}

function Invoke-CheckJson($Name, $Url, [hashtable]$Headers = @{}) {
  try {
    $response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec 15
    return New-Result $Name "pass" "HTTP $($response.StatusCode)" @{
      url = $Url
      statusCode = $response.StatusCode
      body = $response.Content.Substring(0, [Math]::Min(400, $response.Content.Length))
    }
  } catch {
    $statusCode = $null
    try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
    return New-Result $Name "fail" $_.Exception.Message @{ url = $Url; statusCode = $statusCode }
  }
}

function Test-TlsCertificate($HostName, [int]$Port = 443) {
  $client = $null
  $ssl = $null
  try {
    $client = New-Object System.Net.Sockets.TcpClient($HostName, $Port)
    $ssl = New-Object System.Net.Security.SslStream($client.GetStream(), $false, ({ $true } -as [Net.Security.RemoteCertificateValidationCallback]))
    $ssl.AuthenticateAsClient($HostName)
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
    $daysLeft = [Math]::Floor(($cert.NotAfter.ToUniversalTime() - (Get-Date).ToUniversalTime()).TotalDays)
    $status = if ($daysLeft -ge 15) { "pass" } elseif ($daysLeft -ge 0) { "warn" } else { "fail" }
    return New-Result "tls_certificate" $status "Certificado TLS detectado para $HostName." @{
      subject = $cert.Subject
      issuer = $cert.Issuer
      notBefore = $cert.NotBefore.ToUniversalTime().ToString("o")
      notAfter = $cert.NotAfter.ToUniversalTime().ToString("o")
      daysLeft = $daysLeft
      thumbprint = $cert.Thumbprint
    }
  } catch {
    return New-Result "tls_certificate" "fail" $_.Exception.Message @{ host = $HostName; port = $Port }
  } finally {
    if ($ssl) { $ssl.Dispose() }
    if ($client) { $client.Close() }
  }
}

function Read-EnvValue([string]$Name) {
  $envFile = Join-Path (Get-Location) ".env.production"
  if (-not (Test-Path $envFile)) { return "" }
  $line = Get-Content $envFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return "" }
  return ($line -split "=", 2)[1]
}

$base = $BaseUrl.TrimEnd("/")
$uri = [Uri]$base
if (-not $VerifyToken) { $VerifyToken = Read-EnvValue "WHATSAPP_VERIFY_TOKEN" }
if (-not $ConsoleToken) { $ConsoleToken = Read-EnvValue "CONSOLE_SHARED_TOKEN" }
$headers = @{ "x-sas-role" = "admin"; "x-sas-actor" = "production-smoke" }
if ($ConsoleToken) {
  $headers["x-sas-console-token"] = $ConsoleToken
  $headers["Authorization"] = "Bearer $ConsoleToken"
}
$challenge = "sas-smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$webhookUrl = "$base/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$([Uri]::EscapeDataString($VerifyToken))&hub.challenge=$challenge"

$checks = @()
$checks += Test-TlsCertificate -HostName $uri.Host -Port $uri.Port
$checks += Invoke-CheckJson "health" "$base/health"
if ($VerifyToken) {
  $webhook = Invoke-CheckJson "whatsapp_webhook_verify" $webhookUrl
  if ($webhook.status -eq "pass" -and $webhook.details.body -ne $challenge) {
    $webhook = New-Result "whatsapp_webhook_verify" "fail" "El challenge devuelto no coincide." @{ expected = $challenge; actual = $webhook.details.body }
  }
  $checks += $webhook
} else {
  $checks += New-Result "whatsapp_webhook_verify" "warn" "No se encontro WHATSAPP_VERIFY_TOKEN para probar webhook." @{ url = "$base/webhooks/whatsapp" }
}
$adminReadiness = Invoke-CheckJson "admin_readiness" "$base/api/admin/readiness" $headers
if ($adminReadiness.status -eq "fail" -and $adminReadiness.details.statusCode -eq 401) {
  $adminReadiness = New-Result "admin_readiness" "warn" "La salud administrativa requiere una sesion valida; salud publica, TLS y webhook ya fueron verificados." @{
    url = "$base/api/admin/readiness"
    statusCode = 401
  }
}
$checks += $adminReadiness

$fail = @($checks | Where-Object { $_.status -eq "fail" }).Count
$warn = @($checks | Where-Object { $_.status -eq "warn" }).Count
$status = if ($fail -gt 0) { "fail" } elseif ($warn -gt 0) { "warn" } else { "pass" }
$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  baseUrl = $base
  status = $status
  summary = @{
    pass = @($checks | Where-Object { $_.status -eq "pass" }).Count
    warn = $warn
    fail = $fail
    total = $checks.Count
  }
  checks = $checks
  nextAction = if ($fail -gt 0) {
    "Corregir las verificaciones fallidas y repetir la prueba."
  } elseif ($warn -gt 0) {
    "Iniciar sesion en la consola y validar Preparacion; TLS, salud publica y webhook ya estan correctos."
  } else {
    "Sin accion inmediata."
  }
}

$target = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path (Get-Location) $ReportPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $target -Encoding UTF8
$report | ConvertTo-Json -Depth 8