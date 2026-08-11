import test from "node:test";
import assert from "node:assert/strict";
import { runOfflineSimulations } from "../src/agent/offline-simulation-service.js";

test("offline Fisher simulations validate common support categories", async () => {
  const report = await runOfflineSimulations();
  assert.equal(report.mode, "offline_in_memory");
  assert.equal(report.summary.status, "pass");
  assert.equal(report.summary.percent, 100);
  assert.deepEqual(report.results.map((item) => item.id), ["internet", "email", "printer", "performance", "software", "account", "security", "remote"]);
  assert.ok(report.results.every((item) => item.status === "pass"));
});

test("offline Fisher simulations report expectation failures without stopping the suite", async () => {
  const report = await runOfflineSimulations({ scenarios: [{ id: "mismatch", text: "No imprime", expectedCategory: "email", expectedRemote: false }] });
  assert.equal(report.summary.status, "fail");
  assert.equal(report.results[0].status, "fail");
  assert.ok(report.results[0].failedChecks.includes("category"));
  assert.match(report.nextActions[0], /mismatch/);
});
test("offline Fisher simulation validates safe remote lifecycle commands", async () => {
  const report = await runOfflineSimulations();
  const remote = report.results.find((item) => item.id === "remote");
  assert.equal(remote.status, "pass");
  assert.equal(remote.artifacts.lifecycle.sessionAfterCancel, "closed");
  assert.equal(remote.artifacts.lifecycle.ticketAfterCancel, "waiting_customer");
  assert.equal(remote.artifacts.lifecycle.ticketAfterClose, "resolved");
  assert.ok(remote.checks.some((item) => item.id === "remote_link_reused" && item.status === "pass"));
});

