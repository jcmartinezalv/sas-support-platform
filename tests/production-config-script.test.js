import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function powershellCommand() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
}

test("prepare production config generates env and redacted report", { skip: process.platform !== "win32" }, () => {
  const root = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sas-prod-config-"));
  const envPath = path.join(tempDir, ".env.production");
  const reportPath = path.join(tempDir, "report.json");

  const result = spawnSync(powershellCommand(), [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", path.join(root, "scripts", "prepare-production-config.ps1"),
    "-ProjectDir", root,
    "-OutputEnvPath", envPath,
    "-ReportPath", reportPath,
    "-PublicBaseUrl", "https://soporte.example.com",
    "-WhatsappAccessToken", "wa-token",
    "-WhatsappPhoneNumberId", "phone-id",
    "-ShortUrlProvider", "auto",
    "-TinyUrlApiToken", "tiny-secret",
    "-BitlyAccessToken", "bitly-secret"
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const envText = fs.readFileSync(envPath, "utf8");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8").replace(/^\uFEFF/, ""));

  assert.match(envText, /PUBLIC_BASE_URL=https:\/\/soporte\.example\.com/);
  assert.match(envText, /AGENT_SHARED_SECRET=.{20,}/);
  assert.match(envText, /CONSOLE_SHARED_TOKEN=.{20,}/);
  assert.match(envText, /SHORT_URL_PROVIDER=auto/);
  assert.match(envText, /TINYURL_API_TOKEN=tiny-secret/);
  assert.match(envText, /BITLY_ACCESS_TOKEN=bitly-secret/);
  assert.match(envText, /OPENAI_ENABLED=false/);
  assert.match(envText, /OPENAI_API_KEY=/);
  assert.match(envText, /MOBILE_ACCESS_TTL_MINUTES=15/);
  assert.match(envText, /MOBILE_MAX_FAILED_ATTEMPTS=5/);
  assert.equal(report.configured.agentSharedSecret, true);
  assert.equal(report.configured.consoleSharedToken, true);
  assert.equal(report.configured.whatsappAccessToken, true);
  assert.equal(report.configured.shortUrlProvider, "auto");
  assert.equal(report.configured.tinyUrlApiToken, true);
  assert.equal(report.configured.bitlyAccessToken, true);
  assert.equal(report.configured.openAiEnabled, false);
  assert.equal(report.configured.mobileBootstrapConfigured, false);
  assert.equal(report.checks.find((check) => check.name === "public_base_url").status, "pass");
  assert.equal(JSON.stringify(report).includes("wa-token"), false);
  assert.equal(JSON.stringify(report).includes("tiny-secret"), false);
  assert.equal(JSON.stringify(report).includes("bitly-secret"), false);
});

