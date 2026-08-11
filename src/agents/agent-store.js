import crypto from "node:crypto";
const DEFAULT_STALE_AFTER_MS = 90 * 1000;

export function createAgentStore({ initialAgents = [], onChange = () => {}, onHostnameChange = () => {}, staleAfterMs = DEFAULT_STALE_AFTER_MS } = {}) {
  const legacySecretFound = initialAgents.some(hasLegacyUnattendedSecret);
  const agents = new Map(initialAgents.map((agent) => {
    const sanitized = {
      ...agent,
      unattendedAccess: normalizeUnattendedAccess(agent?.unattendedAccess)
    };
    return [sanitized.id, sanitized];
  }));
  if (legacySecretFound) {
    onChange([...agents.values()]);
  }

  return {
    list() {
      return [...agents.values()].map((agent) => publicAgent(withFreshStatus(agent, staleAfterMs)));
    },

    register(input) {
      const now = new Date().toISOString();
      const machineId = cleanText(input.machineId);
      if (!machineId) {
        throw new Error("machineId is required");
      }

      const existing = agents.get(machineId);
      const hostname = cleanText(input.hostname);
      const rename = detectHostnameChange(existing, hostname, now);
      const agent = {
        id: machineId,
        machineId,
        hostname: hostname || existing?.hostname || "",
        username: cleanText(input.username),
        os: cleanText(input.os),
        version: cleanText(input.version) || "0.1.0",
        capabilities: normalizeCapabilities(input.capabilities ?? existing?.capabilities),
        inventory: normalizeInventory(existing?.inventory),
        deployment: normalizeDeployment(input.deployment ?? existing?.deployment),
        authSecretHash: existing?.authSecretHash ?? null,
        unattendedAccess: mergeUnattendedAccess(existing?.unattendedAccess, input.unattendedAccess),
        status: "online",
        lastSeenAt: now,
        previousHostname: rename?.previousHostname ?? existing?.previousHostname ?? null,
        hostnameChangedAt: rename?.changedAt ?? existing?.hostnameChangedAt ?? null,
        hostnameHistory: rename?.history ?? normalizeHostnameHistory(existing?.hostnameHistory),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

      agents.set(agent.id, agent);
      persist();
      if (rename) onHostnameChange({ machineId, ...rename, username: agent.username });
      return publicAgent(agent);
    },

    issueCredential(machineId, secret) {
      const agent = agents.get(cleanText(machineId));
      if (!agent) throw new Error(`Agent ${machineId} not found`);
      agent.authSecretHash = hashSecret(secret);
      agent.updatedAt = new Date().toISOString();
      persist();
      return publicAgent(agent);
    },

    authenticate(machineId, secret) {
      const agent = agents.get(cleanText(machineId));
      if (!agent?.authSecretHash || !secret) return false;
      const received = Buffer.from(hashSecret(secret), "hex");
      const expected = Buffer.from(agent.authSecretHash, "hex");
      return received.length === expected.length && crypto.timingSafeEqual(received, expected);
    },

    configureUnattended(machineId, input = {}) {
      const agent = agents.get(cleanText(machineId));
      if (!agent) throw new Error(`Agent ${machineId} not found`);
      const now = new Date().toISOString();
      agent.unattendedAccess = mergeUnattendedAccess(agent.unattendedAccess, {
        enabled: input.enabled === true,
        allowControl: input.enabled === true && Boolean(input.allowControl),
        configuredAt: input.enabled === true ? input.configuredAt ?? agent.unattendedAccess?.configuredAt ?? now : null,
        disabledAt: input.enabled === true ? null : input.disabledAt ?? now,
        policyRevision: input.policyRevision,
        source: "sas_client"
      });
      agent.updatedAt = now;
      persist();
      return publicAgent(agent);
    },

    recordUnattendedUse(machineId, usedAt = new Date().toISOString()) {
      const agent = agents.get(cleanText(machineId));
      if (!agent?.unattendedAccess?.enabled) return null;
      agent.unattendedAccess.lastUsedAt = usedAt;
      agent.updatedAt = usedAt;
      persist();
      return publicAgent(agent);
    },
    heartbeat(input) {
      const machineId = cleanText(input.machineId);
      const agent = agents.get(machineId);
      if (!agent) {
        return this.register(input);
      }

      const now = new Date().toISOString();
      const hostname = cleanText(input.hostname);
      const rename = detectHostnameChange(agent, hostname, now);
      agent.status = "online";
      agent.hostname = hostname || agent.hostname;
      if (rename) {
        agent.previousHostname = rename.previousHostname;
        agent.hostnameChangedAt = rename.changedAt;
        agent.hostnameHistory = rename.history;
      }
      agent.username = cleanText(input.username) || agent.username;
      agent.os = cleanText(input.os) || agent.os;
      agent.version = cleanText(input.version) || agent.version;
      agent.capabilities = normalizeCapabilities(input.capabilities ?? agent.capabilities);
      if (input.unattendedAccess && typeof input.unattendedAccess === "object") agent.unattendedAccess = mergeUnattendedAccess(agent.unattendedAccess, input.unattendedAccess);
      agent.lastSeenAt = now;
      agent.updatedAt = now;
      persist();
      if (rename) onHostnameChange({ machineId, ...rename, username: agent.username });
      return publicAgent(agent);
    },

    recordInventory(machineId, kind, data = {}) {
      const agent = agents.get(cleanText(machineId));
      if (!agent) throw new Error(`Agent ${machineId} not found`);
      const capturedAt = cleanText(data.capturedAt) || new Date().toISOString();
      agent.inventory = normalizeInventory(agent.inventory);
      if (["applications", "startup"].includes(kind)) {
        const items = normalizeInventoryItems(data.items);
        const previous = agent.inventory[kind];
        const changes = diffInventoryItems(previous?.items ?? [], items, kind);
        const digest = inventoryDigest(items, kind);
        const history = [...(previous?.history ?? []), { capturedAt, count: items.length, digest, added: changes.added.length, removed: changes.removed.length, changed: changes.changed.length }].slice(-30);
        agent.inventory[kind] = { capturedAt, count: items.length, digest, items, changes, history };
      } else if (kind === "security") {
        const events = [...(agent.inventory.security?.events ?? []), { capturedAt, ...sanitizeSecurityResult(data) }].slice(-30);
        agent.inventory.security = { latest: events.at(-1), events };
      } else throw new Error(`Unsupported inventory kind: ${kind}`);
      agent.updatedAt = new Date().toISOString();
      persist();
      return publicAgent(agent);
    }
  };

  function persist() {
    onChange([...agents.values()]);
  }
}

function hasLegacyUnattendedSecret(agent = {}) {
  const access = agent?.unattendedAccess;
  return Boolean(access && typeof access === "object" && (
    Object.hasOwn(access, "password")
    || Object.hasOwn(access, "passwordHash")
    || Object.hasOwn(access, "passwordSalt")
  ));
}
function detectHostnameChange(existing, hostname, changedAt) {
  const previousHostname = cleanText(existing?.hostname);
  if (!previousHostname || !hostname || previousHostname.toLocaleLowerCase() === hostname.toLocaleLowerCase()) return null;
  const history = normalizeHostnameHistory(existing?.hostnameHistory);
  history.push({ previousHostname, hostname, changedAt });
  return { previousHostname, hostname, changedAt, history: history.slice(-10) };
}

function normalizeHostnameHistory(value) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object").slice(-10) : [];
}

