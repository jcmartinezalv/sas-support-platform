import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { inspectRemoteEngine, launchHopToDesk } from "./remote-engine-provider.js";
import { adaptiveScreenPlan, createAdaptiveScreenState, publicScreenTelemetry, recordScreenCapture } from "./adaptive-screen-controller.js";

const config = {
  serverUrl: process.env.SAS_SERVER_URL ?? "https://localhost",
  agentSecret: process.env.SAS_AGENT_SECRET ?? "",
  enrollmentToken: process.env.SAS_ENROLLMENT_TOKEN ?? "",
  deploymentToken: process.env.SAS_DEPLOYMENT_TOKEN ?? "",
  credentialFile: process.env.SAS_AGENT_CREDENTIAL_FILE ?? path.resolve("agent-credential.json"),
  identityFile: process.env.SAS_AGENT_IDENTITY_FILE ?? path.resolve("agent-identity.json"),
  enrollOnly: ["1", "true", "yes"].includes(String(process.env.SAS_ENROLL_ONLY ?? "false").toLowerCase()),
  heartbeatSeconds: Number(process.env.SAS_AGENT_HEARTBEAT_SECONDS ?? 2),
  requestTimeoutMs: Math.max(5000, Number(process.env.SAS_AGENT_REQUEST_TIMEOUT_MS ?? 15000)),
  resumeGapMs: Math.max(20000, Number(process.env.SAS_AGENT_RESUME_GAP_MS ?? 30000)),
  version: readPackageVersion(),
  stopFilePath: process.env.SAS_AGENT_STOP_FILE ?? path.resolve("sas-agent-stop.flag"),
  localControlPort: Number(process.env.SAS_AGENT_LOCAL_PORT ?? 37655),
  consentPromptPath: process.env.SAS_CONSENT_PROMPT_PATH ?? path.resolve("scripts", "show-support-consent.ps1"),
  controlPromptPath: process.env.SAS_CONTROL_PROMPT_PATH ?? path.resolve("scripts", "show-control-consent.ps1"),
  captureHelperPath: process.env.SAS_CAPTURE_HELPER_PATH ?? path.resolve("tools", "sas-capture-helper", "bin", "Release", "SasCaptureHelper.exe"),
  dxgiCaptureHelperPath: process.env.SAS_DXGI_CAPTURE_HELPER_PATH ?? path.resolve("tools", "sas-dxgi-capture", "bin", "Release", "SasDxgiCapture.exe"),
  inputHelperPath: process.env.SAS_INPUT_HELPER_PATH ?? path.resolve("tools", "sas-input-helper", "bin", "Release", "SasInputHelper.exe"),
  inputHelperPipe: process.env.SAS_INPUT_HELPER_PIPE ?? "\\\\.\\pipe\\SASInputDesktopV3",
  inputHelperStatusFile: process.env.SAS_INPUT_HELPER_STATUS_FILE ?? path.join(path.resolve("."), "runtime", "input-desktop-status.json"),
  enableRealInput: ["1", "true", "yes", "on"].includes(String(process.env.SAS_ENABLE_REAL_INPUT ?? "false").toLowerCase()),
  enableRepairActions: ["1", "true", "yes", "on"].includes(String(process.env.SAS_ENABLE_REPAIR_ACTIONS ?? "false").toLowerCase()),
  unsignedRestrictedProduction: ["1", "true", "yes", "on"].includes(String(process.env.SAS_UNSIGNED_RESTRICTED_PRODUCTION ?? "false").toLowerCase()),
  clamScanPath: process.env.SAS_CLAMSCAN_PATH ?? "",
  freshClamPath: process.env.SAS_FRESHCLAM_PATH ?? "",
  clamDatabasePath: process.env.SAS_CLAMAV_DATABASE_PATH ?? "",
  securityScanTimeoutMs: Math.max(30000, Number(process.env.SAS_SECURITY_SCAN_TIMEOUT_MS ?? 600000)),
  securityRealtimeEnabled: !["0", "false", "no", "off"].includes(String(process.env.SAS_SECURITY_REALTIME_ENABLED ?? "true").toLowerCase()),
  securityRealtimeMaxBytes: Math.max(1_048_576, Number(process.env.SAS_SECURITY_REALTIME_MAX_BYTES ?? 536_870_912)),
  clientUpdateDir: process.env.SAS_CLIENT_UPDATE_DIR ?? path.resolve("updates"),
  privilegedBrokerPipe: process.env.SAS_PRIVILEGED_BROKER_PIPE ?? "\\\\.\\pipe\\SASPrivilegedDesktop",
  privilegedBrokerPath: process.env.SAS_PRIVILEGED_BROKER_PATH ?? path.resolve("tools", "sas-secure-attention-broker", "bin", "Release", "SasSecureAttentionBroker.exe"),
  unattendedPolicyFile: process.env.SAS_UNATTENDED_POLICY_FILE ?? path.resolve("unattended-policy.json"),
  remoteEngine: process.env.SAS_REMOTE_ENGINE ?? "sas",
  hopToDeskPath: process.env.SAS_HOPTODESK_PATH ?? "",
  rustDeskPath: process.env.SAS_RUSTDESK_PATH ?? ""
};

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const requiredInputHelperRevision = "input-v9-pointer-recovery";
const identity = createIdentity();
const completedCommands = new Set();
const completedEvents = new Set();
const completedUnattendedRequests = new Set();
const activeConsentPrompts = new Set();
const activeControlPrompts = new Set();
const latestFrameBySession = new Map();
const latestHttpsFrameAtBySession = new Map();
const activeRemoteSessions = new Map();
const nativeHelperServers = new Map();
const directPointerStateBySession = new Map();
const heldInputBySession = new Map();
let lastRemoteClipboardHash = null;
let lastRemoteClipboardAt = 0;
let lastCaptureStatus = { status: "waiting", at: null, error: null, sessionId: null, bytes: 0 };
const webRtcPeers = new Map();
let webRtcRuntime = null;
let webRtcRuntimeError = null;
let screenFramePumpBusy = false;
let pollPromise = null;
let heartbeatPromise = null;
let connectionRecoveryPromise = null;
let lastSchedulerObservationAt = Date.now();
const activeServerRequests = new Set();
const realtimeProtection = { enabled: config.securityRealtimeEnabled, watchers: [], queue: [], queued: new Set(), processing: false, scanned: 0, detections: 0, lastScanAt: null, lastDetection: null, lastError: null };
let lastAgentStatus = null;
let lastSessions = [];
let lastPollAt = null;
let lastConnectionError = null;
let agentSecret = readStoredCredential() || config.agentSecret;
let localUnattendedPolicy = readLocalUnattendedPolicy();
let lastHeartbeatLogAt = 0;
let lastHeartbeatSessionCount = -1;
let inputBridgeStatus = { ready: false, privilegedReady: false, mode: null, message: "SAS Input Service todav\u00eda no confirma la sesi\u00f3n interactiva.", processId: null, sessionId: null, checkedAt: null };

await ensureAgentCredential();
if (config.enrollOnly) {
  console.log("[SAS Agent] enrollment completed");
  process.exit(0);
}

startLocalControlServer();
startRealtimeProtection();
await refreshInputBridgeStatus();
setInterval(() => { refreshInputBridgeStatus().catch(() => {}); }, 5000);
await register().catch((error) => {
  recordConnectionError(error);
  console.error(`[SAS Agent] initial register failed: ${error.message}`);
});
await pollOnce().catch((error) => {
  recordConnectionError(error);
  console.error(`[SAS Agent] initial poll failed: ${error.message}`);
});
setInterval(() => {
  pollOnce().catch((error) => {
    recordConnectionError(error);
    console.error(`[SAS Agent] poll failed: ${error.message}`);
  });
}, config.heartbeatSeconds * 1000);
setInterval(() => {
  heartbeatOnce().catch((error) => {
    recordConnectionError(error);
    console.error(`[SAS Agent] heartbeat independiente falló: ${error.message}`);
  });
}, Math.max(5, Math.min(15, config.heartbeatSeconds * 3)) * 1000);

setInterval(() => {
  pumpScreenFrames().catch((error) => console.error("[SAS Agent] envio de imagen fallo: " + error.message));
}, 45);
setInterval(() => {
  const observedAt = Date.now();
  const elapsedMs = observedAt - lastSchedulerObservationAt;
  lastSchedulerObservationAt = observedAt;
  if (elapsedMs >= config.resumeGapMs) {
    recoverConnectionAfterResume(elapsedMs).catch((error) => {
      recordConnectionError(error);
      console.error(`[SAS Agent] recuperacion tras reanudar Windows fallo: ${error.message}`);
    });
  }
}, 5000);


function pollOnce() {
  if (!pollPromise) {
    const tracked = poll().finally(() => { if (pollPromise === tracked) pollPromise = null; });
    pollPromise = tracked;
  }
  return pollPromise;
}
function heartbeatOnce() {
  if (!heartbeatPromise) {
    const tracked = postJson("/api/agents/heartbeat", buildAgentPayload())
      .then((response) => { lastAgentStatus = response.agent ?? lastAgentStatus; lastConnectionError = null; return response; })
      .finally(() => { if (heartbeatPromise === tracked) heartbeatPromise = null; });
    heartbeatPromise = tracked;
  }
  return heartbeatPromise;
}

async function recoverConnectionAfterResume(elapsedMs) {
  if (connectionRecoveryPromise) return connectionRecoveryPromise;
  connectionRecoveryPromise = (async () => {
    console.warn(`[SAS Agent] Windows se reanudo despues de ${Math.round(elapsedMs / 1000)} s; renovando conexiones.`);
    abortActiveServerRequests("system_resume");
    pollPromise = null;
    heartbeatPromise = null;
    for (const sessionId of [...webRtcPeers.keys()]) closeWebRtcPeer(sessionId);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await refreshInputBridgeStatus();
    await register();
    await pollOnce();
    console.log("[SAS Agent] conexion recuperada despues de reanudar Windows.");
  })().finally(() => { connectionRecoveryPromise = null; });
  return connectionRecoveryPromise;
}

function abortActiveServerRequests(reason) {
  for (const request of activeServerRequests) {
    try { request.controller.abort(reason); } catch {}
  }
}

async function fetchServer(url, options = {}, timeoutMs = config.requestTimeoutMs) {
  const controller = new AbortController();
  const request = { controller, url: String(url), startedAt: Date.now() };
  activeServerRequests.add(request);
  const timer = setTimeout(() => controller.abort("server_request_timeout"), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    const reason = String(controller.signal.reason ?? "server_request_aborted");
    const recoveredError = new Error(reason === "system_resume"
      ? "Conexion renovada despues de reanudar Windows"
      : `SAS Server no respondio en ${Math.round(timeoutMs / 1000)} segundos`);
    recoveredError.code = reason;
    throw recoveredError;
  } finally {
    clearTimeout(timer);
    activeServerRequests.delete(request);
  }
}
function readPackageVersion() {
  try {
    const packagePath = path.resolve("package.json");
    return String(JSON.parse(fs.readFileSync(packagePath, "utf8").replace(/^\uFEFF/, "")).version || "0.0.0");
  } catch { return "0.0.0"; }
}
function startLocalControlServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(renderLocalStatusPage());
      }

      if (req.method === "GET" && url.pathname === "/status") {
        return sendLocalJson(res, 200, buildLocalStatus());
      }
      if (req.method === "GET" && url.pathname === "/remote-engine/status") {
        return sendLocalJson(res, 200, currentRemoteEngine());
      }
      if (req.method === "POST" && url.pathname === "/remote-engine/launch") {
        const body = await readLocalJsonBody(req);
        const engine = currentRemoteEngine();
        if (!engine.hopToDesk.installed) { const error = new Error("HopToDesk no está disponible en este equipo"); error.statusCode = 503; throw error; }
        return sendLocalJson(res, 202, await launchHopToDesk({ executablePath: engine.hopToDesk.executablePath, mode: body.mode, remoteId: body.remoteId }));
      }
      if (req.method === "POST" && url.pathname === "/reconnect") {
        try {
          await register();
          await pollOnce();
          return sendLocalJson(res, 200, { reconnected: true, status: buildLocalStatus() });
        } catch (error) {
          recordConnectionError(error);
          error.statusCode = Number(error.statusCode) || 503;
          throw error;
        }
      }
      if (req.method === "GET" && url.pathname === "/security/status") {
        return sendLocalJson(res, 200, await readSecurityStatus());
      }
      if (req.method === "POST" && url.pathname === "/security/realtime") {
        const body = await readLocalJsonBody(req);
        setRealtimeProtection(body.enabled !== false);
        return sendLocalJson(res, 200, securitySnapshot());
      }
      if (req.method === "POST" && url.pathname === "/security/definitions") {
        return sendLocalJson(res, 200, await updateSecurityDefinitions());
      }
      if (req.method === "POST" && url.pathname === "/security/scan-startup") {
        return sendLocalJson(res, 200, await scanStartupPrograms());
      }
      if (req.method === "GET" && url.pathname === "/update/status") {
        return sendLocalJson(res, 200, await fetchClientUpdateStatus());
      }
      if (req.method === "POST" && url.pathname === "/update/install") {
        return sendLocalJson(res, 202, await installClientUpdate());
      }

      if (req.method === "POST" && url.pathname === "/enroll") {
        const body = await readLocalJsonBody(req);
        const enrollmentToken = String(body.enrollmentToken ?? "").trim().toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{8}$/.test(enrollmentToken)) {
          const error = new Error("Escribe el código temporal de 8 caracteres");
          error.statusCode = 400;
          throw error;
        }
        if (readStoredCredential()) await postJson("/api/agents/associate-enrollment", { ...buildAgentPayload(), enrollmentToken });
        else await enrollWithToken(enrollmentToken);
        await register();
        await poll();
        return sendLocalJson(res, 200, { enrolled: true, identity });
      }

      if (req.method === "POST" && url.pathname === "/pair") {
        const body = await readLocalJsonBody(req);
        const joinCode = String(body.joinCode ?? "").trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(joinCode)) {
          const error = new Error("Escribe el código de 6 letras o números");
          error.statusCode = 400;
          throw error;
        }
        const result = await postJson("/api/agents/pair", { ...buildAgentPayload(), joinCode });
        await poll();
        return sendLocalJson(res, 200, result);
      }

      if (req.method === "POST" && url.pathname === "/quick-authorize") {
        const body = await readLocalJsonBody(req);
        const joinCode = String(body.joinCode ?? "").trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(joinCode)) { const error = new Error("Escribe el código de 6 letras o números"); error.statusCode = 400; throw error; }
        const result = await postJson("/api/agents/quick-authorize", { ...buildAgentPayload(), joinCode, allowControl: body.allowControl === true });
        await poll();
        return sendLocalJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/support-request") {
        const body = await readLocalJsonBody(req);
        const result = await postJson("/api/agents/support-request", { ...buildAgentPayload(), ...body });
        await poll();
        return sendLocalJson(res, 201, result);
      }
      if (req.method === "POST" && url.pathname === "/session-consent") {
        const body = await readLocalJsonBody(req);
        const result = await postJson("/api/agents/session-consent", {
          machineId: identity.machineId,
          sessionId: String(body.sessionId ?? ""),
          decision: body.decision === "approved" ? "approved" : "rejected",
          allowControl: body.decision === "approved" && body.allowControl === true
        });
        await poll();
        return sendLocalJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/control-consent") {
        const body = await readLocalJsonBody(req);
        const result = await postJson("/api/agents/control-consent", {
          machineId: identity.machineId,
          sessionId: String(body.sessionId ?? ""),
          decision: body.decision === "approved" ? "approved" : "rejected"
        });
        await poll();
        return sendLocalJson(res, 200, result);
      }
      if (req.method === "POST" && url.pathname === "/unattended-access") {
        const body = await readLocalJsonBody(req);
        localUnattendedPolicy = configureLocalUnattendedPolicy({
          enabled: body.enabled !== false,
          password: String(body.password ?? ""),
          allowControl: body.enabled !== false && Boolean(body.allowControl),
          autoApprove: body.enabled !== false
        });
        let synchronized = false;
        let synchronizationError = null;
        try {
          const result = await syncUnattendedPolicy();
          lastAgentStatus = result.agent ?? lastAgentStatus;
          synchronized = true;
        } catch (error) {
          synchronizationError = error.message;
        }
        return sendLocalJson(res, synchronized ? 200 : 202, {
          savedLocally: true,
          synchronized,
          synchronizationError,
          unattendedAccess: publicLocalUnattendedPolicy(localUnattendedPolicy)
        });
      }
      if (req.method === "POST" && url.pathname === "/stop") {
        await closeSessionsFromLocalStop(lastSessions);
        return sendLocalJson(res, 200, { stopped: true, sessions: lastSessions.length });
      }

      return sendLocalJson(res, 404, { error: "Not found" });
    } catch (error) {
      return sendLocalJson(res, error.statusCode ?? 500, { error: error.message });
    }
  });

  server.listen(config.localControlPort, "127.0.0.1", () => {
    console.log(`[SAS Agent] local panel http://127.0.0.1:${config.localControlPort}`);
  });
}

