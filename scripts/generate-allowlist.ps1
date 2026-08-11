param(
  [string]$RootPath = (Resolve-Path "$PSScriptRoot\..").Path,
  [string]$OutputPath = "",
  [string[]]$IncludeExtensions = @(".js", ".ps1", ".json", ".html", ".css", ".md", ".txt", ".cmd", ".exe", ".dll", ".msi")
)

$ErrorActionPreference = "Stop"

$resolvedRoot = (Resolve-Path $RootPath).Path
if (-not $OutputPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputPath = Join-Path $resolvedRoot "sas-allowlist-$stamp.json"
}

$files = Get-ChildItem -Path $resolvedRoot -Recurse -File | Where-Object {
  $IncludeExtensions -contains $_.Extension.ToLowerInvariant() -and
  $_.FullName -notmatch '\\data\\' -and
  $_.FullName -notmatch '\\logs\\' -and
  $_.FullName -notmatch '\\tmp\\'
}

$entries = foreach ($file in $files) {
  $hash = Get-FileHash -Path $file.FullName -Algorithm SHA256
  [pscustomobject]@{
    Path = $file.FullName.Replace($resolvedRoot, "").TrimStart("\")
    FullPath = $file.FullName
    Size = $file.Length
    Extension = $file.Extension
    Sha256 = $hash.Hash
    LastWriteTimeUtc = $file.LastWriteTimeUtc.ToString("o")
  }
}

$manifest = [pscustomobject]@{
  Product = "SAS Support Platform"
  GeneratedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  RootPath = $resolvedRoot
  FileCount = @($entries).Count
  Allowlist = $entries
  Notes = @(
    "Use hashes only after final signed build is produced.",
    "Prefer allowlist by publisher certificate and path when available.",
    "Do not allowlist data, logs or temporary folders by hash."
  )
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host "Allowlist generado: $OutputPath"
Write-Host "Archivos incluidos: $(@($entries).Count)"
