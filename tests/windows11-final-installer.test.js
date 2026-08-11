import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const scripts = ["install-windows11-final.ps1", "uninstall-windows11-final.ps1", "build-windows11-final-installer.ps1", "build-windows11-nsis.ps1", "test-windows11-final-package.ps1", "install-client.ps1", "build-client-installer.ps1", "sas-client-tray.ps1", "install-client-update.ps1", "apply-client-update.ps1", "stop-client-components.ps1", "update-clamav-definitions.ps1"];

test("Windows 11 final installer scripts parse and retain safe lifecycle controls", { skip: process.platform !== "win32" }, () => {
  const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  for (const name of scripts) {
    const script = path.join(root, "scripts", name);
    assert.equal(fs.existsSync(script), true, `${name} must exist`);
    const escaped = script.replaceAll("'", "''");
    const result = spawnSync(powershell, ["-NoProfile", "-Command", `$e=$null; [void][System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw '${escaped}'), [ref]$e); if($e){$e;exit 1}`], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const install = fs.readFileSync(path.join(root, "scripts", scripts[0]), "utf8");
  const uninstall = fs.readFileSync(path.join(root, "scripts", scripts[1]), "utf8");
  assert.match(install, /\$build\s+-lt\s+22000/);
  assert.match(install, /prepare-production-config\.ps1/);
  assert.match(install, /UnsignedRestrictedProduction/);
  assert.match(uninstall, /C:\\SAS\\Backups/);
  assert.match(uninstall, /Unregister-ScheduledTask/);
  const nsi = fs.readFileSync(path.join(root, "installer", "windows11", "SAS-Windows11.nsi"), "utf8");
  assert.match(nsi, /AtLeastWin11/);
  assert.match(nsi, /RequestExecutionLevel admin/);
  assert.match(nsi, /uninstall-windows11-final\.ps1/);
  assert.match(nsi, /SKIPCONFIG/);
  assert.match(nsi, /VIProductVersion "\$\{AppVersion\}\.0"/);
  assert.match(nsi, /StrCmp \$INSTDIR "C:\\SAS\\Server" 0 skipLifecycle/);

  const clientNsi = fs.readFileSync(path.join(root, "installer", "windows11", "SAS-Cliente.nsi"), "utf8");
  assert.match(clientNsi, /SAS Cliente/);
  assert.match(clientNsi, /AtLeastWin10/);
  assert.doesNotMatch(clientNsi, /AtLeastWin11/);
  assert.match(clientNsi, /EnrollmentToken/);
  assert.doesNotMatch(clientNsi, /-UnsignedRestrictedProduction/);
  assert.match(clientNsi, /stop-client-components\.ps1/);
  assert.match(clientNsi, /LeaveBrokerDisabled/);
  assert.match(clientNsi, /nsExec::ExecToStack \/TIMEOUT=60000/);
  assert.match(clientNsi, /-NonInteractive/);
  assert.match(clientNsi, /-UpdateMode/);
  assert.match(clientNsi, /SetShellVarContext all/);
  assert.doesNotMatch(clientNsi, /AGENT_SHARED_SECRET/);
  assert.match(clientNsi, /agent-credential\.json/);
  assert.match(clientNsi, /SourceRoot\}\\tools/);
  assert.match(clientNsi, /native\\\$\{AppVersion\}/);
  assert.match(clientNsi, /\/x "SasSecureAttentionBroker\.exe"/);

  const clientBuilder = fs.readFileSync(path.join(root, "scripts", "build-client-installer.ps1"), "utf8");
  assert.match(clientBuilder, /"\/INPUTCHARSET" "UTF8"/);

  const clientInstaller = fs.readFileSync(path.join(root, "scripts", "install-client.ps1"), "utf8");
  assert.match(clientInstaller, /MinimumBuild\s*=\s*10240/);
  assert.match(clientInstaller, /Windows Server 2016/);
  assert.match(clientInstaller, /PowerShell 5\.0/);
  assert.match(clientInstaller, /SAS_CLAMSCAN_PATH/);
  assert.match(clientInstaller, /deferredDownload = \$true/);
  assert.match(clientNsi, /\/x "database"/);
  assert.match(clientNsi, /\/x "\*\.cvd"/);
  assert.match(clientInstaller, /usingExistingCredential/);
  assert.match(clientInstaller, /SAS_ENABLE_REAL_INPUT=true/);
  assert.match(clientInstaller, /SAS_AGENT_HEARTBEAT_SECONDS=1/);
  assert.match(clientInstaller, /SAS Secure Attention Broker/);
  assert.doesNotMatch(clientInstaller, /SoftwareSASGeneration/);
  assert.match(clientInstaller, /SAS Client ClamAV Definitions/);
  assert.match(clientInstaller, /New-TimeSpan -Hours 5/);
  assert.match(clientInstaller, /runsDuringInstall = \$false/);
  assert.match(clientInstaller, /\$usingEnrollment = \(-not \$UpdateMode\)/);
  assert.equal(fs.existsSync(path.join(root, "tools", "sas-secure-attention-broker", "bin", "Release", "SasSecureAttentionBroker.exe")), true);

  const tray = fs.readFileSync(path.join(root, "scripts", "sas-client-tray.ps1"), "utf8");
  assert.match(tray, /Vigilancia en tiempo real/);
  assert.match(tray, /Actualizar definiciones de ClamAV/);
  assert.match(tray, /Versión instalada/);
  assert.doesNotMatch(tray, /definitionsBootstrapRequested/);
  assert.doesNotMatch(tray, /Descargando por primera vez las firmas/);

  const clamSource = JSON.parse(fs.readFileSync(path.join(root, "tools", "clamav", "source-manifest.json"), "utf8").replace(/^\uFEFF/, ""));
  assert.equal(clamSource.version, "1.5.3");
  assert.equal(clamSource.pgpVerified, true);
  assert.match(clamSource.archiveSha256, /^[A-F0-9]{64}$/);
  for (const relative of ["clamscan.exe", "freshclam.exe", "database/main.cvd", "database/daily.cvd"]) {
    assert.equal(fs.existsSync(path.join(root, "tools", "clamav", relative)), true, `${relative} must exist in the verified build source`);
  }

  const builder = fs.readFileSync(path.join(root, "scripts", "build-windows11-final-installer.ps1"), "utf8");
  assert.match(builder, /https:\/\/nodejs\.org\/dist\/v\$NodeVersion\/SHASUMS256\.txt/);
  assert.match(builder, /Get-FileHash \$NodeArchivePath -Algorithm SHA256/);
  assert.match(builder, /\.env\.production/);
  assert.match(builder, /build-client-installer\.ps1/);
  assert.match(builder, /downloads\\SAS-Cliente-Setup\.exe/);
  assert.match(builder, /embeddedClientHash/);

  const validator = fs.readFileSync(path.join(root, "scripts", "test-windows11-final-package.ps1"), "utf8");
  assert.match(validator, /manifest_hashes/);
  assert.match(validator, /no_private_state/);
  assert.match(validator, /-PreflightOnly -NonInteractive/);
  assert.match(validator, /downloads\\SAS-Cliente-Setup\.exe/);
});


