import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("remote install evidence script parses and cross-checks SERVER versions", { skip: process.platform !== "win32" }, () => {
  const file = path.join(process.cwd(), "scripts", "export-remote-install-evidence.ps1");
  const command = `$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|% Message;exit 1}`;
  const parsed = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);

  const source = fs.readFileSync(file, "utf8");
  for (const pattern of [
    /last-update-result\.json/,
    /stable\\manifest\.json/,
    /sas-support-platform/,
    /Version instalada/,
    /Version publicada/,
    /rolledBack/,
    /remote-install-evidence\.json/
  ]) assert.match(source, pattern);
});

test("server and Android release versions are aligned", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const gradle = fs.readFileSync(path.join(process.cwd(), "android-app", "app", "build.gradle.kts"), "utf8");
  assert.match(gradle, new RegExp(`versionName\\s*=\\s*"${pkg.version.replace(/\\./g, "\\.")}"`));
});