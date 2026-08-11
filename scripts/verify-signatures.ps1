param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [string[]]$Extensions = @(".exe", ".dll", ".ps1", ".psm1", ".cmd", ".msi"),
  [string]$OutputPath = "",
  [switch]$RequireSigned
)

$ErrorActionPreference = "Stop"
$resolvedPackage = (Resolve-Path $PackagePath).Path

$files = Get-ChildItem -Path $resolvedPackage -Recurse -File | Where-Object {
  $Extensions -contains $_.Extension.ToLowerInvariant() -and
  $_.FullName -notmatch '\\data\\' -and
  $_.FullName -notmatch '\\logs\\' -and
  $_.FullName -notmatch '\\tmp\\'
}

$results = foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -FilePath $file.FullName
  [pscustomobject]@{
    Path = $file.FullName.Replace($resolvedPackage, "").TrimStart("\")
    Size = $file.Length
    Extension = $file.Extension
    Status = [string]$signature.Status
    StatusMessage = $signature.StatusMessage
    Signer = $signature.SignerCertificate.Subject
    Thumbprint = $signature.SignerCertificate.Thumbprint
  }
}

$summary = [pscustomobject]@{
  PackagePath = $resolvedPackage
  CheckedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  FileCount = @($results).Count
  ValidCount = @($results | Where-Object { $_.Status -eq "Valid" }).Count
  NotSignedCount = @($results | Where-Object { $_.Status -eq "NotSigned" }).Count
  OtherStatusCount = @($results | Where-Object { $_.Status -notin @("Valid", "NotSigned") }).Count
  Files = $results
}

$json = $summary | ConvertTo-Json -Depth 6
if ($OutputPath) {
  $json | Set-Content -Path $OutputPath -Encoding UTF8
  Write-Host "Reporte de firmas: $OutputPath"
} else {
  $json
}

if ($RequireSigned -and ($summary.ValidCount -ne $summary.FileCount)) {
  throw "Firma requerida: $($summary.FileCount - $summary.ValidCount) archivo(s) no tienen firma valida."
}