async function refreshInputBridgeStatus() {
  const checkedAt = new Date().toISOString();
  if (process.platform !== "win32" || config.unsignedRestrictedProduction || !fs.existsSync(config.inputHelperPath)) {
    inputBridgeStatus = { ready: false, privilegedReady: false, mode: null, message: "SAS Input no está disponible en este equipo.", processId: null, sessionId: null, checkedAt };
    return inputBridgeStatus;
  }
  const brokerAvailable = Boolean(agentSecret && fs.existsSync(config.privilegedBrokerPath));
  const serviceProbe = brokerAvailable
    ? executePrivilegedBrokerRaw("INPUT_HEALTH", [], 2500)
    : Promise.reject(new Error("privileged_broker_unavailable"));
  const pipeProbe = requestInputHelperPipe(["--type", "health_check"], 1500);
  const [service, localPipe] = await Promise.allSettled([serviceProbe, pipeProbe]);
  const serviceReady = service.status === "fulfilled" && Boolean(service.value?.ok && service.value?.ready);
  const localReady = localPipe.status === "fulfilled" && Boolean(localPipe.value?.ok);
  if (serviceReady) {
    const result = service.value;
    inputBridgeStatus = { ready: true, privilegedReady: true, mode: result?.mode ?? "service_supervised_session_bridge", message: result?.message ?? "SAS Input Service conectado a la sesión activa.", processId: Number(result?.processId) || null, sessionId: Number.isFinite(Number(result?.sessionId)) ? Number(result.sessionId) : null, checkedAt };
  } else if (localReady) {
    const runtime = readInputDesktopRuntimeStatus();
    const serviceError = service.status === "rejected" ? compactInputError(service.reason) : "servicio_sin_canal";
    inputBridgeStatus = { ready: true, privilegedReady: false, mode: "interactive_desktop_pipe", message: "Teclado y ratón conectados por el canal interactivo; UAC no disponible. Servicio: " + serviceError, processId: runtime.processId, sessionId: runtime.sessionId, checkedAt };
  } else {
    const serviceError = service.status === "rejected" ? compactInputError(service.reason) : "servicio_sin_canal";
    const pipeError = localPipe.status === "rejected" ? compactInputError(localPipe.reason) : "canal_interactivo_sin_respuesta";
    inputBridgeStatus = { ready: false, privilegedReady: false, mode: "unavailable", message: "SAS Input sin canal: servicio=" + serviceError + "; interactivo=" + pipeError, processId: null, sessionId: null, checkedAt };
  }
  return inputBridgeStatus;
}
function readInputDesktopRuntimeStatus() {
  const status = readJsonFile(config.inputHelperStatusFile);
  const checkedAt = Date.parse(status?.checkedAt ?? 0);
  const fresh = Number.isFinite(checkedAt) && Date.now() - checkedAt <= 30000;
  return {
    ready: Boolean(status?.ready && fresh),
    message: fresh ? String(status?.message ?? "") : "SAS Input Desktop todavía no confirma su canal local.",
    processId: fresh && Number.isFinite(Number(status?.processId)) ? Number(status.processId) : null,
    sessionId: fresh && Number.isInteger(Number(status?.sessionId)) ? Number(status.sessionId) : null,
    checkedAt: fresh ? status.checkedAt : null,
    pipe: fresh && /^SASInputDesktopV3_S\d+$/.test(String(status?.pipe ?? "")) ? String(status.pipe) : null
  };
}

function buildLocalStatus() {
  const sessions = lastSessions.map((session) => ({
    id: session.id,
    joinCode: session.joinCode,
    status: session.status,
    ticketId: session.ticketId,
    ticketSubject: session.ticketSubject ?? null,
    customerName: session.customerName ?? null,
    screenShare: session.screenShare,
    controlConsent: session.controlConsent,
    consent: session.consent,
    isActive: session.status === "active",
    hasScreenShare: Boolean(session.screenShare?.enabled),
    hasControl: session.controlConsent?.decision === "approved"
  }));
  const inputDesktop = readInputDesktopRuntimeStatus();
  const effectiveInputReady = Boolean(inputBridgeStatus.ready || inputDesktop.ready);
  const effectiveInputMode = inputBridgeStatus.ready ? inputBridgeStatus.mode : inputDesktop.ready ? "interactive_desktop_pipe" : "unavailable";  return {
    identity,
    serverUrl: config.serverUrl,
    lastPollAt,
    connection: {
      credentialRejected: Boolean(lastConnectionError?.credentialRejected),
      lastErrorAt: lastConnectionError?.at ?? null,
      statusCode: Number(lastConnectionError?.statusCode ?? 0),
      message: lastConnectionError?.credentialRejected ? "La credencial del equipo necesita renovarse" : lastConnectionError?.message ?? null
    },
    agent: lastAgentStatus,
    sessions,
    activeSessionCount: sessions.filter((session) => session.isActive).length,
    supportSessionCount: sessions.filter((session) => !["closed", "consent_rejected", "expired", "consent_locked", "control_locked"].includes(session.status)).length,
    waitingSupport: sessions.some((session) => !["active", "closed", "consent_rejected", "expired", "consent_locked", "control_locked"].includes(session.status)),
    screenShareActive: sessions.some((session) => session.hasScreenShare),
    controlActive: sessions.some((session) => session.hasControl),
    unattendedAccess: publicLocalUnattendedPolicy(localUnattendedPolicy),
    realInputEnabled: config.enableRealInput && !config.unsignedRestrictedProduction,
    repairActionsEnabled: config.enableRepairActions && !config.unsignedRestrictedProduction,
    unsignedRestrictedProduction: config.unsignedRestrictedProduction,
    captureHelperExists: !config.unsignedRestrictedProduction && fs.existsSync(config.captureHelperPath),
    capture: { ...lastCaptureStatus, helperExists: fs.existsSync(config.captureHelperPath), dxgiHelperExists: fs.existsSync(config.dxgiCaptureHelperPath), preferredEngine: fs.existsSync(config.dxgiCaptureHelperPath) ? "dxgi_desktop_duplication" : "gdi_compatible", privilegedBrokerExists: fs.existsSync(config.privilegedBrokerPath) },
    nativeAcceleration: Object.fromEntries([...nativeHelperServers.entries()].map(([key, value]) => [key, { running: !value.process.killed, pid: value.process.pid, queued: value.queue.length, busy: Boolean(value.active), startedAt: new Date(value.startedAt).toISOString() }])),
    directPointer: Object.fromEntries([...directPointerStateBySession.entries()].map(([key, value]) => [key, { running: value.running, delivered: value.delivered, lastError: value.lastError }])),
    inputHelperExists: !config.unsignedRestrictedProduction && fs.existsSync(config.inputHelperPath),
    inputDesktop: { ...inputDesktop, ready: effectiveInputReady, serviceBridge: inputBridgeStatus },
    inputDeliveryMode: config.unsignedRestrictedProduction ? "restricted" : effectiveInputMode,
    privilegedDesktopBrokerExists: !config.unsignedRestrictedProduction && fs.existsSync(config.privilegedBrokerPath),
    stopFilePath: config.stopFilePath,
    version: config.version,
    clientUpdateStatus: readJsonFile(path.join(config.clientUpdateDir, "last-update.json")),
    security: securitySnapshot(),
    remoteEngine: currentRemoteEngine()
  };
}

function currentRemoteEngine() {
  return inspectRemoteEngine({ preferred: config.remoteEngine, configuredPath: config.hopToDeskPath, configuredRustDeskPath: config.rustDeskPath });
}

function localSessionLabel(value) {
  return ({
    pending_customer_consent: "Espera autorización del cliente",
    authorized_waiting_agent: "Autorizada, lista para conectar",
    authorized_waiting_agent_assignment: "Espera equipo de soporte",
    active: "Soporte activo",
    closed: "Finalizada",
    consent_rejected: "Rechazada",
    expired: "Vencida",
    consent_locked: "Bloqueada por seguridad",
    control_locked: "Control bloqueado"
  })[value] ?? "Estado en actualización";
}

function localConsentLabel(value) {
  return ({ approved: "autorizado", rejected: "rechazado", pending: "pendiente", expired: "vencido" })[value] ?? "pendiente";
}

function localControlLabel(value) {
  return ({ approved: "autorizados", rejected: "bloqueados", pending: "permiso solicitado", revoked: "permiso retirado", locked: "bloqueados", not_requested: "bloqueados" })[value] ?? "bloqueados";
}

function renderLocalPermissionActions(session) {
  if (session.consent?.decision === "pending") {
    return `<div class="permission-box"><strong>Tu ticket ya está con el técnico</strong><p>Una sola autorización habilita la pantalla y las herramientas necesarias para resolver este ticket. Puedes finalizar el acceso completo en cualquier momento.</p><div class="permission-actions"><button class="primary-button" data-session-decision="approved" data-session-id="${escapeHtml(session.id)}" data-allow-control="true">Autorizar soporte completo</button><button class="secondary reject" data-session-decision="rejected" data-session-id="${escapeHtml(session.id)}">No autorizar</button></div></div>`;
  }
  if (session.consent?.decision === "approved" && session.controlConsent?.decision === "pending") {
    return `<div class="permission-box warning"><strong>El técnico solicita teclado y ratón</strong><p>La pantalla ya está autorizada. Decide si también permites que el técnico utilice teclado, ratón y portapapeles.</p><div class="permission-actions"><button class="primary-button" data-control-decision="approved" data-session-id="${escapeHtml(session.id)}">Autorizar teclado y ratón</button><button class="secondary reject" data-control-decision="rejected" data-session-id="${escapeHtml(session.id)}">Mantener bloqueados</button></div></div>`;
  }
  if (session.consent?.decision === "approved") {
    return `<div class="permission-summary"><span class="ok">✓ Pantalla autorizada</span><span class="${session.hasControl ? "ok" : "locked"}">${session.hasControl ? "✓ Teclado y ratón autorizados" : "🔒 Teclado y ratón bloqueados"}</span></div>`;
  }
  return `<div class="permission-summary"><span class="locked">Acceso no autorizado</span></div>`;
}
function renderLocalStatusPage() {
  const status = buildLocalStatus();
  const risk = status.controlActive ? "danger" : status.connection.credentialRejected || status.screenShareActive || status.supportSessionCount ? "warning" : "safe";
  const bannerText = status.controlActive
    ? "Teclado y mouse autorizados. Puedes finalizar la sesión en cualquier momento."
    : status.connection.credentialRejected
      ? "SAS requiere volver a vincular este equipo con el servidor."
    : status.screenShareActive
      ? "Vista en vivo activa. El técnico puede observar la pantalla."
      : status.activeSessionCount
        ? "Soporte activo: teclado y mouse permanecen bloqueados."
        : status.waitingSupport
          ? "Esperando soporte. Tu ticket ya está asignado a este equipo."
          : "Este equipo no tiene sesiones de soporte activas.";
  const sessions = status.sessions.map((session) => `
    <article class="session ${session.hasControl ? "danger" : session.hasScreenShare ? "warning" : ""}">
      <div>
        <strong>${escapeHtml(session.joinCode)}</strong>
        <span>${escapeHtml(localSessionLabel(session.status))}</span>
      </div>
      <small>Ticket ${escapeHtml(session.ticketId)}</small>
      <h3>${escapeHtml(session.ticketSubject || "Solicitud de soporte")}</h3>
      <ul>
        <li>Permiso de soporte: ${escapeHtml(localConsentLabel(session.consent?.decision))}</li>
        <li>Vista en vivo: ${session.hasScreenShare ? "activa" : "detenida"}</li>
        <li>Teclado y ratón: ${escapeHtml(localControlLabel(session.controlConsent?.decision))}</li>
      </ul>
      ${renderLocalPermissionActions(session)}
    </article>
  `).join("") || "<p>No hay sesiones activas.</p>";
  const credentialRecovery = status.connection.credentialRejected ? `
    <section class="credential-card">
      <div>
        <h2>Renovar vinculación</h2>
        <p>Solicita al técnico una liga temporal de instalación y escribe aquí su código de 8 caracteres. No necesitas reinstalar SAS.</p>
      </div>
      <form id="enrollForm">
        <label for="enrollmentToken">Código temporal</label>
        <div class="pair-controls">
          <input id="enrollmentToken" name="enrollmentToken" maxlength="8" minlength="8" pattern="[A-HJ-NP-Za-hj-np-z2-9]{8}" autocomplete="off" spellcheck="false" placeholder="ABCD2345" required>
          <button class="pair-button" type="submit">Renovar vinculación</button>
        </div>
        <small>El código se usa una sola vez y no concede acceso remoto.</small>
        <div id="enrollResult" class="pair-result" aria-live="polite"></div>
      </form>
    </section>` : "";

  const securityAlert = status.security?.lastDetection ? `
    <section class="threat-card">
      <h2>⚠ ClamAV detectó un archivo potencialmente malicioso</h2>
      <p><strong>${escapeHtml(status.security.lastDetection.file)}</strong></p>
      <p>SAS bloqueó cualquier acción automática: el archivo no fue abierto, eliminado ni movido. El evento fue enviado al técnico para revisión.</p>
      <small>${escapeHtml(status.security.lastDetection.result || "Detección reportada por ClamAV")}</small>
    </section>` : "";
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SAS en este equipo</title>
  <style>
  :root{--ink:#17242b;--muted:#60727c;--line:#d9e2e6;--accent:#197153;--accent-dark:#105d43;--danger:#a33a35;--warn:#966316;--bg:#f3f6f7;--panel:#fff;--soft:#edf5f2}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Segoe UI,Arial,sans-serif}main{width:min(720px,100%);margin:auto;padding:28px 18px 42px;display:grid;gap:16px}.hero{display:grid;gap:10px}.brand-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.brand-row h1{margin:0;font-size:25px}.state-pill{border-radius:999px;padding:7px 11px;background:#e7f2ee;color:var(--accent-dark);font-size:12px;font-weight:900}.banner{padding:13px 15px;border-radius:12px;background:var(--panel);border:1px solid var(--line);font-weight:750}.banner.safe{border-left:5px solid var(--accent)}.banner.warning{border-left:5px solid #d79a2b;color:#72501a}.banner.danger{border-left:5px solid var(--danger);color:var(--danger)}section{padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 24px rgba(27,57,68,.06)}h2{margin:0 0 6px;font-size:20px}p{margin:4px 0 12px;color:var(--muted);line-height:1.5}.support-card{padding:22px;border:2px solid #b8d8cd;background:linear-gradient(145deg,#fff,#f3faf7)}.request-card{border-left:5px solid var(--accent)}.request-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.request-form label{display:grid;gap:5px;font-weight:750}.request-form input,.request-form textarea{width:100%;padding:11px;border:1px solid var(--line);border-radius:9px;font:inherit}.request-form textarea{min-height:92px;resize:vertical}.request-form .full{grid-column:1/-1}@media(max-width:620px){.request-form{grid-template-columns:1fr}.request-form .full{grid-column:auto}}#pairForm{display:grid;gap:12px;margin-top:16px}.code-label{font-weight:850}.code-entry{display:grid;grid-template-columns:minmax(150px,1fr) minmax(210px,auto);gap:10px}.code-entry input{width:100%;padding:14px 16px;border:2px solid #a7b9c1;border-radius:10px;font:900 23px/1 Segoe UI,Arial;letter-spacing:.18em;text-transform:uppercase;text-align:center}.primary-button{border:0;border-radius:10px;padding:13px 18px;background:var(--accent);color:#fff;font:850 16px Segoe UI,Arial;cursor:pointer}.primary-button:hover{background:var(--accent-dark)}button{min-height:46px}.control-choice{display:flex;align-items:flex-start;gap:9px;font-size:14px}.control-choice input{width:19px;height:19px;flex:none}.pair-result{min-height:21px;font-size:14px;font-weight:850;color:var(--muted)}.pair-result.success{color:var(--accent)}.pair-result.error{color:var(--danger)}.active-card{border-color:#e4b3af;background:#fff8f7}.stop-button{width:100%;border:0;border-radius:10px;padding:13px;background:var(--danger);color:#fff;font:850 16px Segoe UI,Arial;cursor:pointer}.credential-card{border-left:5px solid #d79a2b;background:#fffaf0}.threat-card{border:2px solid #df8e84;background:#fff1ef;color:#7f2923}.threat-card p{color:#633c38}.pair-controls{display:grid;grid-template-columns:1fr auto;gap:9px}.pair-controls input,#unattendedForm input{width:100%;padding:12px;border:1px solid var(--line);border-radius:9px;font:inherit}.pair-button{border:0;border-radius:9px;padding:11px 15px;background:var(--accent);color:#fff;font-weight:800}.advanced{background:transparent;box-shadow:none;padding:0}.advanced>summary{min-height:50px;display:flex;align-items:center;padding:0 16px;border-radius:12px;background:var(--panel);border:1px solid var(--line);cursor:pointer;font-weight:850;color:var(--muted)}.advanced[open]>summary{color:var(--ink);border-radius:12px 12px 0 0}.advanced-body{display:grid;gap:12px;padding:14px;border:1px solid var(--line);border-top:0;background:#fafcfc;border-radius:0 0 12px 12px}.status-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.status-item{padding:10px;border-radius:9px;background:#fff;border:1px solid var(--line)}.status-item strong{display:block}.status-item span,small{color:var(--muted);font-size:12px}.inner-card{padding:14px;box-shadow:none}.inner-card h2{font-size:16px}.unattended-enabled,.unattended-disabled{padding:10px;border-radius:9px;background:var(--soft);margin:8px 0}.unattended-check{display:flex;align-items:center;gap:8px;font-size:14px}.unattended-check input{width:18px!important;height:18px}.actions{display:flex;flex-wrap:wrap;gap:8px}.secondary{border:1px solid var(--line);border-radius:9px;padding:10px 13px;background:#fff;color:var(--ink);font-weight:800;cursor:pointer}.technical summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:800;color:var(--muted)}.session{display:grid;gap:6px;padding:10px;border:1px solid var(--line);border-radius:9px;background:#fff}.session>div{display:flex;justify-content:space-between;gap:8px}.session span{color:var(--muted);font-size:12px}.ticket-session-list{display:grid;gap:12px;margin:14px 0}.ticket-session-list .session{padding:15px}.session h3{margin:2px 0 4px;font-size:16px}.session>.permission-box{display:block}.permission-box{margin-top:10px;padding:13px;border-radius:10px;background:#eef8f4;border:1px solid #b8d8cd}.permission-box.warning{background:#fff8e9;border-color:#e5c27c}.permission-box p{margin:5px 0 10px}.permission-actions{display:flex;flex-wrap:wrap;gap:8px}.permission-actions button{min-height:40px;padding:9px 12px;font-size:14px}.permission-actions .reject{color:var(--danger);border-color:#dfb3af}.permission-summary{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.permission-summary span{padding:7px 9px;border-radius:999px;font-weight:800}.permission-summary .ok{background:#e5f4ee;color:var(--accent-dark)}.permission-summary .locked{background:#eef1f2;color:#56666e}ul{margin:0;padding-left:18px;color:var(--muted)}code{overflow-wrap:anywhere}button:disabled{opacity:.65;cursor:wait}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid rgba(25,113,83,.25);outline-offset:2px}@media(max-width:620px){main{padding:18px 12px 30px}.code-entry,.pair-controls,.status-list{grid-template-columns:1fr}.primary-button{width:100%}}
</style>
</head>
<body>
  <main>
    <header class="hero">
      <div class="brand-row"><h1>SAS Cliente</h1><span class="state-pill">${status.agent?.status === "online" ? "Listo para soporte" : "Conectando"}</span></div>
      <div class="banner ${risk}">${escapeHtml(bannerText)}</div>
    </header>
    ${securityAlert}
    ${credentialRecovery}
    ${!status.supportSessionCount ? `<section id="solicitar-soporte" class="request-card">
      <h2>Solicitar soporte</h2>
      <p>Envía tus datos y el problema desde este equipo. El ticket quedará vinculado automáticamente a <strong>${escapeHtml(status.identity.hostname)}</strong>.</p>
      <form id="supportRequestForm" class="request-form">
        <label>Nombre completo<input id="supportCustomerName" autocomplete="name" minlength="2" value="${escapeHtml(status.identity.username || "")}" required></label>
        <label>Empresa<input id="supportCompany" autocomplete="organization" minlength="2" required></label>
        <label>WhatsApp de México<input id="supportPhone" type="tel" autocomplete="tel" inputmode="tel" placeholder="55 1234 5678" pattern="(?:\\+?52[ -]?)?(?:1[ -]?)?[2-9](?:[ -]?\\d){9}" required><small>Escribe 10 dígitos; también aceptamos +52.</small></label>
        <label>Correo<input id="supportEmail" type="email" autocomplete="email" required></label>
        <label class="full">¿Qué problema tienes?<textarea id="supportDescription" minlength="5" required placeholder="Describe qué sucede, desde cuándo y cualquier mensaje de error."></textarea></label>
        <button id="supportRequestButton" class="primary-button full" type="submit">Crear ticket de soporte</button>
        <div id="supportRequestResult" class="pair-result full" aria-live="polite"></div>
      </form>
    </section>` : ""}
    ${status.supportSessionCount ? `
      <section class="active-card">
        <h2>${status.activeSessionCount ? "Soporte en curso" : "Esperando soporte"}</h2>
        <p>${status.controlActive ? "El técnico puede ver la pantalla y utilizar teclado y ratón." : status.screenShareActive ? "El técnico puede ver la pantalla. El teclado y ratón siguen bloqueados." : "El ticket ya está asignado automáticamente a este equipo. No necesitas copiar ni escribir ningún código."}</p>
        <div class="ticket-session-list">${sessions}</div>
        <button id="stop" class="stop-button" type="button">${status.activeSessionCount ? "Finalizar soporte ahora" : "Cancelar solicitud"}</button>
      </section>` : `
      <details class="advanced manual-code">
        <summary>Ya tengo un código proporcionado por el técnico</summary>
        <div class="advanced-body support-card">
        <h2>Recibir soporte con código</h2>
        <p>Escribe el código que te proporcionó el técnico. Con una sola confirmación se vinculará este equipo y comenzará la asistencia.</p>
        <form id="pairForm">
          <label class="code-label" for="joinCode">Código de soporte</label>
          <div class="code-entry">
            <input id="joinCode" name="joinCode" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="one-time-code" spellcheck="false" placeholder="ABC123" required>
            <button class="primary-button" id="quickAuthorizeButton" type="submit">Permitir soporte ahora</button>
          </div>
          <label class="control-choice"><input id="quickAllowControl" type="checkbox" checked> <span>Permitir pantalla, teclado y mouse durante esta sesión</span></label>
          <div id="pairResult" class="pair-result" aria-live="polite"></div>
          <small>El permiso sirve solamente para esta sesión y puedes finalizarlo en cualquier momento.</small>
        </form>
        </div>
      </details>`}
    <section class="unattended-card">
      <h2>Acceso desatendido de este equipo</h2><p>Úsalo sólo para mantenimiento autorizado y no uses la contraseña de Windows.</p>
      <div class="${status.unattendedAccess?.enabled ? "unattended-enabled" : "unattended-disabled"}"><strong>${status.unattendedAccess?.enabled ? "Contraseña desatendida establecida" : "Contraseña desatendida no establecida"}</strong><div>${status.unattendedAccess?.enabled ? (status.unattendedAccess.allowControl ? "Incluye pantalla, teclado y mouse." : "Solamente permite ver la pantalla.") : "Cada asistencia requiere el código y tu confirmación."}</div></div>
      <p>La contraseña ya no se solicita desde esta página. Para establecerla, cambiarla o deshabilitarla, abre el icono <strong>SAS Cliente</strong> en la bandeja de Windows y selecciona <strong>Configurar acceso desatendido…</strong>.</p>

    </section>
    <details class="advanced">
      <summary>Opciones avanzadas y estado del equipo</summary>
      <div class="advanced-body">
        <div class="status-list">
          <div class="status-item"><strong>${escapeHtml(status.identity.hostname)}</strong><span>Equipo</span></div>
          <div class="status-item"><strong>${status.connection.credentialRejected ? "Requiere vinculación" : status.agent?.status === "online" ? "Conectado" : "Comprobando"}</strong><span>Servicio SAS</span></div>
          <div class="status-item"><strong>${status.screenShareActive ? "Activa" : "Detenida"}</strong><span>Vista remota</span></div>
          <div class="status-item"><strong>${status.controlActive ? "Permitidos" : "Bloqueados"}</strong><span>Teclado y mouse</span></div>
        </div>
        ${!status.supportSessionCount ? `<section class="inner-card"><h2>Vincular sin iniciar soporte</h2><p>Úsalo solamente si el técnico te lo solicita. Vincular por sí solo no concede acceso remoto.</p><button id="pairOnlyButton" class="secondary" type="button">Solo vincular este equipo</button></section>` : ""}

        <section class="inner-card"><details class="technical"><summary>Información técnica</summary><p><strong>Servidor:</strong> ${escapeHtml(status.serverUrl)}</p><p><strong>Último contacto:</strong> ${escapeHtml(status.lastPollAt ?? "pendiente")}</p><p><strong>Captura:</strong> ${status.captureHelperExists ? "disponible" : "pendiente"} · <strong>Control:</strong> ${status.inputHelperExists ? "disponible" : "pendiente"} · <strong>UAC/elevado:</strong> ${status.privilegedDesktopBrokerExists ? "servicio disponible" : "pendiente"}</p></details><div class="actions"><button class="secondary" id="refresh" type="button">Actualizar estado</button></div></section>
      </div>
    </details>
  </main>
  <script>
    function normalizeSupportWhatsApp(value) {
      let digits = String(value || '').replace(/\\D/g, '');
      if (digits.startsWith('00')) digits = digits.slice(2);
      if (digits.length === 10) digits = '52' + digits;
      if (digits.length === 13 && digits.startsWith('521')) digits = '52' + digits.slice(3);
      if (!/^52[2-9]\\d{9}$/.test(digits)) throw new Error('Escribe un WhatsApp de México con 10 dígitos, por ejemplo 55 1234 5678.');
      return digits;
    }
    document.querySelector('#supportRequestForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = document.querySelector('#supportRequestButton');
      const result = document.querySelector('#supportRequestResult');
      if (!form.reportValidity()) return;
      const customerName = document.querySelector('#supportCustomerName').value.trim();
      const company = document.querySelector('#supportCompany').value.trim();
      const email = document.querySelector('#supportEmail').value.trim().toLowerCase();
      const description = document.querySelector('#supportDescription').value.trim();
      let customerPhone;
      try { customerPhone = normalizeSupportWhatsApp(document.querySelector('#supportPhone').value); }
      catch (error) { result.className = 'pair-result error'; result.textContent = error.message; document.querySelector('#supportPhone').focus(); return; }
      button.disabled = true; result.className = 'pair-result'; result.textContent = 'Creando, asignando y notificando el ticket...';
      try {
        const response = await fetch('/support-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerName, company, customerPhone, email, description }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'No fue posible crear el ticket');
        result.className = 'pair-result success'; result.textContent = 'Ticket ' + payload.ticket.id + ' creado y asignado automáticamente a este equipo. Esperando soporte.';
        setTimeout(() => location.reload(), 800);
      } catch (error) { result.className = 'pair-result error'; result.textContent = error.message; button.disabled = false; }
    });
    document.querySelector('#enrollForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.querySelector('#enrollmentToken');
      const button = event.currentTarget.querySelector('button');
      const result = document.querySelector('#enrollResult');
      const enrollmentToken = input.value.trim().toUpperCase();
      input.value = enrollmentToken;
      button.disabled = true;
      result.className = 'pair-result';
      result.textContent = 'Renovando vinculación segura...';
      try {
        const response = await fetch('/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enrollmentToken }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'No fue posible renovar la vinculación');
        result.className = 'pair-result success';
        result.textContent = 'Vinculación renovada. SAS ya puede conectarse.';
        setTimeout(() => location.reload(), 1200);
      } catch (error) {
        result.className = 'pair-result error';
        result.textContent = error.message;
        button.disabled = false;
      }
    });
    async function submitSupport(path, progressText, successText, button) {
      const input = document.querySelector('#joinCode');
      const result = document.querySelector('#pairResult');
      const joinCode = input?.value.trim().toUpperCase() || '';
      if (input) input.value = joinCode;
      if (!/^[A-Z0-9]{6}$/.test(joinCode)) { result.className = 'pair-result error'; result.textContent = 'Escribe el código de 6 caracteres.'; input?.focus(); return; }
      button.disabled = true; result.className = 'pair-result'; result.textContent = progressText;
      try {
        const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ joinCode, allowControl: document.querySelector('#quickAllowControl')?.checked === true }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'No fue posible conectar el soporte');
        result.className = 'pair-result success'; result.textContent = successText;
        setTimeout(() => location.reload(), 900);
      } catch (error) { result.className = 'pair-result error'; result.textContent = error.message; button.disabled = false; }
    }
    document.querySelector('#pairForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitSupport('/quick-authorize', 'Conectando con el técnico...', 'Soporte autorizado. Iniciando pantalla remota...', document.querySelector('#quickAuthorizeButton'));
    });
    document.querySelector('#pairOnlyButton')?.addEventListener('click', async (event) => {
      await submitSupport('/pair', 'Vinculando este equipo...', 'Equipo vinculado. El soporte todavía no está autorizado.', event.currentTarget);
    });
    async function sendPermissionDecision(path, button, payload) {
      const buttons = document.querySelectorAll('[data-session-decision],[data-control-decision]');
      buttons.forEach(item => item.disabled = true);
      const original = button.textContent;
      button.textContent = 'Guardando decisión...';
      try {
        const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No fue posible guardar el permiso');
        location.reload();
      } catch (error) {
        alert(error.message);
        button.textContent = original;
        buttons.forEach(item => item.disabled = false);
      }
    }
    document.querySelectorAll('[data-session-decision]').forEach(button => button.addEventListener('click', () => sendPermissionDecision('/session-consent', button, {
      sessionId: button.dataset.sessionId,
      decision: button.dataset.sessionDecision,
      allowControl: button.dataset.allowControl === 'true'
    })));
    document.querySelectorAll('[data-control-decision]').forEach(button => button.addEventListener('click', () => sendPermissionDecision('/control-consent', button, {
      sessionId: button.dataset.sessionId,
      decision: button.dataset.controlDecision
    })));    document.querySelector('#stop')?.addEventListener('click', async () => {
      const ok = confirm('Esto cerrará las sesiones remotas activas en este equipo.');
      if (!ok) return;
      const response = await fetch('/stop', { method: 'POST' });
      const payload = await response.json();
      alert(payload.stopped ? 'Sesiones finalizadas.' : JSON.stringify(payload));
      location.reload();
    });
    document.querySelector('#refresh').addEventListener('click', () => location.reload());
    const initialSessionState = JSON.stringify(${JSON.stringify(status.sessions.map((item) => [item.id, item.status, item.consent?.decision, item.controlConsent?.decision, Boolean(item.screenShare?.enabled)]))});
    setInterval(async () => {
      try {
        const current = await fetch('/status', { cache: 'no-store' }).then(response => response.json());
        const signature = JSON.stringify((current.sessions || []).map(item => [item.id, item.status, item.consent?.decision, item.controlConsent?.decision, Boolean(item.screenShare?.enabled)]));
        if (signature !== initialSessionState) location.reload();
      } catch { }
    }, 3000);
  </script>
