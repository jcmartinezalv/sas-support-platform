import test from "node:test";
import assert from "node:assert/strict";
import { createMobilePushOutbox } from "../src/mobile/mobile-push-outbox.js";

test("mobile push outbox queues only registered active devices and deduplicates", () => {
  const outbox = createMobilePushOutbox();
  const input = { userId: "U1", notifications: [{ id: "N1", type: "urgent_ticket", title: "Urgente", message: "Servidor" }], devices: [{ id: "D1", userId: "U1", fcmToken: "secret-token" }, { id: "D2", userId: "U1", fcmToken: null }, { id: "D3", userId: "U2", fcmToken: "other" }] };
  assert.equal(outbox.enqueue(input).queued, 1);
  assert.equal(outbox.enqueue(input).queued, 0);
  assert.equal(outbox.list()[0].status, "pending_provider");
  assert.equal(JSON.stringify(outbox.list()).includes("secret-token"), false);
});
