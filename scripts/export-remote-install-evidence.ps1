param(
  [string]$PublicBaseUrl = "https://setinfo.sytes.net",
  [string]$UpdatesRoot = "\\192.168.50.1\SASUpdates$",
  [string]$ReportPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "output\remote-install-evidence.json")
)

$ErrorActionPreference = "Stop"

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "No se encontro $Path" }
  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Add-Check([System.Collections.Generic.List[object]]$Checks, [string]$Name, [bool]$Passed, [string]$Detail) {
  $Checks.Add([pscustomobject]@{ name = $Name; status = $(if ($Passed) { "pass" } else { "fail" }); detail = $Detail })
}

$checks = [System.Collections.Generic.List[object]]::new()
$nextAction = "Revisar conectividad con SERVER y el canal de actualizaciones."

try {
  $health = Invoke-RestMethod -Uri ($PublicBaseUrl.TrimEnd('/') + "/health") -Method Get -TimeoutSec 20
  $updateResult = Read-JsonFile (Join-Path $UpdatesRoot "last-update-result.json")
  $stableManifest = Read-JsonFile (Join-Path $UpdatesRoot "stable\manifest.json")

  $healthVersion = [string]$health.version
  $targetVersion = [string]$updateResult.targetVersion
  $stableVersion = [string]$stableManifest.version
  Add-Check $checks "Servicio publico" ($health.service -eq "sas-support-platform") "Servicio $($health.service), version $healthVersion"
  Add-Check $checks "Resultado de actualizacion" ($updateResult.status -eq "pass") "Estado $($updateResult.status)"
  Add-Check $checks "Sin reversion" (-not [bool]$updateResult.rolledBack) "rolledBack=$($updateResult.rolledBack)"
  Add-Check $checks "Version instalada" ($healthVersion -and $healthVersion -eq $targetVersion) "Publica=$healthVersion; instalada=$targetVersion"
  Add-Check $checks "Version publicada" ($healthVersion -and $healthVersion -eq $stableVersion) "Publica=$healthVersion; canal=$stableVersion"

  $failed = @($checks | Where-Object { $_.status -eq "fail" }).Count
  $status = if ($failed -eq 0) { "pass" } else { "fail" }
  $nextAction = if ($status -eq "pass") { "Sin accion inmediata." } else { "Alinear la version instalada, el resultado de actualizacion y el canal estable." }
  $evidence = [ordered]@{
    status = $status
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    server = "SERVER"
    publicBaseUrl = $PublicBaseUrl
    updatesRoot = $UpdatesRoot
    installedVersion = $healthVersion
    targetVersion = $targetVersion
    publishedVersion = $stableVersion
    updatedAt = $updateResult.completedAt
    rolledBack = [bool]$updateResult.rolledBack
    checks = @($checks)
    summary = if ($status -eq "pass") { "SERVER opera en $healthVersion y coincide con el canal estable." } else { "$failed verificaciones remotas fallaron." }
    nextAction = $nextAction
  }
} catch {
  $evidence = [ordered]@{
    status = "fail"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    server = "SERVER"
    publicBaseUrl = $PublicBaseUrl
    updatesRoot = $UpdatesRoot
    installedVersion = $null
    checks = @($checks)
    summary = "No fue posible validar la instalacion remota: $($_.Exception.Message)"
    nextAction = $nextAction
  }
}

$directory = Split-Path -Parent $ReportPath
if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$evidence | ConvertTo-Json -Depth 8
if ($evidence.status -eq "fail") { exit 1 }