</body>
</html>`;
}
function sendLocalJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function readLocalJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > 4096) tooLarge = true;
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("Solicitud local demasiado grande");
        error.statusCode = 413;
        return reject(error);
      }
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const error = new Error("Solicitud JSON inválida");
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}
function readStoredCredential() {
  return String(readJsonFile(config.credentialFile)?.agentSecret ?? "").trim();
}

async function ensureAgentCredential() {
  if (agentSecret && agentSecret !== "change-agent-secret") return;
  if (!config.enrollmentToken) throw new Error("Falta codigo temporal de instalacion");
  await enrollWithToken(config.enrollmentToken);
}

async function enrollWithDeploymentToken(deploymentToken) {
  const response = await fetchServer(new URL("/api/agents/deploy-enroll", config.serverUrl), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...buildAgentPayload(), deploymentToken })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.agentSecret) { const error = new Error(body.error ?? `Deployment enrollment HTTP ${response.status}`); error.statusCode = response.status; throw error; }
  agentSecret = body.agentSecret;
  fs.mkdirSync(path.dirname(config.credentialFile), { recursive: true });
  fs.writeFileSync(config.credentialFile, JSON.stringify({ agentSecret, agentId: identity.machineId, enrolledAt: new Date().toISOString(), deployment: body.campaign ?? null }, null, 2), { mode: 0o600 });
  lastConnectionError = null;
}
async function enrollWithToken(enrollmentToken) {
  const response = await fetchServer(new URL("/api/agents/enroll", config.serverUrl), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...buildAgentPayload(), enrollmentToken })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.agentSecret) {
    const error = new Error(body.error ?? `Enrollment HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  agentSecret = body.agentSecret;
  fs.mkdirSync(path.dirname(config.credentialFile), { recursive: true });
  fs.writeFileSync(config.credentialFile, JSON.stringify({ agentSecret, agentId: identity.machineId, enrolledAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  lastConnectionError = null;
}

async function register() {
  const response = await postJson("/api/agents/register", buildAgentPayload());
  console.log(`[SAS Agent] registered ${response.agent?.machineId ?? identity.machineId}`);
}

async function poll() {
  const response = await postJson("/api/agents/poll", buildAgentPayload());
  const sessions = response.sessions ?? [];
  const previousSessions = new Map(activeRemoteSessions);
  lastAgentStatus = response.agent ?? null;
  lastSessions = sessions;
  activeRemoteSessions.clear();
  for (const currentSession of sessions) activeRemoteSessions.set(currentSession.id, currentSession);
  for (const [previousId] of previousSessions) {
    const current = activeRemoteSessions.get(previousId);
    const remainsAuthorized = current?.status === "active" && current?.consent?.decision === "approved" && current?.controlConsent?.decision === "approved";
    if (!remainsAuthorized && heldInputBySession.has(previousId)) releaseSessionInput(previousId, current ? "permission_revoked" : "session_disconnected").catch((error) => console.error("[SAS Agent] liberación de entrada " + previousId + ": " + error.message));
  }
  lastPollAt = new Date().toISOString();
  lastConnectionError = null;
  if (Date.now() - lastHeartbeatLogAt >= 60000 || sessions.length !== lastHeartbeatSessionCount) {
    console.log(`[SAS Agent] conectado ${response.agent?.lastSeenAt ?? new Date().toISOString()} · sesiones ${sessions.length}`);
    lastHeartbeatLogAt = Date.now();
    lastHeartbeatSessionCount = sessions.length;
  }

  if (fs.existsSync(config.stopFilePath)) {
    await closeSessionsFromLocalStop(sessions);
    fs.unlinkSync(config.stopFilePath);
    return;
  }

  for (const session of sessions) {
    if (session.consent?.decision === "approved" && session.controlConsent?.decision === "approved" && !["closed", "consent_rejected"].includes(session.status)) {
      ensurePrivilegedBrokerGrant(true, session.id).catch((error) => { inputBridgeStatus = { ...inputBridgeStatus, privilegedReady: false, message: "Control UAC pendiente: " + compactInputError(error), checkedAt: new Date().toISOString() }; });
    }
    if (session.unattendedRequest?.decision === "pending") await respondToUnattendedRequest(session);
    else {
      requestDesktopConsent(session);
      requestDesktopControlConsent(session);
    }
    for (const command of session.commands ?? []) {
      if (completedCommands.has(command.id)) continue;
      rememberCompleted(completedCommands, command.id);
      await executeAndReport(session, command);
    }

    for (const event of session.interactiveEvents ?? []) {
      if (completedEvents.has(event.id)) continue;
      rememberCompleted(completedEvents, event.id);
      await simulateAndReportInteractiveEvent(session, event);
    }
  }
  const visibleSessionIds = new Set(sessions.map((session) => session.id));
  for (const sessionId of latestFrameBySession.keys()) if (!visibleSessionIds.has(sessionId)) latestFrameBySession.delete(sessionId);
  for (const sessionId of latestHttpsFrameAtBySession.keys()) if (!visibleSessionIds.has(sessionId)) latestHttpsFrameAtBySession.delete(sessionId);
  for (const sessionId of directPointerStateBySession.keys()) if (!visibleSessionIds.has(sessionId)) directPointerStateBySession.delete(sessionId);
  await syncWebRtcForSessions(sessions);
}


function loadWebRtcRuntime() {
  if (webRtcRuntime || webRtcRuntimeError) return webRtcRuntime;
  try { webRtcRuntime = require("./webrtc-runtime/node_modules/node-datachannel"); return webRtcRuntime; }
  catch (error) { webRtcRuntimeError = error.message; console.error("[SAS Agent] WebRTC no disponible: " + error.message); return null; }
}
async function getAgentJson(pathname) {
  const response = await fetchServer(new URL(pathname, config.serverUrl), { headers: { "x-agent-secret": agentSecret, "x-agent-id": identity.machineId } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}
function closeWebRtcPeer(sessionId) {
  const state = webRtcPeers.get(sessionId); if (!state) return;
  if (heldInputBySession.has(sessionId)) releaseSessionInput(sessionId, "webrtc_closed").catch(() => {});
  try { state.channel?.close(); } catch {} try { state.controlChannel?.close(); } catch {} try { state.peer?.close(); } catch {}
  webRtcPeers.delete(sessionId);
}
function createWebRtcPeer(sessionId, iceServers = [], negotiationId = "", transportOptions = {}) {
  const rtc = loadWebRtcRuntime(); if (!rtc) return null;
  closeWebRtcPeer(sessionId);
  const peerConfig = {
    iceServers,
    enableIceTcp: true,
    maxMessageSize: 1024 * 1024,
    ...(Number(transportOptions.udpMinPort) >= 1024 ? { portRangeBegin: Number(transportOptions.udpMinPort) } : {}),
    ...(Number(transportOptions.udpMaxPort) >= Number(transportOptions.udpMinPort) ? { portRangeEnd: Number(transportOptions.udpMaxPort) } : {})
  };
  const state = {
    sessionId,
    negotiationId,
    peer: new rtc.PeerConnection(`SAS-${identity.machineId.slice(0, 12)}`, peerConfig),
    channel: null,
    controlChannel: null,
    open: false,
    controlOpen: false,
    after: 0,
    frameSequence: 0,
    lastFrameSentAt: 0,
    screenAdaptive: createAdaptiveScreenState(),
    viewerFeedback: null,
    screenTelemetry: null,
    createdAt: Date.now()
  };
  state.peer.onLocalDescription((sdp, type) => postJson("/api/agents/webrtc-signals", { sessionId, negotiationId: state.negotiationId, type, sdp }).catch((error) => console.error("[SAS Agent] SDP WebRTC: " + error.message)));
  state.peer.onLocalCandidate((candidate, mid) => postJson("/api/agents/webrtc-signals", { sessionId, negotiationId: state.negotiationId, type: "ice", candidate: { candidate, sdpMid: mid } }).catch((error) => console.error("[SAS Agent] ICE WebRTC: " + error.message)));
  state.peer.onStateChange((value) => {
    state.connectionState = String(value).toLowerCase();
    if (["failed", "closed", "disconnected"].includes(state.connectionState)) state.open = false;
    console.log(`[SAS Agent] WebRTC ${sessionId}: ${state.connectionState}`);
  });
  state.peer.onIceStateChange((value) => { state.iceState = String(value).toLowerCase(); });
  state.peer.onGatheringStateChange((value) => { state.gatheringState = String(value).toLowerCase(); });
  state.peer.onDataChannel((channel) => {
    const label = channel.getLabel();
    if (label === "sas-screen") {
      state.channel = channel;
      channel.setBufferedAmountLowThreshold(192 * 1024);
      channel.onOpen(() => { state.open = true; state.openedAt = Date.now(); console.log(`[SAS Agent] WebRTC directo activo ${sessionId}`); });
      channel.onClosed(() => { state.open = false; });
      channel.onError((error) => { state.open = false; console.error("[SAS Agent] canal WebRTC de imagen: " + error); });
      return;
    }
    if (label === "sas-control") {
      state.controlChannel = channel;
      channel.onOpen(() => { state.controlOpen = true; console.log(`[SAS Agent] control WebRTC confiable activo ${sessionId}`); });
      channel.onClosed(() => { state.controlOpen = false; });
      channel.onError((error) => { state.controlOpen = false; console.error("[SAS Agent] canal WebRTC de control: " + error); });
      channel.onMessage((message) => handleWebRtcControlMessage(sessionId, message).catch((error) => console.error("[SAS Agent] control WebRTC rechazado: " + error.message)));
      return;
    }
    channel.close();
  });
  webRtcPeers.set(sessionId, state); return state;
}
async function syncWebRtcForSessions(sessions) {
  const rtc = loadWebRtcRuntime(); if (!rtc) return;
  const active = new Set(sessions.filter((item) => item.screenShare?.enabled && item.consent?.decision === "approved" && !["closed", "expired", "consent_rejected"].includes(item.status)).map((item) => item.id));
  for (const id of [...webRtcPeers.keys()]) if (!active.has(id)) closeWebRtcPeer(id);
  for (const session of sessions) {
    if (!active.has(session.id)) continue;
    let state = webRtcPeers.get(session.id);
    const after = state?.after ?? 0;
    const data = await getAgentJson(`/api/agents/webrtc-signals?sessionId=${encodeURIComponent(session.id)}&after=${after}`).catch(() => null);
    if (!data?.webrtc?.enabled) continue;
    const signals = data.signals ?? [];
    const newestOffer = [...signals].reverse().find((signal) => signal.type === "offer" && signal.sdp);
    if (newestOffer && (!state || state.negotiationId !== String(newestOffer.negotiationId ?? ""))) {
      try {
        state = createWebRtcPeer(session.id, data.webrtc.iceServers ?? [], String(newestOffer.negotiationId ?? ""), data.webrtc);
        if (state) {
          state.after = Number(newestOffer.id) || 0;
          state.peer.setRemoteDescription(newestOffer.sdp, "offer");
        }
      } catch (error) {
        console.error(`[SAS Agent] oferta WebRTC rechazada ${session.id}: ${error.message}`);
        closeWebRtcPeer(session.id);
        state = null;
      }
    }
    for (const signal of signals) {
      try {
        if (signal.type === "offer") continue;
        if (!state) continue;
        if (signal.negotiationId && signal.negotiationId !== state.negotiationId) continue;
        state.after = Math.max(state.after, Number(signal.id) || 0);
        if (signal.type === "ice" && signal.candidate?.candidate) state.peer.addRemoteCandidate(signal.candidate.candidate, signal.candidate.sdpMid || "0");
        else if (signal.type === "bye") closeWebRtcPeer(session.id);
      } catch (error) {
        console.error(`[SAS Agent] senal WebRTC rechazada ${session.id}: ${error.message}`);
      }
    }
  }
}
const allowedWebRtcControlEvents = new Set(["mouse_click", "mouse_double_click", "mouse_move_relative", "mouse_button", "mouse_wheel", "key_down", "key_up", "key_press", "text_input", "release_input", "secure_attention", "privileged_authorize"]);
function queueDirectPointerMove(session, payload) {
  let state = directPointerStateBySession.get(session.id);
  if (!state) { state = { running: false, latest: null, delivered: 0, lastError: null }; directPointerStateBySession.set(session.id, state); }
  state.latest = { relativeX: clampNumber(payload?.relativeX, 0, 1), relativeY: clampNumber(payload?.relativeY, 0, 1), button: "left" };
  if (state.running) return;
  state.running = true;
  (async () => {
    try {
      while (state.latest) {
        const current = state.latest; state.latest = null;
        const result = await simulateInteractiveEvent(session, { id: "PTR-" + Date.now().toString(36), type: "mouse_move", payload: current });
        if (result?.ok === false) state.lastError = result.error; else { state.delivered += 1; state.lastError = null; }
      }
    } finally { state.running = false; if (state.latest) queueDirectPointerMove(session, state.latest); }
  })().catch((error) => { state.lastError = error.message; state.running = false; });
}
async function handleWebRtcControlMessage(sessionId, rawMessage) {
  const text = typeof rawMessage === "string" ? rawMessage : Buffer.from(rawMessage).toString("utf8");
  if (text.length > 32 * 1024) throw new Error("control_message_too_large");
  const message = JSON.parse(text);
  if (message?.sessionId !== sessionId) throw new Error("invalid_control_message");
  const session = activeRemoteSessions.get(sessionId);
  if (!session || session.status !== "active" || session.consent?.decision !== "approved") throw new Error("session_not_authorized");
  if (message.kind === "sas_video_feedback") {
    const state = webRtcPeers.get(sessionId);
    if (state) state.viewerFeedback = {
      fps: clampNumber(message.payload?.fps ?? 0, 0, 120),
      staleMs: clampNumber(message.payload?.staleMs ?? 0, 0, 60000),
      incompleteFrames: clampNumber(message.payload?.incompleteFrames ?? 0, 0, 1000000),
      receivedFrames: clampNumber(message.payload?.receivedFrames ?? 0, 0, 100000000),
      receivedBytes: clampNumber(message.payload?.receivedBytes ?? 0, 0, Number.MAX_SAFE_INTEGER),
      at: Date.now()
    };
    return;
  }
  if (session.controlConsent?.decision !== "approved") throw new Error("control_not_authorized");
  if (message.kind === "sas_pointer_move") { queueDirectPointerMove(session, message.payload); return; }
  if (message.kind !== "sas_control_event") throw new Error("invalid_control_message");
  const event = message.event;
  if (!event?.id || !allowedWebRtcControlEvents.has(event.type)) throw new Error("control_event_not_allowed");
  if (completedEvents.has(event.id)) return;
  rememberCompleted(completedEvents, event.id);
  await simulateAndReportInteractiveEvent(session, { id: String(event.id), type: event.type, payload: event.payload ?? {} });
}

function sendWebRtcFrame(sessionId, frame) {
  const state = webRtcPeers.get(sessionId), channel = state?.channel;
  if (!state?.open || !channel?.isOpen?.()) return false;
  if (channel.bufferedAmount() > 160 * 1024) { state.droppedFrames = Number(state.droppedFrames ?? 0) + 1; return false; }
  try {
    const image = Buffer.from(frame.imageBase64, "base64"), metadata = Buffer.from(JSON.stringify({ ...frame, imageBase64: undefined, transport: "webrtc", receivedFrom: identity.machineId }), "utf8");
    const chunkSize = Math.max(8 * 1024, Math.min(24 * 1024, Number(channel.maxMessageSize?.() ?? 64 * 1024) - 1024)), total = Math.ceil(image.length / chunkSize), frameId = ++state.frameSequence;
    if (total < 1 || total > 256) { state.lastSendError = "frame_chunk_count_out_of_range"; return false; }
    for (let index = 0; index < total; index += 1) {
      const chunk = image.subarray(index * chunkSize, Math.min(image.length, (index + 1) * chunkSize)), meta = index === 0 ? metadata : Buffer.alloc(0), packet = Buffer.allocUnsafe(16 + meta.length + chunk.length);
      packet.write("SASF", 0, 4, "ascii"); packet.writeUInt32BE(frameId >>> 0, 4); packet.writeUInt16BE(index, 8); packet.writeUInt16BE(total, 10); packet.writeUInt32BE(meta.length, 12); meta.copy(packet, 16); chunk.copy(packet, 16 + meta.length);
      if (!channel.sendMessageBinary(packet)) { state.lastSendError = "datachannel_backpressure"; return false; }
    }
    state.lastFrameSentAt = Date.now();
    state.lastFrameBytes = image.length;
    state.lastSendError = null;
    state.droppedFrames = Math.max(0, Number(state.droppedFrames ?? 0) - 1);
    return true;
  } catch (error) {
    state.lastSendError = error.message;
    if (Date.now() - Number(state.lastSendErrorLoggedAt ?? 0) > 10000) { console.error("[SAS Agent] envio WebRTC: " + error.message); state.lastSendErrorLoggedAt = Date.now(); }
    return false;
  }
}
async function pumpScreenFrames() {
  if (screenFramePumpBusy) return;
  const active = lastSessions.filter((item) => item.screenShare?.enabled && item.consent?.decision === "approved" && !["closed", "expired", "consent_rejected"].includes(item.status));
  if (!active.length) return;
  screenFramePumpBusy = true;
  try {
    for (const session of active.slice(0, 2)) {
      const requested = session.screenShare ?? {};
      const rtcState = webRtcPeers.get(session.id);
      const bufferedBytes = Number(rtcState?.channel?.bufferedAmount?.() ?? 0);
      const adaptiveState = rtcState?.screenAdaptive ?? createAdaptiveScreenState();
      if (rtcState && !rtcState.screenAdaptive) rtcState.screenAdaptive = adaptiveState;
      const viewerFeedback = rtcState?.viewerFeedback?.at > Date.now() - 10000 ? rtcState.viewerFeedback : null;
      const plan = rtcState?.open ? adaptiveScreenPlan(adaptiveState, {
        bufferedBytes,
        captureMs: adaptiveState.captureMsAverage,
        viewerFps: viewerFeedback?.fps,
        viewerStaleMs: viewerFeedback?.staleMs,
        requestedQuality: requested.quality,
        requestedMaxWidth: requested.maxWidth,
        nativeResolution: requested.nativeResolution === true
      }) : {
        mode: "https_fallback",
        intervalMs: Math.max(250, Number(requested.intervalSeconds ?? 1) * 1000),
        quality: Math.min(55, Number(requested.quality ?? 55)),
        maxWidth: Math.min(1440, Number(requested.maxWidth ?? 1600)),
        skipCapture: false,
        bufferedBytes,
        congestionScore: 0
      };
      const previousCaptureAt = Number(rtcState?.lastCaptureAt ?? Date.parse(latestFrameBySession.get(session.id)?.capturedAt ?? "")) || 0;
      if (Date.now() - previousCaptureAt < plan.intervalMs) continue;
      if (rtcState?.open && plan.skipCapture) {
        adaptiveState.droppedFrames += 1;
        adaptiveState.consecutiveDrops += 1;
        rtcState.screenTelemetry = publicScreenTelemetry(adaptiveState, plan, { bufferedBytes, viewerFeedback });
        continue;
      }
      if (rtcState) rtcState.lastCaptureAt = Date.now();
      let frame;
      const captureStartedAt = Date.now();
      try {
        frame = await captureScreenshotPreview({
          quality: plan.quality,
          maxWidth: plan.maxWidth,
          monitorIndex: Number(requested.monitorIndex ?? 0),
          nativeResolution: requested.nativeResolution === true
        });
      } catch (error) {
        lastCaptureStatus = { status: "failed", at: new Date().toISOString(), error: error.message, sessionId: session.id, bytes: 0 };
        console.error("[SAS Agent] captura remota: " + error.message);
        continue;
      }
      if (!frame?.imageBase64) { lastCaptureStatus = { status: "empty", at: new Date().toISOString(), error: "capture_returned_no_image", sessionId: session.id, bytes: 0 }; continue; }
      const captureMs = Date.now() - captureStartedAt;
      const frameBytes = Buffer.byteLength(frame.imageBase64, "base64");
      frame.telemetry = { captureMs, frameBytes, adaptiveMode: plan.mode, quality: plan.quality, maxWidth: plan.maxWidth, bufferedBytesBeforeSend: bufferedBytes };
      latestFrameBySession.set(session.id, frame);
      const sentByWebRtc = sendWebRtcFrame(session.id, frame);
      recordScreenCapture(adaptiveState, { captureMs, bytes: frameBytes, sent: sentByWebRtc });
      if (rtcState) rtcState.screenTelemetry = publicScreenTelemetry(adaptiveState, plan, { bufferedBytes, captureMs, frameBytes, viewerFeedback });
      lastCaptureStatus = { status: "captured", at: frame.capturedAt ?? new Date().toISOString(), error: null, sessionId: session.id, bytes: frameBytes, transport: sentByWebRtc ? "webrtc" : "https", telemetry: rtcState?.screenTelemetry ?? frame.telemetry };
      const lastHttpsAt = Number(latestHttpsFrameAtBySession.get(session.id) ?? 0);
      if (!rtcState?.open || Date.now() - lastHttpsAt >= 2000) {
        await postJson("/api/agents/screen-frame", { sessionId: session.id, frame });
        latestHttpsFrameAtBySession.set(session.id, Date.now());
      }
    }
  } finally {
    screenFramePumpBusy = false;
  }
}
function requestDesktopConsent(session) {
  if (session.status !== "pending_customer_consent" || session.consent?.decision !== "pending") {
    activeConsentPrompts.delete(session.id);
    return;
  }
  if (activeConsentPrompts.has(session.id)) return;
  if (!fs.existsSync(config.consentPromptPath)) {
    console.error(`[SAS Agent] no se encontro el aviso de autorizacion: ${config.consentPromptPath}`);
    return;
  }

  activeConsentPrompts.add(session.id);
  const ticketLabel = session.ticketSubject || session.ticketId || "Solicitud de soporte";
  execFile("powershell.exe", [
    "-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", config.consentPromptPath,
    "-JoinCode", String(session.joinCode ?? ""),
    "-Ticket", String(ticketLabel),
    "-RequestedBy", String(session.requestedBy ?? "Tecnico de soporte")
  ], { windowsHide: true, encoding: "utf8", timeout: 30 * 60 * 1000 }, async (error, stdout) => {
    try {
      if (error) throw error;
      const result = JSON.parse(String(stdout ?? "").trim().split(/\r?\n/).pop() || "{}");
      if (!["approved", "rejected"].includes(result.decision)) return;
      await postJson("/api/agents/session-consent", {
        machineId: identity.machineId,
        sessionId: session.id,
        decision: result.decision,
        allowControl: result.decision === "approved"
      });
      console.log(`[SAS Agent] autorizacion ${result.decision} para ${session.joinCode}`);
      await poll();
    } catch (promptError) {
      console.error(`[SAS Agent] aviso de autorizacion fallo para ${session.joinCode}: ${promptError.message}`);
    } finally {
      activeConsentPrompts.delete(session.id);
    }
  });
}
function requestDesktopControlConsent(session) {
  if (session.consent?.decision !== "approved" || session.controlConsent?.decision !== "pending") {
    activeControlPrompts.delete(session.id);
    return;
  }
  if (activeControlPrompts.has(session.id)) return;
  if (!fs.existsSync(config.controlPromptPath)) {
    console.error(`[SAS Agent] no se encontro el aviso de control: ${config.controlPromptPath}`);
    return;
  }

  activeControlPrompts.add(session.id);
  const ticketLabel = session.ticketSubject || session.ticketId || "Solicitud de soporte";
  execFile("powershell.exe", [
    "-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", config.controlPromptPath,
    "-JoinCode", String(session.joinCode ?? ""),
    "-Ticket", String(ticketLabel),
    "-RequestedBy", String(session.controlConsent?.requestedBy ?? "Tecnico de soporte")
  ], { windowsHide: true, encoding: "utf8", timeout: 30 * 60 * 1000 }, async (error, stdout) => {
    try {
      if (error) throw error;
      const result = JSON.parse(String(stdout ?? "").trim().split(/\r?\n/).pop() || "{}");
      if (!["approved", "rejected"].includes(result.decision)) return;
      await postJson("/api/agents/control-consent", {
        machineId: identity.machineId,
        sessionId: session.id,
        decision: result.decision
      });
      console.log(`[SAS Agent] control ${result.decision} para ${session.joinCode}`);
      await poll();
    } catch (promptError) {
      console.error(`[SAS Agent] aviso de control fallo para ${session.joinCode}: ${promptError.message}`);
    } finally {
      activeControlPrompts.delete(session.id);
    }
  });
}
async function closeSessionsFromLocalStop(sessions) {
  for (const session of sessions) {
    if (["closed", "consent_rejected"].includes(session.status)) continue;
    await postJson("/api/agents/session-close", {
      machineId: identity.machineId,
      sessionId: session.id,
      reason: "local_stop_file"
    }).catch((error) => {
      console.error(`[SAS Agent] local stop failed for ${session.id}: ${error.message}`);
    });
  }
  console.log(`[SAS Agent] local stop processed for ${sessions.length} session(s)`);
}
async function simulateAndReportInteractiveEvent(session, event) {
  const result = await simulateInteractiveEvent(session, event).catch((error) => ({ ok: false, error: error.message }));
  await postJson("/api/agents/event-results", { sessionId: session.id, eventId: event.id, result });
  console.log(`[SAS Agent] interactive event ${event.type} ${result.ok === false ? "failed" : result.data?.simulated === false ? "executed" : "simulated"}`);
}

async function simulateInteractiveEvent(session, event) {
  if (config.enableRealInput && !config.unsignedRestrictedProduction) {
    const execution = await executeRealInputEvent(session, event).catch((error) => ({ ok: false, error: error.message }));
    return execution.ok ? execution : { ok: false, error: execution.error ?? "real_input_failed", data: execution.data ?? null };
  }
  return { ok: true, data: { simulated: true, type: event.type, payload: event.payload ?? {}, receivedAt: new Date().toISOString(), note: "Evento recibido en modo de simulación; el control real no está habilitado en este equipo." } };
}

let privilegedBrokerGrant = null;
let privilegedBrokerGrantExpiresAt = 0;
let lastStaleInputRepairAt = 0;

async function executePrivilegedBrokerRaw(operation, args = [], timeoutMs = 20000) {
  if (process.platform !== "win32" || !agentSecret || agentSecret.length < 24) throw new Error("privileged_broker_credential_unavailable");
  const timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(18).toString("hex");
  const payload = Buffer.from(args.join("\0"), "utf8").toString("base64");
  const signed = ["1", timestamp, nonce, operation, payload].join("|");
  const signature = crypto.createHmac("sha256", agentSecret).update(signed).digest("base64");
  const request = signed + "|" + signature + "\n";
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(config.privilegedBrokerPipe); let response = "", settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error("privileged_broker_timeout")), timeoutMs);
    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); if (response.length > 18 * 1024 * 1024) return finish(new Error("privileged_broker_response_too_large")); const end = response.indexOf("\n"); if (end < 0) return; const line = response.slice(0, end).trim(); if (!line.startsWith("OK ")) return finish(new Error(line.replace(/^ERROR\s*/, "") || "privileged_broker_failed")); try { finish(null, JSON.parse(Buffer.from(line.slice(3), "base64").toString("utf8").replace(/^\uFEFF/, ""))); } catch { finish(new Error("privileged_broker_invalid_response")); } });
    socket.on("error", (error) => finish(new Error("privileged_broker_unavailable: " + error.message)));
  });
}
async function ensurePrivilegedBrokerGrant(preapproved = false, sessionId = "") {
  if (privilegedBrokerGrant && Date.now() < privilegedBrokerGrantExpiresAt - 5000) return { ok: true, grant: privilegedBrokerGrant, expiresAt: new Date(privilegedBrokerGrantExpiresAt).toISOString() };
  const authorization = preapproved && sessionId
    ? await executePrivilegedBrokerRaw("AUTHORIZE_APPROVED", ["--session", sessionId], 5000)
    : await executePrivilegedBrokerRaw("AUTHORIZE", [], 70000);
  if (!authorization?.ok || !authorization.grant) throw new Error(authorization?.error ?? "privileged_control_not_authorized");
  privilegedBrokerGrant = authorization.grant;
  privilegedBrokerGrantExpiresAt = Date.parse(authorization.expiresAt) || Date.now() + 15 * 60 * 1000;
  return authorization;
}
async function executePrivilegedBroker(operation, args = [], timeoutMs = 20000) {
  await ensurePrivilegedBrokerGrant();
  try {
    return await executePrivilegedBrokerRaw(operation, ["--grant", privilegedBrokerGrant, ...args], timeoutMs);
  } catch (error) {
    if (/grant_(required|expired)/.test(error.message)) {
      privilegedBrokerGrant = null;
      privilegedBrokerGrantExpiresAt = 0;
    }
    throw error;
  }
}
function closeNativeHelperServer(key, error = new Error("native_helper_stopped")) {
  const state = nativeHelperServers.get(key); if (!state) return;
  nativeHelperServers.delete(key);
  clearTimeout(state.active?.timer);
  state.active?.reject(error);
  for (const request of state.queue.splice(0)) request.reject(error);
  try { state.process.stdin.end(); } catch {} try { state.process.kill(); } catch {}
}
function ensureNativeHelperServer(key, executable) {
  const existing = nativeHelperServers.get(key);
  if (existing && !existing.process.killed) return existing;
  const child = spawn(executable, ["--server"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const state = { key, executable, process: child, queue: [], active: null, buffer: "", stderr: "", startedAt: Date.now() };
  nativeHelperServers.set(key, state);
  child.stdout.on("data", (chunk) => {
    state.buffer += chunk.toString("utf8");
    let newline;
    while ((newline = state.buffer.indexOf("\n")) >= 0) {
      const line = state.buffer.slice(0, newline).replace(/^\uFEFF/, "").trim(); state.buffer = state.buffer.slice(newline + 1);
      if (!line || !state.active) continue;
      const request = state.active; state.active = null; clearTimeout(request.timer);
      try { request.resolve(JSON.parse(line)); } catch (error) { request.reject(new Error("native_helper_invalid_json: " + error.message)); }
      drainNativeHelperServer(state);
    }
  });
  child.stderr.on("data", (chunk) => { state.stderr = (state.stderr + chunk.toString("utf8")).slice(-4000); });
  child.on("error", (error) => closeNativeHelperServer(key, error));
  child.on("exit", (code) => closeNativeHelperServer(key, new Error("native_helper_exited_" + code + (state.stderr ? ": " + state.stderr.trim() : ""))));
  return state;
}
function drainNativeHelperServer(state) {
  if (state.active || !state.queue.length || state.process.killed) return;
  const request = state.queue.shift(); state.active = request;
  request.timer = setTimeout(() => { if (state.active !== request) return; state.active = null; request.reject(new Error("native_helper_timeout")); closeNativeHelperServer(state.key, new Error("native_helper_timeout")); }, request.timeoutMs);
  const encoded = Buffer.from(request.args.join("\0"), "utf8").toString("base64");
  try { state.process.stdin.write(encoded + "\n"); } catch (error) { clearTimeout(request.timer); state.active = null; request.reject(error); closeNativeHelperServer(state.key, error); }
}
function requestNativeHelper(key, executable, args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => { const state = ensureNativeHelperServer(key, executable); state.queue.push({ args, timeoutMs, resolve, reject, timer: null }); drainNativeHelperServer(state); });
}
function compactInputError(error) {
  return String(error?.message ?? error ?? "unknown").replace(/[\r\n|]+/g, " ").slice(0, 260);
}
function resolveInputHelperPipePath() {
  const status = readJsonFile(config.inputHelperStatusFile);
  const checkedAt = Date.parse(status?.checkedAt ?? 0);
  const pipeName = String(status?.pipe ?? "");
  const activeSessionId = Number(inputBridgeStatus?.sessionId);
  const statusSessionId = Number(status?.sessionId);
  const statusMatchesActiveSession = !Number.isInteger(activeSessionId) || activeSessionId < 0 || (Number.isInteger(statusSessionId) && statusSessionId === activeSessionId);
  if (Number.isFinite(checkedAt) && Date.now() - checkedAt <= 30000 && statusMatchesActiveSession && /^SASInputDesktopV3_S\d+$/.test(pipeName)) return "\\\\.\\pipe\\" + pipeName;
  if (Number.isInteger(activeSessionId) && activeSessionId >= 0) return "\\\\.\\pipe\\SASInputDesktopV3_S" + activeSessionId;
  return config.inputHelperPipe;
}
function requestInputHelperPipe(args, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const pipePath = resolveInputHelperPipePath();
    const socket = net.createConnection(pipePath); let response = "", settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error("input_pipe_timeout")), timeoutMs);
    socket.on("connect", () => socket.write(Buffer.from(args.join("\0"), "utf8").toString("base64") + "\n"));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 1024 * 1024) return finish(new Error("input_pipe_response_too_large"));
      const end = response.indexOf("\n"); if (end < 0) return;
      try {
        const result = JSON.parse(response.slice(0, end).replace(/^\uFEFF/, "").trim());
        if (!result.ok) { const error = new Error(result.error ?? "input_pipe_failed"); error.nativeDiagnostic = result.diagnostic ?? null; return finish(error); }
        finish(null, { ...result, persistent: true, delivery: "desktop_pipe" });
      } catch (error) { finish(new Error("input_pipe_invalid_response: " + error.message)); }
    });
    socket.on("error", (error) => finish(new Error("input_pipe_unavailable: " + error.message)));
  });
}
async function repairStaleInputDesktopHelper(native) {
  const staleRevision = String(native?.helperRevision ?? ""), stalePid = Number(native?.processId);
  if (process.platform !== "win32" || !staleRevision.startsWith("input-") || staleRevision === requiredInputHelperRevision || !Number.isInteger(stalePid) || stalePid <= 0 || stalePid === process.pid || Date.now() - lastStaleInputRepairAt < 10000) return false;
  lastStaleInputRepairAt = Date.now();
  const nativeRoot = path.dirname(path.dirname(config.inputHelperPath));
  const script = "$targetPid=[int]$env:SAS_STALE_INPUT_PID;$nativeRoot=[IO.Path]::GetFullPath($env:SAS_NATIVE_INPUT_ROOT).TrimEnd('\\')+'\\';$process=Get-Process -Id $targetPid -ErrorAction Stop;if($process.ProcessName -ne 'SasInputHelper'){exit 3};$actual=[IO.Path]::GetFullPath([string]$process.Path);if(-not $actual.StartsWith($nativeRoot,[StringComparison]::OrdinalIgnoreCase)){exit 4};Stop-Process -Id $targetPid -Force -ErrorAction Stop";
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 5000, env: { ...process.env, SAS_STALE_INPUT_PID: String(stalePid), SAS_NATIVE_INPUT_ROOT: nativeRoot } });
    const pipeName = resolveInputHelperPipePath().split("\\").filter(Boolean).pop();
    if (!pipeName || !fs.existsSync(config.inputHelperPath)) throw new Error("current_input_helper_unavailable");
    const child = spawn(config.inputHelperPath, ["--pipe-server", pipeName], { windowsHide: true, detached: true, stdio: "ignore" });
    child.unref();
    inputBridgeStatus = { ...inputBridgeStatus, ready: false, mode: "repairing_interactive_desktop_pipe", message: `SAS reemplaza ${staleRevision} por ${requiredInputHelperRevision}.`, processId: null, checkedAt: new Date().toISOString() };
    console.log(`[SAS Agent] helper de entrada obsoleto retirado: ${staleRevision} pid=${stalePid}`);
    return true;
  } catch (error) {
    console.error(`[SAS Agent] no fue posible reemplazar helper obsoleto ${staleRevision}: ${compactInputError(error)}`);
    return false;
  }
}
async function executeInputHelper(args) {
  const failures = [], attempts = [];
  const eventType = String(args[args.indexOf("--type") + 1] ?? "");
  const attempt = async (stage, delivery, run) => {
    const startedAt = new Date().toISOString(), started = Date.now();
    try {
      const result = await run();
      attempts.push({ stage, delivery, ok: true, elapsedMs: Date.now() - started, startedAt, native: result?.diagnostic ?? null });
      return { ...result, persistent: true, delivery, diagnostic: { stage: "agent_delivery", eventType, selectedPath: delivery, attempts, bridgeStatus: { ...inputBridgeStatus }, agentProcessId: process.pid } };
    } catch (error) {
      const message = compactInputError(error);
      attempts.push({ stage, delivery, ok: false, elapsedMs: Date.now() - started, startedAt, error: message, native: error.nativeDiagnostic ?? null });
      failures.push(stage + "=" + message);
      if (delivery === "desktop_pipe" && error.nativeDiagnostic) repairStaleInputDesktopHelper(error.nativeDiagnostic).catch(() => {});
      return null;
    }
  };
  const local = await attempt("interactive_user_preferred", "desktop_pipe", async () => {
    const result = await requestInputHelperPipe(args, 2200);
    const actualRevision = String(result?.diagnostic?.helperRevision ?? "");
    const revisionStale = actualRevision !== requiredInputHelperRevision;
    const native = requireInteractiveInputEvidence(result, { allowStaleRevision: revisionStale });
    if (revisionStale) {
      result.diagnostic = { ...native, revisionStale: true, requiredHelperRevision: requiredInputHelperRevision };
      repairStaleInputDesktopHelper(native).catch(() => {});
    }
    inputBridgeStatus = { ready: true, privilegedReady: Boolean(inputBridgeStatus.privilegedReady), mode: "interactive_desktop_pipe", message: "SAS Input Desktop entregó clic y teclado con la identidad del usuario.", processId: Number(native.processId) || inputBridgeStatus.processId, sessionId: Number.isFinite(Number(native.processSessionId)) ? Number(native.processSessionId) : inputBridgeStatus.sessionId, checkedAt: new Date().toISOString() };
    return result;
  });
  if (local) return local;
  const persistent = await attempt("service_supervised_user_fallback", "interactive_broker", async () => {
    const result = await executePrivilegedBrokerRaw("INPUT_USER", args, 6500);
    if (!result?.ok) { const error = new Error(result?.error ?? "interactive_broker_input_failed"); error.nativeDiagnostic = result?.diagnostic ?? null; throw error; }
    requireInteractiveInputEvidence(result);
    return result;
  });
  if (persistent) return persistent;
  const error = new Error("all_input_paths_failed: " + failures.join("; "));
  error.inputDiagnostic = { stage: "agent_delivery", eventType, selectedPath: null, attempts, bridgeStatus: { ...inputBridgeStatus }, agentProcessId: process.pid };
  throw error;
}
function requireInteractiveInputEvidence(result, { allowSecureDesktop = false, allowStaleRevision = false } = {}) {
  const native = result?.diagnostic;
  if (!native || native.stage !== "native_injection") throw new Error("native_input_evidence_missing");
  if (String(native.helperRevision ?? "") !== requiredInputHelperRevision && !allowStaleRevision) {
    const error = new Error(`native_input_revision_stale: expected=${requiredInputHelperRevision}; actual=${native.helperRevision ?? "unknown"}`);
    error.nativeDiagnostic = native;
    throw error;
  }
  const processSession = Number(native.processSessionId), activeSession = Number(native.activeConsoleSessionId);
  if (!Number.isInteger(processSession) || !Number.isInteger(activeSession) || processSession !== activeSession) throw new Error(`native_input_wrong_session: process=${native.processSessionId}; active=${native.activeConsoleSessionId}`);
  const windowStation = String(native.desktop?.windowStation ?? "").toLowerCase();
  const threadDesktop = String(native.desktop?.threadDesktop ?? "").toLowerCase();
  if (windowStation !== "winsta0") throw new Error(`native_input_wrong_desktop: ${native.desktop?.windowStation ?? "unknown"}\\${native.desktop?.threadDesktop ?? "unknown"}`);
  if (threadDesktop === "winlogon") {
    if (!allowSecureDesktop || String(native.integrity?.helperLevel ?? "").toLowerCase() !== "system") throw new Error("native_input_secure_desktop_requires_authorized_system_broker");
  } else if (threadDesktop !== "default") throw new Error(`native_input_wrong_desktop: ${native.desktop?.windowStation ?? "unknown"}\\${native.desktop?.threadDesktop ?? "unknown"}`);
  if (native.method === "SendInput" && Number(native.accepted) !== Number(native.requested)) throw new Error(`native_input_partial_delivery: requested=${native.requested}; accepted=${native.accepted}; win32=${native.win32Error}`);
  return native;
}
function canEscalateInputForIntegrity(eventType) {
  return ["mouse_button", "mouse_click", "mouse_double_click", "mouse_wheel", "key_down", "key_up", "key_press", "text_input", "release_input"].includes(eventType);
}
async function retryInputThroughAuthorizedBroker(session, event, args, originalError) {
  if (!/uipi_target_higher_integrity/.test(String(originalError?.message ?? "")) || !canEscalateInputForIntegrity(event.type)) throw originalError;
  const startedAt = new Date().toISOString(), started = Date.now();
  await ensurePrivilegedBrokerGrant(true, session.id);
  const privileged = await executePrivilegedBrokerRaw("INPUT", ["--grant", privilegedBrokerGrant, ...args], 12000);
  if (!privileged?.ok) throw new Error(privileged?.error ?? "privileged_input_failed");
  const native = requireInteractiveInputEvidence(privileged, { allowSecureDesktop: true });
  const originalDiagnostic = originalError.inputDiagnostic ?? {};
  return {
    ...privileged,
    elevated: true,
    delivery: "privileged_broker",
    diagnostic: {
      stage: "agent_delivery",
      eventType: event.type,
      selectedPath: "privileged_broker",
      escalationReason: "uipi_target_higher_integrity",
      attempts: [...(originalDiagnostic.attempts ?? []), { stage: "authorized_integrity_escalation", delivery: "privileged_broker", ok: true, elapsedMs: Date.now() - started, startedAt, native }],
      bridgeStatus: { ...inputBridgeStatus },
      agentProcessId: process.pid
    }
  };
}
function inputStateForSession(sessionId) {
  let state = heldInputBySession.get(sessionId);
  if (!state) { state = { keys: new Set(), buttons: new Set(), updatedAt: Date.now() }; heldInputBySession.set(sessionId, state); }
  return state;
}
function trackDeliveredInput(sessionId, event) {
  const payload = event.payload ?? {};
  if (event.type === "release_input") { heldInputBySession.delete(sessionId); return; }
  if (!["key_down", "key_up", "mouse_button"].includes(event.type)) return;
  const state = inputStateForSession(sessionId);
  if (event.type === "mouse_button") { const button = String(payload.button ?? "left").toLowerCase(); if (payload.action === "down") state.buttons.add(button); else state.buttons.delete(button); }
  else { const keys = (Array.isArray(payload.keys) ? payload.keys : [payload.key]).filter(Boolean).map((key) => String(key).toUpperCase()); for (const key of keys) event.type === "key_down" ? state.keys.add(key) : state.keys.delete(key); }
  state.updatedAt = Date.now();
  if (!state.keys.size && !state.buttons.size) heldInputBySession.delete(sessionId);
}
async function releaseSessionInput(sessionId, reason = "session_ended") {
  if (!heldInputBySession.has(sessionId)) return { released: false, reason: "nothing_held" };
  try { await executeInputHelper(["--type", "release_input"]); return { released: true, reason }; }
  finally { heldInputBySession.delete(sessionId); }
}
async function executeRealInputEvent(session, event) {
  if (process.platform !== "win32") return { ok: false, error: "real_input_requires_windows" };
  if (config.unsignedRestrictedProduction) return { ok: false, error: "real_input_disabled_unsigned_restricted_production" };

  const payload = event.payload ?? {};
  if (event.type === "privileged_authorize") {
    const authorization = await ensurePrivilegedBrokerGrant(true, session.id);
    return { ok: true, data: { simulated: false, executed: true, elevated: true, type: event.type, payload: {}, helper: "SAS Privileged Desktop Broker", helperMessage: authorization.message, executedAt: new Date().toISOString(), expiresAt: authorization.expiresAt, note: "Control de aplicaciones elevadas y UAC autorizado una sola vez para esta sesión." } };
  }
  if (!fs.existsSync(config.inputHelperPath)) return { ok: false, error: "input_helper_unavailable" };

  const args = ["--type", event.type];
  if (["mouse_move", "mouse_button", "mouse_click", "mouse_double_click"].includes(event.type)) {
    const frame = latestFrameBySession.get(session.id) ?? session.screenShare?.lastFrame ?? {};
    const originX = Number(frame.monitorOriginX ?? 0);
    const originY = Number(frame.monitorOriginY ?? 0);
    const nativeWidth = Math.max(1, Number(frame.nativeWidth ?? frame.width ?? 1));
    const nativeHeight = Math.max(1, Number(frame.nativeHeight ?? frame.height ?? 1));
    const hasRelative = Number.isFinite(Number(payload.relativeX)) && Number.isFinite(Number(payload.relativeY));
    const x = hasRelative ? originX + Math.round(clampNumber(payload.relativeX, 0, 1) * (nativeWidth - 1)) : Math.round(Number(payload.x ?? originX));
    const y = hasRelative ? originY + Math.round(clampNumber(payload.relativeY, 0, 1) * (nativeHeight - 1)) : Math.round(Number(payload.y ?? originY));
    args.push("--x", String(x), "--y", String(y), "--button", String(payload.button ?? "left"));
    if (event.type === "mouse_button") args.push("--action", payload.action === "down" ? "down" : "up");
  }
  if (event.type === "mouse_move_relative") args.push("--dx", String(Math.round(Number(payload.deltaX ?? 0))), "--dy", String(Math.round(Number(payload.deltaY ?? 0))));
  if (event.type === "mouse_wheel") args.push("--delta", String(Math.round(Number(payload.delta ?? 0))), "--horizontal-delta", String(Math.round(Number(payload.horizontalDelta ?? 0))));
  if (["key_down", "key_up", "key_press"].includes(event.type)) {
    const keys = Array.isArray(payload.keys) && payload.keys.length ? payload.keys : [payload.key].filter(Boolean);
    args.push("--keys", keys.join("+"));
    if (event.type === "key_down" && payload.repeat === true) args.push("--repeat");
  }
  if (event.type === "text_input") args.push("--text-base64", Buffer.from(String(payload.text ?? ""), "utf8").toString("base64"));
  if (event.type === "secure_attention") {
    const privileged = await executePrivilegedBroker("SEND_SAS", [], 10000);
    if (!privileged.ok) return { ok: false, error: privileged.error ?? "secure_attention_failed" };
    return { ok: true, data: { simulated: false, executed: true, elevated: true, type: event.type, payload, helper: "SAS Privileged Desktop Broker", helperMessage: privileged.message, executedAt: new Date().toISOString(), note: "Ctrl+Alt+Supr ejecutado por el servicio privilegiado con consentimiento aprobado." } };
  }

  const elevatedDesktopRequested = payload.elevatedDesktop === true;
  if (elevatedDesktopRequested && event.type !== "mouse_move" && privilegedBrokerGrant && Date.now() < privilegedBrokerGrantExpiresAt - 5000) {
    try {
      const privileged = await executePrivilegedBrokerRaw("INPUT", ["--grant", privilegedBrokerGrant, ...args], 12000);
      if (!privileged.ok) throw new Error(privileged.error ?? "privileged_input_failed");
      trackDeliveredInput(session.id, event);
      return { ok: true, data: { simulated: false, executed: true, elevated: true, type: event.type, payload, helper: "SAS Privileged Desktop Broker", helperMessage: privileged.message, executedAt: privileged.executedAt ?? new Date().toISOString(), note: "Entrada ejecutada en el escritorio activo, incluidas aplicaciones elevadas." } };
    } catch (error) {
      if (/grant_(required|expired)/.test(error.message)) { privilegedBrokerGrant = null; privilegedBrokerGrantExpiresAt = 0; }
    }
  }

  try {
    const result = await executeInputHelper(args);
    trackDeliveredInput(session.id, event);
    return { ok: true, data: { simulated: false, executed: true, elevated: false, type: event.type, payload, helper: result.delivery === "desktop_pipe" ? "SAS Input Desktop" : result.delivery === "interactive_broker" ? "SAS Interactive Desktop Broker" : "SasInputHelper.exe", helperMessage: result.message, diagnostic: result.diagnostic ?? null, executedAt: result.executedAt ?? new Date().toISOString(), note: "La orden llegó al ayudante nativo; revisa diagnostic.native para confirmar cuántos eventos aceptó Windows." } };
  } catch (error) {
    try {
      const result = await retryInputThroughAuthorizedBroker(session, event, args, error);
      trackDeliveredInput(session.id, event);
      return { ok: true, data: { simulated: false, executed: true, elevated: true, type: event.type, payload, helper: "SAS Privileged Desktop Broker", helperMessage: result.message, diagnostic: result.diagnostic ?? null, executedAt: result.executedAt ?? new Date().toISOString(), note: "SAS detectÃ³ que la ventana activa tenÃ­a mayor integridad y usÃ³ una sola vez el broker autorizado." } };
    } catch (privilegedError) {
      if (privilegedError !== error) {
        const combined = new Error(error.message + "; privileged_retry=" + privilegedError.message);
        combined.inputDiagnostic = error.inputDiagnostic;
        error = combined;
      }
    }
    return { ok: false, error: "input_delivery_failed: " + error.message, data: { diagnostic: error.inputDiagnostic ?? { stage: "agent_delivery", eventType: event.type, fatalError: compactInputError(error), bridgeStatus: { ...inputBridgeStatus }, agentProcessId: process.pid } } };
  }
}

