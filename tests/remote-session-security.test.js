import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";

function createApprovedActiveSession() {
  const store = createRemoteSessionStore({ security: { ttlMinutes: 60 } });
  const session = store.create({ ticketId: "TCK-1", requestedBy: "test", customerPhone: "5215550000000" });
  store.assignAgent(session.id, "agent-1");
  store.approveConsent(session.joinCode, { decidedBy: "customer" });
  store.start(session.id, "operator");
  return { store, session: store.get(session.id) };
}

function assertConflict(fn, messagePattern) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, 409);
    assert.match(error.message, messagePattern);
    return true;
  });
}

test("does not start remote session without customer consent", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-1", requestedBy: "test" });
  store.assignAgent(session.id, "agent-1");

  assertConflict(() => store.start(session.id, "operator"), /consent is required/i);
});

test("does not queue remote commands before customer consent", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-1", requestedBy: "test" });
  store.assignAgent(session.id, "agent-1");

  assertConflict(() => store.queueCommand(session.id, { type: "system_info", requestedBy: "operator" }), /consent is required/i);
});

test("one customer authorization enables the complete remote support scope", () => {
  const { store, session } = createApprovedActiveSession();
  const event = store.queueInteractiveEvent(session.id, {
    type: "key_press",
    requestedBy: "operator",
    payload: { key: "Enter" }
  });
  assert.equal(session.controlConsent.decision, "approved");
  assert.deepEqual({ screen: session.permissions.screen, input: session.permissions.input, uac: session.permissions.uac, clipboard: session.permissions.clipboard, files: session.permissions.files }, { screen: true, input: true, uac: true, clipboard: true, files: true });
  assert.equal(event.status, "queued");
});

test("closing a session cancels queued commands and interactive events", () => {
  const { store, session } = createApprovedActiveSession();
  store.requestControl(session.id, "operator");
  store.decideControl(session.joinCode, "approved", { decidedBy: "customer" });
  const command = store.queueCommand(session.id, { type: "system_info", requestedBy: "operator" });
  const event = store.queueInteractiveEvent(session.id, {
    type: "key_press",
    requestedBy: "operator",
    payload: { key: "Enter" }
  });

  const closed = store.close(session.id, "operator");
  const closedCommand = closed.commands.find((item) => item.id === command.id);
  const closedEvent = closed.interactiveEvents.find((item) => item.id === event.id);

  assert.equal(closed.status, "closed");
  assert.equal(closedCommand.status, "cancelled");
  assert.equal(closedCommand.error, "session_closed");
  assert.equal(closedEvent.status, "cancelled");
  assert.equal(closedEvent.error, "session_closed");
  assert.equal(closed.controlConsent.decision, "revoked");
});

test("rejecting control cancels queued interactive events", () => {
  const { store, session } = createApprovedActiveSession();
  store.requestControl(session.id, "operator");
  store.decideControl(session.joinCode, "approved", { decidedBy: "customer" });
  const event = store.queueInteractiveEvent(session.id, {
    type: "key_press",
    requestedBy: "operator",
    payload: { key: "Enter" }
  });

  const updated = store.decideControl(session.joinCode, "rejected", { decidedBy: "customer" });
  const cancelledEvent = updated.interactiveEvents.find((item) => item.id === event.id);

  assert.equal(updated.controlConsent.decision, "rejected");
  assert.equal(cancelledEvent.status, "cancelled");
  assert.equal(cancelledEvent.error, "control_rejected");
});

test("completed interactive event keeps simulated status for safe mode", () => {
  const { store, session } = createApprovedActiveSession();
  store.requestControl(session.id, "operator");
  store.decideControl(session.joinCode, "approved", { decidedBy: "customer" });
  const event = store.queueInteractiveEvent(session.id, {
    type: "key_press",
    requestedBy: "operator",
    payload: { key: "Enter" }
  });

  const { event: completed } = store.completeInteractiveEvent(session.id, event.id, {
    ok: true,
    data: { simulated: true, type: "key_press", receivedAt: new Date().toISOString() }
  });

  assert.equal(completed.status, "simulated");
  assert.equal(completed.result.simulated, true);
});

