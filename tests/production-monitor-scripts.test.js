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

test("production monitor scripts parse as valid powershell", { skip: process.platform !== "win32" }, () => {
  assertParses("monitor-production.ps1");
  assertParses("restart-production-task.ps1");
});

test("production monitor can report and optionally restart on fail", () => {
  const monitor = fs.readFileSync(path.join(process.cwd(), "scripts", "monitor-production.ps1"), "utf8");
  const restart = fs.readFileSync(path.join(process.cwd(), "scripts", "restart-production-task.ps1"), "utf8");

  assert.match(monitor, /get-production-status\.ps1/);
  assert.match(monitor, /RestartOnFail/);
  assert.match(monitor, /RemoteOnly/);
  assert.match(monitor, /no puede reiniciar una tarea de otra maquina/);
  assert.match(monitor, /production-monitor-report\.json/);
  assert.match(monitor, /restart-production-task\.ps1/);
  assert.match(restart, /Stop-ScheduledTask/);
  assert.match(restart, /Start-ScheduledTask/);
  assert.match(restart, /production-restart-report\.json/);
});