async function executeAndReport(session, command) {
  const result = await executeSafeCommand(command).catch((error) => ({
    ok: false,
    error: error.message
  }));

  await postJson("/api/agents/command-results", {
    sessionId: session.id,
    commandId: command.id,
    result
  });

  console.log(`[SAS Agent] command ${command.type} ${result.ok === false ? "failed" : "completed"}`);
}

async function executeSafeCommand(command) {
  if (command.type === "system_info") return { ok: true, data: await readSystemInfo() };

  if (command.type === "network_info") {
    return {
      ok: true,
      data: {
        hostname: os.hostname(),
        interfaces: os.networkInterfaces()
      }
    };
  }

  if (command.type === "disk_info") {
    return {
      ok: true,
      data: await readDiskInfo()
    };
  }

  if (command.type === "process_snapshot") {
    return {
      ok: true,
      data: await readProcessSnapshot()
    };
  }

  if (command.type === "service_snapshot") {
    return {
      ok: true,
      data: await readServiceSnapshot()
    };
  }

  if (command.type === "software_inventory") return { ok: true, data: await readSoftwareInventory() };
  if (command.type === "startup_inventory") return { ok: true, data: await readStartupInventory() };
  if (command.type === "security_status") return { ok: true, data: await readSecurityStatus() };
  if (command.type === "security_definitions_update") return { ok: true, data: await updateSecurityDefinitions() };
  if (command.type === "security_scan_startup") return { ok: true, data: await scanStartupPrograms() };
  if (command.type === "security_quarantine_file") return { ok: true, data: await quarantineDetectedFile(command.fileTransfer?.path) };
  if (command.type === "repair_action") {
    return executeRepairAction(command);
  }

  if (command.type === "clipboard_set") {
    if (process.platform !== "win32") return { ok: false, error: "clipboard_requires_windows" };
    if (config.unsignedRestrictedProduction || !fs.existsSync(config.inputHelperPath)) return { ok: false, error: "clipboard_helper_unavailable" };
    const text = String(command.clipboardText ?? "");
    if (text.length > 200000) return { ok: false, error: "clipboard_text_too_large" };
    const result = await executeInputHelper(["--type", "clipboard_set", "--text-base64", Buffer.from(text, "utf8").toString("base64")]);
    lastRemoteClipboardHash = crypto.createHash("sha256").update(text, "utf8").digest("hex"); lastRemoteClipboardAt = Date.now();
    return { ok: true, data: { length: text.length, format: "text/plain", helper: result.delivery ?? "native" } };
  }
  if (command.type === "clipboard_get") {
    if (process.platform !== "win32") return { ok: false, error: "clipboard_requires_windows" };
    if (config.unsignedRestrictedProduction || !fs.existsSync(config.inputHelperPath)) return { ok: false, error: "clipboard_helper_unavailable" };
    const result = await executeInputHelper(["--type", "clipboard_get"]), text = String(result?.data?.text ?? "").slice(0, 200000);
    const hash = crypto.createHash("sha256").update(text, "utf8").digest("hex"), remoteEcho = hash === lastRemoteClipboardHash && Date.now() - lastRemoteClipboardAt < 5 * 60 * 1000;
    return { ok: true, data: { text, length: text.length, format: "text/plain", remoteEcho, helper: result.delivery ?? "native" } };
  }  if (command.type === "file_list") {
    const requested = String(command.fileTransfer?.path ?? "").trim();
    if (!requested) return { ok: true, data: { path: "", roots: await listWindowsRoots(), directories: [], files: [] } };
    const directory = resolveRemoteFilePath(requested, { directory: true });
    const entries = fs.readdirSync(directory, { withFileTypes: true }).slice(0, 1000).map((entry) => {
      const fullPath = path.join(directory, entry.name);
      let stat = null; try { stat = fs.statSync(fullPath); } catch { /* Entrada inaccesible. */ }
      return { name: entry.name, path: fullPath, directory: entry.isDirectory(), size: stat?.isFile() ? stat.size : null, modifiedAt: stat?.mtime?.toISOString?.() ?? null };
    }).sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name, "es"));
    return { ok: true, data: { path: directory, parent: path.dirname(directory) === directory ? null : path.dirname(directory), roots: [], directories: entries.filter((entry) => entry.directory), files: entries.filter((entry) => !entry.directory) } };
  }
  if (command.type === "file_upload_chunk") {
    const transfer = command.fileTransfer;
    if (!transfer?.transferId || !transfer.dataBase64) return { ok: false, error: "file_chunk_missing" };
    const chunkRoot = path.join(os.tmpdir(), "SAS-Transfers", "chunks"); fs.mkdirSync(chunkRoot, { recursive: true });
    const safeId = String(transfer.transferId).replace(/[^a-zA-Z0-9_-]/g, "");
    const partPath = path.join(chunkRoot, safeId + ".part");
    const bytes = Buffer.from(transfer.dataBase64, "base64");
    if (bytes.length > 4 * 1024 * 1024) return { ok: false, error: "file_chunk_too_large" };
    fs.appendFileSync(partPath, bytes);
    const complete = Number(transfer.index) + 1 >= Number(transfer.total);
    if (!complete) return { ok: true, data: { transferId: safeId, index: transfer.index, complete: false, bytes: fs.statSync(partPath).size } };
    const targetDirectory = transfer.targetDirectory
      ? resolveRemoteFilePath(transfer.targetDirectory, { directory: true })
      : path.join(os.homedir(), "Downloads");
    fs.mkdirSync(targetDirectory, { recursive: true });
    const finalPath = uniqueDestinationPath(targetDirectory, path.basename(transfer.name || safeId));
    fs.renameSync(partPath, finalPath);
    return { ok: true, data: { transferId: safeId, complete: true, name: path.basename(finalPath), path: finalPath, size: fs.statSync(finalPath).size } };
  }
  if (command.type === "file_upload") {
    const transfer = command.fileTransfer;
    if (!transfer?.name || !transfer.dataBase64) return { ok: false, error: "file_transfer_payload_missing" };
    const bytes = Buffer.from(transfer.dataBase64, "base64");
    if (bytes.length > 5 * 1024 * 1024) return { ok: false, error: "file_transfer_size_limit" };
    const targetDirectory = transfer.targetDirectory ? resolveRemoteFilePath(transfer.targetDirectory, { directory: true }) : path.join(os.homedir(), "Downloads");
    fs.mkdirSync(targetDirectory, { recursive: true });
    const target = uniqueDestinationPath(targetDirectory, path.basename(transfer.name)); fs.writeFileSync(target, bytes);
    return { ok: true, data: { direction: "inbound", name: path.basename(target), path: target, size: bytes.length } };
  }
  if (command.type === "file_download" || command.type === "file_download_chunk") {
    const transfer = command.fileTransfer;
    if (!transfer?.path) return { ok: false, error: "file_transfer_path_missing" };
    const target = resolveRemoteFilePath(transfer.path, { file: true });
    const size = fs.statSync(target).size;
    const offset = Math.max(0, Math.min(size, Number(transfer.offset) || 0));
    const maxBytes = Math.max(64 * 1024, Math.min(1024 * 1024, Number(transfer.maxBytes) || 1024 * 1024));
    const length = Math.min(maxBytes, size - offset);
    const bytes = Buffer.alloc(length); const handle = fs.openSync(target, "r");
    try { if (length > 0) fs.readSync(handle, bytes, 0, length, offset); } finally { fs.closeSync(handle); }
    const nextOffset = offset + length;
    return { ok: true, data: { direction: "outbound", name: path.basename(target), path: target, size, offset, nextOffset, complete: nextOffset >= size, dataBase64: bytes.toString("base64") } };
  }
  if (command.type === "screenshot_preview") {
    return {
      ok: true,
      data: await captureScreenshotPreview(command.captureOptions)
    };
  }

  return {
    ok: false,
    error: `Unsupported command: ${command.type}`
  };
}


