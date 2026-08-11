param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [int]$HttpPort = 3110,
  [int]$AgentPort = 37655,
  [string]$AgentSecret = "change-agent-secret",
  [switch]$Restart,
  [string]$StatusPath = "output\local-stack-status.json"
)

$ErrorActionPreference = "Stop"

function Normalize-ProcessPathEnv {
  $pathValue = [Environment]::GetEnvironmentVariable("Path", "Process")
  if (-not $pathValue) {
    $pathValue = [Environment]::GetEnvironmentVariable("PATH", "Process")
  }
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  if ($pathValue) {
    [Environment]::SetEnvironmentVariable("Path", $pathValue, "Process")
  }
}
function Resolve-NodeExe {
  param([string]$Root)

  $candidates = @(
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    "node"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -eq "node") {
      $cmd = Get-Command node -ErrorAction SilentlyContinue
      if ($cmd) { return $cmd.Source }
    } elseif (Test-Path $candidate) {
      return $candidate
    }
  }

  throw "No se encontro Node.js."
}

function Get-NodeProcessByPattern {
  param([string]$Pattern)
  try {
    @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction Stop | Where-Object { $_.CommandLine -like $Pattern })
  } catch {
    @()
  }
}

function Stop-ListeningPort {
  param([int]$Port)
  $tcpPids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  $netstatPids = @(Get-NetstatProcessIds -Port $Port)
  $pids = @($tcpPids + $netstatPids | Where-Object { $_ } | Select-Object -Unique)
  foreach ($pidValue in $pids) {
    try { Stop-Process -Id ([int]$pidValue) -Force -ErrorAction Stop } catch {}
  }
}

