import test from "node:test";
import assert from "node:assert/strict";
import { createAgentStore } from "../src/agents/agent-store.js";

const baseAgent = {
  id: "agent-1",
  machineId: "agent-1",
  hostname: "pc-demo",
  username: "usuario",
  os: "Windows_NT",
  version: "0.3.0",
  status: "online",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

test("marks agents without recent heartbeat as offline", () => {
  const oldAgent = {
    ...baseAgent,
    lastSeenAt: new Date(Date.now() - 120_000).toISOString()
  };
  const store = createAgentStore({ initialAgents: [oldAgent], staleAfterMs: 90_000 });

  const [agent] = store.list();

  assert.equal(agent.status, "offline");
  assert.equal(agent.heartbeatFresh, false);
});

test("keeps recently seen agents online", () => {
  const freshAgent = {
    ...baseAgent,
    lastSeenAt: new Date(Date.now() - 10_000).toISOString()
  };
  const store = createAgentStore({ initialAgents: [freshAgent], staleAfterMs: 90_000 });

  const [agent] = store.list();

  assert.equal(agent.status, "online");
  assert.equal(agent.heartbeatFresh, true);
});

test("heartbeat revives a stale registered agent", () => {
  const oldAgent = {
    ...baseAgent,
    lastSeenAt: new Date(Date.now() - 120_000).toISOString()
  };
  const store = createAgentStore({ initialAgents: [oldAgent], staleAfterMs: 90_000 });

  store.heartbeat({ machineId: "agent-1", hostname: "pc-demo", username: "usuario", os: "Windows_NT" });
  const [agent] = store.list();

  assert.equal(agent.status, "online");
  assert.equal(agent.heartbeatFresh, true);
});

test("register stores agent helper capabilities", () => {
  const store = createAgentStore();

  store.register({
    machineId: "agent-cap-1",
    hostname: "pc-control",
    username: "tecnico",
    os: "Windows_NT",
    version: "0.3.0",
    capabilities: {
      screenCapture: true,
      optimizedCapture: true,
      interactiveControl: true,
      webrtcSignaling: true,
      webrtcMedia: true,
      webrtcDataChannel: true,
      webrtcEngine: "libdatachannel",
      directFramePush: true,
      persistentNativeHelpers: true,
      directPointerWebRtc: true,
      capturedCursor: true,
      privilegedDesktopBroker: true,
      realInputEnabled: false,
      inputHelperAvailable: true,
      stopFileAvailable: true,
      localPanelPort: 37655,
      remoteEngine: {
        preference: "rustdesk",
        selected: "rustdesk",
        sasAvailable: true,
        rustDesk: { installed: true, localId: "123456789", observedAt: "2026-08-10T21:00:00.000Z", executablePath: "C:\\secret\\RustDesk.exe" }
      }
    }
  });

  const [agent] = store.list();

  assert.equal(agent.capabilities.optimizedCapture, true);
  assert.equal(agent.capabilities.webrtcSignaling, true);
  assert.equal(agent.capabilities.webrtcMedia, true);
  assert.equal(agent.capabilities.webrtcDataChannel, true);
  assert.equal(agent.capabilities.webrtcEngine, "libdatachannel");
  assert.equal(agent.capabilities.directFramePush, true);
  assert.equal(agent.capabilities.persistentNativeHelpers, true);
  assert.equal(agent.capabilities.directPointerWebRtc, true);
  assert.equal(agent.capabilities.capturedCursor, true);
  assert.equal(agent.capabilities.privilegedDesktopBroker, true);
  assert.equal(agent.capabilities.realInputEnabled, false);
  assert.equal(agent.capabilities.inputHelperAvailable, true);
  assert.equal(agent.capabilities.localPanelPort, 37655);
  assert.equal(agent.capabilities.remoteEngine.selected, "rustdesk");
  assert.equal(agent.capabilities.remoteEngine.rustDesk.localId, "123456789");
  assert.equal("executablePath" in agent.capabilities.remoteEngine.rustDesk, false);
});

test("register stores unsigned restricted production capability", () => {
  const store = createAgentStore();

  store.register({
    machineId: "agent-restricted-1",
    hostname: "pc-restringido",
    username: "usuario",
    os: "Windows_NT",
    version: "0.3.0",
    capabilities: {
      screenCapture: true,
      optimizedCapture: false,
      interactiveControl: true,
      realInputEnabled: false,
      inputHelperAvailable: false,
      unsignedRestrictedProduction: true,
      stopFileAvailable: true,
      localPanelPort: 37655
    }
  });

  const [agent] = store.list();

  assert.equal(agent.capabilities.unsignedRestrictedProduction, true);
  assert.equal(agent.capabilities.optimizedCapture, false);
  assert.equal(agent.capabilities.realInputEnabled, false);
  assert.equal(agent.capabilities.inputHelperAvailable, false);
});
test("heartbeat refreshes helper capabilities", () => {
  const store = createAgentStore();
  store.register({
    machineId: "agent-cap-2",
    hostname: "pc-control",
    username: "tecnico",
    os: "Windows_NT",
    capabilities: { optimizedCapture: false, inputHelperAvailable: false, realInputEnabled: false }
  });

  store.heartbeat({
    machineId: "agent-cap-2",
    hostname: "pc-control",
    username: "tecnico",
    os: "Windows_NT",
    capabilities: { optimizedCapture: true, inputHelperAvailable: true, realInputEnabled: true, localPanelPort: 37655 }
  });

  const [agent] = store.list();

  assert.equal(agent.capabilities.optimizedCapture, true);
  assert.equal(agent.capabilities.inputHelperAvailable, true);
  assert.equal(agent.capabilities.realInputEnabled, true);
});


test("agent credentials are individual and never exposed by list", () => {
  const store=createAgentStore(); store.register({machineId:"agent-auth",hostname:"pc"});
  store.issueCredential("agent-auth","device-secret");
  assert.equal(store.authenticate("agent-auth","device-secret"),true);
  assert.equal(store.authenticate("agent-auth","wrong"),false);
  assert.equal(store.list()[0].authSecretHash,undefined);
});

test("hostname changes keep the same machine and emit one auditable event", () => {
  const changes = [];
  const store = createAgentStore({ onHostnameChange: (change) => changes.push(change) });
  store.register({ machineId: "stable-agent-1", hostname: "PC-VENTAS", username: "ana", os: "Windows_NT" });

  store.heartbeat({ machineId: "stable-agent-1", hostname: "PC-CONTABILIDAD", username: "ana", os: "Windows_NT" });
  store.heartbeat({ machineId: "stable-agent-1", hostname: "PC-CONTABILIDAD", username: "ana", os: "Windows_NT" });

  const agents = store.list();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].machineId, "stable-agent-1");
  assert.equal(agents[0].hostname, "PC-CONTABILIDAD");
  assert.equal(agents[0].previousHostname, "PC-VENTAS");
  assert.equal(agents[0].hostnameHistory.length, 1);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].previousHostname, "PC-VENTAS");
  assert.equal(changes[0].hostname, "PC-CONTABILIDAD");
});