async function listWindowsRoots() {
  if (process.platform !== "win32") return [{ name: "/", path: "/", directory: true }];
  const roots = await runPowerShellJson(String.raw`
$result = @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue | Where-Object { $_.Root } | ForEach-Object { [pscustomobject]@{ name=[string]$_.Name; path=[string]$_.Root; free=[long]$_.Free; used=[long]$_.Used } })
ConvertTo-Json -InputObject $result -Compress -Depth 3
`);
  return (Array.isArray(roots) ? roots : [roots].filter(Boolean)).map((item) => ({ ...item, directory: true }));
}

function resolveRemoteFilePath(value, expected = {}) {
  const requested = String(value ?? "").replaceAll("/", path.sep).trim();
  if (process.platform === "win32" && (!/^[a-zA-Z]:\\/.test(requested) || requested.startsWith("\\\\"))) throw new Error("file_path_must_be_local_absolute");
  const resolved = path.resolve(requested);
  if (!fs.existsSync(resolved)) throw new Error("file_path_not_found");
  const stat = fs.statSync(resolved);
  if (expected.directory && !stat.isDirectory()) throw new Error("file_path_is_not_directory");
  if (expected.file && !stat.isFile()) throw new Error("file_path_is_not_file");
  return resolved;
}

function uniqueDestinationPath(directory, fileName) {
  const safeName = path.basename(fileName || "archivo").replace(/[<>:"/\\|?*]/g, "_");
  let candidate = path.join(directory, safeName);
  const extension = path.extname(safeName); const stem = path.basename(safeName, extension);
  for (let index = 1; fs.existsSync(candidate); index += 1) candidate = path.join(directory, `${stem} (${index})${extension}`);
  return candidate;
}
async function runPowerShellJson(script, timeout = 120000) {
  if (process.platform !== "win32") return [];
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
  const text = String(stdout ?? "").replace(/^\uFEFF/, "").trim();
  return text ? JSON.parse(text) : [];
}

async function readSystemInfo() {
  const base = {
    hostname: os.hostname(), username: os.userInfo().username, platform: os.platform(), type: os.type(), release: os.release(), arch: os.arch(),
    uptimeSeconds: os.uptime(), totalMemory: os.totalmem(), freeMemory: os.freemem(), cpus: [...new Set(os.cpus().map((cpu) => cpu.model))]
  };
  if (process.platform !== "win32") return base;
  const windows = await runPowerShellJson(String.raw`
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
$bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
$cpu = @(Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.Name })
$gpu = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ name=[string]$_.Name; memory=[long]$_.AdapterRAM; driverVersion=[string]$_.DriverVersion } })
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue
$result = [pscustomobject]@{
  productName=[string]$cv.ProductName; displayVersion=[string]$cv.DisplayVersion; editionId=[string]$cv.EditionID; build=[string]$cv.CurrentBuildNumber; ubr=[int]$cv.UBR
  architecture=[string]$os.OSArchitecture; installedAt=if($os.InstallDate){$os.InstallDate.ToUniversalTime().ToString('o')}else{$null}; lastBootAt=if($os.LastBootUpTime){$os.LastBootUpTime.ToUniversalTime().ToString('o')}else{$null}
  manufacturer=[string]$cs.Manufacturer; model=[string]$cs.Model; domain=[string]$cs.Domain; totalPhysicalMemory=[long]$cs.TotalPhysicalMemory
  biosManufacturer=[string]$bios.Manufacturer; biosVersion=[string]($bios.SMBIOSBIOSVersion); serialNumber=[string]$bios.SerialNumber; processors=$cpu; video=$gpu
}
ConvertTo-Json -InputObject $result -Compress -Depth 5
`);
  return { ...base, windows };
}
async function readSoftwareInventory() {
  const items = await runPowerShellJson(String.raw`
$paths = @(
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$result = @($paths | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } |
  Where-Object { $_.DisplayName } |
  ForEach-Object { [pscustomobject]@{ name=[string]$_.DisplayName; version=[string]$_.DisplayVersion; publisher=[string]$_.Publisher; installDate=[string]$_.InstallDate; installLocation=[string]$_.InstallLocation; uninstallCommand=[string]$_.UninstallString } } |
  Sort-Object name, publisher -Unique)
ConvertTo-Json -InputObject $result -Compress -Depth 4
`);
  return { operation: "software_inventory", capturedAt: new Date().toISOString(), items: Array.isArray(items) ? items : [items].filter(Boolean) };
}

async function readStartupInventory() {
  const items = await runPowerShellJson(String.raw`
$result = @(Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue |
  ForEach-Object { [pscustomobject]@{ name=[string]$_.Name; command=[string]$_.Command; location=[string]$_.Location; user=[string]$_.User } } |
  Sort-Object name, location -Unique)
ConvertTo-Json -InputObject $result -Compress -Depth 4
`);
  return { operation: "startup_inventory", capturedAt: new Date().toISOString(), items: Array.isArray(items) ? items : [items].filter(Boolean) };
}

function resolveClamAvPaths() {
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const roots = [path.resolve("tools", "clamav"), path.join(programFiles, "ClamAV")];
  const find = (configured, name) => configured && fs.existsSync(configured) ? configured : roots.map((root) => path.join(root, name)).find((candidate) => fs.existsSync(candidate)) ?? null;
  const clamscan = find(config.clamScanPath, process.platform === "win32" ? "clamscan.exe" : "clamscan");
  const freshclam = find(config.freshClamPath, process.platform === "win32" ? "freshclam.exe" : "freshclam");
  const database = config.clamDatabasePath || roots.map((root) => path.join(root, "database")).find((candidate) => fs.existsSync(candidate)) || path.join(process.env.ProgramData || "C:\\ProgramData", "ClamAV", "database");
  const root = clamscan ? path.dirname(clamscan) : roots[0];
  const freshclamConfig = path.join(root, "freshclam.conf");
  const sourceManifest = path.join(root, "source-manifest.json");
  return { root, clamscan, freshclam, database, freshclamConfig, sourceManifest };
}

async function runExecutable(file, args, timeout) {
  try {
    const result = await execFileAsync(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } catch (error) {
    return { code: Number(error.code), stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? error.message ?? "") };
  }
}

function securityJournalPaths() {
  const root = path.join(process.env.ProgramData || "C:\\ProgramData", "SAS", "Security");
  return { root, journal: path.join(root, "activity.json"), quarantine: path.join(process.env.ProgramData || "C:\\ProgramData", "SAS", "Quarantine") };
}

function readSecurityJournal() {
  const stored = readJsonFile(securityJournalPaths().journal);
  return {
    totalScanned: Math.max(0, Number(stored?.totalScanned ?? 0)),
    totalDetections: Math.max(0, Number(stored?.totalDetections ?? 0)),
    events: Array.isArray(stored?.events) ? stored.events.slice(-120) : []
  };
}

function recordSecurityActivity(input = {}) {
  const paths = securityJournalPaths();
  const journal = readSecurityJournal();
  const event = {
    id: String(input.id || crypto.randomBytes(8).toString("hex")),
    operation: String(input.operation || "realtime_scan").slice(0, 80),
    status: ["clean", "infected", "quarantined", "error", "summary"].includes(input.status) ? input.status : "summary",
    file: input.file ? path.resolve(String(input.file)) : null,
    fileName: String(input.fileName || (input.file ? path.basename(String(input.file)) : "")).slice(0, 260) || null,
    size: Math.max(0, Number(input.size ?? 0)),
    scannedAt: input.scannedAt || new Date().toISOString(),
    result: String(input.result || "").slice(-1000),
    action: String(input.action || "reported_not_deleted").slice(0, 80),
    quarantinePath: input.quarantinePath ? path.resolve(String(input.quarantinePath)) : null,
    count: Math.max(0, Number(input.count ?? 0)),
    infected: Math.max(0, Number(input.infected ?? 0))
  };
  if (event.operation === "realtime_scan") journal.totalScanned += 1;
  else if (event.operation === "startup_scan") journal.totalScanned += event.count;
  if (event.status === "infected") journal.totalDetections += 1;
  journal.events.push(event);
  journal.events = journal.events.slice(-120);
  fs.mkdirSync(paths.root, { recursive: true });
  const temporary = paths.journal + "." + process.pid + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, paths.journal);
  return event;
}

function readQuarantineHistory() {
  const quarantine = securityJournalPaths().quarantine;
  if (!fs.existsSync(quarantine)) return [];
  return fs.readdirSync(quarantine).filter((name) => name.endsWith(".json")).map((name) => readJsonFile(path.join(quarantine, name))).filter(Boolean).sort((a, b) => String(b.quarantinedAt).localeCompare(String(a.quarantinedAt))).slice(0, 100).map((item) => ({
    id: String(item.id || ""), fileName: String(item.fileName || ""), originalPath: String(item.originalPath || ""), quarantinePath: String(item.quarantinePath || ""), size: Math.max(0, Number(item.size || 0)), quarantinedAt: item.quarantinedAt || null, action: "quarantined_not_deleted"
  }));
}

async function readSecurityStatus() {
  const paths = resolveClamAvPaths();
  if (!paths.clamscan) return { operation: "status", engine: "ClamAV", available: false, bundled: false, realtime: securitySnapshot(), message: "El motor integrado de ClamAV no está disponible." };
  const version = await runExecutable(paths.clamscan, ["--version", `--database=${paths.database}`], 30000);
  const definitions = fs.existsSync(paths.database)
    ? fs.readdirSync(paths.database).filter((name) => /\.(?:cvd|cld)$/i.test(name)).map((name) => ({ name, updatedAt: fs.statSync(path.join(paths.database, name)).mtime.toISOString() }))
    : [];
  const source = readJsonFile(paths.sourceManifest);
  return {
    operation: "status", engine: "ClamAV", engineVersion: version.stdout.trim(), available: version.code === 0,
    bundled: paths.root === path.resolve("tools", "clamav"), sourceVerified: source?.pgpVerified === true,
    definitionsPath: paths.database, definitions, definitionsUpdatedAt: definitions.map((item) => item.updatedAt).sort().pop() ?? null,
    updaterAvailable: Boolean(paths.freshclam), realtime: securitySnapshot(),
    message: version.code === 0 ? "Motor integrado disponible; vigilancia ligera activa sin eliminación automática." : version.stderr.trim()
  };
}

async function updateSecurityDefinitions() {
  const paths = resolveClamAvPaths();
  if (!paths.freshclam) return { operation: "definitions_update", engine: "ClamAV", available: false, definitionsUpdated: false, message: "El actualizador integrado de ClamAV no está disponible." };
  fs.mkdirSync(paths.database, { recursive: true });
  const args = [`--datadir=${paths.database}`, "--stdout"];
  if (fs.existsSync(paths.freshclamConfig)) args.unshift(`--config-file=${paths.freshclamConfig}`);
  const result = await runExecutable(paths.freshclam, args, config.securityScanTimeoutMs);
  return { operation: "definitions_update", engine: "ClamAV", available: true, definitionsUpdated: result.code === 0, updatedAt: new Date().toISOString(), message: (result.stdout || result.stderr).trim().slice(-4000) };
}

function startupExecutable(command) {
  const expanded = String(command ?? "").replace(/%([^%]+)%/g, (_match, name) => process.env[name] ?? _match).trim();
  const match = expanded.match(/^"([^"]+\.exe)"/i) || expanded.match(/^(.+?\.exe)(?:\s|$)/i);
  if (!match) return null;
  const candidate = path.resolve(match[1]);
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

async function scanStartupPrograms() {
  const status = await readSecurityStatus();
  if (!status.available) return { ...status, operation: "startup_scan", scanned: 0, infected: 0 };
  const startup = await readStartupInventory();
  const targets = [...new Set(startup.items.map((item) => startupExecutable(item.command)).filter(Boolean))].slice(0, 250);
  if (!targets.length) return { ...status, operation: "startup_scan", scanned: 0, infected: 0, targets: [], detections: [], message: "No se encontraron ejecutables de inicio accesibles para analizar." };
  const paths = resolveClamAvPaths();
  const detections = [], messages = [];
  let failed = false;
  for (let index = 0; index < targets.length; index += 25) {
    const result = await runExecutable(paths.clamscan, ["--infected", "--no-summary", "--official-db-only=yes", `--database=${paths.database}`, ...targets.slice(index, index + 25)], config.securityScanTimeoutMs);
    messages.push(result.stdout, result.stderr);
    detections.push(...result.stdout.split(/\r?\n/).filter((line) => /\sFOUND$/i.test(line)).map((line) => line.trim()));
    if (![0, 1].includes(result.code)) failed = true;
  }
  const summary = { operation: "startup_scan", engine: "ClamAV", engineVersion: status.engineVersion, available: true, capturedAt: new Date().toISOString(), scanned: targets.length, infected: detections.length, targets, detections, message: failed ? "El análisis terminó con advertencias; revisa el detalle y no ejecutes cambios automáticos." : detections.length ? "Se detectaron posibles amenazas. Revisa antes de aislar o eliminar." : "No se detectaron amenazas en los ejecutables de inicio analizados." };
  recordSecurityActivity({ operation: "startup_scan", status: failed ? "error" : "summary", count: targets.length, infected: detections.length, scannedAt: summary.capturedAt, result: summary.message });
  for (const detectionLine of detections) {
    const parsed = detectionLine.match(/^(.*):\s+(.+)\s+FOUND$/i);
    recordSecurityActivity({ operation: "startup_detection", status: "infected", file: parsed?.[1] || null, scannedAt: summary.capturedAt, result: parsed?.[2] || detectionLine, action: "reported_not_deleted" });
  }
  return summary;
}
async function quarantineDetectedFile(filePath) {
  const source = resolveRemoteFilePath(filePath, { file: true });
  const programData = process.env.ProgramData || "C:\\ProgramData";
  const quarantine = path.join(programData, "SAS", "Quarantine"); fs.mkdirSync(quarantine, { recursive: true });
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
  const target = path.join(quarantine, `${id}.quarantine`);
  try { fs.renameSync(source, target); } catch (error) { if (error.code !== "EXDEV") throw error; fs.copyFileSync(source, target); fs.unlinkSync(source); }
  const metadata = { id, originalPath: source, quarantinePath: target, fileName: path.basename(source), size: fs.statSync(target).size, quarantinedAt: new Date().toISOString(), action: "quarantined_not_deleted" };
  fs.writeFileSync(path.join(quarantine, `${id}.json`), JSON.stringify(metadata, null, 2));
  recordSecurityActivity({ operation: "quarantine", status: "quarantined", file: source, fileName: metadata.fileName, size: metadata.size, scannedAt: metadata.quarantinedAt, action: metadata.action, quarantinePath: target, result: "Archivo aislado sin eliminar" });
  return { operation: "quarantine", ...metadata, message: "Archivo aislado. No fue eliminado; puede revisarse o restaurarse manualmente." };
}
function securitySnapshot() {
  const paths = resolveClamAvPaths();
  const source = readJsonFile(paths.sourceManifest);
  const definitionFiles = fs.existsSync(paths.database) ? fs.readdirSync(paths.database).filter((name) => /\.(?:cvd|cld)$/i.test(name)) : [];
  const definitionsUpdatedAt = definitionFiles.map((name) => fs.statSync(path.join(paths.database, name)).mtime.toISOString()).sort().pop() ?? null;
  const journal = readSecurityJournal();
  const recentScans = journal.events.filter((event) => event.operation === "realtime_scan" || event.operation === "startup_scan").slice(-60).reverse();
  const detectionHistory = journal.events.filter((event) => event.status === "infected").slice(-60).reverse();
  const quarantine = readQuarantineHistory();
  return {
    engine: "ClamAV",
    engineVersion: source?.version ?? null,
    definitionsUpdatedAt,
    bundled: Boolean(paths.clamscan && paths.root === path.resolve("tools", "clamav")),
    available: Boolean(paths.clamscan),
    enabled: realtimeProtection.enabled,
    active: realtimeProtection.enabled && realtimeProtection.watchers.length > 0,
    watchedFolders: realtimeProtection.watchers.map((item) => item.directory),
    queued: realtimeProtection.queue.length,
    scanned: Math.max(realtimeProtection.scanned, journal.totalScanned),
    detections: Math.max(realtimeProtection.detections, journal.totalDetections),
    quarantined: quarantine.length,
    recentScans,
    detectionHistory,
    quarantine,
    lastScanAt: recentScans[0]?.scannedAt ?? realtimeProtection.lastScanAt,
    lastDetection: detectionHistory[0] ?? realtimeProtection.lastDetection,
    lastError: realtimeProtection.lastError
  };
}

function setRealtimeProtection(enabled) {
  realtimeProtection.enabled = Boolean(enabled);
  for (const item of realtimeProtection.watchers) item.watcher.close();
  realtimeProtection.watchers = [];
  if (realtimeProtection.enabled) startRealtimeProtection();
}

function startRealtimeProtection() {
  if (!realtimeProtection.enabled || realtimeProtection.watchers.length) return;
  const paths = resolveClamAvPaths();
  if (!paths.clamscan) {
    realtimeProtection.lastError = "El motor integrado de ClamAV no está disponible.";
    return;
  }
  const profile = process.env.USERPROFILE || os.homedir();
  const directories = [...new Set([
    path.join(profile, "Downloads"), path.join(profile, "Desktop"), process.env.TEMP || process.env.TMP
  ].filter(Boolean).map((item) => path.resolve(item)).filter((item) => fs.existsSync(item)))];
  for (const directory of directories) {
    try {
      const watcher = fs.watch(directory, { persistent: false, recursive: process.platform === "win32" }, (_event, filename) => {
        if (!filename) return;
        scheduleRealtimeScan(path.join(directory, String(filename)));
      });
      watcher.on("error", (error) => { realtimeProtection.lastError = `${directory}: ${error.message}`; });
      realtimeProtection.watchers.push({ directory, watcher });
    } catch (error) { realtimeProtection.lastError = `${directory}: ${error.message}`; }
  }
}

function scheduleRealtimeScan(filePath) {
  const extensions = new Set([".exe", ".msi", ".dll", ".sys", ".scr", ".com", ".ps1", ".vbs", ".js", ".jar", ".zip", ".rar", ".7z", ".doc", ".docm", ".xls", ".xlsm", ".pdf"]);
  if (!extensions.has(path.extname(filePath).toLowerCase()) || realtimeProtection.queued.has(filePath)) return;
  realtimeProtection.queued.add(filePath);
  setTimeout(() => {
    realtimeProtection.queued.delete(filePath);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > config.securityRealtimeMaxBytes) return;
      realtimeProtection.queue.push({ filePath, size: stat.size, modifiedAt: stat.mtimeMs });
      if (realtimeProtection.queue.length > 100) realtimeProtection.queue.shift();
      processRealtimeQueue().catch((error) => { realtimeProtection.lastError = error.message; });
    } catch { /* El archivo temporal ya no existe. */ }
  }, 1800);
}

