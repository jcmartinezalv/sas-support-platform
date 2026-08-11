import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const script = fs.readFileSync("scripts/install-rustdesk-engine.ps1", "utf8");
const clientInstaller = fs.readFileSync("scripts/install-client.ps1", "utf8");
const packageValidator = fs.readFileSync("scripts/test-windows11-final-package.ps1", "utf8");
const releaseBuilder = fs.readFileSync("scripts/build-windows11-final-installer.ps1", "utf8");
const nsisInstaller = fs.readFileSync("installer/windows11/SAS-Cliente.nsi", "utf8");

test("RustDesk installer pins the release and verifies its official digest", () => {
  assert.match(script, /\[string\]\$Version = "1\.4\.9"/);
  assert.match(script, /c87d2f4cef2a5acd6003b6507dcfbf5d5168a256db082cd90b54d35193224aaa/);
  assert.match(script, /Get-FileHash -LiteralPath \$msiPath -Algorithm SHA256/);
  assert.match(script, /rustdesk\/rustdesk\/releases\/download\/\$Version/);
  assert.match(script, /msiexec\.exe/);
  assert.match(script, /\/qn/);
  assert.match(script, /\[string\]\$InstallerPath/);
  assert.match(script, /bundled_verified_msi/);
});

test("RustDesk installer validates administrator context and safe temporary cleanup", () => {
  assert.match(script, /WindowsBuiltInRole\]::Administrator/);
  assert.match(script, /StartsWith\(\$systemTemp/);
  assert.match(script, /Remove-Item -LiteralPath \$temporaryRoot -Recurse -Force/);
});

test("SAS client installer can install and persist the selected external engine", () => {
  assert.match(clientInstaller, /\[switch\]\$InstallRustDeskEngine/);
  assert.match(clientInstaller, /install-rustdesk-engine\.ps1/);
  assert.match(clientInstaller, /rustdesk-1\.4\.9-x86_64\.msi/);
  assert.match(clientInstaller, /-InstallerPath \$bundledRustDeskInstaller/);
  assert.match(clientInstaller, /if \(\$InstallRustDeskEngine\) \{ \$RemoteEngine = "auto" \}/);
  assert.match(clientInstaller, /SAS_REMOTE_ENGINE=\$RemoteEngine/);
  assert.match(clientInstaller, /SAS_RUSTDESK_PATH=\$RustDeskPath/);
  assert.match(clientInstaller, /SAS_HOPTODESK_PATH=\$HopToDeskPath/);
});

test("final package validation requires the RustDesk integration files", () => {
  assert.match(packageValidator, /scripts\\install-rustdesk-engine\.ps1/);
  assert.match(packageValidator, /docs\\RUSTDESK-INTEGRATION\.md/);
  assert.match(packageValidator, /vendor\\remote-engines\\rustdesk-1\.4\.9-x86_64\.msi/);
  assert.match(packageValidator, /Add-Check "bundled_rustdesk"/);
  assert.match(packageValidator, /nsisListing -match "rustdesk-1\\\.4\\\.9-x86_64\\\.msi"/);
});

test("final NSIS installer embeds and installs RustDesk on new installs and updates", () => {
  assert.match(releaseBuilder, /rustdesk-\$RustDeskVersion-x86_64\.msi/);
  assert.match(releaseBuilder, /C87D2F4CEF2A5ACD6003B6507DCFBF5D5168A256DB082CD90B54D35193224AAA/);
  assert.match(releaseBuilder, /vendor\\remote-engines/);
  assert.match(nsisInstaller, /File "\$\{SourceRoot\}\\vendor\\remote-engines\\rustdesk-\$\{RustDeskVersion\}-x86_64\.msi"/);
  assert.equal((nsisInstaller.match(/-InstallRustDeskEngine/g) || []).length, 2);
  assert.equal((nsisInstaller.match(/-RemoteEngine auto/g) || []).length, 2);
});
