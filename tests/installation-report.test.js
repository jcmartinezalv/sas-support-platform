import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildInstallationReports } from "../src/production/installation-report-service.js";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test("installation reports summarize server and client checklists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sas-install-report-"));
  const server = path.join(root, "server");
  const client = path.join(root, "client");

  writeJson(path.join(server, "install-manifest.json"), {
    Product: "SAS Support Server",
    InstalledAtUtc: "2026-07-04T00:00:00.000Z",
    ConsoleTokenConfigured: true,
    GeneratedSecrets: ["AGENT_SHARED_SECRET"]
  });
  writeJson(path.join(server, "post-install-checklist.json"), {
    GeneratedAtUtc: "2026-07-04T00:00:01.000Z",
    Checks: [
      { Name: "node", Status: "pass", Message: "OK" },
      { Name: "port_443", Status: "pass", Message: "OK" }
    ]
  });
  writeJson(path.join(client, "install-manifest.json"), {
    Product: "SAS Support Client Agent",
    UnsignedRestrictedProduction: true
  });
  writeJson(path.join(client, "post-install-checklist.json"), {
    Checks: [
      { Name: "unsigned_restricted_production", Status: "pass", Message: "OK" },
      { Name: "capture_helper_disabled", Status: "pass", Message: "OK" }
    ]
  });

  const report = buildInstallationReports({ serverInstallPath: server, clientInstallPath: client });

  assert.equal(report.summary.pass, 2);
  assert.equal(report.summary.missing, 0);
  assert.equal(report.installations[0].consoleTokenConfigured, true);
  assert.deepEqual(report.installations[0].generatedSecrets, ["AGENT_SHARED_SECRET"]);
  assert.equal(report.installations[1].unsignedRestrictedProduction, true);
});

test("installation reports mark missing manifests clearly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sas-install-report-missing-"));
  const report = buildInstallationReports({ serverInstallPath: path.join(root, "server"), clientInstallPath: path.join(root, "client") });

  assert.equal(report.summary.missing, 2);
  assert.equal(report.installations[0].status, "missing");
  assert.equal(report.installations[1].exists, false);
});
