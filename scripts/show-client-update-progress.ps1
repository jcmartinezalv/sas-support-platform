param(
  [Parameter(Mandatory = $true)][string]$StatusPathBase64,
  [string]$ExpectedVersion = ""
)

$ErrorActionPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$statusPath = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($StatusPathBase64))
$updatesRoot = Split-Path -Parent $statusPath
$clientRuntimeRoot = Join-Path $env:LOCALAPPDATA "SAS\Client"
$notificationStatePath = Join-Path $clientRuntimeRoot "tray-update-notifications.json"
$activePath = Join-Path $clientRuntimeRoot "client-update-progress-active.json"
$created = $false
$mutex = [Threading.Mutex]::new($true, "Local\SASClientUpdateProgress", [ref]$created)
if (-not $created) { exit 0 }

function Read-Json([string]$Path) {
  try {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch { return $null }
}

function Write-JsonAtomic([string]$Path, [object]$Value) {
  try {
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $temporary = "$Path.$PID.tmp"
    $Value | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } catch {}
}

function Save-TerminalReceipt([object]$Receipt) {
  $version = if ($Receipt.installedVersion) { [string]$Receipt.installedVersion } else { [string]$Receipt.expectedVersion }
  $fingerprint = if ($Receipt.status -eq "pass") { "pass:${version}" } else { "fail:${version}:$($Receipt.failedAt):$($Receipt.message)" }
  Write-JsonAtomic $notificationStatePath ([ordered]@{
    lastUpdateReceipt = $fingerprint
    acknowledgedAt = (Get-Date).ToUniversalTime().ToString("o")
    version = if ($Receipt.installedVersion) { [string]$Receipt.installedVersion } else { [string]$Receipt.expectedVersion }
  })
}

Write-JsonAtomic $activePath ([ordered]@{
  processId = $PID
  expectedVersion = $ExpectedVersion
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
})

$form = New-Object System.Windows.Forms.Form
$form.Text = "Actualización de SAS Cliente"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(520, 190)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.TopMost = $true
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 248, 248)

$title = New-Object System.Windows.Forms.Label
$title.Text = if ($ExpectedVersion) { "Actualizando a SAS Cliente $ExpectedVersion" } else { "Actualizando SAS Cliente" }
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.Size = New-Object System.Drawing.Size(470, 30)
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 15)
$form.Controls.Add($title)

$detail = New-Object System.Windows.Forms.Label
$detail.Text = "Preparando la descarga segura…"
$detail.Location = New-Object System.Drawing.Point(27, 62)
$detail.Size = New-Object System.Drawing.Size(465, 42)
$detail.ForeColor = [System.Drawing.Color]::FromArgb(68, 86, 94)
$form.Controls.Add($detail)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(28, 114)
$progress.Size = New-Object System.Drawing.Size(392, 24)
$progress.Minimum = 0
$progress.Maximum = 100
$progress.Value = 5
$form.Controls.Add($progress)

$percent = New-Object System.Windows.Forms.Label
$percent.Text = "5 %"
$percent.Location = New-Object System.Drawing.Point(432, 115)
$percent.Size = New-Object System.Drawing.Size(62, 24)
$percent.TextAlign = "MiddleRight"
$percent.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)
$form.Controls.Add($percent)

$note = New-Object System.Windows.Forms.Label
$note.Text = "Puedes continuar trabajando hasta que SAS Cliente se cierre para instalar."
$note.Location = New-Object System.Drawing.Point(28, 148)
$note.Size = New-Object System.Drawing.Size(465, 24)
$note.ForeColor = [System.Drawing.Color]::FromArgb(99, 113, 119)
$form.Controls.Add($note)

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Shield
$notify.Text = "Actualizando SAS Cliente"
$notify.Visible = $true

$phaseText = @{
  downloading = "Descargando el instalador desde SAS Server…"
  verifying = "Verificando tamaño, integridad y SHA-256…"
  ready = "Descarga verificada; preparando la tarea segura…"
  scheduled = "Actualización programada; esperando el cierre controlado…"
  applying = "Cerrando componentes de SAS Cliente…"
  installing = "Instalando la nueva versión…"
  validating = "Validando versión, servicios y arranque…"
  pass = "Actualización terminada correctamente."
  fail = "La actualización no pudo terminar."
}
$phasePercent = @{ downloading=15; verifying=40; ready=55; scheduled=65; applying=74; installing=86; validating=95; pass=100; fail=100 }
$lastPhase = ""
$terminalAt = $null

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.Add_Tick({
  $receipt = Read-Json $statusPath
  if (-not $receipt -or -not $receipt.status) { return }
  $phase = [string]$receipt.status
  $value = if ($null -ne $receipt.progressPercent) { [int]$receipt.progressPercent } elseif ($phasePercent.ContainsKey($phase)) { [int]$phasePercent[$phase] } else { 5 }
  $value = [Math]::Max(0, [Math]::Min(100, $value))
  $progress.Value = $value
  $percent.Text = "$value %"
  $detail.Text = if ($receipt.message) { [string]$receipt.message } elseif ($phaseText.ContainsKey($phase)) { [string]$phaseText[$phase] } else { "Actualización en proceso…" }

  if ($phase -ne $lastPhase) {
    $lastPhase = $phase
    $notify.BalloonTipIcon = if ($phase -eq "fail") { [System.Windows.Forms.ToolTipIcon]::Error } else { [System.Windows.Forms.ToolTipIcon]::Info }
    $notify.BalloonTipTitle = if ($phase -eq "pass") { "SAS Cliente actualizado" } elseif ($phase -eq "fail") { "La actualización no terminó" } else { "Actualización de SAS Cliente · $value %" }
    $notify.BalloonTipText = $detail.Text
    $notify.ShowBalloonTip($(if ($phase -in @("pass", "fail")) { 9000 } else { 4500 }))
  }

  if ($phase -in @("pass", "fail") -and -not $terminalAt) {
    Save-TerminalReceipt $receipt
    $terminalAt = Get-Date
    $note.Text = if ($phase -eq "pass") { "SAS Cliente ya está listo para usarse." } else { "La instalación anterior se conservó. Revisa el detalle antes de reintentar." }
    $form.TopMost = $false
  }
  if ($terminalAt -and $phase -eq "pass" -and ((Get-Date) - $terminalAt).TotalSeconds -ge 9) {
    $form.Close()
  }
})

$form.Add_FormClosed({
  $timer.Stop()
  $notify.Visible = $false
  $notify.Dispose()
  Remove-Item -LiteralPath $activePath -Force -ErrorAction SilentlyContinue
})

$timer.Start()
[System.Windows.Forms.Application]::Run($form)
$mutex.ReleaseMutex() | Out-Null
$mutex.Dispose()
