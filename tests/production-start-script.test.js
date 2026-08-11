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

test("production start script parses as valid powershell", { skip: process.platform !== "win32" }, () => {
  const root = process.cwd();
  const script = path.join(root, "scripts", "start-production-server.ps1");
  assert.equal(fs.existsSync(script), true);

  const result = spawnSync(powershellCommand(), [
    "-NoProfile",
    "-Command",
    `$errors=$null; $tokens=[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw '${script.replaceAll("'", "''")}'), [ref]$errors); if ($errors) { $errors; exit 1 } else { 'OK' }`
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OK/);
});

test("production start script checks ports and writes pid file", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "start-production-server.ps1"), "utf8");

  assert.match(script, /Assert-PortAvailable/);
  assert.match(script, /sas-production\.pid/);
  assert.match(script, /ENABLE_HTTP y ENABLE_HTTPS estan desactivados/);
  assert.match(script, /ENABLE_HTTP=/);
  assert.match(script, /exit \$exitCode/);
  assert.match(script, /Remove-Item -LiteralPath \$pidFile/);
});

test("production task has unlimited execution and automatic recovery", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "install-production-task.ps1"), "utf8");

  assert.match(script, /ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
  assert.match(script, /RestartCount 999/);
  assert.match(script, /RestartInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(script, /StartWhenAvailable/);
  assert.match(script, /MultipleInstances IgnoreNew/);
  assert.match(script, /-Settings \$taskSettings/);
  assert.match(script, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(script, /Trigger @\(\$taskTrigger, \$recoveryTrigger\)/);
});

test("client task has unlimited execution and automatic recovery", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "install-client.ps1"), "utf8");

  assert.match(script, /-WindowStyle Hidden/);
  assert.match(script, /ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
  assert.match(script, /RestartCount 999/);
  assert.match(script, /RestartInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(script, /StartWhenAvailable/);
  assert.match(script, /AllowStartIfOnBatteries/);
  assert.match(script, /DontStopIfGoingOnBatteries/);
  assert.match(script, /MultipleInstances IgnoreNew/);
  assert.match(script, /-Settings \$taskSettings/);
  assert.match(script, /\$recoveryTrigger = New-ScheduledTaskTrigger/);
  assert.match(script, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(script, /-Trigger @\(\$taskTrigger, \$recoveryTrigger\)/);
});
