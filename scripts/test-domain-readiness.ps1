param(
  [string]$Domain = "setinfo.sytes.net",
  [int[]]$Ports = @(80, 443),
  [string]$ReportPath = "output\domain-readiness-report.json",
  [switch]$RemoteOnly
)

$ErrorActionPreference = "Stop"

function Test-TcpPort($HostName, [int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(5000, $false)
    if ($ok) { $client.EndConnect($iar) }
    return [pscustomobject]@{ port = $Port; connected = [bool]$client.Connected; error = $null }
  } catch {
    return [pscustomobject]@{ port = $Port; connected = $false; error = $_.Exception.Message }
  } finally {
    $client.Close()
  }
}

function Get-PublicIp {
  $providers = @(
    @{ uri = "https://api.ipify.org?format=json"; mode = "json" },
    @{ uri = "https://ifconfig.me/ip"; mode = "text" },
    @{ uri = "http://checkip.amazonaws.com"; mode = "text" }
  )
  foreach ($provider in $providers) {
    try {
      $response = Invoke-RestMethod -Uri $provider.uri -TimeoutSec 10
      if ($provider.mode -eq "json") { return [string]$response.ip }
      return ([string]$response).Trim()
    } catch {}
  }
  return $null
}

function Test-HttpHealth($Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
    $serviceMatched = [bool]($response.Content -match '"service"\s*:\s*"sas-support-platform"')
    return [pscustomobject]@{
      url = $Url
      ok = $true
      statusCode = $response.StatusCode
      serviceMatched = $serviceMatched
      error = $null
    }
  } catch {
    return [pscustomobject]@{
      url = $Url
      ok = $false
      statusCode = $null
      serviceMatched = $false
      error = $_.Exception.Message
    }
  }
}

$dns = @(Resolve-DnsName $Domain -ErrorAction SilentlyContinue | Where-Object { $_.Type -eq "A" } | Select-Object -ExpandProperty IPAddress)
$publicIp = Get-PublicIp
$tcp = foreach ($port in $Ports) { Test-TcpPort -HostName $Domain -Port $port }
$localListeners = if ($RemoteOnly) {
  @()
} else {
  @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in $Ports } |
    Select-Object LocalAddress,LocalPort,OwningProcess)
}
$health = @(Test-HttpHealth "http://$Domain/health")
$dnsMatchesPublicIp = [bool]($publicIp -and ($dns -contains $publicIp))
$http80Reachable = [bool](@($tcp | Where-Object { $_.port -eq 80 -and $_.connected }).Count -gt 0)
$sasRoutingVerified = [bool](@($health | Where-Object { $_.ok -and $_.serviceMatched }).Count -gt 0)

$report = [pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  domain = $Domain
  remoteOnly = [bool]$RemoteOnly
  dnsA = $dns
  publicIp = $publicIp
  dnsMatchesPublicIp = $dnsMatchesPublicIp
  sasRoutingVerified = $sasRoutingVerified
  tcp = $tcp
  localListeners = $localListeners
  health = $health
  readyForLetsEncryptHttp01 = [bool]($http80Reachable -and $sasRoutingVerified)
  notes = @(
    "HTTP-01 requiere que el dominio llegue al servicio SAS por el puerto 80.",
    "HTTPS final requiere certificado valido y servicio accesible en 443.",
    "La IP de salida de la maquina auditora puede diferir en redes multi-WAN; se confirma el enrutamiento cuando /health responde como SAS.",
    "Si la IP publica de entrada cambia, el DDNS debe actualizar $Domain antes de renovar."
  )
}

$target = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path (Get-Location) $ReportPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $target -Encoding UTF8
$report | ConvertTo-Json -Depth 6