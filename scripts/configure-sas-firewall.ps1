param(
  [string]$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = "Stop"

$current = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($current)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Ejecuta este script en PowerShell como Administrador."
}

function Ensure-PortRule([string]$Name, [int]$Port) {
  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -DisplayName $Name -Enabled True -Action Allow -Profile Any | Out-Null
  } else {
    New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Any | Out-Null
  }
}

Ensure-PortRule -Name "SAS MVP HTTP 80" -Port 80
Ensure-PortRule -Name "SAS MVP HTTPS 443" -Port 443

$wacs = Join-Path $ProjectDir "tools\win-acme\wacs.exe"
if (Test-Path $wacs) {
  $ruleName = "SAS win-acme wacs"
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -DisplayName $ruleName -Enabled True -Action Allow -Profile Any | Out-Null
  } else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Program (Resolve-Path $wacs).Path -Profile Any | Out-Null
  }
}

Get-NetFirewallRule -DisplayName "SAS MVP HTTP 80","SAS MVP HTTPS 443","SAS win-acme wacs" -ErrorAction SilentlyContinue |
  Select-Object DisplayName,Enabled,Action,Profile |
  ConvertTo-Json -Compress
