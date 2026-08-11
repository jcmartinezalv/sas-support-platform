import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProductionReadiness } from "../src/production/readiness-service.js";

function baseConfig(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sas-readiness-"));
  const tlsKeyPath = path.join(root, "server.key");
  const tlsCertPath = path.join(root, "server.crt");
  fs.writeFileSync(tlsKeyPath, "key");
  fs.writeFileSync(tlsCertPath, "cert");
  return {
    publicBaseUrl: "https://soporte.example.com",
    enableHttps: true,
    httpsPort: 443,
    tlsKeyPath,
    tlsCertPath,
    agentSharedSecret: "secret-real",
    consoleSharedToken: "console-token-real",
    whatsappVerifyToken: "verify-real",
    whatsappAccessToken: "token-real",
    whatsappPhoneNumberId: "phone-real",
    whatsappAppSecret: "app-secret-real",
    remoteSessionTtlMinutes: 60,
    remoteConsentMaxAttempts: 5,
    remoteControlMaxAttempts: 5,
    googleAiEnabled: true,
    googleAiMock: false,
    googleAiRequireReview: true,
    geminiApiKey: "gemini-key",
    ...overrides
  };
}

test("production readiness passes when required production settings exist", () => {
  const readiness = buildProductionReadiness({
    config: baseConfig(),
    storageStatus: { exists: true, backupCount: 2, filePath: "data/sas-db.json", backupDir: "data/backups", size: 1000 },
    agents: [{ id: "agent-1", status: "online" }],
    preflightReport: { status: "pass", generatedAt: new Date().toISOString() },
    knowledgeArticles: [{ id: "KB-1", status: "approved" }],
    repairOutcomeSummary: [{ actionId: "flush_dns", confirmedResolved: 2, confirmedUnresolved: 0, resolutionRate: 1 }]
  });

  assert.equal(readiness.status, "pass");
  assert.equal(readiness.summary.fail, 0);
  assert.equal(readiness.summary.warn, 0);
  assert.equal(readiness.percent, 100);
  assert.equal(readiness.mvpStatus, "pass");
  assert.equal(readiness.mvpPercent, 100);
  assert.equal(readiness.tiers.required.fail, 0);
  assert.deepEqual(readiness.nextSteps, []);
});

test("production readiness flags local defaults and missing secrets", () => {
  const readiness = buildProductionReadiness({
    config: baseConfig({
      publicBaseUrl: "https://localhost",
      enableHttps: false,
      agentSharedSecret: "change-agent-secret",
      consoleSharedToken: "",
      whatsappVerifyToken: "change-me",
      whatsappAccessToken: "",
      whatsappPhoneNumberId: "",
      googleAiEnabled: false
    }),
    storageStatus: { exists: true, backupCount: 0, filePath: "data/sas-db.json", backupDir: "data/backups", size: 1000 },
    agents: [],
    preflightReport: null
  });

  assert.equal(readiness.status, "fail");
  assert.ok(readiness.summary.fail >= 2);
  assert.ok(readiness.summary.warn >= 1);
  assert.ok(readiness.nextActions.some((action) => action.includes("PUBLIC_BASE_URL")));
  assert.ok(readiness.nextSteps.some((step) => step.title === "Publicar dominio HTTPS"));
  assert.ok(readiness.nextSteps.every((step) => step.owner && step.priority && step.action));
  assert.equal(readiness.mvpStatus, "fail");
  assert.ok(readiness.checks.some((check) => check.tier === "required" && check.blocking));
});



test("production readiness warns when Fisher learning has no confirmed signals", () => {
  const readiness = buildProductionReadiness({
    config: baseConfig(),
    storageStatus: { exists: true, backupCount: 2, filePath: "data/sas-db.json", backupDir: "data/backups", size: 1000 },
    agents: [{ id: "agent-1", status: "online" }],
    preflightReport: { status: "pass", generatedAt: new Date().toISOString() },
    knowledgeArticles: [],
    repairOutcomeSummary: []
  });

  const learning = readiness.checks.find((item) => item.key === "fisher_learning");

  assert.equal(readiness.status, "warn");
  assert.equal(learning.status, "warn");
  assert.equal(learning.details.confirmedResolved, 0);
  assert.ok(readiness.nextSteps.some((step) => step.title === "Alimentar aprendizaje Fisher"));
});
test("production readiness mvp stays pass with only recommended and optional warnings", () => {
  const readiness = buildProductionReadiness({
    config: baseConfig({
      whatsappAccessToken: "",
      whatsappPhoneNumberId: "",
      googleAiEnabled: false
    }),
    storageStatus: { exists: true, backupCount: 2, filePath: "data/sas-db.json", backupDir: "data/backups", size: 1000 },
    agents: [],
    preflightReport: null,
    knowledgeArticles: [],
    repairOutcomeSummary: []
  });

  assert.equal(readiness.status, "warn");
  assert.equal(readiness.mvpStatus, "pass");
  assert.equal(readiness.mvpPercent, 100);
  assert.equal(readiness.tiers.required.fail, 0);
  assert.ok(readiness.tiers.recommended.warn >= 1);
  assert.ok(readiness.nextSteps.every((step) => step.priority !== "Alta"));
});
test("mobile identity readiness distinguishes optional, incomplete and configured states", () => {
  const base = { config: baseConfig(), storageStatus: { exists: true, backupCount: 2, filePath: "data/sas-db.json", backupDir: "data/backups", size: 1000 }, agents: [{ id: "agent-1", status: "online" }], preflightReport: { status: "pass", generatedAt: new Date().toISOString() }, knowledgeArticles: [{ id: "KB-1", status: "approved" }], repairOutcomeSummary: [{ actionId: "flush_dns", confirmedResolved: 2, confirmedUnresolved: 0, resolutionRate: 1 }] };
  const optional = buildProductionReadiness({ ...base, mobileIdentity: { users: [], devices: [], sessions: [] } });
  assert.equal(optional.checks.find((item) => item.key === "mobile_identity").status, "pass");
  const incomplete = buildProductionReadiness({ ...base, config: { ...base.config, mobileBootstrapUsername: "admin", mobileBootstrapPassword: "" }, mobileIdentity: { users: [], devices: [], sessions: [] } });
  assert.equal(incomplete.checks.find((item) => item.key === "mobile_identity").status, "warn");
  const configured = buildProductionReadiness({ ...base, mobileIdentity: { users: [{ id: "M1" }], devices: [{ id: "D1" }], sessions: [] } });
  assert.equal(configured.checks.find((item) => item.key === "mobile_identity").status, "pass");
});


