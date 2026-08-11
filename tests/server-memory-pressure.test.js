import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createAuditStore } from "../src/audit/audit-store.js";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8").replace(/^\uFEFF/, "");

test("audit history remains bounded under high-frequency support activity", () => {
  let persisted = [];
  const store = createAuditStore({ maxEvents: 100, onChange: (events) => { persisted = [...events]; } });
  for (let index = 0; index < 250; index += 1) store.record({ action: "remote.input", entityType: "remote_session", metadata: { index } });
  assert.equal(store.list(0).length, 100);
  assert.equal(persisted.length, 100);
  assert.equal(persisted[0].metadata.index, 249);
});

test("keyboard and mouse delivery stays transient instead of rewriting the database", () => {
  let persistenceWrites = 0;
  const store = createRemoteSessionStore({ onChange: () => { persistenceWrites += 1; } });
  const session = store.create({ ticketId: "TCK-MEMORY", requestedBy: "operator" });
  store.assignAgent(session.id, "agent-1");
  store.approveConsent(session.joinCode, { decidedBy: "customer" });
  store.start(session.id, "operator");
  store.requestControl(session.id, "operator");
  store.decideControl(session.joinCode, "approved", { decidedBy: "customer" });
  const beforeInput = persistenceWrites;
  const event = store.queueInteractiveEvent(session.id, { type: "mouse_move", requestedBy: "operator", payload: { relativeX: 0.5, relativeY: 0.5 } });
  store.completeInteractiveEvent(session.id, event.id, { ok: true, data: { simulated: false } });
  assert.equal(persistenceWrites, beforeInput);
  assert.equal(store.get(session.id).interactiveEvents.find((item) => item.id === event.id).status, "completed");
});

test("server responses and browser refresh loops are bounded", () => {
  const http = read("src", "shared", "http.js");
  const server = read("src", "server.js");
  const app = read("public", "app.js");
  const workspace = read("public", "remote-workspace.html");
  const agent = read("client", "agent-client.js");
  assert.match(http, /JSON\.stringify\(payload\)/);
  assert.doesNotMatch(http, /JSON\.stringify\(payload, null, 2\)/);
  assert.match(server, /remoteSessionStore\.list\(\)\.map\(operatorRemoteSession\)/);
  assert.match(server, /screenShare: \{ \.\.\.session\.screenShare, lastFrame: null \}/);
  assert.match(server, /items\.filter[\s\S]*slice\(-50\)/);
  assert.match(app, /dataRefreshPromise/);
  assert.match(app, /if \(state\.dataRefreshPromise\) return state\.dataRefreshPromise/);
  assert.doesNotMatch(app, /isLiveRemoteView\(\)\) refresh\(\)[\s\S]*2000/);
  assert.match(workspace, /workspaceRefreshInFlight/);
  assert.match(workspace, /frameRefreshInFlight/);
  assert.match(workspace, /rtcSignalInFlight/);
  assert.match(workspace, /fetchTimed/);
  assert.match(workspace, /\/api\/tickets\/'\+encodeURIComponent\(session\.ticketId\)/);
  assert.match(agent, /if \(!pollPromise\) \{[\s\S]*const tracked = poll\(\)\.finally/);
  assert.match(agent, /if \(pollPromise === tracked\) pollPromise = null/);
});
