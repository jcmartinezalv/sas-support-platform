param(
  [string]$LocalUrl = "http://127.0.0.1:37655",
  [string]$InstallPath = "C:\SAS\Client"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$created = $false
$mutex = [Threading.Mutex]::new($true, "Local\SASClientTray", [ref]$created)
if (-not $created) { exit 0 }
$clientRuntimeRoot = Join-Path $env:LOCALAPPDATA "SAS\Client"
$notificationStatePath = Join-Path $clientRuntimeRoot "tray-update-notifications.json"
$progressActivePath = Join-Path $clientRuntimeRoot "client-update-progress-active.json"
$inputDesktopStatusPath = Join-Path $clientRuntimeRoot "input-desktop-status.json"
$sharedInputDesktopStatusPath = Join-Path $InstallPath "runtime\input-desktop-status.json"
$interactiveSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
$inputPipeName = "SASInputDesktopV3_S$interactiveSessionId"
$requiredInputHelperRevision = "input-v9-pointer-recovery"
$script:inputHelperProcess = $null
$script:lastInputHelperAttempt = [DateTime]::MinValue
$script:lastInputHelperRevision = ""
$script:lastInputHelperPath = ""
$script:lastInputHelperProcessId = 0

function Invoke-Local([string]$Path, [string]$Method = "GET", [object]$Body = $null, [int]$Timeout = 4) {
  $parameters = @{ Uri = "$LocalUrl$Path"; Method = $Method; TimeoutSec = $Timeout; UseBasicParsing = $true }
  if ($null -ne $Body) { $parameters.ContentType = "application/json"; $parameters.Body = ($Body | ConvertTo-Json -Compress) }
  Invoke-RestMethod @parameters
}
function Start-LocalAction([string]$Path, [string]$Title) {
  $escapedUrl = "$LocalUrl$Path".Replace("'", "''")
  $script = "try { Invoke-RestMethod -Uri '$escapedUrl' -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 1800 | Out-Null } catch { }"
  Start-Process powershell.exe -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-Command", $script) -WindowStyle Hidden | Out-Null
  $notify.BalloonTipTitle = "SAS Cliente"
  $notify.BalloonTipText = $Title
  $notify.ShowBalloonTip(5000)
}
function Open-Panel {
  try { Start-Process $LocalUrl | Out-Null }
  catch { [System.Windows.Forms.MessageBox]::Show("No fue posible abrir SAS Cliente.`r`n`r`n$($_.Exception.Message)", "SAS Cliente", "OK", "Error") | Out-Null }
}
function Open-SupportPanel {
  try { Start-Process "$LocalUrl/#solicitar-soporte" | Out-Null }
  catch { [System.Windows.Forms.MessageBox]::Show("No fue posible abrir la solicitud de soporte.`r`n`r`n$($_.Exception.Message)", "SAS Cliente", "OK", "Error") | Out-Null }
}
function Get-SafeJsonFile([string]$Path) {
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) | ConvertFrom-Json
  } catch { return $null }
}
function Write-JsonAtomic([string]$Path, [object]$Value) {
  try {
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $temporary = "$Path.$PID.tmp"
    $Value | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $Path -Force
    return $true
  } catch { return $false }
}
function Write-UpdateProgressPlaceholder([string]$Path, [string]$Version, [string]$Status, [string]$Message, [int]$Percent) {
  Write-JsonAtomic $Path ([ordered]@{ status=$Status; message=$Message; targetVersion=$Version; expectedVersion=$Version; progressPercent=$Percent; updatedAt=(Get-Date).ToUniversalTime().ToString("o") }) | Out-Null
}
function Start-UpdateProgressWindow([string]$StatusPath, [string]$Version) {
  try {
    $source = Join-Path $InstallPath "scripts\show-client-update-progress.ps1"
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { return $false }
    $progressRoot = Join-Path $env:LOCALAPPDATA "SAS\UpdateProgress"
    New-Item -ItemType Directory -Force -Path $progressRoot | Out-Null
    $target = Join-Path $progressRoot "show-client-update-progress.ps1"
    Copy-Item -LiteralPath $source -Destination $target -Force
    $encodedStatus = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($StatusPath))
    $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+$target+'"'),'-StatusPathBase64',('"'+$encodedStatus+'"'),'-ExpectedVersion',('"'+$Version+'"'))
    Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    return $true
  } catch { return $false }
}
function Get-UpdateReceiptFingerprint([object]$Receipt) {
  $version = if ($Receipt.installedVersion) { [string]$Receipt.installedVersion } else { [string]$Receipt.expectedVersion }
  if ($Receipt.status -eq "pass") { return "pass:${version}" }
  return "fail:${version}:$($Receipt.failedAt):$($Receipt.message)"
}
function Save-UpdateReceiptAcknowledgement([string]$Fingerprint, [object]$Receipt) {
  Write-JsonAtomic $notificationStatePath ([ordered]@{ lastUpdateReceipt=$Fingerprint; acknowledgedAt=(Get-Date).ToUniversalTime().ToString("o"); version=if($Receipt.installedVersion){[string]$Receipt.installedVersion}else{[string]$Receipt.expectedVersion} }) | Out-Null
}
function Test-UpdateProgressWindowActive {
  $active = Get-SafeJsonFile $progressActivePath
  if (-not $active -or -not $active.processId) { return $false }
  try { return $null -ne (Get-Process -Id ([int]$active.processId) -ErrorAction Stop) } catch { return $false }
}
function Get-ClientEnvValue([string]$Name) {
  try {
    $line = Get-Content -LiteralPath (Join-Path $InstallPath ".env.client") -Encoding UTF8 |
      Where-Object { $_ -match ("^\s*" + [regex]::Escape($Name) + "\s*=") } |
      Select-Object -First 1
    if ($line) { return (($line -split "=", 2)[1]).Trim() }
  } catch {}
  return ""
}
function Test-InputDesktopPipe([string]$ExpectedHelperPath = "") {
  $pipe = $null
  try {
    $pipe = New-Object IO.Pipes.NamedPipeClientStream(".", $inputPipeName, [IO.Pipes.PipeDirection]::InOut)
    $pipe.Connect(350)
    $utf8 = New-Object Text.UTF8Encoding($false)
    $writer = New-Object IO.StreamWriter($pipe, $utf8, 1024, $true)
    $reader = New-Object IO.StreamReader($pipe, $utf8, $false, 1024, $true)
    $writer.AutoFlush = $true
    $request = [Convert]::ToBase64String($utf8.GetBytes("--type`0health_check"))
    $writer.WriteLine($request)
    $response = $reader.ReadLine()
    if (-not $response) { return $false }
    $result = $response.TrimStart([char]0xFEFF) | ConvertFrom-Json
    if (-not [bool]$result.ok) { return $false }
    $diagnostic = $result.diagnostic
    $helperProcessId = [int]($diagnostic.processId)
    $helperRevision = [string]($diagnostic.helperRevision)
    $helperProcess = if ($helperProcessId -gt 0) { Get-Process -Id $helperProcessId -ErrorAction SilentlyContinue } else { $null }
    $helperProcessPath = if ($helperProcess) { try { [string]$helperProcess.Path } catch { "" } } else { "" }
    $script:lastInputHelperRevision = $helperRevision
    $script:lastInputHelperPath = $helperProcessPath
    $script:lastInputHelperProcessId = $helperProcessId
    if ($helperRevision -ne $requiredInputHelperRevision) {
      if ($helperProcess -and $helperProcess.ProcessName -eq "SasInputHelper") { Stop-Process -Id $helperProcessId -Force -ErrorAction SilentlyContinue }
      return $false
    }
    if ($ExpectedHelperPath -and $helperProcessPath) {
      $expectedFull = [IO.Path]::GetFullPath($ExpectedHelperPath)
      $actualFull = [IO.Path]::GetFullPath($helperProcessPath)
      if (-not $actualFull.Equals($expectedFull, [StringComparison]::OrdinalIgnoreCase)) {
        $nativeRoot = [IO.Path]::GetFullPath((Join-Path $InstallPath "native")).TrimEnd('\') + '\'
        if ($helperProcess -and $helperProcess.ProcessName -eq "SasInputHelper" -and $actualFull.StartsWith($nativeRoot, [StringComparison]::OrdinalIgnoreCase)) {
          Stop-Process -Id $helperProcessId -Force -ErrorAction SilentlyContinue
        }
        return $false
      }
    }
    return $true
  } catch {
    return $false
  } finally {
    if ($pipe) { $pipe.Dispose() }
  }
}
function Write-InputDesktopStatus([bool]$Ready, [string]$Message, [int]$ProcessId = 0) {
  $effectiveProcessId = if ($ProcessId -gt 0) { $ProcessId } elseif ($script:lastInputHelperProcessId -gt 0) { $script:lastInputHelperProcessId } else { 0 }
  $status = [ordered]@{
    ready = $Ready
    message = $Message
    processId = $effectiveProcessId
    sessionId = $interactiveSessionId
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    pipe = $inputPipeName
    helperRevision = $script:lastInputHelperRevision
    helperPath = $script:lastInputHelperPath
    requiredHelperRevision = $requiredInputHelperRevision
  }
  Write-JsonAtomic $inputDesktopStatusPath $status | Out-Null
  Write-JsonAtomic $sharedInputDesktopStatusPath $status | Out-Null
}
function Ensure-InputDesktopHelper {
  $helperPath = Get-ClientEnvValue "SAS_INPUT_HELPER_PATH"
  if (-not $helperPath -or -not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
    Write-InputDesktopStatus $false "No se encontró SasInputHelper.exe."
    return $false
  }
  if (Test-InputDesktopPipe -ExpectedHelperPath $helperPath) {
    $pidValue = if ($script:inputHelperProcess -and -not $script:inputHelperProcess.HasExited) { [int]$script:inputHelperProcess.Id } else { 0 }
    Write-InputDesktopStatus $true "Canal interactivo de teclado y ratón disponible." $pidValue
    return $true
  }
  if (((Get-Date) - $script:lastInputHelperAttempt).TotalSeconds -lt 12) { return $false }
  $script:lastInputHelperAttempt = Get-Date
  try {
    if ($script:inputHelperProcess -and -not $script:inputHelperProcess.HasExited) {
      Stop-Process -Id $script:inputHelperProcess.Id -Force -ErrorAction SilentlyContinue
    }
    $script:inputHelperProcess = Start-Process -FilePath $helperPath -ArgumentList @("--pipe-server", $inputPipeName) -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(6)
    do {
      Start-Sleep -Milliseconds 200
      if (Test-InputDesktopPipe -ExpectedHelperPath $helperPath) {
        Write-InputDesktopStatus $true "Canal interactivo iniciado y validado por SAS Cliente." ([int]$script:inputHelperProcess.Id)
        return $true
      }
      if ($script:inputHelperProcess.HasExited) { break }
    } while ((Get-Date) -lt $deadline)
    $exitDetail = if ($script:inputHelperProcess.HasExited) { " El proceso terminó con código $($script:inputHelperProcess.ExitCode)." } else { "" }
    Write-InputDesktopStatus $false "El helper inició, pero el canal local no respondió.$exitDetail" $(if ($script:inputHelperProcess.HasExited) { 0 } else { [int]$script:inputHelperProcess.Id })
  } catch {
    Write-InputDesktopStatus $false "Windows no permitió iniciar el canal interactivo: $($_.Exception.Message)"
  }
  return $false
}
function Get-ConfiguredServerUrl {
  try {
    $line = Get-Content -LiteralPath (Join-Path $InstallPath ".env.client") -Encoding UTF8 |
      Where-Object { $_ -match '^\s*SAS_SERVER_URL\s*=' } |
      Select-Object -First 1
    if ($line) { return (($line -split '=', 2)[1]).Trim() }
  } catch { }
  return ""
}
function Show-ConnectionDiagnostic {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("SAS Cliente · diagnóstico seguro")
  $lines.Add("Fecha: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))")
  $lines.Add("Equipo: $env:COMPUTERNAME")
  $lines.Add("Ruta: $InstallPath")
  $lines.Add("")
  $state = $null
  try {
    $state = Invoke-Local "/status" "GET" $null 2
    $lastContact = if ($state.lastPollAt) { ([DateTime]$state.lastPollAt).ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss") } else { "Nunca" }
    $errorMessage = if ($state.connection.message) { [string]$state.connection.message } else { "Sin error registrado" }
    $lines.Add("Componente local: RESPONDE")
    $lines.Add("Versión: $($state.version)")
    $lines.Add("Servidor configurado: $($state.serverUrl)")
    $lines.Add("Último contacto: $lastContact")
    $lines.Add("Estado remoto: $errorMessage")
    $lines.Add("Código HTTP: $([int]$state.connection.statusCode)")
    $lines.Add("Credencial rechazada: $([bool]$state.connection.credentialRejected)")
    $lines.Add("Identidad activa: $($state.identity.machineId)")
    $captureAt = if ($state.capture.at) { ([DateTime]$state.capture.at).ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss") } else { "Nunca" }
    $lines.Add("Captura remota: $($state.capture.status) · $captureAt · $([int]$state.capture.bytes) bytes")
    $lines.Add("Error de captura: $(if($state.capture.error){$state.capture.error}else{'Ninguno'})")
    $lines.Add("Helper de captura: $([bool]$state.capture.helperExists) · Broker: $([bool]$state.capture.privilegedBrokerExists)")
  } catch {
    $lines.Add("Componente local: NO RESPONDE")
    $lines.Add("Detalle: $($_.Exception.Message)")
  }
  $credential = Get-SafeJsonFile (Join-Path $InstallPath "agent-credential.json")
  $identity = Get-SafeJsonFile (Join-Path $InstallPath "agent-identity.json")
  $credentialPresent = [bool]($credential -and $credential.agentSecret)
  $credentialId = if ($credential.agentId) { [string]$credential.agentId } else { "No disponible" }
  $identityId = if ($identity.machineId) { [string]$identity.machineId } else { "No disponible" }
  $identityMatch = [bool]($credential.agentId -and $identity.machineId -and ([string]$credential.agentId -eq [string]$identity.machineId))
  $lines.Add("")
  $lines.Add("Credencial: $(if($credentialPresent){'PRESENTE (secreto oculto)'}else{'NO ENCONTRADA'})")
  $lines.Add("ID de credencial: $credentialId")
  $lines.Add("ID guardado: $identityId")
  $lines.Add("Identidad coherente: $identityMatch")
  $configuredUrl = Get-ConfiguredServerUrl
  if ($configuredUrl) {
    try {
      $health = Invoke-RestMethod -Uri "$($configuredUrl.TrimEnd('/'))/health" -TimeoutSec 8 -UseBasicParsing
      $lines.Add("Servidor /health: RESPONDE · versión $($health.version)")
    } catch { $lines.Add("Servidor /health: NO RESPONDE · $($_.Exception.Message)") }
  } else { $lines.Add("Servidor /health: SIN URL CONFIGURADA") }
  try {
    $task = Get-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction Stop
    $taskInfo = Get-ScheduledTaskInfo -TaskName "SAS Support Client Agent" -ErrorAction Stop
    $lines.Add("Tarea del agente: $($task.State) · último código $($taskInfo.LastTaskResult)")
  } catch { $lines.Add("Tarea del agente: NO DISPONIBLE") }
  try {
    $listener = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 37655 -State Listen -ErrorAction Stop | Select-Object -First 1
    $lines.Add("Puerto local 37655: ESCUCHANDO · PID $($listener.OwningProcess)")
  } catch { $lines.Add("Puerto local 37655: NO ESCUCHA") }
  $errorLog = Join-Path $InstallPath "logs\sas-agent.err.log"
  if (Test-Path -LiteralPath $errorLog) {
    $tail = @(Get-Content -LiteralPath $errorLog -Tail 8 -Encoding UTF8 -ErrorAction SilentlyContinue) -join "`r`n"
    $tail = $tail -replace '(?i)(x-agent-secret|agentSecret|SAS_AGENT_SECRET)(\s*[:=]\s*)[^\s,;"}]+', '$1$2[SECRETO OCULTO]'
    if ($tail.Trim()) { $lines.Add(""); $lines.Add("Errores recientes:"); $lines.Add($tail) }
  }
  $report = $lines -join "`r`n"
  try { [System.Windows.Forms.Clipboard]::SetText($report); $copyNote = "El reporte completo ya se copió al portapapeles." }
  catch { $copyNote = "Selecciona el texto con Ctrl+C para copiarlo." }
  $summary = if ($state -and -not $state.connection.message) { "SAS Cliente está conectado correctamente." } elseif ($state) { "SAS Cliente funciona localmente, pero el servidor rechazó o no recibió la conexión." } else { "El agente local no está respondiendo." }
  [System.Windows.Forms.MessageBox]::Show("$summary`r`n`r`n$copyNote`r`n`r`n$report", "Diagnóstico de conexión", "OK", $(if($state -and -not $state.connection.message){"Information"}else{"Warning"})) | Out-Null
}
function Retry-Connection {
  try {
    Invoke-Local "/reconnect" "POST" @{} 20 | Out-Null
    $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notify.BalloonTipTitle = "SAS Cliente conectado"
    $notify.BalloonTipText = "La conexión con SAS Server se restableció."
    $notify.ShowBalloonTip(6000)
  } catch {
    $detail = $_.ErrorDetails.Message
    if (-not $detail) { $detail = $_.Exception.Message }
    [System.Windows.Forms.MessageBox]::Show("No fue posible conectar con SAS Server.`r`n`r`n$detail`r`n`r`nUsa Diagnóstico de conexión para revisar el detalle.", "SAS Cliente", "OK", "Warning") | Out-Null
  }
}
function Show-UnattendedDialog {
  try { $state = Invoke-Local "/status" "GET" $null 2
    $cachedState = $state } catch {
    [System.Windows.Forms.MessageBox]::Show("SAS Cliente todavía no está disponible.`r`n`r`n$($_.Exception.Message)", "SAS Cliente", "OK", "Warning") | Out-Null
    return
  }
  $form = New-Object System.Windows.Forms.Form
  $form.Text = "SAS Cliente - acceso desatendido"
  $form.StartPosition = "CenterScreen"
  $form.ClientSize = New-Object System.Drawing.Size(520, 410)
  $form.MaximizeBox = $false
  $form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
  $form.BackColor = [System.Drawing.Color]::FromArgb(244,247,247)
  function Add-Label([string]$Text,[int]$X,[int]$Y,[int]$Width,[int]$Height) {
    $label = New-Object System.Windows.Forms.Label; $label.Text=$Text; $label.Location=New-Object System.Drawing.Point($X,$Y); $label.Size=New-Object System.Drawing.Size($Width,$Height); $form.Controls.Add($label); return $label
  }
  $title = Add-Label "Acceso desatendido" 24 18 460 38
  $title.Font = New-Object System.Drawing.Font("Segoe UI Semibold",18)
  $description = Add-Label "La contraseña se guarda solamente en SAS Cliente. Al activarla, SAS autorizará el acceso sin preguntar al usuario en cada sesión." 27 62 465 42
  $description.ForeColor = [System.Drawing.Color]::FromArgb(76,96,105)
  $status = Add-Label $(if($state.unattendedAccess.enabled){if($state.unattendedAccess.allowControl){"Acceso automático · pantalla, teclado y mouse"}else{"Acceso automático · solamente pantalla"}}else{"No configurada · cada sesión requiere autorización"}) 27 108 465 38
  $status.Padding = New-Object System.Windows.Forms.Padding(10,8,10,8); $status.BorderStyle="FixedSingle"
  $status.BackColor = if($state.unattendedAccess.enabled){[System.Drawing.Color]::FromArgb(229,244,238)}else{[System.Drawing.Color]::FromArgb(255,248,233)}
  [void](Add-Label "Nueva contraseña" 27 162 465 24)
  $password = New-Object System.Windows.Forms.TextBox; $password.Location=New-Object System.Drawing.Point(30,187); $password.Size=New-Object System.Drawing.Size(462,30); $password.UseSystemPasswordChar=$true; $password.MaxLength=128; $form.Controls.Add($password)
  [void](Add-Label "Confirmar contraseña" 27 228 465 24)
  $confirmation = New-Object System.Windows.Forms.TextBox; $confirmation.Location=New-Object System.Drawing.Point(30,253); $confirmation.Size=New-Object System.Drawing.Size(462,30); $confirmation.UseSystemPasswordChar=$true; $confirmation.MaxLength=128; $form.Controls.Add($confirmation)
  $show = New-Object System.Windows.Forms.CheckBox; $show.Text="Mostrar contraseña"; $show.Location=New-Object System.Drawing.Point(30,291); $show.AutoSize=$true; $form.Controls.Add($show)
  $show.Add_CheckedChanged({$password.UseSystemPasswordChar=-not $show.Checked; $confirmation.UseSystemPasswordChar=-not $show.Checked})
  $allow = New-Object System.Windows.Forms.CheckBox; $allow.Text="Permitir también teclado y mouse"; $allow.Location=New-Object System.Drawing.Point(250,291); $allow.AutoSize=$true; $allow.Checked=[bool]$state.unattendedAccess.allowControl; $form.Controls.Add($allow)
  $hint = Add-Label "Mínimo 12 caracteres y tres tipos: mayúsculas, minúsculas, números o símbolos." 27 321 465 35
  $hint.ForeColor=[System.Drawing.Color]::FromArgb(76,96,105)
  $disable = New-Object System.Windows.Forms.Button; $disable.Text="Deshabilitar"; $disable.Location=New-Object System.Drawing.Point(30,362); $disable.Size=New-Object System.Drawing.Size(112,34); $disable.Enabled=[bool]$state.unattendedAccess.enabled; $form.Controls.Add($disable)
  $save = New-Object System.Windows.Forms.Button; $save.Text="Guardar"; $save.Location=New-Object System.Drawing.Point(283,362); $save.Size=New-Object System.Drawing.Size(100,34); $save.BackColor=[System.Drawing.Color]::FromArgb(25,113,83); $save.ForeColor=[System.Drawing.Color]::White; $save.FlatStyle="Flat"; $form.Controls.Add($save)
  $close = New-Object System.Windows.Forms.Button; $close.Text="Cerrar"; $close.Location=New-Object System.Drawing.Point(392,362); $close.Size=New-Object System.Drawing.Size(100,34); $form.Controls.Add($close)
  $save.Add_Click({
    $value=$password.Text; $classes=0; if($value -cmatch '[a-z]'){$classes++}; if($value -cmatch '[A-Z]'){$classes++}; if($value -match '\d'){$classes++}; if($value -match '[^a-zA-Z0-9]'){$classes++}
    if($value -ne $confirmation.Text){[System.Windows.Forms.MessageBox]::Show("Las contraseñas no coinciden.","SAS Cliente","OK","Warning")|Out-Null;return}
    if($value.Length -lt 12 -or $value.Length -gt 128 -or $classes -lt 3){[System.Windows.Forms.MessageBox]::Show("Usa entre 12 y 128 caracteres y combina al menos tres tipos de caracteres.","SAS Cliente","OK","Warning")|Out-Null;return}
    try{$result=Invoke-Local "/unattended-access" "POST" @{enabled=$true;password=$value;allowControl=$allow.Checked;autoApprove=$true};$password.Clear();$confirmation.Clear();$status.Text=if($result.unattendedAccess.allowControl){"Configurada · pantalla, teclado y mouse"}else{"Configurada · solamente pantalla"};$status.BackColor=[System.Drawing.Color]::FromArgb(229,244,238);$disable.Enabled=$true;[System.Windows.Forms.MessageBox]::Show("Acceso desatendido automático activado. La contraseña quedó guardada solamente en SAS Cliente.","SAS Cliente","OK","Information")|Out-Null}catch{[System.Windows.Forms.MessageBox]::Show($_.Exception.Message,"No fue posible guardar","OK","Error")|Out-Null}
  })
  $disable.Add_Click({if([System.Windows.Forms.MessageBox]::Show("¿Deshabilitar el acceso desatendido?","SAS Cliente","YesNo","Warning") -ne "Yes"){return};try{Invoke-Local "/unattended-access" "POST" @{enabled=$false}|Out-Null;$status.Text="No configurada · cada sesión requiere autorización";$status.BackColor=[System.Drawing.Color]::FromArgb(255,248,233);$disable.Enabled=$false}catch{[System.Windows.Forms.MessageBox]::Show($_.Exception.Message,"No fue posible deshabilitar","OK","Error")|Out-Null}})
  $close.Add_Click({$form.Close()}); $form.AcceptButton=$save; $form.CancelButton=$close
  [void]$form.ShowDialog()
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add("Conectando con SAS…"); $statusItem.Enabled = $false
$versionItem = $menu.Items.Add("Versión: comprobando…"); $versionItem.Enabled = $false
$definitionsStatusItem = $menu.Items.Add("Definiciones: comprobando…"); $definitionsStatusItem.Enabled = $false
$protectionItem = $menu.Items.Add("Protección: comprobando…"); $protectionItem.Enabled = $false
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$openItem = $menu.Items.Add("Abrir SAS Cliente")
$supportItem = $menu.Items.Add("Solicitar soporte")
$unattendedItem = $menu.Items.Add("Configurar acceso desatendido…")
$retryItem = $menu.Items.Add("Reintentar conexión")
$diagnosticItem = $menu.Items.Add("Diagnóstico de conexión")
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$realtimeItem = $menu.Items.Add("Vigilancia en tiempo real")
$definitionsItem = $menu.Items.Add("Actualizar definiciones de ClamAV")
$scanItem = $menu.Items.Add("Analizar programas de inicio")
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$updateItem = $menu.Items.Add("Buscar actualización de SAS Cliente")
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$exitItem = $menu.Items.Add("Cerrar icono de bandeja")

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Shield
$notify.Text = "SAS Cliente"
$notify.ContextMenuStrip = $menu
$notify.Visible = $true
$openItem.Add_Click({ Open-Panel })
$supportItem.Add_Click({ Open-SupportPanel })
$unattendedItem.Add_Click({ Show-UnattendedDialog })
$retryItem.Add_Click({ Retry-Connection })
$diagnosticItem.Add_Click({ Show-ConnectionDiagnostic })
$definitionsItem.Add_Click({ Start-LocalAction "/security/definitions" "Actualizando definiciones de ClamAV en segundo plano." })
$scanItem.Add_Click({ Start-LocalAction "/security/scan-startup" "Analizando programas de inicio en segundo plano." })
$realtimeItem.Add_Click({
  $enabled = -not $realtimeItem.Checked
  Invoke-Local "/security/realtime" "POST" @{ enabled = $enabled } 10 | Out-Null
  $realtimeItem.Checked = $enabled
})
$updateItem.Add_Click({
  $updateStatusPath = ""
  $progressStarted = $false
  try {
    $update = Invoke-Local "/update/status" "GET" $null 20
    if (-not $update.available) {
      $updateItem.Text = "Buscar actualización de SAS Cliente"
      $notify.BalloonTipTitle = "SAS Cliente al día"
      $notify.BalloonTipText = "Tienes la versión $($update.installedVersion)."
      $notify.ShowBalloonTip(4500)
      return
    }
    $updateItem.Enabled = $false
    $updateStatusPath = Join-Path $InstallPath "updates\last-update.json"
    Write-UpdateProgressPlaceholder $updateStatusPath ([string]$update.version) "downloading" "Preparando la descarga segura de SAS Cliente $($update.version)." 8
    $progressStarted = Start-UpdateProgressWindow $updateStatusPath ([string]$update.version)
    if (-not $progressStarted) {
      $notify.BalloonTipTitle = "Preparando actualización"
      $notify.BalloonTipText = "Descargando y verificando SAS Cliente $($update.version)."
      $notify.ShowBalloonTip(5000)
    }
    [System.Windows.Forms.Application]::DoEvents()
    $prepared = Invoke-Local "/update/install" "POST" @{} 1800
    if (-not $prepared.prepared -or -not $prepared.installerPath -or -not $prepared.helperPath) { throw "SAS no confirmó la preparación del instalador." }
    $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$prepared.helperPath+'"'),'-InstallerPath',('"'+$prepared.installerPath+'"'),'-ExpectedVersion',('"'+$prepared.version+'"'),'-ExpectedSha256',('"'+$prepared.sha256+'"'),'-InstallPath',('"'+$InstallPath+'"'),'-StatusPath',('"'+$prepared.statusPath+'"'))
    $scheduler = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    if ($scheduler.ExitCode -ne 0) { throw "Windows no pudo programar la actualización de SAS Cliente." }
    $timer.Stop()
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
  } catch {
    $updateItem.Enabled = $true
    $message = $_.Exception.Message
    if ($updateStatusPath) { Write-UpdateProgressPlaceholder $updateStatusPath $(if($update.version){[string]$update.version}else{""}) "fail" $message 100 }
    if (-not $progressStarted) {
      $notify.BalloonTipTitle = "No fue posible actualizar SAS Cliente"
      $notify.BalloonTipText = $message
      $notify.ShowBalloonTip(8000)
    }
  }
})
$exitItem.Add_Click({ $timer.Stop(); $notify.Visible = $false; $notify.Dispose(); [System.Windows.Forms.Application]::Exit() })

$lastDetectionCount = 0
$lastPermissionPrompt = ""
$notificationState = Get-SafeJsonFile $notificationStatePath
$lastUpdateReceipt = if ($notificationState -and $notificationState.lastUpdateReceipt) { [string]$notificationState.lastUpdateReceipt } else { "" }
$cachedState = $null
$script:localAgentFailures = 0
$script:lastAgentRecoveryAttempt = [DateTime]::MinValue
function Request-AgentTaskRecovery {
  if ($script:localAgentFailures -lt 2 -or ((Get-Date) - $script:lastAgentRecoveryAttempt).TotalSeconds -lt 30) { return $false }
  try {
    $task = Get-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction Stop
    if ([string]$task.State -eq "Running") { return $false }
    $script:lastAgentRecoveryAttempt = Get-Date
    Start-ScheduledTask -TaskName "SAS Support Client Agent" -ErrorAction Stop
    return $true
  } catch { return $false }
}
$menu.Add_Opening({
  $openItem.Enabled = $true
  $supportItem.Enabled = $true
  $unattendedItem.Enabled = $true
  $retryItem.Enabled = $true
  $diagnosticItem.Enabled = $true
  $exitItem.Enabled = $true
})
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 8000
$timer.Add_Tick({
  try {
    [void](Ensure-InputDesktopHelper)
    $state = Invoke-Local "/status" "GET" $null 2
    $script:localAgentFailures = 0
    $cachedState = $state
    $connected = $null -ne $state.lastPollAt -and -not $state.connection.message
    $pendingPermission = @($state.sessions | Where-Object { $_.consent.decision -eq "pending" -or $_.controlConsent.decision -eq "pending" } | Select-Object -First 1)
    if ($pendingPermission.Count -gt 0) {
      $pendingSession = $pendingPermission[0]
      $promptType = if ($pendingSession.consent.decision -eq "pending") { "support" } else { "control" }
      $fingerprint = "$($pendingSession.id):$($promptType):$($pendingSession.controlConsent.requestedAt)"
      if ($fingerprint -ne $lastPermissionPrompt) {
        $lastPermissionPrompt = $fingerprint
        $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notify.BalloonTipTitle = if ($promptType -eq "support") { "Tu ticket ya está con el técnico" } else { "El técnico solicita teclado y ratón" }
        $notify.BalloonTipText = "Abre el menú de SAS Cliente y selecciona Abrir SAS Cliente para autorizar o rechazar."
        $notify.ShowBalloonTip(12000)
      }
    } else { $lastPermissionPrompt = "" }
    $receipt = $state.clientUpdateStatus
    if ($receipt -and $receipt.status) {
      $progressStates = @('downloading','verifying','ready','scheduled','applying','installing','validating')
      if ($receipt.status -in $progressStates) {
        $updateItem.Enabled = $false
        $phaseLabel = @{ downloading='Descargando'; verifying='Verificando'; ready='Descarga preparada'; scheduled='Actualización programada'; applying='Cerrando componentes'; installing='Instalando'; validating='Validando' }[[string]$receipt.status]
        $progressValue = if ($null -ne $receipt.progressPercent) { [int]$receipt.progressPercent } else { 0 }
        $updateItem.Text = "$phaseLabel… $progressValue %"
      } else {
        $updateItem.Enabled = $true
        $updateItem.Text = 'Buscar actualización de SAS Cliente'
      }
      if ($receipt.status -in @('pass','fail')) {
        $fingerprint = Get-UpdateReceiptFingerprint $receipt
        if ($fingerprint -ne $lastUpdateReceipt -and -not (Test-UpdateProgressWindowActive)) {
          $lastUpdateReceipt = $fingerprint
          Save-UpdateReceiptAcknowledgement $fingerprint $receipt
          if ($receipt.status -eq 'pass') { $notify.BalloonTipTitle = 'SAS Cliente actualizado'; $notify.BalloonTipText = $receipt.message; $notify.ShowBalloonTip(8000) }
          else { $notify.BalloonTipTitle = 'La actualización no terminó'; $notify.BalloonTipText = $receipt.message; $notify.ShowBalloonTip(10000) }
        }
      }
    }
    $statusItem.Text = if ($connected) { "Servidor: conectado" } else { "Servidor: sin conexión" }
    $versionItem.Text = "Versión instalada: $($state.version)"
    $security = $state.security
    $engineVersion = if ($security.engineVersion) { "ClamAV $($security.engineVersion)" } else { "ClamAV" }
    $protectionItem.Text = if (-not $security.available) { "ClamAV integrado: no disponible" } elseif ($security.active) { "Protección: activa · $engineVersion · $($security.scanned) analizados" } else { "Protección: pausada · $engineVersion" }
    $definitionsStatusItem.Text = if ($security.definitionsUpdatedAt) { "Definiciones: $([DateTime]$security.definitionsUpdatedAt | Get-Date -Format 'dd/MM/yyyy HH:mm')" } else { "Definiciones: sin fecha disponible" }
    $realtimeItem.Checked = [bool]$security.enabled
    $notify.Text = if ($connected) { "SAS Cliente $($state.version) - conectado" } else { "SAS Cliente $($state.version) - sin conexión" }
    if ([int]$security.detections -gt $lastDetectionCount) {
      $lastDetectionCount = [int]$security.detections
      $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
      $notify.BalloonTipTitle = "ClamAV detectó una amenaza"
      $notify.BalloonTipText = "SAS no eliminó el archivo. Abre SAS Cliente para revisar el resultado."
      $notify.ShowBalloonTip(10000)
    }
  } catch {
    $script:localAgentFailures += 1
    $recoveryStarted = Request-AgentTaskRecovery
    $statusItem.Text = if ($recoveryStarted) { "SAS Cliente: recuperando agente" } else { "SAS Cliente: iniciando o sin conexión" }
    $protectionItem.Text = "Protección: esperando al agente"
    $notify.Text = if ($recoveryStarted) { "SAS Cliente - recuperando" } else { "SAS Cliente - iniciando" }
  }
})
$timer.Start()
[void](Ensure-InputDesktopHelper)
[System.Windows.Forms.Application]::Run()
$mutex.ReleaseMutex() | Out-Null
$mutex.Dispose()
