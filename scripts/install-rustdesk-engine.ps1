param(
  [string]$Version = "1.4.9",
  [string]$ExpectedSha256 = "c87d2f4cef2a5acd6003b6507dcfbf5d5168a256db082cd90b54d35193224aaa",
  [string]$DownloadUrl = "",
  [string]$InstallerPath = "",
  [string]$ExpectedExecutable = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "La instalación de RustDesk requiere ejecutar PowerShell como administrador."
  }
}

Assert-Administrator

if (-not $DownloadUrl) {
  $DownloadUrl = "https://github.com/rustdesk/rustdesk/releases/download/$Version/rustdesk-$Version-x86_64.msi"
}
if (-not $ExpectedExecutable) {
  $ExpectedExecutable = Join-Path $env:ProgramFiles "RustDesk\RustDesk.exe"
}

if ((Test-Path -LiteralPath $ExpectedExecutable -PathType Leaf) -and -not $Force) {
  [pscustomobject]@{
    installed = $true
    changed = $false
    provider = "rustdesk"
    version = (Get-Item -LiteralPath $ExpectedExecutable).VersionInfo.ProductVersion
    executablePath = $ExpectedExecutable
    message = "RustDesk ya está instalado. Usa -Force para reinstalar la versión fijada."
  } | ConvertTo-Json -Depth 4
  exit 0
}

$temporaryRoot = $null
$msiPath = $null
$installerSource = $DownloadUrl
if ($InstallerPath) {
  if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "No existe el MSI integrado de RustDesk: $InstallerPath" }
  $msiPath = (Resolve-Path -LiteralPath $InstallerPath).Path
  if ([IO.Path]::GetExtension($msiPath) -ne ".msi") { throw "El instalador integrado de RustDesk debe ser un archivo MSI." }
  $installerSource = "bundled_verified_msi"
} else {
  $temporaryRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("sas-rustdesk-" + [Guid]::NewGuid().ToString("N"))))
  $systemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $temporaryRoot.StartsWith($systemTemp, [StringComparison]::OrdinalIgnoreCase)) {
    throw "La ruta temporal calculada no pertenece al directorio temporal de Windows."
  }
  New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
  $msiPath = Join-Path $temporaryRoot "rustdesk-$Version-x86_64.msi"
}

try {
  if (-not $InstallerPath) { Invoke-WebRequest -Uri $DownloadUrl -OutFile $msiPath -UseBasicParsing }
  $actualSha256 = (Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
    throw "El instalador RustDesk no coincide con el SHA-256 publicado. Esperado: $ExpectedSha256; recibido: $actualSha256"
  }

  $arguments = @("/i", $msiPath, "/qn", "/norestart")
  $process = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "Windows Installer no pudo instalar RustDesk. Código: $($process.ExitCode)"
  }
  if (-not (Test-Path -LiteralPath $ExpectedExecutable -PathType Leaf)) {
    throw "RustDesk terminó la instalación, pero no apareció $ExpectedExecutable"
  }

  [pscustomobject]@{
    installed = $true
    changed = $true
    restartRequired = $process.ExitCode -eq 3010
    provider = "rustdesk"
    version = $Version
    executablePath = $ExpectedExecutable
    sha256 = $actualSha256
    source = $installerSource
  } | ConvertTo-Json -Depth 4
} finally {
  if ($temporaryRoot -and (Test-Path -LiteralPath $temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
