import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAgentStore } from "../src/agents/agent-store.js";

const client = fs.readFileSync("client/agent-client.js", "utf8");
const tray = fs.readFileSync("scripts/sas-client-tray.ps1", "utf8");
const workspace = fs.readFileSync("public/remote-workspace.html", "utf8");
const turn = fs.readFileSync("src/turn/turn-service.js", "utf8");
const turnInstaller = fs.readFileSync("scripts/install-sas-turn-service.ps1", "utf8");
const administrator = fs.readFileSync("tools/sas-admin-console/SasAdminConsole.cs", "utf8");

test("unattended password enables automatic local approval without exposing the password", () => {
  assert.match(client, /localPolicy.enabled === true && localPolicy.autoApprove !== false/);
  assert.match(client, /autoApprove: input.autoApprove !== false/);
  assert.match(tray, /autorizar. el acceso/i);

  const store = createAgentStore();
  store.register({ machineId: "agent-auto", hostname: "PC-AUTO" });
  const configured = store.configureUnattended("agent-auto", { enabled: true, autoApprove: true, allowControl: true, password: "never-store-this" });
  assert.equal(configured.unattendedAccess.autoApprove, true);
  assert.equal(configured.unattendedAccess.allowControl, true);
  assert.equal(configured.unattendedAccess.password, undefined);
});

test("TURN follows public DNS changes and preserves the active mapping on lookup failure", () => {
  assert.match(turn, /PUBLIC_BASE_URL/);
  assert.equal(turn.includes("dns.resolve4(publicHost)"), true);
  assert.equal(turn.includes("writeExternalMapping(mapping)"), true);
  assert.match(turn, /preservedCurrentConfiguration: true/);
  assert.equal(turn.includes("ip-monitor.json"), true);
  assert.match(turnInstaller, /SAS_TURN_EXTERNAL_IP_MODE/);
  assert.match(turnInstaller, /SAS_TURN_IP_REFRESH_SECONDS/);
  assert.match(administrator, /InspectTurnIpMonitor/);
});

test("antivirus activity, detections, and quarantine remain visible in remote support", () => {
  for (const marker of ["recordSecurityActivity", "recentScans", "detectionHistory", "readQuarantineHistory", "realtime_scan"]) assert.match(client, new RegExp(marker));
  assert.match(workspace, /id="antivirusBadge"/);
  assert.match(workspace, /Archivos maliciosos/);
  assert.match(workspace, /Cuarentena/);
  assert.match(workspace, /security_quarantine_file/);

  const store = createAgentStore();
  store.register({ machineId: "agent-security", hostname: "PC-SECURITY" });
  store.recordInventory("agent-security", "security", {
    operation: "security_status",
    engine: "ClamAV",
    available: true,
    realtime: {
      scanned: 8,
      detections: 1,
      quarantined: 1,
      recentScans: [{ operation: "realtime_scan", status: "infected", file: "C:\\Users\\demo\\malware.exe", result: "Win.Test.EICAR" }],
      detectionHistory: [{ operation: "realtime_detection", status: "infected", originalPath: "C:\\Users\\demo\\malware.exe", result: "Win.Test.EICAR" }],
      quarantine: [{ operation: "quarantine", status: "quarantined", originalPath: "C:\\Users\\demo\\malware.exe", quarantinePath: "C:\\ProgramData\\SAS\\Quarantine\\sample.quarantine" }]
    }
  });
  const security = store.list()[0].inventory.security.latest;
  assert.equal(security.recentScans[0].status, "infected");
  assert.equal(security.detectionHistory[0].fileName, "malware.exe");
  assert.match(security.quarantine[0].quarantinePath, /Quarantine/);
});
