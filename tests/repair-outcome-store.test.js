import test from "node:test";
import assert from "node:assert/strict";
import { createRepairOutcomeStore } from "../src/repairs/repair-outcome-store.js";

test("repair outcome store records simulated and executed outcomes", () => {
  const persisted = [];
  const store = createRepairOutcomeStore({ onChange: (items) => persisted.push(items) });

  const simulated = store.record({
    ticketId: "TCK-1",
    sessionId: "RMT-1",
    command: {
      id: "CMD-1",
      status: "completed",
      repairAction: { id: "flush_dns", title: "Limpiar cache DNS", risk: "low" }
    },
    result: { ok: true, data: { simulated: true, skippedReason: "repair_actions_disabled" } }
  });
  const executed = store.record({
    ticketId: "TCK-1",
    sessionId: "RMT-1",
    command: {
      id: "CMD-2",
      status: "completed",
      repairAction: { id: "flush_dns", title: "Limpiar cache DNS", risk: "low" }
    },
    result: { ok: true, data: { simulated: false } }
  });

  assert.equal(simulated.status, "simulated");
  assert.equal(executed.status, "executed");
  assert.equal(persisted.at(-1).length, 2);
  assert.equal(store.summary()[0].actionId, "flush_dns");
  assert.equal(store.summary()[0].successRate, 0.5);
});

test("repair outcome store records failed outcomes", () => {
  const store = createRepairOutcomeStore();
  const failed = store.record({
    ticketId: "TCK-1",
    sessionId: "RMT-1",
    command: {
      id: "CMD-3",
      status: "failed",
      error: "access_denied",
      repairAction: { id: "restart_print_spooler", title: "Reiniciar cola", risk: "medium" }
    },
    result: { ok: false, error: "access_denied" }
  });

  assert.equal(failed.status, "failed");
  assert.equal(store.summary()[0].failed, 1);
});

test("repair outcome store confirms human resolution feedback", () => {
  const store = createRepairOutcomeStore();
  const outcome = store.record({
    ticketId: "TCK-1",
    sessionId: "RMT-1",
    command: {
      id: "CMD-4",
      status: "completed",
      repairAction: { id: "flush_dns", title: "Limpiar cache DNS", risk: "low" }
    },
    result: { ok: true, data: { simulated: false } }
  });

  const confirmed = store.confirm(outcome.id, { resolution: "resolved", note: "Cliente navega bien", resolvedBy: "tech-1" });
  const summary = store.summary()[0];

  assert.equal(confirmed.resolution, "resolved");
  assert.equal(confirmed.resolvedBy, "tech-1");
  assert.equal(summary.confirmedResolved, 1);
  assert.equal(summary.resolutionRate, 1);
});
