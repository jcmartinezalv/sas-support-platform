param([Parameter(Mandatory = $true, Position = 0)][string]$Uri)
$ErrorActionPreference = "Stop"
$match = [regex]::Match($Uri, '^sas-client://(?:enroll|link)/([A-HJ-NP-Z2-9]{8})/?$', 'IgnoreCase')
if (-not $match.Success) { throw "La liga de SAS Cliente no es valida." }
$code = $match.Groups[1].Value.ToUpperInvariant()
$payload = @{ enrollmentToken = $code } | ConvertTo-Json -Compress
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:37655/enroll" -Method Post -ContentType "application/json" -Body $payload -TimeoutSec 25 | Out-Null
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Equipo detectado y vinculado correctamente. Regresa a WhatsApp para describir el problema.", "SAS Cliente", "OK", "Information") | Out-Null
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("No fue posible detectar SAS Cliente en ejecución. Abre SAS Cliente o descarga el instalador desde la liga de Fisher.`r`n`r`n$($_.Exception.Message)", "SAS Cliente", "OK", "Warning") | Out-Null
  exit 1
}