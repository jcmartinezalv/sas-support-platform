import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildReleaseGate, readProductionTrafficLightHistory } from "../src/production/release-gate-service.js";

function readiness(checks) {
  return { status: "warn", mvpStatus: "warn", checks };
}

function operations(reports) {
  return { status: "warn", reports };
}

test("release gate allows clean MVP", () => {
  const gate = buildReleaseGate({
    readiness: readiness([{ key: "agent_secret", label: "Secreto agente", tier: "required", status: "pass", message: "OK" }]),
    operations: operations([{ key: "smoke", label: "Smoke", required: true, status: "pass", nextAction: "OK" }]),
    now: new Date("2026-07-11T12:00:00.000Z")
  });

  assert.equal(gate.decision, "ready");
  assert.equal(gate.productionAllowed, true);
  assert.equal(gate.mvpAllowed, true);
  assert.equal(gate.nextActions.length, 0);
});

test("release gate blocks required readiness failures", () => {
  const gate = buildReleaseGate({
    readiness: readiness([{ key: "agent_secret", label: "Secreto agente", tier: "required", status: "fail", message: "Cambiar secreto" }]),
    operations: operations([])
  });

  assert.equal(gate.decision, "blocked");
  assert.equal(gate.productionAllowed, false);
  assert.equal(gate.mvpAllowed, false);
  assert.equal(gate.blockers[0].owner, "Administrador SAS");
  assert.match(gate.blockers[0].command, /prepare-production-config/);
});

test("release gate allows MVP with optional operation warnings", () => {
  const gate = buildReleaseGate({
    readiness: readiness([{ key: "agent_secret", label: "Secreto agente", tier: "required", status: "pass", message: "OK" }]),
    operations: operations([{ key: "task", label: "Tarea programada", required: false, status: "fail", nextAction: "Verificar tarea" }])
  });

  assert.equal(gate.decision, "ready_with_warnings");
  assert.equal(gate.productionAllowed, true);
  assert.equal(gate.mvpAllowed, true);
  assert.equal(gate.warnings[0].owner, "Administrador Windows");
  assert.equal(gate.warnings[0].severity, "Baja");
});

test("package exposes release gate export command", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8").replace(/^\uFEFF/, ""));
  assert.equal(pkg.scripts["release:gate"], "node scripts/export-release-gate.mjs");
  assert.equal(pkg.scripts["semaforo:produccion"], "node scripts/export-release-gate.mjs");
  assert.equal(fs.existsSync(path.join(process.cwd(), "scripts", "export-release-gate.mjs")), true);
  const exporter = fs.readFileSync(path.join(process.cwd(), "scripts", "export-release-gate.mjs"), "utf8");
  assert.match(exporter, /semaforo-produccion-history\.json/);
  assert.match(exporter, /semaforo-produccion-history\.md/);
});



test("production traffic light history reads recent entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sas-traffic-"));
  const outputDir = path.join(root, "output");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "semaforo-produccion-history.json"), JSON.stringify([
    { generatedAt: "2026-07-11T12:00:00.000Z", decision: "ready", label: "Verde", productionAllowed: true },
    { generatedAt: "2026-07-10T12:00:00.000Z", decision: "ready_with_warnings", label: "Amarillo", productionAllowed: true }
  ]));

  const history = readProductionTrafficLightHistory({ projectRoot: root, limit: 1 });

  assert.equal(history.length, 1);
  assert.equal(history[0].decision, "ready");
});
