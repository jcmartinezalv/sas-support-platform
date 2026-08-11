param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$EnvPath = ".env.production",
  [string]$BaseUrl = "",
  [string]$HostName = "",
  [switch]$LocalOnly,
  [switch]$RemoteOnly
)

$ErrorActionPreference = "Stop"

function Read-EnvFile([string]$PathValue) {
  $values = @{}
  if (-not (Test-Path $PathValue)) { return $values }
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

function Test-HttpEndpoint([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return @{ status = "pass"; statusCode = $response.StatusCode; url = $Url }
  } catch {
    return @{ status = "fail"; error = $_.Exception.Message; url = $Url }
  }
}

function Read-TlsCertificate([string]$Name, [int]$Port) {
  $client = $null
  $ssl = $null
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $connect = $client.BeginConnect($Name, $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(5000, $false)) {
      return @{ status = "fail"; error = "Timeout conectando a $Name`:$Port"; host = $Name; port = $Port }
    }
    $client.EndConnect($connect)
    $ssl = New-Object System.Net.Security.SslStream($client.GetStream(), $false, ({ $true } -as [Net.Security.RemoteCertificateValidationCallback]))
    $ssl.ReadTimeout = 5000
    $ssl.WriteTimeout = 5000
    $ssl.AuthenticateAsClient($Name)
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
    $daysLeft = [Math]::Floor(($cert.NotAfter.ToUniversalTime() - (Get-Date).ToUniversalTime()).TotalDays)
    return @{ status = "pass"; subject = $cert.Subject; issuer = $cert.Issuer; thumbprint = $cert.Thumbprint; notAfter = $cert.NotAfter.ToUniversalTime().ToString("o"); daysLeft = $daysLeft }
  } catch {
    return @{ status = "fail"; error = $_.Exception.Message; host = $Name; port = $Port }
  } finally {
    if ($ssl) { $ssl.Dispose() }
    if ($client) { $client.Close() }
  }
}


function Find-ListeningPort([int]$Port) {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { return $listener }
  return Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { [int]$_.LocalPort -eq $Port } |
    Select-Object -First 1
}
function Test-NodeLocalHealth([string]$Root) {
  $node = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (-not (Test-Path $node)) { $node = "node" }
  try {
    $script = "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; fetch('https://127.0.0.1/health').then(async r=>{const t=await r.text(); console.log(JSON.stringify({status:'pass',statusCode:r.status,ok:t.includes('sas-support-platform'),url:'https://127.0.0.1/health'}));}).catch(e=>{console.log(JSON.stringify({status:'fail',error:e.message,url:'https://127.0.0.1/health'})); process.exit(0);})"
    $output = & $node --no-warnings -e $script 2>$null
    if ($output) { return ($output | Select-Object -First 1 | ConvertFrom-Json) }
    return @{ status = "fail"; error = "Sin respuesta local de Node fetch."; url = "https://127.0.0.1/health" }
  } catch {
    return @{ status = "fail"; error = $_.Exception.Message; url = "https://127.0.0.1/health" }
  }
}

$root = (Resolve-Path $ProjectDir).Path
if($LocalOnly -and $RemoteOnly){throw "LocalOnly y RemoteOnly no pueden usarse juntos."}
$envFile = if ([System.IO.Path]::IsPathRooted($EnvPath)) { $EnvPath } else { Join-Path $root $EnvPath }
$envValues = Read-EnvFile $envFile
if (-not $BaseUrl) { $BaseUrl = EnvOrDefault $envValues "PUBLIC_BASE_URL" "https://localhost" }
$uri = [Uri]$BaseUrl
if (-not $HostName) { $HostName = $uri.Host }
if ($LocalOnly) { $BaseUrl = "https://127.0.0.1"; $HostName = "127.0.0.1" }
$httpsPort = [int](EnvOrDefault $envValues "HTTPS_PORT" 443)
$httpPort = [int](EnvOrDefault $envValues "HTTP_PORT" 80)
$pidFile = Join-Path $root "logs\sas-production.pid"
$pidValue = if (Test-Path $pidFile) { (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1) } else { "" }
$pidNumber = 0
[int]::TryParse([string]$pidValue, [ref]$pidNumber) | Out-Null
$httpsListener = Find-ListeningPort $httpsPort
$httpListener = Find-ListeningPort $httpPort
$runnerPid = $pidNumber
$servingPid = if ($httpsListener) { [int]$httpsListener.OwningProcess } else { $pidNumber }
$process = if ($servingPid -gt 0) { Get-Process -Id $servingPid -ErrorAction SilentlyContinue } else { $null }
$runnerProcess = if ($runnerPid -gt 0) { Get-Process -Id $runnerPid -ErrorAction SilentlyContinue } else { $null }
$health = if ($LocalOnly) { Test-NodeLocalHealth $root } else { Test-HttpEndpoint (($BaseUrl.TrimEnd("/")) + "/health") }
$tls = if ($LocalOnly) { @{ status = "skipped"; reason = "LocalOnly usa health local sin validar certificado publico." } } else { Read-TlsCertificate $HostName $httpsPort }

$effectiveHttpsListening = [bool]$httpsListener -or ($LocalOnly -and $health.status -eq "pass") -or ($RemoteOnly -and $health.status -eq "pass")
$effectiveHttpsOwner = if ($httpsListener) { $httpsListener.OwningProcess } else { $servingPid }
$status = if ($RemoteOnly -and $health.status -eq "pass" -and $tls.status -eq "pass") { "pass" } elseif ($LocalOnly -and $effectiveHttpsListening -and $health.status -eq "pass") { "pass" } elseif ($effectiveHttpsListening -and $health.status -eq "pass" -and $tls.status -eq "pass") { "pass" } elseif ($effectiveHttpsListening) { "warn" } else { "fail" }
$processReport = if($RemoteOnly){@{applicable=$false;reason="Validacion ejecutada desde otra maquina."}}else{@{pid=$servingPid;running=[bool]$process;name=$process.ProcessName;path=$process.Path}}
$runnerReport = if($RemoteOnly){@{applicable=$false;reason="Validacion ejecutada desde otra maquina."}}else{@{pid=$runnerPid;running=[bool]$runnerProcess;name=$runnerProcess.ProcessName;path=$runnerProcess.Path}}
$listenersReport = if($RemoteOnly){@{https=@{port=$httpsPort;listening=($health.status -eq "pass");owningProcess=$null;source="remote_health"};http=@{port=$httpPort;listening=$null;owningProcess=$null;source="not_checked"}}}else{@{https=@{port=$httpsPort;listening=$effectiveHttpsListening;owningProcess=$effectiveHttpsOwner};http=@{port=$httpPort;listening=[bool]$httpListener;owningProcess=$httpListener.OwningProcess}}}

[pscustomobject]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  status = $status
  baseUrl = $BaseUrl
  remoteOnly = [bool]$RemoteOnly
  envPath = $envFile
  pidFile = $pidFile
  process = $processReport
  runner = $runnerReport
  listeners = $listenersReport
  tls = $tls
  health = $health
} | ConvertTo-Json -Depth 8