test("hostname comparison ignores letter casing", () => {
  const changes = [];
  const store = createAgentStore({ onHostnameChange: (change) => changes.push(change) });
  store.register({ machineId: "stable-agent-2", hostname: "SERVER", username: "admin", os: "Windows_NT" });

  store.heartbeat({ machineId: "stable-agent-2", hostname: "server", username: "admin", os: "Windows_NT" });

  const [agent] = store.list();
  assert.equal(agent.hostname, "server");
  assert.equal(agent.hostnameHistory.length, 0);
  assert.equal(agent.hostnameChangedAt, null);
  assert.equal(changes.length, 0);
});

test("hostname history keeps the ten most recent changes", () => {
  const store = createAgentStore();
  store.register({ machineId: "stable-agent-3", hostname: "PC-00" });
  for (let index = 1; index <= 12; index += 1) {
    store.heartbeat({ machineId: "stable-agent-3", hostname: `PC-${String(index).padStart(2, "0")}` });
  }

  const [agent] = store.list();
  assert.equal(agent.hostnameHistory.length, 10);
  assert.equal(agent.hostnameHistory[0].previousHostname, "PC-02");
  assert.equal(agent.hostnameHistory[9].hostname, "PC-12");
});
test("unattended access stores only client-reported status and never password material", () => {
  const store = createAgentStore();
  store.register({ machineId: "agent-fast-1", hostname: "PC-RAPIDA" });
  const configured = store.configureUnattended("agent-fast-1", { enabled: true, allowControl: false, configuredAt: "2026-07-28T12:00:00.000Z", policyRevision: "local-revision-1", password: "must-not-be-stored" });

  assert.equal(configured.unattendedAccess.enabled, true);
  assert.equal(configured.unattendedAccess.allowControl, false);
  assert.equal(configured.unattendedAccess.source, "sas_client");
  assert.equal(configured.unattendedAccess.policyRevision, "local-revision-1");
  assert.equal(configured.unattendedAccess.password, undefined);
  assert.equal(configured.unattendedAccess.passwordHash, undefined);
  assert.equal(configured.unattendedAccess.passwordSalt, undefined);
  assert.equal(store.verifyUnattended, undefined);
});

