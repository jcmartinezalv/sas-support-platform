[CmdletBinding()]
param(
  [string]$ProjectDir = "",
  [string]$EnvPath = "",
  [string]$TaskName = "SAS Support Server Production",
  [string]$WhatsappBusinessAccountId = "3508532109305908",
  [string]$GraphApiVersion = "v25.0"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ProjectDir) {
  $ProjectDir = Split-Path -Parent $scriptDir
}
if (-not $EnvPath) {
  $EnvPath = Join-Path $ProjectDir ".env.production"
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-EnvValue {
  param([string]$Content, [string]$Name)
  $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Name))=(.*)$")
  if ($match.Success) { return $match.Groups[1].Value.Trim() }
  return ""
}

if (-not (Test-IsAdministrator)) {
  throw "Esta rutina debe ejecutarse como Administrador."
}

if (-not (Test-Path -LiteralPath $EnvPath)) {
  throw "No existe el archivo de configuracion: $EnvPath"
}

Write-Host "Instalacion segura del token permanente de WhatsApp" -ForegroundColor Cyan
Write-Host "El valor no se mostrara ni se escribira en registros." -ForegroundColor DarkGray
Write-Host "Pega el token copiado desde Meta y presiona Enter." -ForegroundColor Yellow

$secureToken = Read-Host -AsSecureString "Token"
$bstr = [IntPtr]::Zero
$token = $null

try {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 80 -or -not $token.StartsWith("EAA")) {
    throw "El valor pegado no tiene el formato esperado de un token de Meta. No se realizo ningun cambio."
  }

  Write-Host "Validando acceso con Meta..." -ForegroundColor Cyan
  $headers = @{ Authorization = "Bearer $token" }
  $uri = "https://graph.facebook.com/$GraphApiVersion/$WhatsappBusinessAccountId`?fields=id,name"
  $account = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 30

  if ([string]$account.id -ne $WhatsappBusinessAccountId) {
    throw "Meta respondio, pero el token no corresponde a la cuenta de WhatsApp esperada."
  }

  $content = [IO.File]::ReadAllText($EnvPath)
  $tokenLine = "WHATSAPP_ACCESS_TOKEN=$token"
  if ($content -match "(?m)^WHATSAPP_ACCESS_TOKEN=.*$") {
    $updated = [regex]::Replace($content, "(?m)^WHATSAPP_ACCESS_TOKEN=.*$", $tokenLine, 1)
  } else {
    $updated = $content.TrimEnd("`r", "`n") + "`r`n" + $tokenLine + "`r`n"
  }

  $tempPath = "$EnvPath.whatsapp.tmp"
  try {
    [IO.File]::WriteAllText($tempPath, $updated, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $EnvPath -Force
  } finally {
    if (Test-Path -LiteralPath $tempPath) {
      Remove-Item -LiteralPath $tempPath -Force
    }
  }

  Write-Host "Token validado y configuracion actualizada." -ForegroundColor Green
  Write-Host "Reiniciando SAS..." -ForegroundColor Cyan

  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName $TaskName

  $baseUrl = Get-EnvValue -Content $updated -Name "PUBLIC_BASE_URL"
  if (-not $baseUrl) { $baseUrl = "https://setinfo.sytes.net" }
  $healthUrl = $baseUrl.TrimEnd("/") + "/health"
  $healthy = $false
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    Start-Sleep -Seconds 3
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 10
      if ($response.StatusCode -eq 200) {
        $healthy = $true
        break
      }
    } catch {
      # El watchdog puede tardar varios segundos en levantar el servicio.
    }
  }

  if (-not $healthy) {
    throw "El token quedo instalado, pero la comprobacion de /health no respondio a tiempo."
  }

  Write-Host "VALIDACION COMPLETA" -ForegroundColor Green
  Write-Host "- Meta acepto el token permanente."
  Write-Host "- La cuenta de WhatsApp coincide."
  Write-Host "- SAS fue reiniciado."
  Write-Host "- /health respondio correctamente."
} finally {
  $token = $null
  $secureToken = $null
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

Write-Host ""
Read-Host "Presiona Enter para cerrar"