function normalizeInventory(value = {}) {
  const inventory = value && typeof value === "object" ? value : {};
  return {
    applications: normalizeInventorySection(inventory.applications),
    startup: normalizeInventorySection(inventory.startup),
    security: { latest: inventory.security?.latest ?? null, events: Array.isArray(inventory.security?.events) ? inventory.security.events.slice(-30) : [] }
  };
}
function normalizeInventorySection(value) {
  if (!value || typeof value !== "object") return null;
  const items = normalizeInventoryItems(value.items);
  return { capturedAt: value.capturedAt ?? null, count: items.length, digest: cleanText(value.digest) || null, items, changes: { added: normalizeInventoryItems(value.changes?.added), removed: normalizeInventoryItems(value.changes?.removed), changed: Array.isArray(value.changes?.changed) ? value.changes.changed.slice(0, 500) : [] }, history: Array.isArray(value.history) ? value.history.slice(-30) : [] };
}
function normalizeInventoryItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === "object").slice(0, 2000).map((item) => Object.fromEntries(Object.entries(item).slice(0, 24).map(([key, value]) => [cleanText(key).slice(0, 80), cleanText(value).slice(0, 2000)])));
}
function inventoryIdentity(item, kind) {
  const fields = kind === "applications" ? [item.name, item.publisher] : [item.name, item.location, item.user];
  return fields.map((value) => cleanText(value).toLocaleLowerCase()).join("|");
}
function inventoryDigest(items, kind) {
  const canonical = [...items].sort((a, b) => inventoryIdentity(a, kind).localeCompare(inventoryIdentity(b, kind)));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
function diffInventoryItems(previousItems, currentItems, kind) {
  const previous = new Map(previousItems.map((item) => [inventoryIdentity(item, kind), item]));
  const current = new Map(currentItems.map((item) => [inventoryIdentity(item, kind), item]));
  const added = [], removed = [], changed = [];
  for (const [key, item] of current) { if (!previous.has(key)) added.push(item); else if (JSON.stringify(previous.get(key)) !== JSON.stringify(item)) changed.push({ before: previous.get(key), after: item }); }
  for (const [key, item] of previous) if (!current.has(key)) removed.push(item);
  return { added, removed, changed };
}
function sanitizeSecurityEvent(input = {}) {
  const event = input && typeof input === "object" ? input : {};
  return {
    id: cleanText(event.id).slice(0, 100) || null,
    operation: cleanText(event.operation).slice(0, 80),
    status: cleanText(event.status).slice(0, 40),
    fileName: cleanText(event.fileName || ((event.file || event.originalPath) ? String(event.file || event.originalPath).split(/[\\/]/).pop() : "")).slice(0, 260),
    file: cleanText(event.file || event.originalPath).slice(0, 2000) || null,
    originalPath: cleanText(event.originalPath || event.file).slice(0, 2000) || null,
    quarantinePath: cleanText(event.quarantinePath).slice(0, 2000) || null,
    size: Math.max(0, Number(event.size ?? 0)),
    scannedAt: event.scannedAt ?? event.detectedAt ?? event.capturedAt ?? null,
    quarantinedAt: event.quarantinedAt ?? null,
    result: cleanText(event.result).slice(0, 1000),
    action: cleanText(event.action).slice(0, 80),
    count: Math.max(0, Number(event.count ?? 0)),
    infected: Math.max(0, Number(event.infected ?? 0))
  };
}
function sanitizeSecurityResult(data) {
  const value = data && typeof data === "object" ? data : {};
  const realtime = value.realtime && typeof value.realtime === "object" ? value.realtime : value;
  return {
    operation: cleanText(value.operation), engine: cleanText(value.engine), engineVersion: cleanText(value.engineVersion || realtime.engineVersion), available: Boolean(value.available ?? realtime.available), definitionsUpdated: Boolean(value.definitionsUpdated), definitionsUpdatedAt: value.definitionsUpdatedAt ?? realtime.definitionsUpdatedAt ?? null,
    scanned: Number(value.scanned ?? realtime.scanned ?? 0), infected: Number(value.infected ?? realtime.detections ?? 0), quarantined: Number(value.quarantined ?? realtime.quarantined ?? 0),
    targets: Array.isArray(value.targets) ? value.targets.slice(0, 200).map(cleanText) : [], detections: Array.isArray(value.detections) ? value.detections.slice(0, 200).map(cleanText) : [], message: cleanText(value.message).slice(0, 4000),
    fileName: cleanText(value.fileName).slice(0, 260), file: cleanText(value.file || value.originalPath).slice(0, 2000) || null, originalPath: cleanText(value.originalPath || value.file).slice(0, 2000) || null, quarantinePath: cleanText(value.quarantinePath).slice(0, 2000) || null, action: cleanText(value.action).slice(0, 80), status: cleanText(value.status).slice(0, 40), result: cleanText(value.result).slice(0, 1000), quarantinedAt: value.quarantinedAt ?? null,
    recentScans: Array.isArray(realtime.recentScans) ? realtime.recentScans.slice(0, 60).map(sanitizeSecurityEvent) : [],
    detectionHistory: Array.isArray(realtime.detectionHistory) ? realtime.detectionHistory.slice(0, 60).map(sanitizeSecurityEvent) : [],
    quarantine: Array.isArray(realtime.quarantine) ? realtime.quarantine.slice(0, 100).map(sanitizeSecurityEvent) : []
  };
}
function publicAgent(agent) {
  const { authSecretHash: _private, ...safe } = agent;
  return { ...safe, unattendedAccess: normalizeUnattendedAccess(agent.unattendedAccess) };
}

function normalizeUnattendedAccess(value = {}) {
  const access = value && typeof value === "object" ? value : {};
  return {
    enabled: Boolean(access.enabled),
    allowControl: Boolean(access.enabled) && Boolean(access.allowControl),
    autoApprove: Boolean(access.enabled) && access.autoApprove !== false,
    configuredAt: access.enabled ? access.configuredAt ?? null : null,
    disabledAt: access.enabled ? null : access.disabledAt ?? null,
    lastUsedAt: access.lastUsedAt ?? null,
    policyRevision: cleanText(access.policyRevision) || null,
    source: access.enabled ? "sas_client" : cleanText(access.source) || "sas_client"
  };
}

function mergeUnattendedAccess(current = {}, incoming = {}) {
  const previous = normalizeUnattendedAccess(current);
  if (!incoming || typeof incoming !== "object") return previous;
  const enabled = incoming.enabled === true;
  return normalizeUnattendedAccess({
    enabled,
    allowControl: enabled && Boolean(incoming.allowControl),
    autoApprove: enabled && incoming.autoApprove !== false,
    configuredAt: enabled ? incoming.configuredAt ?? previous.configuredAt ?? new Date().toISOString() : null,
    disabledAt: enabled ? null : incoming.disabledAt ?? previous.disabledAt,
    lastUsedAt: incoming.lastUsedAt ?? previous.lastUsedAt,
    policyRevision: incoming.policyRevision ?? previous.policyRevision,
    source: "sas_client"
  });
}
function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeDeployment(value = {}) {
  const deployment = value && typeof value === "object" ? value : {};
  return { campaignId: cleanText(deployment.campaignId) || null, campaignName: cleanText(deployment.campaignName) || null, company: cleanText(deployment.company) || null, enrolledAt: deployment.enrolledAt ?? null, associationStatus: cleanText(deployment.associationStatus) || (deployment.campaignId ? "pending_user" : null) };
}function normalizeCapabilities(input = {}) {
  const capabilities = input && typeof input === "object" ? input : {};
  return {
    screenCapture: Boolean(capabilities.screenCapture),
    optimizedCapture: Boolean(capabilities.optimizedCapture),
    interactiveControl: Boolean(capabilities.interactiveControl),
    webrtcSignaling: Boolean(capabilities.webrtcSignaling),
    webrtcMedia: Boolean(capabilities.webrtcMedia),
    webrtcDataChannel: Boolean(capabilities.webrtcDataChannel),
    webrtcEngine: cleanText(capabilities.webrtcEngine) || null,
    webrtcError: cleanText(capabilities.webrtcError).slice(0, 240) || null,
    directFramePush: Boolean(capabilities.directFramePush),
    persistentNativeHelpers: Boolean(capabilities.persistentNativeHelpers),
    directPointerWebRtc: Boolean(capabilities.directPointerWebRtc),
    capturedCursor: Boolean(capabilities.capturedCursor),
    privilegedDesktopBroker: Boolean(capabilities.privilegedDesktopBroker),
    realInputEnabled: Boolean(capabilities.realInputEnabled),
    repairActionsEnabled: Boolean(capabilities.repairActionsEnabled),
    inputHelperAvailable: Boolean(capabilities.inputHelperAvailable),
    inputHelperReady: Boolean(capabilities.inputHelperReady),
    inputHelperStatus: cleanText(capabilities.inputHelperStatus).slice(0, 240) || null,
    inputDeliveryMode: cleanText(capabilities.inputDeliveryMode).slice(0, 80) || null,
    stopFileAvailable: Boolean(capabilities.stopFileAvailable),
    unsignedRestrictedProduction: Boolean(capabilities.unsignedRestrictedProduction),
    softwareInventory: Boolean(capabilities.softwareInventory),
    securityEngine: cleanText(capabilities.securityEngine) || null,
    localPanelPort: Number.isFinite(Number(capabilities.localPanelPort)) ? Number(capabilities.localPanelPort) : null
  };
}
function withFreshStatus(agent, staleAfterMs) {
  const lastSeen = new Date(agent.lastSeenAt ?? 0).getTime();
  const isFresh = Number.isFinite(lastSeen) && Date.now() - lastSeen <= staleAfterMs;
  return {
    ...agent,
    status: isFresh ? agent.status : "offline",
    heartbeatFresh: isFresh
  };
}

function cleanText(value) {
  return String(value ?? "").trim();
}