async function processRealtimeQueue() {
  if (realtimeProtection.processing || !realtimeProtection.enabled) return;
  realtimeProtection.processing = true;
  try {
    while (realtimeProtection.enabled && realtimeProtection.queue.length) {
      const item = realtimeProtection.queue.shift();
      let current;
      try { current = fs.statSync(item.filePath); } catch { continue; }
      if (!current.isFile() || current.size !== item.size || current.mtimeMs !== item.modifiedAt) {
        scheduleRealtimeScan(item.filePath);
        continue;
      }
      const paths = resolveClamAvPaths();
      const result = await runExecutable(paths.clamscan, ["--infected", "--no-summary", "--official-db-only=yes", `--database=${paths.database}`, item.filePath], config.securityScanTimeoutMs);
      realtimeProtection.scanned += 1;
      realtimeProtection.lastScanAt = new Date().toISOString();
      const infected = result.code === 1 || /\sFOUND\s*$/im.test(result.stdout);
      const scanResult = (result.stdout || result.stderr || (result.code === 0 ? "Sin amenazas" : `ClamAV exit ${result.code}`)).trim().slice(-1000);
      const activity = recordSecurityActivity({ operation: "realtime_scan", status: infected ? "infected" : result.code === 0 ? "clean" : "error", file: item.filePath, size: item.size, scannedAt: realtimeProtection.lastScanAt, result: scanResult, action: infected ? "reported_not_deleted" : "none" });
      if (infected) {
        const detection = { ...activity, detectedAt: activity.scannedAt };
        realtimeProtection.detections += 1;
        realtimeProtection.lastDetection = detection;
        await postJson("/api/agents/security-event", { machineId: identity.machineId, event: detection }).catch((error) => { realtimeProtection.lastError = error.message; });
      } else if (result.code !== 0) {
        realtimeProtection.lastError = scanResult;
      }
    }
  } finally { realtimeProtection.processing = false; }
}

