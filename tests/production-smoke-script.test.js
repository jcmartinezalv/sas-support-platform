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

test("production smoke script parses as valid powershell", { skip: process.platform !== "win32" }, () => {
  const root = process.cwd();
  const script = path.join(root, "scripts", "test-production-smoke.ps1");
  assert.equal(fs.existsSync(script), true);

  const result = spawnSync(powershellCommand(), [
    "-NoProfile",
    "-Command",
    `$errors=$null; $tokens=[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw '${script.replaceAll("'", "''")}'), [ref]$errors); if ($errors) { $errors; exit 1 } else { 'OK' }`
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK/);
});
test("production smoke script sends console token with supported headers", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "test-production-smoke.ps1"), "utf8");

  assert.match(script, /x-sas-console-token/);
  assert.match(script, /Authorization/);
  assert.match(script, /statusCode -eq 401/);
  assert.match(script, /requiere una sesion valida/);
  assert.doesNotMatch(script, /x-sas-token/);
});