test("startup migration purges legacy unattended secrets from server persistence", () => {
  const persisted = [];
  const store = createAgentStore({
    initialAgents: [{
      ...baseAgent,
      unattendedAccess: {
        enabled: true,
        allowControl: true,
        passwordHash: "legacy-hash",
        passwordSalt: "legacy-salt"
      }
    }],
    onChange: (agents) => persisted.push(agents)
  });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0][0].unattendedAccess.passwordHash, undefined);
  assert.equal(persisted[0][0].unattendedAccess.passwordSalt, undefined);
  assert.equal(store.list()[0].unattendedAccess.enabled, true);
});
test("unattended access is synchronized by heartbeat and can be revoked locally", () => {
  const store = createAgentStore();
  store.register({ machineId: "agent-fast-2", hostname: "PC-NOC", unattendedAccess: { enabled: true, allowControl: true, policyRevision: "rev-a" } });
  assert.equal(store.list()[0].unattendedAccess.enabled, true);
  assert.equal(store.list()[0].unattendedAccess.allowControl, true);

  store.heartbeat({ machineId: "agent-fast-2", unattendedAccess: { enabled: false, allowControl: false, disabledAt: "2026-07-28T13:00:00.000Z", policyRevision: "rev-b" } });
  const disabled = store.list()[0].unattendedAccess;
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.allowControl, false);
  assert.equal(disabled.policyRevision, "rev-b");
});

test("unattended use records only time and safe scope", () => {
  const store = createAgentStore();
  store.register({ machineId: "agent-fast-3", hostname: "PC-USER", unattendedAccess: { enabled: true, allowControl: true, policyRevision: "rev-c" } });
  const used = store.recordUnattendedUse("agent-fast-3", "2026-07-28T14:00:00.000Z");
  assert.equal(used.unattendedAccess.lastUsedAt, "2026-07-28T14:00:00.000Z");
  assert.equal(used.unattendedAccess.passwordHash, undefined);
});test("inventory records installed applications and detects later changes", () => {
  const store = createAgentStore();
  store.register({ machineId: "agent-inventory-1", hostname: "PC-INVENTARIO" });
  store.recordInventory("agent-inventory-1", "applications", { items: [{ name: "Suite", version: "1.0", publisher: "SAS" }] });
  store.recordInventory("agent-inventory-1", "applications", { items: [{ name: "Suite", version: "2.0", publisher: "SAS" }, { name: "Nuevo", version: "1", publisher: "Proveedor" }] });

  const inventory = store.list()[0].inventory.applications;
  assert.equal(inventory.count, 2);
  assert.equal(inventory.changes.added.length, 1);
  assert.equal(inventory.changes.changed.length, 1);
  assert.equal(inventory.history.length, 2);
});

test("startup and security history remain associated with the same machine", () => {
  const store = createAgentStore();
  store.register({ machineId: "agent-inventory-2", hostname: "PC-SEGURA" });
  store.recordInventory("agent-inventory-2", "startup", { items: [{ name: "Cliente", command: "C:\\Cliente.exe", location: "HKCU", user: "ana" }] });
  store.recordInventory("agent-inventory-2", "security", { operation: "startup_scan", engine: "ClamAV", available: true, scanned: 1, infected: 0 });

  const agent = store.list()[0];
  assert.equal(agent.inventory.startup.count, 1);
  assert.equal(agent.inventory.security.latest.engine, "ClamAV");
  assert.equal(agent.inventory.security.latest.infected, 0);
});
