param(
  [Parameter(Mandatory = $true)]
  [string]$Thumbprint
)

$ErrorActionPreference = "Stop"
$clean = $Thumbprint.Replace(" ", "").ToUpperInvariant()
$locations = @(
  "Cert:\CurrentUser\My",
  "Cert:\CurrentUser\Root",
  "Cert:\CurrentUser\TrustedPublisher"
)

$removed = foreach ($location in $locations) {
  $certs = Get-ChildItem $location -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $clean }
  foreach ($cert in $certs) {
    Remove-Item -Path $cert.PSPath -Force
    [pscustomobject]@{ Store = $location; Thumbprint = $clean; Removed = $true }
  }
}

if (-not $removed) {
  [pscustomobject]@{ Thumbprint = $clean; Removed = $false; Message = "No se encontro certificado en CurrentUser." } | ConvertTo-Json
} else {
  $removed | ConvertTo-Json -Depth 3
}
