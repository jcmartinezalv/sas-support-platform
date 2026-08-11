import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";

function activeSession() {
  const store = createRemoteSessionStore({ security: { ttlMinutes: 5 } });
  const created = store.create({ ticketId: "TCK-LONG", requestedBy: "operator", agentId: "agent-long" });
  store.approveConsent(created.joinCode, { decidedBy: "customer", allowControl: true });
  store.start(created.id, "operator");
  return { store, session: store.get(created.id) };
}

test("remote support has no time expiration and closes only explicitly", () => {
  const { store, session } = activeSession();
  assert.equal(session.expiresAt, null);
  assert.equal(session.status, "active");
  assert.equal(store.get(session.id).status, "active");
  assert.equal(store.close(session.id, "operator").status, "closed");
});

test("legacy sessions expired only by TTL are restored during startup", () => {
  const { session } = activeSession();
  const legacy = structuredClone(session);
  legacy.status = "expired";
  legacy.expiresAt = "2020-01-01T00:00:00.000Z";
  legacy.endedAt = "2020-01-01T00:00:00.000Z";
  legacy.security.lockedReason = "session_expired";
  const restored = createRemoteSessionStore({ initialSessions: [legacy] }).get(legacy.id);
  assert.equal(restored.status, "active");
  assert.equal(restored.expiresAt, null);
  assert.equal(restored.endedAt, null);
  assert.equal(restored.security.lockedReason, null);
});

test("an unattended prompt timeout does not reject the support session", () => {
  const { store, session } = activeSession();
  const requested = store.requestUnattended(session.id, { requestedBy: "operator" });
  const pending = structuredClone(requested);
  pending.unattendedRequest.expiresAt = "2020-01-01T00:00:00.000Z";
  const restoredStore = createRemoteSessionStore({ initialSessions: [pending] });
  const restored = restoredStore.get(pending.id);
  assert.equal(restored.status, "active");
  assert.equal(restored.consent.decision, "approved");
  assert.equal(restored.unattendedRequest.decision, "rejected");
  assert.equal(restored.unattendedRequest.reason, "request_expired");
});