param(
  [string]$HelperPath = (Join-Path (Resolve-Path "$PSScriptRoot\..").Path "tools\sas-input-helper\bin\Release\SasInputHelper.exe"),
  [string]$ReportPath = "output\native-input-self-test.json",
  [int]$TimeoutSeconds = 10,
  [ValidateSet("Helper", "PowerShell")][string]$InjectionMode = "Helper"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SasInputTestWindow {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void MouseLeftClick(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(55);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }
}
"@
[void][SasInputTestWindow]::SetProcessDPIAware()

$helper = (Resolve-Path -LiteralPath $HelperPath).Path
$root = (Resolve-Path "$PSScriptRoot\..").Path
$targetReport = if ([IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $root $ReportPath }
$originalCursor = [Windows.Forms.Cursor]::Position
$originalWindow = [SasInputTestWindow]::GetForegroundWindow()
$startedAt = Get-Date
$deadline = $startedAt.AddSeconds([Math]::Max(4, $TimeoutSeconds))
$expectedText = "SAS-INPUT-OK"
$state = [ordered]@{ stage = 0; clicked = $false; enterReceived = $false; targetX = $null; targetY = $null; clickDiagnostic = $null; textDiagnostic = $null; keyDiagnostic = $null; error = $null }

$form = New-Object Windows.Forms.Form
$form.Text = "SAS · prueba controlada de clic y teclado"
$form.StartPosition = "CenterScreen"
$form.Size = New-Object Drawing.Size(520, 220)
$form.TopMost = $true
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$label = New-Object Windows.Forms.Label
$label.Text = "Prueba automática aislada. No interactúes durante unos segundos."
$label.AutoSize = $true
$label.Location = New-Object Drawing.Point(24, 22)
$form.Controls.Add($label)

$button = New-Object Windows.Forms.Button
$button.Text = "Destino de clic SAS"
$button.Size = New-Object Drawing.Size(190, 38)
$button.Location = New-Object Drawing.Point(24, 62)
$form.Controls.Add($button)

$textbox = New-Object Windows.Forms.TextBox
$textbox.Size = New-Object Drawing.Size(430, 28)
$textbox.Location = New-Object Drawing.Point(24, 120)
$form.Controls.Add($textbox)

$button.Add_Click({ $state.clicked = $true; $textbox.Focus() })
$textbox.Add_KeyDown({ param($sender, $eventArgs); if ($eventArgs.KeyCode -eq [Windows.Forms.Keys]::Enter) { $state.enterReceived = $true; $eventArgs.SuppressKeyPress = $true } })

function Invoke-InputHelper([string[]]$Arguments) {
  $raw = & $helper @Arguments | Out-String
  if ($LASTEXITCODE -ne 0) { throw "SasInputHelper terminó con código ${LASTEXITCODE}: $raw" }
  $result = $raw | ConvertFrom-Json
  if (-not $result.ok) { throw $(if ($result.error) { $result.error } else { "input_helper_failed" }) }
  return $result
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  try {
    if ((Get-Date) -gt $deadline) { throw "native_input_self_test_timeout_stage_$($state.stage)" }
    switch ($state.stage) {
      0 {
        $form.Activate(); $form.BringToFront()
        $point = $button.PointToScreen((New-Object Drawing.Point([int]($button.Width / 2), [int]($button.Height / 2))))
        $state.targetX = $point.X; $state.targetY = $point.Y
        if ($InjectionMode -eq "PowerShell") { [SasInputTestWindow]::MouseLeftClick($point.X, $point.Y); $state.clickDiagnostic = @{ method = "powershell_signed_host" } }
        else { $result = Invoke-InputHelper @("--type", "mouse_click", "--x", "$($point.X)", "--y", "$($point.Y)", "--button", "left"); $state.clickDiagnostic = $result.diagnostic }
        $state.stage = 1
      }
      1 {
        if (-not $state.clicked) { return }
        $textbox.Focus()
        if ($InjectionMode -eq "PowerShell") { [Windows.Forms.SendKeys]::SendWait($expectedText); $state.textDiagnostic = @{ method = "powershell_signed_host" } }
        else { $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($expectedText)); $result = Invoke-InputHelper @("--type", "text_input", "--text-base64", $encoded); $state.textDiagnostic = $result.diagnostic }
        $state.stage = 2
      }
      2 {
        if ($textbox.Text -ne $expectedText) { return }
        $textbox.Focus()
        if ($InjectionMode -eq "PowerShell") { [Windows.Forms.SendKeys]::SendWait("{ENTER}"); $state.keyDiagnostic = @{ method = "powershell_signed_host" } }
        else { $result = Invoke-InputHelper @("--type", "key_press", "--keys", "ENTER"); $state.keyDiagnostic = $result.diagnostic }
        $state.stage = 3
      }
      3 {
        if (-not $state.enterReceived) { return }
        $timer.Stop(); $form.Close()
      }
    }
  } catch {
    $state.error = $_.Exception.Message
    $timer.Stop(); $form.Close()
  }
})

$receivedText = ""
$form.Add_Shown({ $form.Activate(); $form.BringToFront(); $timer.Start() })
try { [void]$form.ShowDialog() }
finally {
  $receivedText = $textbox.Text
  $timer.Stop(); $timer.Dispose(); $form.Dispose()
  [Windows.Forms.Cursor]::Position = $originalCursor
  if ($originalWindow -ne [IntPtr]::Zero) { [void][SasInputTestWindow]::SetForegroundWindow($originalWindow) }
}

$passed = $state.clicked -and $receivedText -eq $expectedText -and $state.enterReceived -and -not $state.error
$report = [ordered]@{
  status = if ($passed) { "pass" } else { "fail" }
  helperPath = $helper
  injectionMode = $InjectionMode
  clicked = $state.clicked
  expectedText = $expectedText
  receivedText = $receivedText
  enterReceived = $state.enterReceived
  target = @{ x = $state.targetX; y = $state.targetY; virtualScreen = [Windows.Forms.SystemInformation]::VirtualScreen.ToString() }
  clickDiagnostic = $state.clickDiagnostic
  textDiagnostic = $state.textDiagnostic
  keyDiagnostic = $state.keyDiagnostic
  error = $state.error
  startedAt = $startedAt.ToUniversalTime().ToString("o")
  completedAt = (Get-Date).ToUniversalTime().ToString("o")
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetReport) | Out-Null
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $targetReport -Encoding UTF8
$report | ConvertTo-Json -Depth 12
if (-not $passed) { exit 1 }
