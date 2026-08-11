import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function powershellCommand() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

test("production status script parses as valid powershell", { skip: process.platform !== "win32" }, () => {
  const root = process.cwd();
  const script = path.join(root, "scripts", "get-production-status.ps1");
  assert.equal(fs.existsSync(script), true);

  const result = spawnSync(powershellCommand(), [
    "-NoProfile",
    "-Command",
    `$errors=$null; $tokens=[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw '${script.replaceAll("'", "''")}'), [ref]$errors); if ($errors) { $errors; exit 1 } else { 'OK' }`
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK/);
});

test("production status script reports process, listeners, tls and health", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "get-production-status.ps1"), "utf8");

  assert.match(script, /sas-production\.pid/);
  assert.match(script, /Get-NetTCPConnection/);
  assert.match(script, /Read-TlsCertificate/);
  assert.match(script, /\/health/);
  assert.match(script, /ConvertTo-Json -Depth 8/);
  assert.match(script, /LocalOnly/);
  assert.match(script, /RemoteOnly/);
  assert.match(script, /Test-NodeLocalHealth/);
});


test("production status script handles wildcard IPv6 listeners", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "get-production-status.ps1"), "utf8");

  assert.match(script, /function Find-ListeningPort/);
  assert.match(script, /Where-Object \{ \[int\]\$_\.LocalPort -eq \$Port \}/);
  assert.match(script, /\$httpsListener = Find-ListeningPort \$httpsPort/);
  assert.match(script, /\$httpListener = Find-ListeningPort \$httpPort/);
});
test("production status script treats local health as effective HTTPS signal", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "get-production-status.ps1"), "utf8");

  assert.match(script, /\$effectiveHttpsListening = \[bool\]\$httpsListener -or \(\$LocalOnly -and \$health\.status -eq "pass"\)/);
  assert.match(script, /listeners = \$listenersReport/);
  assert.match(script, /source="remote_health"/);
});