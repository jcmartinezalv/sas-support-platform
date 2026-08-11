import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProductionOperations } from "../src/production/operation-report-service.js";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sas-ops-"));
}

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, ...relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

test("production operations summarizes available production reports", () => {
  const root = makeTempRoot();
  writeJson(root, ["output", "production-smoke-report.json"], { status: "pass", summary: { pass: 4, fail: 0 }, generatedAt: "2026-07-10T10:00:00.000Z" });
  writeJson(root, ["output", "production-monitor-report.json"], { status: "pass", message: "Local 443 saludable" });
  writeJson(root, ["output", "production-config-report.json"], { status: "pass", publicBaseUrl: "https://setinfo.sytes.net" });
  writeJson(root, ["install-manifest.json"], { Product: "SAS", InstalledAtUtc: "2026-07-10T10:01:00.000Z" });
  writeJson(root, ["post-install-checklist.json"], { Checks: [{ Name: "TLS", Status: "Pass" }, { Name: "Firewall", Status: "Pass" }] });

  const operations = buildProductionOperations({ projectRoot: root, now: new Date("2026-07-10T12:00:00.000Z") });

  assert.equal(operations.status, "warn");
  assert.equal(operations.summary.pass, 5);
  assert.equal(operations.summary.missing, 2);
  assert.equal(operations.summary.requiredPending, 0);
  assert.equal(operations.reports.find((item) => item.key === "smoke").summary, "4 correctas, 0 errores");
});

test("production operations marks required missing reports as blocking", () => {
  const root = makeTempRoot();
  writeJson(root, ["output", "production-monitor-report.json"], { status: "pass" });

  const operations = buildProductionOperations({ projectRoot: root, now: new Date("2026-07-10T12:00:00.000Z") });

  assert.equal(operations.status, "fail");
  assert.ok(operations.summary.requiredPending >= 1);
  assert.equal(operations.reports.find((item) => item.key === "smoke").status, "fail");
  assert.match(operations.nextActions[0].action, /Ejecutar/);
});

