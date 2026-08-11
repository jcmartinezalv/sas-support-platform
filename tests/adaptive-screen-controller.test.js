import test from "node:test";
import assert from "node:assert/strict";
import { adaptiveScreenPlan, createAdaptiveScreenState, recordScreenCapture } from "../client/adaptive-screen-controller.js";

test("adaptive screen controller reduces load immediately under backpressure", () => {
  const state = createAdaptiveScreenState(1000);
  const plan = adaptiveScreenPlan(state, { bufferedBytes: 230 * 1024, requestedQuality: 80, requestedMaxWidth: 2560, now: 1100 });
  assert.equal(plan.skipCapture, true);
  assert.ok(plan.intervalMs >= 110);
  assert.ok(plan.quality <= 56);
  assert.ok(plan.maxWidth <= 1440);
});

test("adaptive screen controller recovers gradually after stable samples", () => {
  const state = createAdaptiveScreenState(0);
  state.level = 3;
  state.lastAdjustedAt = 0;
  let plan;
  for (let index = 0; index < 12; index += 1) plan = adaptiveScreenPlan(state, { bufferedBytes: 0, captureMs: 25, now: 2000 + index * 100 });
  assert.equal(plan.level, 2);
  assert.equal(plan.mode, "constrained");
});

test("native resolution is preserved while quality and cadence adapt", () => {
  const state = createAdaptiveScreenState();
  state.level = 3;
  const plan = adaptiveScreenPlan(state, { nativeResolution: true, requestedMaxWidth: 3840, requestedQuality: 90 });
  assert.equal(plan.maxWidth, 3840);
  assert.equal(plan.quality, 45);
});

test("capture telemetry counts sent and discarded frames", () => {
  const state = createAdaptiveScreenState();
  recordScreenCapture(state, { captureMs: 40, bytes: 100000, sent: true });
  recordScreenCapture(state, { captureMs: 80, bytes: 140000, sent: false });
  assert.equal(state.captures, 2);
  assert.equal(state.sentFrames, 1);
  assert.equal(state.droppedFrames, 1);
  assert.equal(state.consecutiveDrops, 1);
  assert.ok(state.captureMsAverage > 40 && state.captureMsAverage < 80);
});
