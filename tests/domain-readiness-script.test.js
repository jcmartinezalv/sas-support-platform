import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const file = path.join(process.cwd(), "scripts", "test-domain-readiness.ps1");

test("domain readiness script parses as valid powershell", { skip: process.platform !== "win32" }, () => {
  const command = "$e=$null;[Management.Automation.Language.Parser]::ParseFile('" + file.replaceAll("'", "''") + "',[ref]$null,[ref]$e)|Out-Null;if($e.Count){$e|% Message;exit 1}";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("remote domain readiness verifies SAS routing instead of assuming outbound IP", () => {
  const script = fs.readFileSync(file, "utf8");
  assert.match(script, /RemoteOnly/);
  assert.match(script, /serviceMatched/);
  assert.match(script, /sasRoutingVerified/);
  assert.match(script, /http80Reachable -and \$sasRoutingVerified/);
  assert.match(script, /multi-WAN/);
});