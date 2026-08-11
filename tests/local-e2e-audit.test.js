import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("scripts/run-local-e2e-audit.mjs", "utf8");

test("local E2E audit completes Fisher customer intake before remote support", () => {
  assert.match(source, /customer_details/);
  assert.match(source, /Fisher vincula datos del cliente con Agenda/);
  assert.match(source, /Fisher recibe el problema y prepara soporte/);
});

test("local E2E audit records unexpected flow interruptions as failures", () => {
  assert.match(source, /status: "fail"/);
  assert.match(source, /Completar flujo extremo a extremo/);
});