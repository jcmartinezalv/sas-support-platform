[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [string]$SourceRoot = "",
  [Parameter(Mandatory=$true)][string]$DestinationRoot,
  [ValidateSet("stable", "testing", "client")][string]$Channel = "stable",
  [string]$PublicBaseUrl = "https://setinfo.sytes.net",
  [string]$ExpectedVersion = "",
  [switch]$SkipPublicValidation
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  $SourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) "updates"
}

function Resolve-SafeRoot([string]$Value, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Label no puede estar vacio." }
  $full = [IO.Path]::GetFullPath($Value)
  $isUncShare = $full.StartsWith("\\")
  if (-not $isUncShare -and $full -eq [IO.Path]::GetPathRoot($full)) { throw "$Label no puede ser la raiz de una unidad: $full" }
  return $full.TrimEnd('\', '/')
}

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "No existe el archivo requerido: $Path" }
  return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

$source = Resolve-SafeRoot $SourceRoot "SourceRoot"
$destination = Resolve-SafeRoot $DestinationRoot "DestinationRoot"
$sourceChannel = Join-Path $source $Channel
$manifestPath = Join-Path $sourceChannel "manifest.json"
$manifest = Read-Json $manifestPath

if ($manifest.schemaVersion -ne 1 -or $manifest.product -ne "SAS Support Platform") { throw "El manifiesto local no pertenece a SAS." }
if ([string]$manifest.channel -ne $Channel) { throw "El manifiesto local pertenece al canal $($manifest.channel), no a $Channel." }
if ([string]$manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw "La version del manifiesto no es valida." }
if ($ExpectedVersion -and [string]$manifest.version -ne $ExpectedVersion) { throw "Se esperaba $ExpectedVersion y el manifiesto contiene $($manifest.version)." }
if ([string]$manifest.package.sha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw "El SHA-256 del manifiesto no es valido." }

$packageName = [IO.Path]::GetFileName([string]$manifest.package.url)
$expectedRelativeUrl = "$Channel/$packageName"
if ([string]$manifest.package.url -ne $expectedRelativeUrl -or $packageName -notmatch '^sas-update-\d+\.\d+\.\d+\.zip$') {
  throw "La ruta del paquete no es segura o no corresponde al canal: $($manifest.package.url)"
}

$packagePath = Join-Path $sourceChannel $packageName
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "No existe el paquete local: $packagePath" }
$package = Get-Item -LiteralPath $packagePath
$actualHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne [string]$manifest.package.sha256.ToUpperInvariant()) { throw "El SHA-256 del paquete local no coincide con el manifiesto." }
if ($package.Length -ne [long]$manifest.package.size) { throw "El tamano del paquete local no coincide con el manifiesto." }

if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
  throw "No se puede acceder a $destination. Conecta primero el recurso compartido del servidor definitivo o ejecuta este publicador desde ese servidor."
}

$destinationChannel = Join-Path $destination $Channel
$targetPackage = Join-Path $destinationChannel $packageName
$targetManifest = Join-Path $destinationChannel "manifest.json"
$publicationId = [Guid]::NewGuid().ToString("N")
$temporaryPackage = Join-Path $destinationChannel ".$packageName.$publicationId.partial"
$temporaryManifest = Join-Path $destinationChannel ".manifest.$publicationId.partial"

if ($PSCmdlet.ShouldProcess($destinationChannel, "Publicar SAS $($manifest.version) en canal $Channel")) {
  New-Item -ItemType Directory -Force -Path $destinationChannel | Out-Null
  try {
    Copy-Item -LiteralPath $packagePath -Destination $temporaryPackage -Force
    $remoteHash = (Get-FileHash -LiteralPath $temporaryPackage -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($remoteHash -ne $actualHash) { throw "El paquete copiado al servidor no conserva su SHA-256." }

    if (Test-Path -LiteralPath $targetPackage) {
      $existingHash = (Get-FileHash -LiteralPath $targetPackage -Algorithm SHA256).Hash.ToUpperInvariant()
      if ($existingHash -ne $actualHash) { throw "Ya existe $targetPackage con contenido diferente; no se sobrescribira un paquete inmutable." }
      Remove-Item -LiteralPath $temporaryPackage -Force
    } else {
      Move-Item -LiteralPath $temporaryPackage -Destination $targetPackage
    }

    Copy-Item -LiteralPath $manifestPath -Destination $temporaryManifest -Force
    Move-Item -LiteralPath $temporaryManifest -Destination $targetManifest -Force
  } finally {
    Remove-Item -LiteralPath $temporaryPackage -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temporaryManifest -Force -ErrorAction SilentlyContinue
  }
}

$publicManifestUrl = "$($PublicBaseUrl.TrimEnd('/'))/updates/$Channel/manifest.json"
$publicValidated = $false
if (-not $SkipPublicValidation -and -not $WhatIfPreference) {
  $response = Invoke-WebRequest -Uri $publicManifestUrl -UseBasicParsing -TimeoutSec 20 -Headers @{ "Cache-Control" = "no-cache" }
  if ($response.StatusCode -ne 200) { throw "El manifiesto publico respondio HTTP $($response.StatusCode)." }
  $published = $response.Content | ConvertFrom-Json
  if ([string]$published.version -ne [string]$manifest.version) { throw "El sitio publico muestra $($published.version), no $($manifest.version)." }
  if ([string]$published.package.sha256.ToUpperInvariant() -ne $actualHash) { throw "El sitio publico anuncia otro SHA-256." }
  $publicValidated = $true
}

[pscustomobject]@{
  status = $(if ($WhatIfPreference) { "preview" } else { "published" })
  sourceMachine = $env:COMPUTERNAME
  sourceRoot = $source
  destinationRoot = $destination
  channel = $Channel
  version = [string]$manifest.version
  package = $targetPackage
  sha256 = $actualHash
  size = $package.Length
  manifest = $targetManifest
  publicManifestUrl = $publicManifestUrl
  publicValidated = $publicValidated
} | ConvertTo-Json -Depth 5