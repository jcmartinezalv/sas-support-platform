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

function assertParses(scriptName) {
  const root = process.cwd();
  const script = path.join(root, "scripts", scriptName);
  assert.equal(fs.existsSync(script), true);
  const result = spawnSync(powershellCommand(), [
    "-NoProfile",
    "-Command",
    `$errors=$null; $tokens=[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw '${script.replaceAll("'", "''")}'), [ref]$errors); if ($errors) { $errors; exit 1 } else { 'OK' }`
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK/);
}

test("production task verification scripts parse as valid powershell", { skip: process.platform !== "win32" }, () => {
  assertParses("verify-production-task.ps1");
  assertParses("verify-production-task-elevated.ps1");
});

test("production task verification checks scheduler, manifest and local status", () => {
  const verifier = fs.readFileSync(path.join(process.cwd(), "scripts", "verify-production-task.ps1"), "utf8");
  const elevated = fs.readFileSync(path.join(process.cwd(), "scripts", "verify-production-task-elevated.ps1"), "utf8");

  assert.match(verifier, /Get-ScheduledTask/);
  assert.match(verifier, /task_recovery_settings/);
  assert.match(verifier, /ExecutionTimeLimit/);
  assert.match(verifier, /RestartCount/);
  assert.match(verifier, /StartWhenAvailable/);
  assert.match(verifier, /recoveryTriggerEveryMinute/);
  assert.match(verifier, /Repetition\.Interval/);
  assert.match(verifier, /schtasks\.exe/);
  assert.match(verifier, /Schedule\.Service/);
  assert.match(verifier, /install-manifest\.json/);
  assert.match(verifier, /production-task-verification\.json/);
  assert.match(elevated, /-Verb RunAs/);
  assert.match(elevated, /verify-production-task\.ps1/);
});
