import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("la actualización del cliente se prepara y entrega el control al proceso interactivo", () => {
  const agent = read("client", "agent-client.js");
  const start = agent.indexOf("async function installClientUpdate()");
  const end = agent.indexOf("async function executeRepairAction", start);
  const updater = agent.slice(start, end);
  assert.match(agent, /clientUpdateStatus: readJsonFile\(path\.join\(config\.clientUpdateDir, "last-update\.json"\)\)/);
  assert.match(updater, /writeProgress\("ready"/);
  assert.match(updater, /updatedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(updater, /prepared: true/);
  assert.match(updater, /helperPath: helper/);
  assert.match(updater, /fs\.fsyncSync\(descriptor\)/);
  assert.match(updater, /diskHash !== actualHash/);
  assert.match(updater, /fs\.renameSync\(temporaryPath, installerPath\)/);
  assert.doesNotMatch(updater, /execFile(?:Async)?\([^\n]*powershell/i);
});

test("la bandeja programa la actualización, espera confirmación y luego se cierra", () => {
  const tray = read("scripts", "sas-client-tray.ps1");
  assert.match(tray, /Invoke-Local "\/update\/install" "POST" @\{\} 1800/);
  assert.match(tray, /Start-Process powershell\.exe -Verb RunAs -ArgumentList \$arguments -Wait -PassThru/);
  assert.match(tray, /\$scheduler\.ExitCode -ne 0/);
  assert.match(tray, /'-ExpectedSha256'/);
  assert.match(tray, /Application\]::DoEvents\(\)/);
  assert.match(tray, /Application\]::Exit\(\)/);
  assert.match(tray, /clientUpdateStatus/);
  assert.match(tray, /\$receipt\.status -eq 'pass'/m);
  assert.match(tray, /\$receipt\.status -in @\('pass','fail'\)/m);
  assert.match(tray, /\$progressStates = @\('downloading','verifying','ready','scheduled','applying','installing','validating'\)/);
  assert.doesNotMatch(tray, /Start-LocalAction "\/update\/install"/);
});


test("la notificación final se confirma una sola vez y el avance sobrevive al cierre del cliente", () => {
  const tray = read("scripts", "sas-client-tray.ps1");
  const progress = read("scripts", "show-client-update-progress.ps1");
  const agent = read("client", "agent-client.js");
  const worker = read("scripts", "apply-client-update.ps1");
  assert.match(tray, /tray-update-notifications\.json/);
  assert.match(tray, /LOCALAPPDATA/);
  assert.doesNotMatch(tray, /BalloonTipClicked|Add_DoubleClick/);
  assert.match(tray, /Save-UpdateReceiptAcknowledgement/);
  assert.match(tray, /Test-UpdateProgressWindowActive/);
  assert.match(tray, /Start-UpdateProgressWindow/);
  assert.match(tray, /StatusPathBase64/);
  assert.match(progress, /Local\\SASClientUpdateProgress/);
  assert.match(progress, /client-update-progress-active\.json/);
  assert.match(progress, /Save-TerminalReceipt/);
  assert.match(progress, /clientRuntimeRoot = Join-Path \$env:LOCALAPPDATA/);
  assert.match(progress, /pass:\$\{version\}/);
  assert.match(progress, /System\.Windows\.Forms\.ProgressBar/);
  assert.match(agent, /writeProgress\("downloading"/);
  assert.match(agent, /reader\.read\(\)/);
  assert.match(agent, /writeProgress\("verifying"/);
  assert.match(worker, /Write-UpdateStatus "installing"/);
  assert.match(worker, /Write-UpdateStatus "validating"/);
});

test("el programador registra una tarea SYSTEM de un solo uso sin ejecutar NSIS directamente", () => {
  const scheduler = read("scripts", "install-client-update.ps1");
  assert.match(scheduler, /TaskName = "SAS Support Client Update"/);
  assert.match(scheduler, /New-ScheduledTaskAction/);
  assert.match(scheduler, /New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest/);
  assert.match(scheduler, /New-ScheduledTaskTrigger -Once/);
  assert.match(scheduler, /Register-ScheduledTask/);
  assert.match(scheduler, /stop-client-components\.ps1/);
  assert.match(scheduler, /Write-UpdateStatus "scheduled"/);
  assert.match(scheduler, /Get-FileHash -LiteralPath \$resolved -Algorithm SHA256/);
  assert.doesNotMatch(scheduler, /Start-Process -FilePath \$resolved/);
});

test("la tarea detiene todos los procesos SAS, verifica otra vez e instala fuera de la bandeja", () => {
  const worker = read("scripts", "apply-client-update.ps1");
  assert.match(worker, /stop-client-components\.ps1/);
  assert.match(worker, /LeaveBrokerDisabled/);
  assert.match(worker, /Stop-ScheduledTask -TaskName "SAS Support Client Agent"/);
  assert.match(worker, /Stop-ScheduledTask -TaskName "SAS Privileged Desktop Broker Recovery"/);
  assert.match(worker, /Stop-Service -Name "SAS Secure Attention Broker"/);
  assert.match(worker, /ExecutablePath[\s\S]*StartsWith\(\$installPrefix/);
  assert.match(worker, /CommandLine[\s\S]*IndexOf\(\$installPrefix/);
  assert.match(worker, /Stop-Process -Id \$process\.ProcessId -Force/);
  assert.match(worker, /Resolve-ValidatedInstaller[\s\S]*Stop-SasClientProcesses[\s\S]*Resolve-ValidatedInstaller/);
  assert.match(worker, /Start-Process -FilePath \$resolved -ArgumentList "\/S" -Wait -PassThru/);
  assert.match(worker, /\$installedVersion -ne \$ExpectedVersion/);
  assert.match(worker, /Write-UpdateStatus "pass"/);
  assert.match(worker, /Write-UpdateStatus "fail"/);
  assert.match(worker, /input-v9-pointer-recovery/);
  assert.match(worker, /Restore-PreviousClientStartup\s*\n\s*Write-UpdateStatus "validating"/);
  assert.match(worker, /SASInputDesktopV3_S\\d\+\$/);
  assert.match(worker, /helperProcess\.ExecutablePath/);
  assert.match(worker, /if \(-not \$inputDesktopReady\) \{ throw/);
  assert.match(worker, /Unregister-ScheduledTask -TaskName \$TaskName/);
});
test("la actualización libera exclusivamente los helpers nativos y nunca vuelve a vincular", () => {
  const cleanup = read("scripts", "stop-client-components.ps1");
  const installer = read("scripts", "install-client.ps1");
  const nsi = read("installer", "windows11", "SAS-Cliente.nsi");
  for (const executable of ["SasCaptureHelper.exe", "SasDxgiCapture.exe", "SasInputHelper.exe", "SasSecureAttentionBroker.exe"]) {
    assert.match(cleanup, new RegExp(executable.replace(".", "\\.")));
  }
  assert.match(cleanup, /Invoke-NativeProcessBounded \$sc @\("config", \$brokerServiceName, "start=", "disabled"\) 5000/);
  assert.match(cleanup, /FileShare\]::None/);
  assert.match(cleanup, /No fue posible liberar los componentes nativos/);
  assert.match(cleanup, /Invoke-NativeProcessBounded/);
  assert.equal(cleanup.includes("$deadline = (Get-Date).AddSeconds(15)"), true);
  assert.doesNotMatch(cleanup, /Get-CimInstance|Win32_Process|Win32_Service/);
  assert.match(installer, /if \(\$UpdateMode -and -not \$usingExistingCredential\)/);
  assert.match(installer, /\$usingEnrollment = \(-not \$UpdateMode\)/);
  assert.match(nsi, /\$IsUpdate == "1"[\s\S]*-UpdateMode/);
  assert.match(nsi, /native\\\$\{AppVersion\}/);
  assert.match(nsi, /\/x "SasCaptureHelper\.exe"/);
  assert.match(nsi, /AllowSideBySide/);
  assert.match(installer, /native\\\$clientVersion/);
  assert.match(installer, /Set-ServiceImagePath -Name \$brokerServiceName -CommandLine \$desktopControlServiceCommand/);
  assert.doesNotMatch(installer, /Invoke-ScCommand @\("config", \$brokerServiceName, "binPath="/);
  assert.match(installer, /Restore-ClientAfterInstallFailure/);
  assert.doesNotMatch(installer, /"binPath= `\\"\$secureAttentionBrokerPath`\\""/);
});

test("la actualización detiene y verifica ClamAV antes de que NSIS reemplace archivos", () => {
  const cleanup = read("scripts", "stop-client-components.ps1");
  const worker = read("scripts", "apply-client-update.ps1");
  const nsi = read("installer", "windows11", "SAS-Cliente.nsi");
  assert.match(cleanup, /SAS Client ClamAV Definitions/);
  assert.equal(cleanup.includes("Stop-ScheduledTask -TaskName $clamTaskName"), true);
  assert.equal(cleanup.includes("Disable-ScheduledTask -TaskName $clamTaskName"), true);
  assert.match(cleanup, /update-clamav-definitions/);
  assert.equal(cleanup.includes("$clamRootPrefix"), true);
  assert.match(cleanup, /Test-ExclusiveWrite/);
  assert.match(cleanup, /No fue posible liberar ClamAV antes de actualizar/);
  assert.match(cleanup, /RestoreOnly/);
  assert.match(cleanup, /Restore-ClientStartup -Force/);
  assert.match(worker, /Restore-PreviousClientStartup/);
  assert.equal(worker.includes('Enable-ScheduledTask -TaskName "SAS Client ClamAV Definitions"'), true);
  assert.equal(nsi.includes("Function .onInstFailed"), true);
  assert.equal(nsi.includes("last-component-release-error.txt"), true);
  assert.match(nsi, /La actualización se detuvo antes de reemplazar archivos/);
});

test("la actualización acepta el fallback interactivo y lo restaura si falla", () => {
  const worker = read("scripts", "apply-client-update.ps1");
  const cleanup = read("scripts", "stop-client-components.ps1");
  assert.match(worker, /function Test-InputDesktopPipe/);
  assert.match(worker, /\$inputDesktopReady = Test-InputDesktopPipe/);
  assert.match(worker, /\$installedVersion -eq \$ExpectedVersion\) -and \$agentTask/);
  assert.match(worker, /\$agentTask -and \$inputDesktopReady/);
  assert.match(worker, /helper interactivo activo no corresponde/);
  assert.doesNotMatch(worker, /SAS Desktop Control Service no quedo operativo; la actualizacion no puede declararse correcta/);
  assert.doesNotMatch(worker, /Start-ScheduledTask -TaskName "SAS Input Desktop Helper"/);
  assert.match(cleanup, /Start-ScheduledTask -TaskName \$inputTaskName/);
});
test("ClamAV se actualiza por una tarea separada cada cinco horas", () => {
  const install = read("scripts", "install-client.ps1");
  const updater = read("scripts", "update-clamav-definitions.ps1");
  const tray = read("scripts", "sas-client-tray.ps1");
  assert.match(install, /New-ScheduledTaskTrigger -Once -At \(Get-Date\)\.AddMinutes\(5\) -RepetitionInterval \(New-TimeSpan -Hours 5\)/);
  assert.match(install, /New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest/);
  assert.match(install, /schtasks\.exe \/Create[\s\S]*\/SC HOURLY \/MO 5 \/RU SYSTEM/);
  assert.match(install, /last-install-result\.json/);
  assert.match(updater, /Start-Process -FilePath \$freshClam/);
  assert.match(updater, /Global\\SASClientClamAVDefinitions/);
  assert.doesNotMatch(tray, /Descargando por primera vez las firmas/);
});
