param(
  [string]$Subject = "CN=SAS Support Platform Dev Code Signing",
  [string]$OutputCerPath = "certs\sas-dev-code-signing.cer",
  [int]$YearsValid = 3,
  [switch]$TrustForCurrentUser = $true
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command New-SelfSignedCertificate -ErrorAction SilentlyContinue)) {
  throw "New-SelfSignedCertificate no esta disponible en esta version de PowerShell/Windows."
}

$cert = New-SelfSignedCertificate `
  -Subject $Subject `
  -Type CodeSigningCert `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddYears($YearsValid)

$outputDir = Split-Path -Parent $OutputCerPath
if ($outputDir) {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}
Export-Certificate -Cert $cert -FilePath $OutputCerPath | Out-Null

if ($TrustForCurrentUser) {
  $rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "CurrentUser")
  $rootStore.Open("ReadWrite")
  $rootStore.Add($cert)
  $rootStore.Close()

  $publisherStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "CurrentUser")
  $publisherStore.Open("ReadWrite")
  $publisherStore.Add($cert)
  $publisherStore.Close()
}

[pscustomobject]@{
  Subject = $cert.Subject
  Thumbprint = $cert.Thumbprint
  NotBefore = $cert.NotBefore.ToString("o")
  NotAfter = $cert.NotAfter.ToString("o")
  Store = "Cert:\CurrentUser\My"
  PublicCertificate = (Resolve-Path $OutputCerPath).Path
  TrustedForCurrentUser = [bool]$TrustForCurrentUser
  Warning = "Certificado autofirmado para desarrollo. No reemplaza certificado Code Signing OV/EV publico para produccion."
} | ConvertTo-Json -Depth 4
