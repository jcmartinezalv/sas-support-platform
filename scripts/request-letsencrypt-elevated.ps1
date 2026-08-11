param(
  [string]$Domain = "setinfo.sytes.net",
  [string]$Email = "jcmtza@gmail.com",
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path,
  [switch]$Staging
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path $ProjectDir).Path
$script = Join-Path $root "scripts\request-letsencrypt-cert.ps1"
if (-not (Test-Path $script)) {
  throw "No se encontro $script"
}

$args = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-NoExit",
  "-File", "`"$script`"",
  "-Domain", $Domain,
  "-Email", $Email,
  "-ProjectDir", "`"$root`""
)

if ($Staging) {
  $args += "-Staging"
}

Write-Host "Abriendo PowerShell como Administrador para solicitar Lets Encrypt..."
Write-Host "Dominio: $Domain"
Write-Host "Correo:  $Email"
Write-Host "Mantén libre el puerto 80 durante la validacion HTTP-01."
Start-Process -FilePath "powershell.exe" -ArgumentList $args -Verb RunAs