test("production operations handles corrupted json without throwing", () => {
  const root = makeTempRoot();
  const filePath = path.join(root, "output", "production-smoke-report.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "{bad json");

  const operations = buildProductionOperations({ projectRoot: root, now: new Date("2026-07-10T12:00:00.000Z") });
  const smoke = operations.reports.find((item) => item.key === "smoke");

  assert.equal(smoke.status, "fail");
  assert.match(smoke.summary, /No se pudo leer/);
});

test("production operations warns when required evidence is stale", () => {
  const root = makeTempRoot();
  writeJson(root, ["output", "production-smoke-report.json"], { status: "pass", summary: { pass: 4, fail: 0 }, generatedAt: "2026-07-01T10:00:00.000Z" });
  writeJson(root, ["output", "production-monitor-report.json"], { status: "pass", generatedAt: "2026-07-10T10:00:00.000Z" });
  writeJson(root, ["output", "production-config-report.json"], { status: "pass", generatedAt: "2026-07-10T10:00:00.000Z" });
  writeJson(root, ["install-manifest.json"], { Product: "SAS", InstalledAtUtc: "2026-07-10T10:01:00.000Z", generatedAt: "2026-07-10T10:01:00.000Z" });
  writeJson(root, ["post-install-checklist.json"], { GeneratedAtUtc: "2026-07-10T10:02:00.000Z", Checks: [{ Name: "TLS", Status: "Pass" }] });

  const operations = buildProductionOperations({ projectRoot: root, now: new Date("2026-07-10T12:00:00.000Z") });
  const smoke = operations.reports.find((item) => item.key === "smoke");

  assert.equal(smoke.status, "warn");
  assert.equal(smoke.freshness.status, "stale");
  assert.match(smoke.nextAction, /Actualizar/);
});

test("package exposes offline production operations report command", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8").replace(/^\uFEFF/, ""));
  assert.equal(pkg.scripts["ops:report"], "node scripts/export-production-operations.mjs");
  assert.equal(fs.existsSync(path.join(process.cwd(), "scripts", "export-production-operations.mjs")), true);
});



test("production operations reads windows utf8 bom json reports", () => {
  const root = makeTempRoot();
  const filePath = path.join(root, "output", "production-smoke-report.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `\uFEFF${JSON.stringify({ status: "pass", summary: { pass: 4, fail: 0 }, generatedAt: "2026-07-10T10:00:00.000Z" })}`);

  const operations = buildProductionOperations({ projectRoot: root, now: new Date("2026-07-10T12:00:00.000Z") });
  const smoke = operations.reports.find((item) => item.key === "smoke");

  assert.equal(smoke.status, "pass");
  assert.equal(smoke.summary, "4 correctas, 0 errores");
});

test("production operations action plan gives owner and command for pending reports", () => {
  const root = makeTempRoot();
  writeJson(root, ["output", "production-smoke-report.json"], { status: "pass", summary: { pass: 4, fail: 0 }, generatedAt: "2026-07-10T10:00:00.000Z" });
  writeJson(root, ["output", "production-monitor-report.json"], { status: "pass", generatedAt: "2026-07-10T10:00:00.000Z" });
  writeJson(root, ["output", "production-task-verification.json"], { status: "fail", generatedAt: "2026-07-10T10:00:00.000Z", nextAction: "Ejecutar elevado" });
  writeJson(root, ["output", "production-config-report.json"], { status: "warn", generatedAt: "2026-07-10T10:00:00.000Z", nextAction: "Revisar env" });
  writeJson(root, ["install-manifest.json"], { Product: "SAS", InstalledAtUtc: "2026-07-10T10:01:00.000Z" });
  writeJson(root, ["post-install-checklist.json"], { GeneratedAtUtc: "2026-07-10T10:02:00.000Z", Checks: [{ Name: "TLS", Status: "Pass" }] });

  const operations = buildProductionOperations({ projectRoot: root, now: new Date("2026-07-10T12:00:00.000Z") });
  const configAction = operations.actionPlan.find((item) => item.label === "Configuracion produccion");
  const taskAction = operations.actionPlan.find((item) => item.label === "Tarea programada");
  const manifest = operations.reports.find((item) => item.key === "manifest");

  assert.equal(operations.status, "warn");
  assert.equal(configAction.owner, "Administrador SAS");
  assert.match(configAction.command, /prepare-production-config/);
  assert.equal(taskAction.severity, "Media");
  assert.match(taskAction.command, /verify-production-task-elevated/);
  assert.equal(manifest.generatedAt, "2026-07-10T10:01:00.000Z");
});
test("production operations prefers newer remote SERVER evidence", () => {
  const root = makeTempRoot();
  writeJson(root, ["output", "production-smoke-report.json"], { status: "pass", generatedAt: "2026-07-18T10:00:00.000Z" });
  writeJson(root, ["output", "production-monitor-report.json"], { status: "pass", generatedAt: "2026-07-18T10:00:00.000Z" });
  writeJson(root, ["output", "production-config-report.json"], { status: "pass", generatedAt: "2026-07-18T10:00:00.000Z" });
  writeJson(root, ["install-manifest.json"], { Product: "SAS", InstalledAtUtc: "2026-07-01T10:00:00.000Z" });
  writeJson(root, ["post-install-checklist.json"], { GeneratedAtUtc: "2026-07-01T10:00:00.000Z", Checks: [] });
  writeJson(root, ["output", "remote-install-evidence.json"], {
    status: "pass",
    generatedAt: "2026-07-18T11:00:00.000Z",
    server: "SERVER",
    installedVersion: "0.2.13",
    checks: [{ name: "Version instalada", status: "pass" }]
  });

  const operations = buildProductionOperations({ projectRoot: root, now: new Date("2026-07-18T12:00:00.000Z") });
  const manifest = operations.reports.find((item) => item.key === "manifest");
  const checklist = operations.reports.find((item) => item.key === "checklist");

  assert.equal(manifest.status, "pass");
  assert.equal(manifest.summary, "SERVER actualizado 0.2.13");
  assert.match(manifest.path, /remote-install-evidence\.json$/);
  assert.equal(checklist.status, "pass");
  assert.equal(checklist.summary, "1 correctas, 0 avisos, 0 errores");
});
