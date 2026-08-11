import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";

test("pairing by join code binds only the requested agent and preserves consent", () => {
  const store = createRemoteSessionStore({ security: { ttlMinutes: 60 } });
  const session = store.create({ ticketId: "TCK-PAIR", requestedBy: "Fisher", customerPhone: "5215551002000" });

  const paired = store.pairAgentByJoinCode(session.joinCode.toLowerCase(), "agent-windows-1", {
    pairedBy: "agent_local_panel",
    hostname: "PC-CLIENTE"
  });

  assert.equal(paired.agentId, "agent-windows-1");
  assert.equal(paired.status, "pending_customer_consent");
  assert.equal(paired.consent.decision, "pending");
  assert.equal(paired.pairing.pairedBy, "agent_local_panel");
  assert.equal(paired.pairing.hostname, "PC-CLIENTE");

  const repeated = store.pairAgentByJoinCode(session.joinCode, "agent-windows-1", { hostname: "PC-CLIENTE" });
  assert.equal(repeated.agentId, "agent-windows-1");
  assert.equal(store.list().length, 1);

  const approved = store.approveConsent(session.joinCode, { decidedBy: "customer" });
  assert.equal(approved.status, "active");
  assert.equal(approved.controlConsent.decision, "approved");
  assert.equal(approved.screenShare.enabled, true);
  assert.equal(store.pendingForAgent("agent-windows-1").length, 1);
  assert.equal(store.pendingForAgent("otro-agente").length, 0);
});

test("pairing refuses reassignment to a different agent", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-PAIR-2", requestedBy: "Fisher" });
  store.pairAgentByJoinCode(session.joinCode, "agent-1");

  assert.throws(
    () => store.pairAgentByJoinCode(session.joinCode, "agent-2"),
    (error) => error.statusCode === 409 && /another agent/.test(error.message)
  );
  assert.equal(store.get(session.id).agentId, "agent-1");
});

test("pairing refuses terminal sessions", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-PAIR-3", requestedBy: "Fisher" });
  store.close(session.id, "operator");

  assert.throws(
    () => store.pairAgentByJoinCode(session.joinCode, "agent-1"),
    (error) => error.statusCode === 409 && /no longer available/.test(error.message)
  );
});

test("Windows agent exposes local pairing without bypassing server authentication", () => {
  const root = process.cwd();
  const client = fs.readFileSync(path.join(root, "client", "agent-client.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");

  assert.match(client, /url\.pathname === "\/pair"/);
  assert.match(client, /id="pairForm"/);
  assert.match(client, /Permitir soporte ahora/);
  assert.match(client, /joinCode, allowControl: body\.allowControl === true/);
  assert.match(client, /Vincular por sí solo no concede acceso/);
  assert.match(client, /postJson\("\/api\/agents\/pair"/);
  assert.doesNotMatch(client, /http-equiv="refresh"/);

  assert.match(server, /url\.pathname === "\/api\/agents\/pair"/);
  assert.match(server, /assertAgentSecret\(req\)/);
  assert.match(server, /pairAgentByJoinCode/);
  assert.match(server, /remote\.pair_agent/);
  assert.match(server, /requiresConsent/);
});