function Wait-PortReleased {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 8
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -eq 0) {
      return $true
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Wait-HttpReady {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 10,
    [hashtable]$Headers = @{}
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $result = Test-HttpJson -Url $Url -Headers $Headers
    if ($result.ok) {
      return $result
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $result
}

function Stop-ProcessList {
  param([array]$Processes)
  foreach ($proc in $Processes) {
    try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop } catch {}
  }
}

function Get-ListeningProcessIds {
  param([int]$Port)
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-NetstatProcessIds {
  param([int]$Port)

  $matches = @(netstat -ano -p tcp | Select-String -Pattern ":$Port\s+.*LISTENING\s+(\d+)")
  $ids = foreach ($match in $matches) {
    if ($match.Matches.Count -gt 0) {
      [int]$match.Matches[0].Groups[1].Value
    }
  }
  @($ids | Select-Object -Unique)
}
function Get-ServiceProcessIds {
  param(
    [int]$Port,
    [string]$Pattern
  )

  $processIds = @(Get-NetstatProcessIds -Port $Port)
  if ($processIds.Count -gt 0) {
    return $processIds
  }

  $processIds = @(Get-ListeningProcessIds -Port $Port)
  if ($processIds.Count -gt 0) {
    return $processIds
  }

  @(Get-NodeProcessByPattern -Pattern $Pattern | Select-Object -ExpandProperty ProcessId -Unique)
}
function Test-HttpJson {
  param([string]$Url, [hashtable]$Headers = @{})
  try {
    $response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec 6
    return @{ ok = $true; statusCode = $response.StatusCode; content = $response.Content }
  } catch {
    return @{ ok = $false; error = $_.Exception.Message }
  }
}

function Start-NodeService {
  param(
    [string]$NodeExe,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment,
    [string]$OutLog,
    [string]$ErrLog
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodeExe
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $false
  $psi.RedirectStandardError = $false
  $psi.CreateNoWindow = $true

  foreach ($key in $Environment.Keys) {
    $psi.Environment[$key] = [string]$Environment[$key]
  }

  "[$(Get-Date -Format o)] Starting $Arguments" | Add-Content -Path $OutLog -Encoding UTF8
  "[$(Get-Date -Format o)] Starting $Arguments" | Add-Content -Path $ErrLog -Encoding UTF8

  $process = [System.Diagnostics.Process]::Start($psi)
  "[$(Get-Date -Format o)] Started PID $($process.Id)" | Add-Content -Path $OutLog -Encoding UTF8
  "[$(Get-Date -Format o)] Started PID $($process.Id)" | Add-Content -Path $ErrLog -Encoding UTF8
  return $process.Id
}

$root = (Resolve-Path $ProjectDir).Path
Set-Location $root
Normalize-ProcessPathEnv
$nodeExe = Resolve-NodeExe -Root $root
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$serverProcesses = Get-NodeProcessByPattern -Pattern "*server.js*"
$agentProcesses = Get-NodeProcessByPattern -Pattern "*agent-client.js*"

if ($Restart) {
  Stop-ProcessList -Processes $serverProcesses
  Stop-ProcessList -Processes $agentProcesses
  Stop-ListeningPort -Port $HttpPort
  Stop-ListeningPort -Port $AgentPort
  $serverPortReleased = Wait-PortReleased -Port $HttpPort
  $agentPortReleased = Wait-PortReleased -Port $AgentPort
  if (-not $serverPortReleased) {
    throw "No se pudo liberar el puerto HTTP $HttpPort. Cierra el proceso que lo usa y vuelve a ejecutar."
  }
  if (-not $agentPortReleased) {
    throw "No se pudo liberar el puerto local del agente $AgentPort. Cierra el proceso que lo usa y vuelve a ejecutar."
  }
  $serverProcesses = @()
  $agentProcesses = @()
}

if (@($serverProcesses).Count -eq 0) {
  $env:HTTP_PORT = [string]$HttpPort
  $env:ENABLE_HTTP = "true"
  $env:ENABLE_HTTPS = "false"
  $env:PUBLIC_BASE_URL = "http://localhost:$HttpPort"
  Start-NodeService -NodeExe $nodeExe -Arguments "src\server.js" -WorkingDirectory $root -Environment @{ HTTP_PORT = [string]$HttpPort; ENABLE_HTTP = "true"; ENABLE_HTTPS = "false"; PUBLIC_BASE_URL = "http://localhost:$HttpPort" } -OutLog (Join-Path $logDir "sas-server.out.log") -ErrLog (Join-Path $logDir "sas-server.err.log")
}

$headers = @{ "x-sas-role" = "admin"; "x-sas-actor" = "local-stack" }
$health = Wait-HttpReady -Url "http://localhost:$HttpPort/health" -TimeoutSeconds 12

if (@(Get-NodeProcessByPattern -Pattern "*agent-client.js*").Count -eq 0) {
  $env:SAS_SERVER_URL = "http://localhost:$HttpPort"
  $env:SAS_AGENT_SECRET = $AgentSecret
  $env:SAS_AGENT_HEARTBEAT_SECONDS = "2"
  $env:SAS_AGENT_LOCAL_PORT = [string]$AgentPort
  $env:SAS_ENABLE_REAL_INPUT = "false"
  Start-NodeService -NodeExe $nodeExe -Arguments "client\agent-client.js" -WorkingDirectory $root -Environment @{ SAS_SERVER_URL = "http://localhost:$HttpPort"; SAS_AGENT_SECRET = $AgentSecret; SAS_AGENT_HEARTBEAT_SECONDS = "2"; SAS_AGENT_LOCAL_PORT = [string]$AgentPort; SAS_ENABLE_REAL_INPUT = "false" } -OutLog (Join-Path $logDir "sas-agent.out.log") -ErrLog (Join-Path $logDir "sas-agent.err.log")
}

Start-Sleep -Seconds 3
$agents = Test-HttpJson -Url "http://localhost:$HttpPort/api/agents" -Headers $headers
$agentPanel = Wait-HttpReady -Url "http://127.0.0.1:$AgentPort/status" -TimeoutSeconds 8
$preflight = Test-HttpJson -Url "http://localhost:$HttpPort/api/client-preflight" -Headers $headers

$serverPids = @(Get-ServiceProcessIds -Port $HttpPort -Pattern "*server.js*" | ForEach-Object { [int]$_ })
$agentPids = @(Get-ServiceProcessIds -Port $AgentPort -Pattern "*agent-client.js*" | ForEach-Object { [int]$_ })

$report = [pscustomobject]@{
  generatedAt = (Get-Date -Format o)
  nodeExe = $nodeExe
  server = @{
    url = "http://localhost:$HttpPort"
    healthOk = $health.ok
    statusCode = $health.statusCode
    error = $health.error
    listening = @($serverPids).Count -gt 0
    processes = @($serverPids)
    outLog = "logs\\sas-server.out.log"
    errLog = "logs\\sas-server.err.log"
  }
  agent = @{
    panelUrl = "http://127.0.0.1:$AgentPort"
    panelOk = $agentPanel.ok
    statusCode = $agentPanel.statusCode
    error = $agentPanel.error
    listening = @($agentPids).Count -gt 0
    processes = @($agentPids)
    outLog = "logs\\sas-agent.out.log"
    errLog = "logs\\sas-agent.err.log"
  }
  agentsApiOk = $agents.ok
  agentsApiError = $agents.error
  preflightOk = $preflight.ok
  preflightError = $preflight.error
  realInputEnabled = $false
}

$statusFullPath = if ([System.IO.Path]::IsPathRooted($StatusPath)) { $StatusPath } else { Join-Path $root $StatusPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statusFullPath) | Out-Null
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $statusFullPath -Encoding UTF8
$report | ConvertTo-Json -Depth 6

















