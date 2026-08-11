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

test("windows 11 MVP release builder parses as valid powershell", { skip: process.platform !== "win32" }, () => {
  const root = process.cwd();
  const script = path.join(root, "scripts", "build-windows11-mvp-release.ps1");
  assert.equal(fs.existsSync(script), true);

  const result = spawnSync(powershellCommand(), [
    "-NoProfile",
    "-Command",
    `$errors=$null; $tokens=[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw '${script.replaceAll("'", "''")}'), [ref]$errors); if ($errors) { $errors; exit 1 } else { 'OK' }`
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK/);
});
