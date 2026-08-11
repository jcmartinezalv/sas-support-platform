param(
  [Parameter(Mandatory = $true)][string]$JoinCode,
  [string]$Ticket = "Solicitud de soporte",
  [string]$RequestedBy = "Técnico de soporte"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$decision = "rejected"
$form = New-Object System.Windows.Forms.Form
$form.Text = "SAS Cliente - permiso de control remoto"
$form.Size = New-Object System.Drawing.Size(520, 380)
$form.StartPosition = "CenterScreen"
$form.TopMost = $true
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(246, 249, 248)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$title = New-Object System.Windows.Forms.Label
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.Size = New-Object System.Drawing.Size(445, 38)
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 16)
$title.Text = "El técnico solicita controlar este equipo"
$form.Controls.Add($title)
$detail = New-Object System.Windows.Forms.Label
$detail.Location = New-Object System.Drawing.Point(26, 67)
$detail.Size = New-Object System.Drawing.Size(435, 74)
$detail.Text = "$Ticket`r`nSolicitado por: $RequestedBy`r`nCódigo de sesión: $JoinCode"
$form.Controls.Add($detail)
$notice = New-Object System.Windows.Forms.Label
$notice.Location = New-Object System.Drawing.Point(26, 146)
$notice.Size = New-Object System.Drawing.Size(455, 105)
$notice.ForeColor = [System.Drawing.Color]::FromArgb(64, 83, 78)
$notice.Text = "Aceptar permite temporalmente teclado, ratón, portapapeles y aplicaciones abiertas como administrador. También permite ver y responder avisos UAC. SAS no ejecuta cambios por sí solo y puedes terminar el soporte en cualquier momento."
$form.Controls.Add($notice)
$reject = New-Object System.Windows.Forms.Button
$reject.Location = New-Object System.Drawing.Point(274, 286)
$reject.Size = New-Object System.Drawing.Size(98, 40)
$reject.Text = "Rechazar"
$reject.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($reject)
$accept = New-Object System.Windows.Forms.Button
$accept.Location = New-Object System.Drawing.Point(382, 286)
$accept.Size = New-Object System.Drawing.Size(98, 40)
$accept.Text = "Autorizar"
$accept.BackColor = [System.Drawing.Color]::FromArgb(38, 123, 91)
$accept.ForeColor = [System.Drawing.Color]::White
$accept.FlatStyle = "Flat"
$accept.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($accept)
$form.AcceptButton = $accept
$form.CancelButton = $reject
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Warning
$notify.Visible = $true
$notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
$notify.BalloonTipTitle = "SAS Cliente solicita tu permiso"
$notify.BalloonTipText = "El técnico solicita control, incluso de aplicaciones elevadas y avisos UAC. Autoriza o rechaza desde SAS."
$notify.ShowBalloonTip(10000)
try {
  if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $decision = "approved" }
} finally {
  $notify.Visible = $false
  $notify.Dispose()
  $form.Dispose()
}
[pscustomobject]@{ decision = $decision } | ConvertTo-Json -Compress