function compareVersions(left, right) {
  const a = String(left).split(".").map(Number), b = String(right).split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

async function fetchClientUpdateStatus() {
  const response = await fetch(new URL("/api/client-update", config.serverUrl), { headers: { "Cache-Control": "no-cache", "x-agent-secret": agentSecret, "x-agent-id": identity.machineId } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Actualización HTTP ${response.status}`);
  return { ...body, installedVersion: config.version, available: compareVersions(body.version, config.version) > 0 };
}

async function installClientUpdate() {
  const update = await fetchClientUpdateStatus();
  if (!update.available) return { started: false, message: "SAS Cliente ya está actualizado.", ...update };
  fs.mkdirSync(config.clientUpdateDir, { recursive: true });
  const statusPath = path.join(config.clientUpdateDir, "last-update.json");
  const writeProgress = (status, message, progressPercent, extra = {}) => {
    const temporary = `${statusPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ status, message, installedVersion: config.version, targetVersion: update.version, expectedVersion: update.version, progressPercent, updatedAt: new Date().toISOString(), ...extra }, null, 2));
    fs.rmSync(statusPath, { force: true });
    fs.renameSync(temporary, statusPath);
  };
  try {
    writeProgress("downloading", `Descargando SAS Cliente ${update.version} desde SAS Server.`, 10, { downloadedBytes: 0, totalBytes: Number(update.size) });
    const response = await fetch(new URL(update.downloadUrl, config.serverUrl), { headers: { "x-agent-secret": agentSecret, "x-agent-id": identity.machineId } });
    if (!response.ok) throw new Error(`Descarga HTTP ${response.status}`);
    const chunks = [];
    let received = 0;
    let lastReportedPercent = 10;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("SAS Server no entregó un flujo de descarga válido.");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      received += chunk.length;
      const percent = Math.min(35, 10 + Math.floor((received / Math.max(1, Number(update.size))) * 25));
      if (percent >= lastReportedPercent + 2) {
        lastReportedPercent = percent;
        writeProgress("downloading", `Descargando SAS Cliente ${update.version}: ${percent} %.`, percent, { downloadedBytes: received, totalBytes: Number(update.size) });
      }
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== Number(update.size)) throw new Error("La descarga de SAS Cliente está incompleta.");
    writeProgress("verifying", "Verificando tamaño e integridad SHA-256 del instalador.", 42, { downloadedBytes: bytes.length, totalBytes: Number(update.size) });
    const actualHash = crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
    if (actualHash !== String(update.sha256).toUpperCase()) throw new Error("La actualización de SAS Cliente no supera la verificación SHA-256.");
    const installerPath = path.join(config.clientUpdateDir, `SAS-Cliente-Setup-${update.version}.exe`);
    const temporaryPath = `${installerPath}.part`;
    fs.rmSync(temporaryPath, { force: true });
    const descriptor = fs.openSync(temporaryPath, "w");
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    const diskSize = fs.statSync(temporaryPath).size;
    const diskHash = crypto.createHash("sha256").update(fs.readFileSync(temporaryPath)).digest("hex").toUpperCase();
    if (diskSize !== Number(update.size) || diskHash !== actualHash) {
      fs.rmSync(temporaryPath, { force: true });
      throw new Error("El instalador cambió al guardarse en disco; SAS canceló la actualización.");
    }
    fs.rmSync(installerPath, { force: true });
    fs.renameSync(temporaryPath, installerPath);
    const helper = path.resolve("scripts", "install-client-update.ps1");
    writeProgress("ready", "Descarga verificada. Lista para programar la actualización fuera de SAS Cliente.", 55, { installerPath, preparedAt: new Date().toISOString(), sha256: actualHash });
    return { started: true, prepared: true, version: update.version, installerPath, helperPath: helper, statusPath, sha256: actualHash, message: "Actualización verificada. Autoriza una vez a Windows para programarla." };
  } catch (error) {
    writeProgress("fail", error.message, 100, { failedAt: new Date().toISOString() });
    throw error;
  }
}

