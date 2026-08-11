import test from "node:test";
import assert from "node:assert/strict";
import { applyOutcomeLearning, scoreRepairActionFromOutcomes } from "../src/agent/repair-learning-score.js";

test("repair learning promotes actions with real success history", () => {
  const score = scoreRepairActionFromOutcomes(
    { id: "flush_dns", matchScore: 4 },
    { actionId: "flush_dns", executed: 3, failed: 0, simulated: 2, total: 5 }
  );

  assert.equal(score.confidenceSignal, "promote");
  assert.ok(score.adjustment > 0);
  assert.ok(score.effectiveScore > 4);
});

test("repair learning degrades actions with repeated failures", () => {
  const score = scoreRepairActionFromOutcomes(
    { id: "renew_ip", matchScore: 6 },
    { actionId: "renew_ip", executed: 0, failed: 3, simulated: 0, total: 3 }
  );

  assert.equal(score.confidenceSignal, "degrade");
  assert.ok(score.adjustment < 0);
  assert.ok(score.effectiveScore < 6);
});

test("repair learning sorts actions by effective score", () => {
  const actions = applyOutcomeLearning([
    { id: "renew_ip", matchScore: 7, outcomeStats: { actionId: "renew_ip", executed: 0, failed: 3, simulated: 0, total: 3 } },
    { id: "flush_dns", matchScore: 4, outcomeStats: { actionId: "flush_dns", executed: 3, failed: 0, simulated: 0, total: 3 } }
  ]);

  assert.equal(actions[0].id, "flush_dns");
  assert.equal(actions[0].learningAdjustment.confidenceSignal, "promote");
});

test("repair learning prioritizes confirmed human resolution over execution status", () => {
  const score = scoreRepairActionFromOutcomes(
    { id: "flush_dns", matchScore: 4 },
    { actionId: "flush_dns", executed: 1, failed: 1, simulated: 0, total: 2, confirmedResolved: 3, confirmedUnresolved: 0 }
  );

  assert.equal(score.confidenceSignal, "confirmed_promote");
  assert.ok(score.adjustment > 3);
});

test("repair learning degrades confirmed unresolved outcomes", () => {
  const score = scoreRepairActionFromOutcomes(
    { id: "flush_dns", matchScore: 7 },
    { actionId: "flush_dns", executed: 3, failed: 0, simulated: 0, total: 3, confirmedResolved: 0, confirmedUnresolved: 3 }
  );

  assert.equal(score.confidenceSignal, "confirmed_degrade");
  assert.ok(score.adjustment < 0);
});
