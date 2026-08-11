param(
  [Parameter(Mandatory = $true)][string]$JoinCode,
  [string]$Ticket = "Solicitud de soporte",
  [string]$RequestedBy = "Técnico de soporte"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$decision = "rejected"
$allowControl = $false
$form = New-Object System.Windows.Forms.Form
$form.Text = "SAS Cliente - autorización de soporte"
$form.Size = New-Object System.Drawing.Size(470, 330)
$form.StartPosition = "CenterScreen"
$form.TopMost = $true
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(246, 249, 248)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$title = New-Object System.Windows.Forms.Label
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.Size = New-Object System.Drawing.Size(410, 34)
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 16)
$title.Text = "Soporte solicita acceso a este equipo"
$form.Controls.Add($title)
$detail = New-Object System.Windows.Forms.Label
$detail.Location = New-Object System.Drawing.Point(26, 64)
$detail.Size = New-Object System.Drawing.Size(405, 84)
$detail.Text = "$Ticket`r`nSolicitado por: $RequestedBy`r`nCódigo de sesión: $JoinCode"
$form.Controls.Add($detail)
$notice = New-Object System.Windows.Forms.Label
$notice.Location = New-Object System.Drawing.Point(26, 151)
$notice.Size = New-Object System.Drawing.Size(405, 42)
$notice.ForeColor = [System.Drawing.Color]::FromArgb(64, 83, 78)
$notice.Text = "Autorizar habilita pantalla, ratón, clics, teclado, portapapeles, archivos y asistencia sobre UAC para este ticket. Puedes finalizar todo en cualquier momento desde SAS Cliente."
$form.Controls.Add($notice)
$control = New-Object System.Windows.Forms.CheckBox
$control.Location = New-Object System.Drawing.Point(28, 198)
$control.Size = New-Object System.Drawing.Size(395, 28)
$control.Text = "La autorización incluye todas las herramientas de soporte"
$control.Checked = $true
$control.Visible = $false
$form.Controls.Add($control)
$reject = New-Object System.Windows.Forms.Button
$reject.Location = New-Object System.Drawing.Point(224, 242)
$reject.Size = New-Object System.Drawing.Size(98, 38)
$reject.Text = "Rechazar"
$reject.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($reject)
$accept = New-Object System.Windows.Forms.Button
$accept.Location = New-Object System.Drawing.Point(332, 242)
$accept.Size = New-Object System.Drawing.Size(98, 38)
$accept.Text = "Autorizar soporte"
$accept.BackColor = [System.Drawing.Color]::FromArgb(38, 123, 91)
$accept.ForeColor = [System.Drawing.Color]::White
$accept.FlatStyle = "Flat"
$accept.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($accept)
$form.AcceptButton = $accept
$form.CancelButton = $reject
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.BalloonTipTitle = "SAS Cliente"
$notify.BalloonTipText = "El técnico solicita autorización para acceder a este equipo."
$notify.ShowBalloonTip(7000)
try {
  if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $decision = "approved"
    $allowControl = $true
  }
} finally {
  $notify.Visible = $false
  $notify.Dispose()
  $form.Dispose()
}
[pscustomobject]@{ decision = $decision; allowControl = $allowControl } | ConvertTo-Json -Compress