test("completed interactive event marks real helper execution distinctly", () => {
  const { store, session } = createApprovedActiveSession();
  store.requestControl(session.id, "operator");
  store.decideControl(session.joinCode, "approved", { decidedBy: "customer" });
  const event = store.queueInteractiveEvent(session.id, {
    type: "key_press",
    requestedBy: "operator",
    payload: { key: "Enter" }
  });

  const { event: completed } = store.completeInteractiveEvent(session.id, event.id, {
    ok: true,
    data: {
      simulated: false,
      executed: true,
      helper: "SasInputHelper.exe",
      helperMessage: "key pressed",
      executedAt: new Date().toISOString()
    }
  });

  assert.equal(completed.status, "completed");
  assert.equal(completed.result.simulated, false);
  assert.equal(completed.result.executed, true);
  assert.equal(completed.result.helper, "SasInputHelper.exe");
});
test("mouse movement is coalesced so clicks are never starved", () => {
  const { store, session } = createApprovedActiveSession();
  store.requestControl(session.id, "operator");
  store.decideControl(session.joinCode, "approved", { decidedBy: "customer" });
  for (let index = 0; index < 25; index += 1) store.queueInteractiveEvent(session.id, { type: "mouse_move", requestedBy: "operator", payload: { relativeX: index / 25, relativeY: index / 25 } });
  const click = store.queueInteractiveEvent(session.id, { type: "mouse_click", requestedBy: "operator", payload: { relativeX: 0.5, relativeY: 0.5, button: "left" } });
  for (let index = 0; index < 25; index += 1) store.queueInteractiveEvent(session.id, { type: "mouse_move", requestedBy: "operator", payload: { relativeX: index / 25, relativeY: index / 25 } });
  const queued = store.get(session.id).interactiveEvents.filter((event) => event.status === "queued");
  assert.equal(queued.filter((event) => event.type === "mouse_move").length, 1);
  assert.equal(queued.some((event) => event.id === click.id && event.type === "mouse_click"), true);
});

test("unattended device policy authorizes viewing without silently granting control", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-FAST-1", requestedBy: "admin", agentId: "agent-fast" });
  const authorized = store.authorizeUnattended(session.id, { authorizedBy: "admin", allowControl: false });

  assert.equal(authorized.accessMode, "unattended");
  assert.equal(authorized.consent.decision, "approved");
  assert.equal(authorized.consent.required, false);
  assert.equal(authorized.controlConsent.decision, "not_requested");
  store.start(session.id, "admin");
  assert.doesNotThrow(() => store.queueCommand(session.id, { type: "system_info", requestedBy: "admin" }));
  assertConflict(() => store.queueInteractiveEvent(session.id, { type: "key_press", requestedBy: "admin", payload: { key: "Enter" } }), /control consent is required/i);
});

test("unattended control is granted only when the local device policy explicitly allows it", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-FAST-2", requestedBy: "admin", agentId: "agent-fast" });
  const authorized = store.authorizeUnattended(session.id, { authorizedBy: "admin", allowControl: true });
  store.start(session.id, "admin");

  assert.equal(authorized.controlConsent.decision, "approved");
  assert.equal(authorized.controlConsent.required, false);
  assert.doesNotThrow(() => store.queueInteractiveEvent(session.id, { type: "key_press", requestedBy: "admin", payload: { key: "Enter" } }));
});
test("unattended request must be approved by the matching SAS Client request", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-LOCAL-1", requestedBy: "admin", agentId: "agent-local" });
  const requested = store.requestUnattended(session.id, { requestedBy: "admin" });
  assert.equal(requested.status, "pending_unattended_authorization");
  assert.equal(requested.unattendedRequest.decision, "pending");
  assert.throws(() => store.authorizeUnattended(session.id, { requestId: "UAR-WRONG", allowControl: true }), /does not match/);
  const authorized = store.authorizeUnattended(session.id, { requestId: requested.unattendedRequest.id, allowControl: true });
  assert.equal(authorized.unattendedRequest.decision, "approved");
  assert.equal(authorized.controlConsent.decision, "approved");
});

test("SAS Client can reject an unattended request without opening the screen", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-LOCAL-2", requestedBy: "admin", agentId: "agent-local" });
  const requested = store.requestUnattended(session.id, { requestedBy: "admin" });
  const rejected = store.rejectUnattended(session.id, { requestId: requested.unattendedRequest.id, reason: "local_policy_unavailable" });
  assert.equal(rejected.status, "consent_rejected");
  assert.equal(rejected.consent.decision, "rejected");
  assert.equal(rejected.screenShare.enabled, false);
});