async function executeRepairAction(command) {
  const action = command.repairAction;
  if (!action?.id) {
    return { ok: false, error: "repair_action_missing_metadata" };
  }

  if (!config.enableRepairActions || config.unsignedRestrictedProduction) {
    return {
      ok: true,
      data: {
        simulated: true,
        actionId: action.id,
        title: action.title,
        risk: action.risk,
        skippedReason: config.unsignedRestrictedProduction ? "unsigned_restricted_production" : "repair_actions_disabled",
        note: "Accion de reparacion recibida y registrada en modo simulacion; no se ejecuto ningun cambio real.",
        receivedAt: new Date().toISOString()
      }
    };
  }

  if (process.platform !== "win32") {
    return { ok: false, error: "repair_actions_require_windows" };
  }

  const startedAt = new Date().toISOString();
  const execution = action.powershell
    ? await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", action.powershell], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true })
    : await execFileAsync(action.command, action.args ?? [], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });

  return {
    ok: true,
    data: {
      simulated: false,
      actionId: action.id,
      title: action.title,
      risk: action.risk,
      stdout: execution.stdout?.slice(0, 8000) ?? "",
      stderr: execution.stderr?.slice(0, 8000) ?? "",
      startedAt,
      completedAt: new Date().toISOString(),
      note: "Accion de reparacion ejecutada por el agente bajo consentimiento remoto."
    }
  };
}
async function readDiskInfo() {
  if (process.platform !== "win32") {
    return { platform: process.platform, note: "disk_info currently uses Windows WMIC" };
  }

  const { stdout } = await execFileAsync("wmic", ["logicaldisk", "get", "Caption,FreeSpace,Size,VolumeName", "/format:csv"], { timeout: 10000 });
  return parseCsvLikeWmic(stdout).slice(0, 20);
}

async function readProcessSnapshot() {
  if (process.platform !== "win32") {
    return { platform: process.platform, note: "process_snapshot currently uses Windows tasklist" };
  }

  const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], { timeout: 10000, maxBuffer: 1024 * 1024 });
  return parseTasklist(stdout).slice(0, 50);
}

async function readServiceSnapshot() {
  if (process.platform !== "win32") {
    return { platform: process.platform, note: "service_snapshot currently uses Windows sc" };
  }

  const { stdout } = await execFileAsync("sc", ["query", "state=", "all"], { timeout: 10000, maxBuffer: 1024 * 1024 });
  return stdout
    .split(/\\r?\\n/)
    .filter((line) => /SERVICE_NAME:|STATE\s+:/i.test(line))
    .slice(0, 120);
}

function parseCsvLikeWmic(raw) {
  return raw
    .split(/\\r?\\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(1)
    .map((line) => {
      const [node, caption, freeSpace, size, volumeName] = line.split(",");
      return { node, caption, freeSpace, size, volumeName };
    });
}

function parseTasklist(raw) {
  return raw
    .split(/\\r?\\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/("(?:[^"]|"")*"|[^,]+)/g)?.map((value) => value.replace(/^"|"$/g, "").replace(/""/g, "")) ?? [])
    .filter((parts) => parts.length >= 5)
    .map(([imageName, pid, sessionName, sessionNumber, memoryUsage]) => ({ imageName, pid, sessionName, sessionNumber, memoryUsage }));
}

async function captureScreenshotPreview(options = {}) {
  if (process.platform !== "win32") {
    return { platform: process.platform, note: "screenshot_preview currently requires Windows" };
  }

  const helperResult = await captureWithHelper(options).catch((error) => ({ ok: false, error: error.message }));
  if (helperResult.ok) {
    return helperResult.data;
  }

  const script = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;
$graphics = [System.Drawing.Graphics]::FromImage($bitmap);
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);
$stream = New-Object System.IO.MemoryStream;
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png);
$graphics.Dispose();
$bitmap.Dispose();
[Convert]::ToBase64String($stream.ToArray());
`;

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 15000,
    maxBuffer: 12 * 1024 * 1024
  });
  const imageBase64 = stdout.trim();
  return {
    mimeType: "image/png",
    imageBase64,
    capturedAt: new Date().toISOString(),
    note: `Captura solicitada mediante fallback PowerShell: ${helperResult.error ?? "helper no disponible"}.`
  };
}

async function captureWithHelper(options = {}) {
  if (config.unsignedRestrictedProduction) return { ok: false, error: "capture_helper_disabled_unsigned_restricted_production" };
  if (!fs.existsSync(config.captureHelperPath) && !fs.existsSync(config.dxgiCaptureHelperPath)) return { ok: false, error: "capture_helper_unavailable" };

  const quality = clampNumber(options?.quality ?? 62, 35, 90);
  const maxWidth = clampNumber(options?.maxWidth ?? 1280, 640, 3840);
  const monitorIndex = clampNumber(options?.monitorIndex ?? 0, 0, 15);
  const nativeResolution = options?.nativeResolution === true;
  const captureArgs = ["--quality", String(quality), "--max-width", String(maxWidth), "--monitor", String(monitorIndex), ...(nativeResolution ? ["--native"] : [])];
  let payload = null, persistent = false, elevatedDesktop = false, persistentError = null, fallbackReason = null;
  const dxgiAvailable = fs.existsSync(config.dxgiCaptureHelperPath);
  if (dxgiAvailable) {
    try {
      payload = await requestNativeHelper("capture_dxgi", config.dxgiCaptureHelperPath, captureArgs, 6000);
      persistent = true;
      if (!payload?.ok || !payload.imageBase64) fallbackReason = payload?.error ?? "dxgi_capture_empty";
      else if (captureLooksBlank(payload)) { fallbackReason = "dxgi_blank_frame"; payload = null; }
    } catch (error) {
      fallbackReason = error.message;
      closeNativeHelperServer("capture_dxgi", error);
      payload = null;
    }
  }
  if ((!payload?.ok || !payload.imageBase64) && fs.existsSync(config.captureHelperPath)) {
    try {
      payload = await requestNativeHelper("capture_gdi", config.captureHelperPath, captureArgs, 6000);
      persistent = true;
      if (captureLooksBlank(payload)) { persistentError = new Error("gdi_blank_frame"); payload = null; }
    } catch (error) {
      persistentError = error;
      closeNativeHelperServer("capture_gdi", error);
      payload = null;
    }
  }
  if ((!payload?.ok || !payload.imageBase64) && privilegedBrokerGrant && Date.now() < privilegedBrokerGrantExpiresAt - 5000) {
    try {
      payload = await executePrivilegedBrokerRaw("CAPTURE", ["--grant", privilegedBrokerGrant, ...captureArgs], 12000);
      elevatedDesktop = Boolean(payload?.ok);
      if (payload?.ok) payload.captureEngine = "gdi_privileged_desktop";
      if (captureLooksBlank(payload)) { persistentError = new Error("privileged_capture_blank_frame"); payload = null; elevatedDesktop = false; }
    } catch { /* El escritorio normal sigue disponible. */ }
  }
  if ((!payload?.ok || !payload.imageBase64) && fs.existsSync(config.captureHelperPath)) {
    const { stdout } = await execFileAsync(config.captureHelperPath, captureArgs, { timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    payload = JSON.parse(String(stdout ?? "").replace(/^﻿/, "").trim());
    payload.captureEngine = payload.captureEngine ?? "gdi_compatible";
    persistent = false;
    if (captureLooksBlank(payload)) payload = { ok: false, error: "gdi_blank_frame" };
  }
  if (!payload?.ok || !payload.imageBase64) return { ok: false, error: payload?.error ?? persistentError?.message ?? fallbackReason ?? "capture_helper_failed" };

  const captureEngine = payload.captureEngine ?? (dxgiAvailable && !fallbackReason ? "dxgi_desktop_duplication" : "gdi_compatible");
  return { ok: true, data: {
    mimeType: payload.mimeType ?? "image/jpeg", imageBase64: payload.imageBase64,
    width: payload.width, height: payload.height,
    nativeWidth: payload.nativeWidth ?? payload.width, nativeHeight: payload.nativeHeight ?? payload.height,
    monitorOriginX: payload.monitorOriginX ?? 0, monitorOriginY: payload.monitorOriginY ?? 0,
    monitorIndex: payload.monitorIndex ?? monitorIndex, monitorCount: payload.monitorCount ?? 1,
    quality: payload.quality, maxWidth: payload.maxWidth,
    frameMetrics: payload.frameMetrics ?? null, blankFrame: payload.blankFrame === true,
    capturedAt: payload.capturedAt ?? new Date().toISOString(), persistentCapture: persistent, elevatedDesktop,
    captureEngine, dxgiAvailable, captureFallbackReason: fallbackReason,
    note: captureEngine.startsWith("dxgi") ? "Captura acelerada mediante DXGI Desktop Duplication." : fallbackReason ? "DXGI no estuvo disponible; SAS mantuvo la imagen mediante respaldo GDI." : "Captura JPEG mediante respaldo compatible."
  } };
}

function captureLooksBlank(payload) {
  if (!payload?.ok || !payload.imageBase64) return false;
  if (payload.blankFrame === true) return true;
  const metrics = payload.frameMetrics ?? {};
  const mean = Number(metrics.meanLuma), deviation = Number(metrics.lumaStdDev), darkRatio = Number(metrics.darkPixelRatio);
  return Number.isFinite(mean) && Number.isFinite(deviation) && Number.isFinite(darkRatio) && darkRatio >= 0.995 && mean <= 3 && deviation <= 4;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function recordConnectionError(error) {
  const message = String(error?.message ?? "Error de conexion");
  const statusCode = Number(error?.statusCode ?? 0);
  lastConnectionError = {
    message,
    statusCode,
    at: new Date().toISOString(),
    credentialRejected: statusCode === 401 && /agent secret|credential/i.test(message)
  };
}

async function postJson(path, payload) {
  const response = await fetchServer(new URL(path, config.serverUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agent-secret": agentSecret,
      "x-agent-id": identity.machineId
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error ?? `HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return body;
}

function createIdentity() {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const osLabel = `${os.type()} ${os.release()} ${os.arch()}`;
  const legacyMachineId = crypto
    .createHash("sha256")
    .update(`${hostname}:${username}:${osLabel}`)
    .digest("hex")
    .slice(0, 24);
  const machineId = resolveStableMachineId(legacyMachineId, hostname);

  return {
    machineId,
    hostname,
    username,
    os: osLabel,
    version: config.version
  };
}

function resolveStableMachineId(legacyMachineId, hostname) {
  const storedIdentity = readJsonFile(config.identityFile);
  const credential = readJsonFile(config.credentialFile);
  const credentialMachineId = cleanMachineId(credential?.agentId);
  const storedMachineId = cleanMachineId(storedIdentity?.machineId);
  // La credencial individual está vinculada en el servidor a su agentId. Si una
  // actualización dejó una identidad antigua, usarla con el secreto vigente
  // provoca un 401 permanente aunque la tarea de Windows siga ejecutándose.
  const machineId = credentialMachineId || storedMachineId || legacyMachineId;
  if (!storedIdentity || storedIdentity.machineId !== machineId) {
    const record = {
      schemaVersion: 1,
      machineId,
      initialHostname: storedIdentity?.initialHostname || hostname,
      createdAt: storedIdentity?.createdAt || new Date().toISOString(),
      reconciledAt: storedMachineId && credentialMachineId && storedMachineId !== credentialMachineId
        ? new Date().toISOString()
        : storedIdentity?.reconciledAt
    };
    try {
      fs.mkdirSync(path.dirname(config.identityFile), { recursive: true });
      fs.writeFileSync(config.identityFile, JSON.stringify(record, null, 2), { mode: 0o600 });
    } catch (error) {
      console.warn(`[SAS Agent] no fue posible guardar identidad estable: ${error.message}`);
    }
  }
  return machineId;
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch { return null; }
}

function readLocalUnattendedPolicy() {
  const value = readJsonFile(config.unattendedPolicyFile);
  const enabled = value?.enabled === true && /^[a-f0-9]{64}$/i.test(String(value.passwordHash ?? "")) && /^[a-f0-9]{32}$/i.test(String(value.passwordSalt ?? ""));
  return {
    enabled,
    allowControl: enabled && value.allowControl === true,
    autoApprove: enabled && value.autoApprove !== false,
    passwordHash: enabled ? String(value.passwordHash) : null,
    passwordSalt: enabled ? String(value.passwordSalt) : null,
    configuredAt: enabled ? value.configuredAt ?? null : null,
    disabledAt: enabled ? null : value?.disabledAt ?? null,
    policyRevision: String(value?.policyRevision ?? "") || null
  };
}

function publicLocalUnattendedPolicy(policy = localUnattendedPolicy) {
  return {
    enabled: policy?.enabled === true,
    credentialEstablished: policy?.enabled === true && Boolean(policy.passwordHash && policy.passwordSalt),
    autoApprove: policy?.enabled === true && policy.autoApprove !== false,
    allowControl: policy?.enabled === true && policy.allowControl === true,
    configuredAt: policy?.enabled === true ? policy.configuredAt ?? null : null,
    disabledAt: policy?.enabled === true ? null : policy?.disabledAt ?? null,
    policyRevision: policy?.policyRevision ?? null,
    source: "sas_client"
  };
}

function assertStrongLocalUnattendedPassword(password) {
  const value = String(password ?? "");
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value), /[^a-zA-Z0-9]/.test(value)].filter(Boolean).length;
  if (value.length < 12 || value.length > 128 || classes < 3 || /^(password|contraseña|contrasena|123456|qwerty)/i.test(value)) {
    const error = new Error("La contraseña debe tener 12 caracteres o más y combinar al menos tres tipos: mayúsculas, minúsculas, números y símbolos");
    error.statusCode = 400;
    throw error;
  }
}

function writeLocalUnattendedPolicy(policy) {
  fs.mkdirSync(path.dirname(config.unattendedPolicyFile), { recursive: true });
  const temporary = `${config.unattendedPolicyFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(policy, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, config.unattendedPolicyFile);
}

function configureLocalUnattendedPolicy(input = {}) {
  const now = new Date().toISOString();
  if (input.enabled !== true) {
    const disabled = { enabled: false, autoApprove: false, allowControl: false, configuredAt: null, disabledAt: now, policyRevision: crypto.randomBytes(12).toString("hex") };
    writeLocalUnattendedPolicy(disabled);
    return disabled;
  }
  const password = String(input.password ?? "");
  assertStrongLocalUnattendedPassword(password);
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const policy = {
    schemaVersion: 1,
    enabled: true,
    autoApprove: input.autoApprove !== false,
    allowControl: input.allowControl === true,
    passwordSalt,
    passwordHash: crypto.scryptSync(password, passwordSalt, 32, { N: 16384, r: 8, p: 1 }).toString("hex"),
    configuredAt: now,
    disabledAt: null,
    policyRevision: crypto.randomBytes(12).toString("hex")
  };
  writeLocalUnattendedPolicy(policy);
  return policy;
}

async function syncUnattendedPolicy() {
  return postJson("/api/agents/unattended-policy", { machineId: identity.machineId, ...publicLocalUnattendedPolicy(localUnattendedPolicy) });
}

function rememberCompleted(set, id, limit = 2500) {
  set.add(id);
  while (set.size > limit) set.delete(set.values().next().value);
}

async function respondToUnattendedRequest(session) {
  const request = session.unattendedRequest;
  if (!request?.id || completedUnattendedRequests.has(request.id)) return;
  const localPolicy = readLocalUnattendedPolicy();
  localUnattendedPolicy = localPolicy;
  const expired = request.expiresAt && Date.parse(request.expiresAt) <= Date.now();
  const approved = localPolicy.enabled === true && localPolicy.autoApprove !== false && !expired;
  await postJson("/api/agents/unattended-decision", {
    machineId: identity.machineId,
    sessionId: session.id,
    requestId: request.id,
    decision: approved ? "approved" : "rejected",
    allowControl: approved && localPolicy.allowControl === true,
    reason: expired ? "request_expired" : approved ? null : localPolicy.enabled ? "automatic_access_disabled" : "local_policy_unavailable"
  });
  rememberCompleted(completedUnattendedRequests, request.id);
  console.log(`[SAS Agent] solicitud desatendida ${approved ? "autorizada" : "rechazada"} · ${session.joinCode}`);
}
function cleanMachineId(value) {
  const machineId = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(machineId) ? machineId : "";
}

function buildAgentPayload() {
  const inputDesktop = readInputDesktopRuntimeStatus();
  const brokerInstalled = process.platform === "win32" && Boolean(agentSecret) && fs.existsSync(config.privilegedBrokerPath);
  const brokerExists = Boolean(brokerInstalled && inputBridgeStatus.privilegedReady);
  const inputReady = Boolean(inputBridgeStatus.ready || inputDesktop.ready);
  const inputStatus = inputBridgeStatus.ready ? inputBridgeStatus.message : inputDesktop.message;
  const inputDeliveryMode = inputBridgeStatus.ready ? inputBridgeStatus.mode : inputDesktop.ready ? "interactive_desktop_pipe" : "unavailable";
  return {
    ...identity,
    capabilities: {
      screenCapture: process.platform === "win32",
      optimizedCapture: !config.unsignedRestrictedProduction && (fs.existsSync(config.dxgiCaptureHelperPath) || fs.existsSync(config.captureHelperPath)),
      captureEngine: fs.existsSync(config.dxgiCaptureHelperPath) ? "dxgi_desktop_duplication" : "gdi_compatible",
      interactiveControl: true,
      webrtcSignaling: true,
      webrtcMedia: Boolean(loadWebRtcRuntime()),
      webrtcDataChannel: Boolean(loadWebRtcRuntime()),
      webrtcEngine: loadWebRtcRuntime() ? "libdatachannel" : null,
      webrtcError: webRtcRuntimeError ? String(webRtcRuntimeError).slice(0, 240) : null,
      directFramePush: true,
      persistentNativeHelpers: true,
      directPointerWebRtc: true,
      capturedCursor: true,
      privilegedDesktopBroker: brokerExists,
      realInputEnabled: config.enableRealInput && !config.unsignedRestrictedProduction,
    repairActionsEnabled: config.enableRepairActions && !config.unsignedRestrictedProduction,
      unsignedRestrictedProduction: config.unsignedRestrictedProduction,
      inputHelperAvailable: !config.unsignedRestrictedProduction && fs.existsSync(config.inputHelperPath),
      inputHelperReady: inputReady,
      inputHelperStatus: inputStatus,
      inputDeliveryMode: config.unsignedRestrictedProduction ? "restricted" : inputDeliveryMode,
      stopFileAvailable: true,
      localPanelPort: config.localControlPort,
      softwareInventory: process.platform === "win32",
      securityEngine: resolveClamAvPaths().clamscan ? "clamav" : null,
      remoteEngine: currentRemoteEngine()
    },
    unattendedAccess: publicLocalUnattendedPolicy(localUnattendedPolicy)
  };
}





















