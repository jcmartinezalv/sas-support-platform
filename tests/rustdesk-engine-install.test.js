import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const script = fs.readFileSync("scripts/install-rustdesk-engine.ps1", "utf8");
const clientInstaller = fs.readFileSync("scripts/install-client.ps1", "utf8");
const packageValidator = fs.readFileSync("scripts/test-windows11-final-package.ps1", "utf8");

test("RustDesk installer pins the release and verifies its official digest", () => {
  assert.match(script, /\[string\]\$Version = "1\.4\.9"/);
  assert.match(script, /c87d2f4cef2a5acd6003b6507dcfbf5d5168a256db082cd90b54d35193224aaa/);
  assert.match(script, /Get-FileHash -LiteralPath \$msiPath -Algorithm SHA256/);
  assert.match(script, /rustdesk\/rustdesk\/releases\/download\/\$Version/);
  assert.match(script, /msiexec\.exe/);
  assert.match(script, /\/qn/);
});

test("RustDesk installer validates administrator context and safe temporary cleanup", () => {
  assert.match(script, /WindowsBuiltInRole\]::Administrator/);
  assert.match(script, /StartsWith\(\$systemTemp/);
  assert.match(script, /Remove-Item -LiteralPath \$temporaryRoot -Recurse -Force/);
});

test("SAS client installer can install and persist the selected external engine", () => {
  assert.match(clientInstaller, /\[switch\]\$InstallRustDeskEngine/);
  assert.match(clientInstaller, /install-rustdesk-engine\.ps1/);
  assert.match(clientInstaller, /SAS_REMOTE_ENGINE=\$RemoteEngine/);
  assert.match(clientInstaller, /SAS_RUSTDESK_PATH=\$RustDeskPath/);
  assert.match(clientInstaller, /SAS_HOPTODESK_PATH=\$HopToDeskPath/);
});

test("final package validation requires the RustDesk integration files", () => {
  assert.match(packageValidator, /scripts\\install-rustdesk-engine\.ps1/);
  assert.match(packageValidator, /docs\\RUSTDESK-INTEGRATION\.md/);
});
