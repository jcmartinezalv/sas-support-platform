param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [string]$CertificateThumbprint = "",
  [string]$CertificatePath = "",
  [securestring]$CertificatePassword,
  [string]$TimestampServer = "http://timestamp.digicert.com",
  [string[]]$Extensions = @(".exe", ".dll", ".ps1", ".psm1", ".cmd", ".msi"),
  [switch]$AuditOnly
)

$ErrorActionPreference = "Stop"

$resolvedPackage = (Resolve-Path $PackagePath).Path
$signableFiles = Get-ChildItem -Path $resolvedPackage -Recurse -File | Where-Object {
  $Extensions -contains $_.Extension.ToLowerInvariant() -and
  $_.FullName -notmatch '\\data\\' -and
  $_.FullName -notmatch '\\logs\\' -and
  $_.FullName -notmatch '\\tmp\\'
}

function Get-SigningCertificate {
  if ($CertificatePath) {
    $resolvedCert = (Resolve-Path $CertificatePath).Path
    if ($CertificatePassword) {
      return New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($resolvedCert, $CertificatePassword)
    }
    return New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($resolvedCert)
  }

  if ($CertificateThumbprint) {
    $thumbprint = $CertificateThumbprint.Replace(" ", "").ToUpperInvariant()
    $stores = @("Cert:\CurrentUser\My", "Cert:\LocalMachine\My")
    foreach ($store in $stores) {
      $cert = Get-ChildItem $store -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $thumbprint } | Select-Object -First 1
      if ($cert) { return $cert }
    }
    throw "No se encontro certificado con thumbprint $CertificateThumbprint."
  }

  throw "Indica -CertificateThumbprint o -CertificatePath, o usa -AuditOnly para solo inventariar."
}

if ($AuditOnly) {
  $signableFiles | ForEach-Object {
    $signature = Get-AuthenticodeSignature -FilePath $_.FullName
    [pscustomobject]@{
      Path = $_.FullName.Replace($resolvedPackage, "").TrimStart("\")
      Size = $_.Length
      Status = $signature.Status
      Signer = $signature.SignerCertificate.Subject
      Thumbprint = $signature.SignerCertificate.Thumbprint
    }
  } | ConvertTo-Json -Depth 4
  return
}

$certificate = Get-SigningCertificate
$results = foreach ($file in $signableFiles) {
  $signature = Set-AuthenticodeSignature -FilePath $file.FullName -Certificate $certificate -TimestampServer $TimestampServer -HashAlgorithm SHA256
  [pscustomobject]@{
    Path = $file.FullName.Replace($resolvedPackage, "").TrimStart("\")
    Status = $signature.Status
    StatusMessage = $signature.StatusMessage
    Signer = $signature.SignerCertificate.Subject
    Thumbprint = $signature.SignerCertificate.Thumbprint
  }
}

$failed = @($results | Where-Object { $_.Status -ne "Valid" })
$results | ConvertTo-Json -Depth 4
if ($failed.Count -gt 0) {
  throw "Firma incompleta: $($failed.Count) archivo(s) no quedaron validos."
}
