import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import { config } from "./shared/config.js";
import { createJsonResponse, readJsonBody, readRawBody, sendJson } from "./shared/http.js";
import { createTicketStore } from "./tickets/ticket-store.js";
import { createContactStore } from "./contacts/contact-store.js";
import { createCompanyStore } from "./contacts/company-store.js";
import { createAspelSaeService } from "./integrations/aspel-sae-service.js";
import { createRemoteSessionStore } from "./remote/remote-session-store.js";
import { createNativeTurnIceServers, createTurnIceServers, turnIsConfigured } from "./remote/turn-credentials.js";
import { createAgentService } from "./agent/agent-service.js";
import { createConversationService } from "./agent/conversation-service.js";
import { createImageAnalysisService } from "./agent/image-analysis-service.js";
import { createGoogleAiResearchService } from "./agent/google-ai-research-service.js";
import { createOpenAiResearchService } from "./agent/openai-research-service.js";
import { createResearchConsensusService } from "./agent/research-consensus-service.js";
import { createRepairPlanService } from "./agent/repair-plan-service.js";
import { createAgentStore } from "./agents/agent-store.js";
import { createClientEnrollmentStore } from "./installations/client-enrollment-store.js";
import { createDeploymentCampaignStore } from "./installations/deployment-campaign-store.js";
import { createShortUrlService } from "./links/short-url-service.js";
import { createUpdateService } from "./updates/update-service.js";
import { createAuditStore } from "./audit/audit-store.js";
import { exportAuditEvents } from "./audit/audit-export.js";
import { filterAuditEvents, normalizeAuditFilter } from "./audit/audit-filter.js";
import { createAuthService } from "./auth/auth-service.js";
import { createMobileIdentityStore } from "./auth/mobile-identity-store.js";
import { buildMobileActivity, buildMobileDashboard } from "./mobile/mobile-view-service.js";
import { createMobileFisherService } from "./mobile/mobile-fisher-service.js";
import { createMobileNotificationStore } from "./mobile/mobile-notification-store.js";
import { createMobilePushOutbox } from "./mobile/mobile-push-outbox.js";
import { createTechnicianNotificationService } from "./mobile/technician-notification-service.js";
import { createKnowledgeBaseStore, extractKeywords } from "./knowledge/knowledge-base-store.js";
import { createWorkflowService } from "./workflows/workflow-service.js";
import { createWhatsAppClient } from "./whatsapp/whatsapp-client.js";
import { parseWhatsAppWebhook, verifyWhatsAppSignature, verifyWhatsAppWebhook } from "./whatsapp/whatsapp-webhook.js";
import { createJsonDatabase } from "./storage/json-database.js";
import { buildProductionReadiness } from "./production/readiness-service.js";
import { buildInstallationReports } from "./production/installation-report-service.js";
import { buildProductionOperations } from "./production/operation-report-service.js";
import { buildReleaseGate, readProductionTrafficLightHistory } from "./production/release-gate-service.js";
import { assertRepairActionAllowed, listRepairActions } from "./repairs/repair-catalog.js";
import { createRepairOutcomeStore } from "./repairs/repair-outcome-store.js";
import { createRepairKnowledgeService } from "./repairs/repair-knowledge-service.js";
import { buildTicketReport, exportTicketReportCsv } from "./reports/ticket-report-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.resolve(projectRoot, "public");
const clientPreflightReportPath = path.resolve(projectRoot, "output", "client-preflight-report.json");
const packageJsonText = fs
  .readFileSync(path.join(projectRoot, "package.json"), "utf8")
  .replace(/^\\uFEFF/, "")
  .replace(/^[^\{\[]+/, "");
const packageInfo = JSON.parse(packageJsonText);
const clientInstallPath = process.env.SAS_CLIENT_INSTALL_PATH ?? "C:\\SAS\\Client";
let clientInstallerMetadataCache = null;

const db = createJsonDatabase({
  filePath: config.dataFilePath,
  backupDir: config.backupDir
});
const state = db.data();
const persist = (key, value) => {
  state[key] = value;
  db.save();
};

const ticketStore = createTicketStore({
  initialTickets: state.tickets,
  onChange: (tickets) => persist("tickets", tickets)
});
const contactStore = createContactStore({ initialContacts: state.contacts, onChange: (contacts) => persist("contacts", contacts) });
const companyStore = createCompanyStore({ initialCompanies: state.companies, onChange: (companies) => persist("companies", companies) });
const aspelSaeService = createAspelSaeService({ companyStore, projectRoot });
const remoteSessionStore = createRemoteSessionStore({
  initialSessions: state.remoteSessions,
  onChange: (sessions) => persist("remoteSessions", sessions),
  security: {
    ttlMinutes: config.remoteSessionTtlMinutes,
    consentMaxAttempts: config.remoteConsentMaxAttempts,
    controlMaxAttempts: config.remoteControlMaxAttempts
  }
});
const auditStore = createAuditStore({
  initialEvents: state.auditEvents,
  onChange: (events) => persist("auditEvents", events)
});
const agentStore = createAgentStore({
  initialAgents: state.agents,
  onChange: (agents) => persist("agents", agents),
  onHostnameChange: ({ machineId, previousHostname, hostname, changedAt, username }) => {
    auditStore.record({
      action: "agent.hostname_changed",
      entityType: "agent",
      entityId: machineId,
      metadata: { previousHostname, hostname, changedAt, username }
    });
  }
});
const clientEnrollmentStore = createClientEnrollmentStore({
  initialEnrollments: state.clientEnrollments,
  ttlMinutes: config.clientEnrollmentTtlMinutes,
  onChange: (items) => persist("clientEnrollments", items)
});
const deploymentCampaignStore = createDeploymentCampaignStore({
  initialCampaigns: state.deploymentCampaigns,
  onChange: (items) => persist("deploymentCampaigns", items)
});const authService = createAuthService({ consoleToken: config.consoleSharedToken });
const mobileIdentityStore = createMobileIdentityStore({
  initialUsers: state.mobileUsers,
  initialDevices: state.mobileDevices,
  initialSessions: state.mobileSessions,
  initialRecoveryTokens: state.mobileRecoveryTokens,
  accessTtlMinutes: config.mobileAccessTtlMinutes,
  refreshTtlDays: config.mobileRefreshTtlDays,
  maxFailedAttempts: config.mobileMaxFailedAttempts,
  lockMinutes: config.mobileLockMinutes,
  onChange: (mobile) => {
    state.mobileUsers = mobile.users;
    state.mobileDevices = mobile.devices;
    state.mobileSessions = mobile.sessions;
    state.mobileRecoveryTokens = mobile.recoveryTokens;
    db.save();
  }
});
if (!mobileIdentityStore.hasUsers() && config.mobileBootstrapUsername && config.mobileBootstrapPassword) {
  const mobileAdmin = mobileIdentityStore.bootstrapUser({ username: config.mobileBootstrapUsername, password: config.mobileBootstrapPassword, displayName: config.mobileBootstrapDisplayName, role: "admin" });
  auditStore.record({ actorId: mobileAdmin.id, actorRole: mobileAdmin.role, action: "mobile.auth.bootstrap", entityType: "mobile_user", entityId: mobileAdmin.id, metadata: { username: mobileAdmin.username } });
}
const mobilePushOutbox = createMobilePushOutbox({ initialDeliveries: state.mobilePushDeliveries, onChange: (deliveries) => persist("mobilePushDeliveries", deliveries) });
const knowledgeBaseStore = createKnowledgeBaseStore({
  initialArticles: state.knowledgeArticles,
  onChange: (articles) => persist("knowledgeArticles", articles)
});
const mobileNotificationStore = createMobileNotificationStore({
  initialNotifications: state.mobileNotifications,
  initialPreferences: state.mobileNotificationPreferences,
  onChange: (mobile) => {
    state.mobileNotifications = mobile.notifications;
    state.mobileNotificationPreferences = mobile.preferences;
    db.save();
  }
});const repairOutcomeStore = createRepairOutcomeStore({
  initialOutcomes: state.repairOutcomes,
  onChange: (outcomes) => persist("repairOutcomes", outcomes)
});
const agentService = createAgentService({ ticketStore, knowledgeBaseStore });
const whatsappClient = createWhatsAppClient(config);
const imageAnalysisService = createImageAnalysisService({ config, whatsappClient });
const shortUrlService = createShortUrlService({ config });
const updateService = createUpdateService({ config, currentVersion: packageInfo.version, projectRoot });
const webrtcSignals = new Map();
let webrtcSignalSequence = Date.now() * 1000;
const recordingUploads = new Map();
setInterval(pruneTransientRemoteState, 60_000).unref();
const captureRoot = path.resolve(projectRoot, "data", "captures");
if (config.updateCheckEnabled) {
  const refreshUpdateChannel = () => updateService.check(config.updateChannel).catch(() => null);
  setTimeout(refreshUpdateChannel, 5000).unref();
  setInterval(refreshUpdateChannel, config.updateCheckIntervalMinutes * 60000).unref();
}
const workflowService = createWorkflowService({ ticketStore, remoteSessionStore, knowledgeBaseStore, auditStore });
const mobileFisherService = createMobileFisherService({
  ticketStore,
  knowledgeBaseStore,
  auditStore,
  dashboardProvider: () => buildMobileDashboard({ tickets: ticketStore.list(), sessions: remoteSessionStore.list(), agents: agentStore.list(), articles: knowledgeBaseStore.list() })
});const googleAiResearchService = createGoogleAiResearchService({ config });
const openAiResearchService = createOpenAiResearchService({ config });
const researchConsensusService = createResearchConsensusService({ googleAiResearchService, openAiResearchService });
const repairPlanService = createRepairPlanService({ ticketStore, remoteSessionStore, agentService, auditStore, repairOutcomeStore });
const repairKnowledgeService = createRepairKnowledgeService({ repairOutcomeStore, knowledgeBaseStore, auditStore });
const technicianNotificationService = createTechnicianNotificationService({
  mobileIdentityStore,
  mobileNotificationStore,
  mobilePushOutbox,
  ticketStore,
  knowledgeBaseStore,
  auditStore
});
const conversationService = createConversationService({
  agentService,
  remoteSessionStore,
  ticketStore,
  contactStore,
  auditStore,
  whatsappClient,
  imageAnalysisService,
  onHumanEscalation: () => technicianNotificationService.notifyEscalation(),
  resolveClientInstallation: ensureClientInstallationForTicket,
  config
});

auditStore.record({ action: "server.boot", entityType: "system", metadata: { httpPort: config.httpPort, httpsPort: config.httpsPort, remoteSessionTtlMinutes: config.remoteSessionTtlMinutes } });

async function ensureClientInstallationForTicket(ticket) {
  const phone = String(ticket?.customerPhone ?? "").replace(/\D/g, "");
  const agents = agentStore.list();
  const directAgent = agents.find((agent) => agent.machineId === ticket?.equipmentId);
  if (directAgent) return { installed: true, agent: directAgent };

  const historicalEquipmentId = ticketStore.list()
    .filter((item) => item.id !== ticket.id && String(item.customerPhone ?? "").replace(/\D/g, "") === phone && item.equipmentId)
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0]?.equipmentId;
  const enrollmentEquipmentId = clientEnrollmentStore.list()
    .filter((item) => item.status === "used" && item.agentId && String(item.customerPhone ?? "").replace(/\D/g, "") === phone)
    .sort((left, right) => String(right.usedAt ?? "").localeCompare(String(left.usedAt ?? "")))[0]?.agentId;
  const agent = agents.find((item) => item.machineId === historicalEquipmentId || item.machineId === enrollmentEquipmentId);
  if (agent) {
    ticketStore.update(ticket.id, { equipmentId: agent.machineId });
    return { installed: true, agent };
  }

  let enrollment = clientEnrollmentStore.list().find((item) => item.ticketId === ticket.id && item.status === "pending");
  if (!enrollment) enrollment = clientEnrollmentStore.create({ ticketId: ticket.id, customerPhone: ticket.customerPhone, createdBy: "Fisher" });
  const internalInstallationUrl = `${config.publicBaseUrl}/i/${enrollment.shortCode}`;
  const shortened = await shortUrlService.shorten(internalInstallationUrl);
  return { installed: false, enrollment, installationUrl: shortened.url, shortUrlProvider: shortened.provider };
}
function sanitizeDeploymentFilename(value) {
  return String(value ?? "empresa").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "empresa";
}function buildCurrentReadiness() {
  return buildProductionReadiness({
    config,
    storageStatus: db.status(),
    agents: agentStore.list(),
    preflightReport: readClientPreflightReport(),
    knowledgeArticles: knowledgeBaseStore.list(),
    repairOutcomeSummary: repairOutcomeStore.summary(),
    mobileIdentity: mobileIdentityStore.snapshot()
  });
}

function buildCurrentOperations() {
  return buildProductionOperations({ projectRoot });
}
async function sendTicketWhatsApp(ticketId, body, { author = "Fisher", action = "whatsapp.notification" } = {}) {
  const ticket = ticketStore.get(ticketId);
  if (!ticket || !ticket.customerPhone || !body) return { skipped: true, reason: "Ticket is not connected to WhatsApp" };
  const delivery = await whatsappClient.sendText({ to: ticket.customerPhone, body });
  ticketStore.addMessage(ticket.id, { direction: "outbound", channel: "whatsapp", author, body, delivery });
  auditStore.record({ action, entityType: "ticket", entityId: ticket.id, metadata: { sent: delivery.sent === true, status: delivery.status ?? null } });
  return delivery;
}

const passwordRecoveryAttempts = new Map();
const requestHandler = async (req, res) => {
  const requestContext = {};
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const actor = mobileIdentityStore.actorFromRequest(req) ?? authService.actorFromRequest(req);
    requestContext.actor = actor;

    if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/console"))) {
      return serveStatic(res, "index.html");
    }

    if (req.method === "GET" && url.pathname.startsWith("/remote/consent/")) {
      return serveStatic(res, "remote-consent.html");
    }
    if (req.method === "GET" && url.pathname === "/remote/workspace.html") {
      return serveStatic(res, "remote-workspace.html");
    }

    if (req.method === "GET" && url.pathname.match(/^\/(?:install|i)\/[^/]+$/)) {
      return serveStatic(res, "client-install.html");
    }

    if (req.method === "GET" && ["/privacy", "/privacy/", "/data-deletion", "/data-deletion/"].includes(url.pathname)) {
      return serveStatic(res, "privacy.html");
    }

    if (req.method === "GET" && url.pathname.startsWith("/updates/")) {
      return serveUpdateFile(res, url.pathname.replace("/updates/", ""));
    }

    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      return serveStatic(res, url.pathname.replace("/assets/", ""));
    }

    if (req.method === "GET" && url.pathname === "/health") {
      const memory = process.memoryUsage();
      return sendJson(res, 200, {
        status: "ok",
        service: "sas-support-platform",
        version: packageInfo.version,
        httpPort: config.httpPort,
        httpsPort: config.httpsPort,
        webrtc: { requested: config.webrtcEnabled, realtimeReady: config.webrtcEnabled, transport: "webrtc_datachannel_with_https_fallback", directFramePush: true, frameIntervalMs: 90, signalingConfigured: true, dataChannel: true, screenEncoding: "jpeg", mediaTrack: false, stunUrls: config.webrtcStunUrls, turnConfigured: turnIsConfigured(config), guaranteedConnectivity: turnIsConfigured(config), udpMinPort: config.webrtcUdpMinPort, udpMaxPort: config.webrtcUdpMaxPort },
        timestamp: new Date().toISOString(),
        runtime: {
          uptimeSeconds: Math.round(process.uptime()),
          rssMb: Math.round(memory.rss / 1048576),
          heapUsedMb: Math.round(memory.heapUsed / 1048576),
          heapTotalMb: Math.round(memory.heapTotal / 1048576),
          externalMb: Math.round(memory.external / 1048576),
          activeRemoteSessions: remoteSessionStore.list().filter((session) => !isTerminalRemoteStatus(session.status)).length,
          webrtcSignalSessions: webrtcSignals.size,
          recordingUploads: recordingUploads.size
        },
        persistence: {
          dataFilePath: config.dataFilePath,
          backupDir: config.backupDir
        }
      });
    }


    if (req.method === "GET" && url.pathname === "/api/client-update") {
      const installer = readClientInstallerMetadata();
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 200, {
        product: "SAS Cliente",
        version: installer.version,
        size: installer.size,
        sha256: installer.sha256,
        downloadUrl: "/api/client-update/download",
        requiresRestart: true
      });
    }
    if (req.method === "GET" && url.pathname === "/api/client-update/download") {
      assertIndividualAgentSecret(req);
      const installer = readClientInstallerMetadata();
      return serveDownload(res, installer.path, "SAS-Cliente-Setup.exe", installer);
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/v1/auth/recovery/request") {
      const body = await readJsonBody(req);
      enforceRecoveryRateLimit(req, body.phoneE164);
      const result = mobileIdentityStore.requestPasswordReset({ phoneE164: body.phoneE164 });
      if (result.token) {
        const link = `${config.publicBaseUrl.replace(/\/$/, "")}/restablecer.html?token=${encodeURIComponent(result.token)}`;
        await whatsappClient.sendText({ to: body.phoneE164, body: `Solicitud de recuperación SAS. Abre esta liga para crear una nueva contraseña: ${link} Esta liga vence en 15 minutos y solo puede usarse una vez.` });
      }
      auditStore.record({ actorId: "anonymous", actorRole: "public", action: "mobile.password_recovery.requested", entityType: "mobile_user", metadata: { phoneMatched: Boolean(result.token) } });
      return sendJson(res, 200, { accepted: true, message: "Si el WhatsApp coincide con una cuenta, recibirás una liga temporal." });
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/v1/auth/recovery/reset") {
      const body = await readJsonBody(req);
      const result = mobileIdentityStore.consumePasswordReset({ token: body.token, password: body.password });
      auditStore.record({ actorId: result.user.id, actorRole: result.user.role, action: "mobile.password_recovery.completed", entityType: "mobile_user", entityId: result.user.id, metadata: { sessionsRevoked: true } });
      return sendJson(res, 200, { message: "Contraseña restablecida. Inicia sesión nuevamente." });
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/v1/auth/login") {
      const body = await readJsonBody(req);
      try {
        const session = mobileIdentityStore.login({ username: body.username, password: body.password, deviceId: body.deviceId, deviceName: body.deviceName, platform: body.platform ?? "android", fcmToken: body.fcmToken });
        auditStore.record({ actorId: session.user.id, actorRole: session.user.role, action: session.device.platform === "web" ? "console.auth.login" : "mobile.auth.login", entityType: "mobile_device", entityId: session.device.id, metadata: { platform: session.device.platform, mustChangePassword: session.user.mustChangePassword } });
        return sendJson(res, 200, { session });
      } catch (error) {
        auditStore.record({ actorId: "mobile-login", actorRole: "unknown", action: body.platform === "web" ? "console.auth.failed" : "mobile.auth.failed", entityType: "mobile_device", entityId: String(body.deviceId ?? "unknown").slice(0, 80), metadata: { statusCode: error.statusCode ?? 401, locked: error.statusCode === 429 } });
        throw error;
      }
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/v1/auth/refresh") {
      const body = await readJsonBody(req);
      const session = mobileIdentityStore.refresh({ refreshToken: body.refreshToken, deviceId: body.deviceId });
      auditStore.record({ actorId: session.user.id, actorRole: session.user.role, action: session.device.platform === "web" ? "console.auth.refresh" : "mobile.auth.refresh", entityType: "mobile_device", entityId: session.device.id });
      return sendJson(res, 200, { session });
    }
    if (req.method === "GET" && url.pathname === "/api/mobile-admin/v1/users") {
      authService.require(actor, "mobile:approve");
      return sendJson(res, 200, { users: mobileIdentityStore.listUsers() });
    }
    if (req.method === "POST" && url.pathname === "/api/mobile-admin/v1/users") {
      authService.require(actor, "mobile:approve");
      const body = await readJsonBody(req);
      const user = mobileIdentityStore.createUser(body);
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "mobile.user.create", entityType: "mobile_user", entityId: user.id, metadata: { role: user.role } });
      return sendJson(res, 201, { user });
    }
    if (req.method === "PATCH" && url.pathname.match(/^\/api\/mobile-admin\/v1\/users\/[^/]+$/)) {
      authService.require(actor, "mobile:approve");
      const userId = decodeURIComponent(url.pathname.split("/")[5]);
      const body = await readJsonBody(req);
      if (actor.mobileAuthenticated && actor.id === userId && body.status === "disabled") { const error = new Error("You cannot disable your current mobile user"); error.statusCode = 409; throw error; }
      const user = mobileIdentityStore.updateUser({ userId, displayName: body.displayName, role: body.role, status: body.status, phoneE164: body.phoneE164 });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "mobile.user.update", entityType: "mobile_user", entityId: user.id, metadata: { role: user.role, status: user.status } });
      return sendJson(res, 200, { user });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/mobile-admin\/v1\/users\/[^/]+\/reset-password$/)) {
      authService.require(actor, "mobile:approve");
      const userId = decodeURIComponent(url.pathname.split("/")[5]);
      const body = await readJsonBody(req);
      const user = mobileIdentityStore.resetPassword({ userId, password: body.password });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "mobile.user.password_reset", entityType: "mobile_user", entityId: user.id });
      return sendJson(res, 200, { user, sessionsRevoked: true });
    }    if (url.pathname.startsWith("/api/mobile/v1/") && !actor.mobileAuthenticated) {
      const error = new Error("Mobile authentication required"); error.statusCode = 401; throw error;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/v1/auth/change-password") {
      const body = await readJsonBody(req);
      const accessToken = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
      const result = mobileIdentityStore.changePassword({ accessToken, currentPassword: body.currentPassword, newPassword: body.newPassword });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: actor.clientPlatform === "web" ? "console.auth.password_changed" : "mobile.auth.password_changed", entityType: "mobile_user", entityId: actor.id, metadata: { sessionsRevoked: true } });
      return sendJson(res, 200, result);
    }
    if (actor.mobileAuthenticated && actor.mustChangePassword && !["/api/mobile/v1/auth/change-password", "/api/mobile/v1/auth/logout", "/api/mobile/v1/me"].includes(url.pathname)) {
      const error = new Error("Mobile password change required"); error.statusCode = 403; throw error;
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/v1/auth/logout") {
      const accessToken = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
      const closedRemoteSessions = [];
      if (actor.clientPlatform === "web") {
        for (const session of remoteSessionStore.list()) {
          if (session.requestedBy !== actor.id || isTerminalRemoteStatus(session.status)) continue;
          const closed = remoteSessionStore.close(session.id, actor.id);
          closedRemoteSessions.push(closed.id);
          auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.close.console_logout", entityType: "remote_session", entityId: closed.id, metadata: { joinCode: closed.joinCode } });
        }
      }
      mobileIdentityStore.logout({ accessToken });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: actor.clientPlatform === "web" ? "console.auth.logout" : "mobile.auth.logout", entityType: "mobile_device", entityId: actor.mobileDeviceId, metadata: { closedRemoteSessions: closedRemoteSessions.length } });
      return sendJson(res, 200, { loggedOut: true, closedRemoteSessions });
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/v1/me") {
      return sendJson(res, 200, { user: { id: actor.id, displayName: actor.displayName, role: actor.role, mustChangePassword: actor.mustChangePassword }, deviceId: actor.mobileDeviceId });
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/v1/devices") {
      return sendJson(res, 200, { devices: mobileIdentityStore.listDevices(actor.id) });
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/v1/devices/push-token") {
      const body = await readJsonBody(req);
      const device = mobileIdentityStore.updatePushToken({ userId: actor.id, deviceId: actor.mobileDeviceId, fcmToken: body.fcmToken });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "mobile.device.push_token", entityType: "mobile_device", entityId: device.id, metadata: { configured: device.hasPushToken } });
      return sendJson(res, 200, { device });
    }
    if (req.method === "DELETE" && url.pathname.match(/^\/api\/mobile\/v1\/devices\/[^/]+$/)) {
      const deviceId = decodeURIComponent(url.pathname.split("/")[5]);
      const revoked = mobileIdentityStore.revokeDevice({ userId: actor.id, deviceId, reason: "mobile_user_revoked" });
      if (!revoked) return sendJson(res, 404, { error: "Mobile device not found" });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "mobile.device.revoke", entityType: "mobile_device", entityId: deviceId });
      return sendJson(res, 200, { revoked: true, deviceId });
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/v1/knowledge") {
      authService.require(actor, "mobile:read");
      const status = url.searchParams.get("status");
      const articles = knowledgeBaseStore.list({ includePending: true }).filter((article) => !status || article.status === status).sort((a, b) => Number(b.reviewScore ?? 0) - Number(a.reviewScore ?? 0));
      return sendJson(res, 200, { articles });
    }
    if (req.method === "PATCH" && url.pathname.match(/^\/api\/mobile\/v1\/knowledge\/[^/]+$/)) {
      authService.require(actor, "kb:write");
      const articleId = decodeURIComponent(url.pathname.split("/")[5]);
      const body = await readJsonBody(req);
      if (!["approved", "rejected"].includes(body.status)) { const error = new Error("El estado debe ser approved o rejected"); error.statusCode = 400; throw error; }
      const article = knowledgeBaseStore.update(articleId, { status: body.status, reviewedBy: actor.id, reviewedAt: new Date().toISOString(), reviewNote: body.reviewNote });
      if (!article) return sendJson(res, 404, { error: "Knowledge article not found" });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: `knowledge.${body.status}`, entityType: "knowledge", entityId: article.id, metadata: { source: "mobile" } });
      return sendJson(res, 200, { article });
    }    if (req.method === "POST" && url.pathname === "/api/mobile/v1/fisher/ask") {
      authService.require(actor, "mobile:read");
      const body = await readJsonBody(req);
      const answer = mobileFisherService.ask({ message: body.message, actor });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "mobile.fisher.ask", entityType: "mobile_device", entityId: actor.mobileDeviceId, metadata: { responseType: answer.type, readOnly: true } });
      return sendJson(res, 200, { answer });
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/v1/dashboard") {
      authService.require(actor, "mobile:read");
      const dashboard = buildMobileDashboard({ tickets: ticketStore.list(), sessions: remoteSessionStore.list(), agents: agentStore.list(), articles: knowledgeBaseStore.list() });
      return sendJson(res, 200, { dashboard });
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/v1/activity") {
      authService.require(actor, "mobile:read");
      const events = buildMobileActivity({ events: auditStore.list(0), limit: url.searchParams.get("limit") ?? 30, offset: url.searchParams.get("offset") ?? 0 });
      return sendJson(res, 200, { events });
    }
    if (req.method === "GET" && url.pathname === "/api/mobile/v1/notifications") {
      authService.require(actor, "mobile:read");
      const synchronized = mobileNotificationStore.sync({ userId: actor.id, tickets: ticketStore.list(), articles: knowledgeBaseStore.list(), events: auditStore.list(0) });
      mobilePushOutbox.enqueue({ userId: actor.id, notifications: synchronized, devices: mobileIdentityStore.snapshot().devices });
      const notifications = mobileNotificationStore.list(actor.id, { unreadOnly: url.searchParams.get("unreadOnly") === "true", limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") });
      return sendJson(res, 200, { notifications, unread: mobileNotificationStore.list(actor.id, { unreadOnly: true, limit: 100 }).length });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/mobile\/v1\/notifications\/[^/]+\/read$/)) {
      const notificationId = decodeURIComponent(url.pathname.split("/")[5]);
      const notification = mobileNotificationStore.markRead(actor.id, notificationId);
      if (!notification) return sendJson(res, 404, { error: "Mobile notification not found" });
      return sendJson(res, 200, { notification });
    }
    if (req.method === "POST" && url.pathname === "/api/mobile/v1/notifications/read-all") return sendJson(res, 200, { markedRead: mobileNotificationStore.markAllRead(actor.id) });
    if (req.method === "GET" && url.pathname === "/api/mobile/v1/notification-preferences") return sendJson(res, 200, { preferences: mobileNotificationStore.getPreferences(actor.id) });
    if (req.method === "PUT" && url.pathname === "/api/mobile/v1/notification-preferences") {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { preferences: mobileNotificationStore.updatePreferences(actor.id, body) });
    }
    if (req.method === "GET" && url.pathname === "/api/client-preflight") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { report: readClientPreflightReport() });
    }


    if (req.method === "GET" && url.pathname === "/api/tests/guided-report") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { report: buildGuidedTestReport({
        ticketId: url.searchParams.get("ticketId"),
        sessionId: url.searchParams.get("sessionId")
      }) });
    }
    if (req.method === "POST" && url.pathname === "/api/tests/guided-next-step") {
      authService.require(actor, "remote:approve");
      const result = runGuidedAutoStep({ actor });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "tests.guided.auto_step", entityType: result.session?.id ? "remote_session" : "system", entityId: result.session?.id ?? result.ticket?.id ?? "guided-test", metadata: { step: result.step, message: result.message } });
      return sendJson(res, 200, result);
    }
    if (req.method === "GET" && url.pathname === "/api/admin/updates") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { updates: updateService.status() });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/updates/check") {
      authService.require(actor, "system:update");
      const body = await readJsonBody(req);
      const release = await updateService.check(body.channel);
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "system.update_checked", entityType: "system", metadata: { channel: release.channel, version: release.version, available: release.available, signatureValid: release.signatureValid } });
      return sendJson(res, 200, { release, updates: updateService.status() });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/updates/stage") {
      authService.require(actor, "system:update");
      const body = await readJsonBody(req);
      const staged = await updateService.stage(body.channel);
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "system.update_staged", entityType: "system", metadata: { channel: staged.channel, version: staged.version, sha256: staged.sha256, size: staged.size } });
      return sendJson(res, 200, { staged, updates: updateService.status() });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/updates/reset") {
      authService.require(actor, "system:update");
      const updates = updateService.reset();
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "system.update_reset", entityType: "system", metadata: { reason: "manual_reset" } });
      return sendJson(res, 200, { updates, message: "Flujo de actualización reiniciado." });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/updates/apply") {
      authService.require(actor, "system:update");
      const body = await readJsonBody(req);
      if (body.confirm !== `ACTUALIZAR ${body.version}`) return sendJson(res, 400, { error: "Confirmacion de actualizacion incorrecta" });
      const scheduled = updateService.apply({ version: body.version, actorId: actor.id });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "system.update_scheduled", entityType: "system", metadata: { version: scheduled.version, taskName: scheduled.updaterTaskName } });
      return sendJson(res, 202, { scheduled, updates: updateService.status(), message: "Actualizacion programada; SAS se reiniciara y validara automaticamente." });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/maintenance/diagnostic") {
      authService.require(actor, "audit:read");
      const diagnostic = {
        generatedAtUtc: new Date().toISOString(),
        service: { version: packageInfo.version, node: process.version, pid: process.pid, uptimeSeconds: Math.round(process.uptime()) },
        network: { httpPort: config.httpPort, httpsPort: config.httpsPort, publicBaseUrl: config.publicBaseUrl },
        webrtc: { requested: config.webrtcEnabled, realtimeReady: config.webrtcEnabled, transport: "webrtc_datachannel_with_https_fallback", directFramePush: true, frameIntervalMs: 90, signalingConfigured: true, dataChannel: true, screenEncoding: "jpeg", mediaTrack: false, stunUrls: config.webrtcStunUrls, turnConfigured: turnIsConfigured(config), guaranteedConnectivity: turnIsConfigured(config), udpMinPort: config.webrtcUdpMinPort, udpMaxPort: config.webrtcUdpMaxPort },
        updates: updateService.status(),
        storage: db.status?.() ?? { dataFilePath: config.dataFilePath, backupDir: config.backupDir },
        counts: { tickets: ticketStore.list().length, agents: agentStore.list().length, sessions: remoteSessionStore.list().length, contacts: contactStore.list().length, companies: companyStore.list().length, knowledge: knowledgeBaseStore.list().length },
        activeSessions: remoteSessionStore.list().filter((item) => !["closed", "expired", "consent_rejected"].includes(item.status)).length
      };
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "maintenance.diagnostic", entityType: "system" });
      return sendJson(res, 200, { diagnostic });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/storage") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { storage: db.status() });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/readiness") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { readiness: buildCurrentReadiness() });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/installations") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { installations: buildInstallationReports({
        projectRoot,
        serverInstallPath: projectRoot,
        clientInstallPath
      }) });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/operations") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { operations: buildCurrentOperations() });
    }

    if (req.method === "GET" && (url.pathname === "/api/admin/release-gate" || url.pathname === "/api/admin/production-traffic-light")) {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { releaseGate: buildReleaseGate({ readiness: buildCurrentReadiness(), operations: buildCurrentOperations() }) });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/production-traffic-light-history") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, { history: readProductionTrafficLightHistory({ projectRoot, limit: 8 }) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/backup") {
      authService.require(actor, "audit:read");
      const backupPath = db.backup();
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "admin.backup", entityType: "system", metadata: { backupPath } });
      return sendJson(res, 201, { backupPath, storage: db.status() });
    }

    if (req.method === "GET" && url.pathname === "/api/auth/roles") {
      return sendJson(res, 200, { roles: authService.listRoles(), tokenRequired: authService.tokenRequired() });
    }

    if (req.method === "GET" && url.pathname === "/api/audit") {
      authService.require(actor, "audit:read");
      const filter = normalizeAuditFilter(url.searchParams.get("filter") ?? "all");
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return sendJson(res, 200, { events: filterAuditEvents(auditStore.list(0), filter).slice(0, limit), filter });
    }

    if (req.method === "GET" && url.pathname === "/api/audit/export") {
      authService.require(actor, "audit:read");
      const format = url.searchParams.get("format") ?? "json";
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      const filter = normalizeAuditFilter(url.searchParams.get("filter") ?? "all");
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "audit.export", entityType: "system", metadata: { format, limit, filter } });
      const exported = exportAuditEvents(filterAuditEvents(auditStore.list(0), filter).slice(0, limit), { format });
      res.writeHead(200, {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${exported.filename}"`
      });
      return res.end(exported.body);
    }

    if (req.method === "GET" && url.pathname === "/api/knowledge") {
      const query = url.searchParams.get("q");
      const articles = query ? knowledgeBaseStore.search(query) : knowledgeBaseStore.list();
      return sendJson(res, 200, { articles });
    }



    if (req.method === "GET" && url.pathname === "/api/knowledge/review-metrics") {
      authService.require(actor, "kb:write");
      return sendJson(res, 200, { metrics: knowledgeBaseStore.reviewMetrics() });
    }
    if (req.method === "GET" && url.pathname === "/api/knowledge/review-queue") {
      authService.require(actor, "kb:write");
      const status = url.searchParams.get("status") ?? "pending_review";
      return sendJson(res, 200, { articles: knowledgeBaseStore.reviewQueue({ status }) });
    }
    if (req.method === "POST" && url.pathname === "/api/knowledge") {
      authService.require(actor, "kb:write");
      const body = await readJsonBody(req);
      const article = knowledgeBaseStore.create(body, actor.id);
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "knowledge.create", entityType: "knowledge", entityId: article.id });
      return sendJson(res, 201, { article });
    }


    if (req.method === "PATCH" && url.pathname.match(/^\/api\/knowledge\/[^/]+$/)) {
      authService.require(actor, "kb:write");
      const articleId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const reviewPatch = body.status ? {
        ...body,
        reviewedBy: actor.id,
        reviewedAt: new Date().toISOString(),
        reviewNote: body.reviewNote
      } : body;
      const article = knowledgeBaseStore.update(articleId, reviewPatch);
      if (!article) {
        return sendJson(res, 404, { error: "Knowledge article not found" });
      }
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "knowledge.update", entityType: "knowledge", entityId: article.id, metadata: { status: article.status } });
      return sendJson(res, 200, { article });
    }
    if (req.method === "GET" && url.pathname === "/api/contacts") {
      authService.require(actor, "ticket:read");
      return sendJson(res, 200, { contacts: contactStore.list(url.searchParams.get("q")) });
    }
    if (req.method === "POST" && url.pathname === "/api/contacts") {
      authService.require(actor, "ticket:write");
      const contact = contactStore.create(await readJsonBody(req));
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "contact.create", entityType: "contact", entityId: contact.id });
      return sendJson(res, 201, { contact });
    }
    if (req.method === "PATCH" && url.pathname.match(/^\/api\/contacts\/[^/]+\/company$/)) {
      authService.require(actor, "ticket:write");
      const contactId = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await readJsonBody(req);
      const company = body.companyId ? companyStore.get(body.companyId) : null;
      if (body.companyId && !company) return sendJson(res, 404, { error: "Empresa no encontrada en Agenda" });
      const contact = contactStore.update(contactId, { companyId: company?.id ?? "", company: company?.legalName ?? "" });
      if (!contact) return sendJson(res, 404, { error: "Contacto no encontrado" });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "contact.company.assign", entityType: "contact", entityId: contact.id, metadata: { companyId: company?.id ?? null, legalName: company?.legalName ?? null } });
      return sendJson(res, 200, { contact, company });
    }
    if (req.method === "GET" && url.pathname === "/api/companies") {
      authService.require(actor, "ticket:read");
      return sendJson(res, 200, { companies: companyStore.list(url.searchParams.get("q")) });
    }
    if (req.method === "POST" && url.pathname === "/api/companies/aspel/preview") {
      authService.require(actor, "system:update");
      const preview = await aspelSaeService.preview(await readJsonBody(req));
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "aspel.clients.preview", entityType: "company", metadata: { databaseName: preview.databaseName, detected: preview.detected, tableNames: preview.tableNames } });
      return sendJson(res, 200, { preview });
    }
    if (req.method === "POST" && url.pathname === "/api/companies/aspel/import") {
      authService.require(actor, "system:update");
      const result = await aspelSaeService.importClients(await readJsonBody(req));
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "aspel.clients.import", entityType: "company", metadata: { databaseName: result.databaseName, created: result.created, updated: result.updated, skipped: result.skipped, total: result.total, tableNames: result.tableNames } });
      return sendJson(res, 200, { result });
    }
    if (req.method === "GET" && (url.pathname === "/api/reports/tickets" || url.pathname === "/api/reports/tickets/export")) {
      authService.require(actor, "ticket:read");
      const filters = Object.fromEntries(url.searchParams.entries());
      const report = buildTicketReport({
        tickets: ticketStore.list().filter((ticket) => ticket.status !== "intake"),
        sessions: remoteSessionStore.list().map(operatorRemoteSession),
        agents: agentStore.list(),
        contacts: contactStore.list(),
        technicians: mobileIdentityStore.listUsers(),
        filters
      });
      if (url.pathname.endsWith("/export")) {
        const filename = `sas-reporte-tickets-${report.filters.from}-${report.filters.to}.csv`;
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store"
        });
        return res.end(`\uFEFF${exportTicketReportCsv(report)}`);
      }
      return sendJson(res, 200, { report });
    }
    if (req.method === "GET" && url.pathname === "/api/tickets") {
      authService.require(actor, "ticket:read");
      return sendJson(res, 200, { tickets: ticketStore.list().filter((ticket) => ticket.status !== "intake") });
    }
    if (req.method === "GET" && url.pathname.match(/^\/api\/tickets\/[^/]+$/)) {
      authService.require(actor, "ticket:read");
      const ticket = ticketStore.get(url.pathname.split("/")[3]);
      if (!ticket || ticket.status === "intake") return sendJson(res, 404, { error: "Ticket not found" });
      return sendJson(res, 200, { ticket });
    }

    if (req.method === "POST" && url.pathname === "/api/tickets") {
      authService.require(actor, "ticket:write");
      const body = await readJsonBody(req);
      const ticket = ticketStore.create({
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        subject: body.subject,
        description: body.description,
        source: body.source ?? "manual",
        priority: body.priority ?? "normal",
        status: body.status,
        contactId: body.contactId,
        equipmentId: body.equipmentId ?? body.agentId,
        intakeStage: body.intakeStage
      });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "ticket.create", entityType: "ticket", entityId: ticket.id });

      return sendJson(res, 201, { ticket });
    }


    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/close$/)) {
      authService.require(actor, "ticket:write");
      const ticketId = url.pathname.split("/")[3];
      const current = ticketStore.get(ticketId);
      if (!current) return sendJson(res, 404, { error: "Ticket not found" });
      const body = await readJsonBody(req);
      const relatedSessions = remoteSessionStore.list().filter((item) => item.ticketId === ticketId);
      const sessionEvidence = relatedSessions.map((item) => ({
        sessionId: item.id, startedAt: item.startedAt ?? null, endedAt: item.endedAt ?? null, accessMode: item.accessMode,
        controlAuthorized: item.controlConsent?.decision === "approved", screenObserved: Boolean(item.screenShare?.lastFrameAt),
        fisherObservations: item.fisherObservation?.observations?.length ?? 0
      }));
      const ticket = ticketStore.closeManually(ticketId, {
        closedBy: actor.id, documentation: { ...(body.documentation ?? {}), sessionEvidence }
      });
      const closedSessions = [];
      for (const item of relatedSessions) {
        if (["closed", "consent_rejected", "expired", "consent_locked", "control_locked"].includes(item.status)) continue;
        const closed = remoteSessionStore.close(item.id, actor.id); if (closed) closedSessions.push(closed.id);
      }
      ticketStore.addMessage(ticket.id, { direction: "internal", channel: "closure", author: actor.id, body: `Cierre manual documentado. Diagnóstico: ${ticket.documentation.diagnosis} Resultado: ${ticket.documentation.outcome}` });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "ticket.close.documented", entityType: "ticket", entityId: ticket.id, metadata: { closedSessions, evidenceCount: sessionEvidence.length } });
      await sendTicketWhatsApp(ticket.id, `El técnico cerró el ticket ${ticket.id} después de documentar la sesión. Si surge un problema distinto, puedes escribirnos nuevamente.`, { action: "whatsapp.ticket_closed" });
      return sendJson(res, 200, { ticket: ticketStore.get(ticket.id), closedSessions });
    }

    if (req.method === "PATCH" && url.pathname.match(/^\/api\/tickets\/[^/]+$/)) {
      authService.require(actor, "ticket:write");
      const ticketId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const previous = ticketStore.get(ticketId);
      const previousStatus = previous?.status;
      const ticket = ticketStore.update(ticketId, { ...body, statusChangedBy: actor.id });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "ticket.update", entityType: "ticket", entityId: ticket.id, metadata: { status: ticket.status, priority: ticket.priority } });
      if (ticket.status !== previousStatus && ticket.status === "resolved") {
        await sendTicketWhatsApp(ticket.id, `El tecnico marcó el ticket ${ticket.id} como resuelto. Confirma respondiendo "confirmar cierre" o escribe "continuar soporte".`, { action: "whatsapp.ticket_resolved" });
      } else if (ticket.status !== previousStatus && ticket.status === "closed") {
        await sendTicketWhatsApp(ticket.id, `El ticket ${ticket.id} fue cerrado. Si el problema continua, responde a este mensaje y abriremos un ticket nuevo.`, { action: "whatsapp.ticket_closed" });
      }
      return sendJson(res, 200, { ticket });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/reply$/)) {
      authService.require(actor, "ticket:write");
      const ticketId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const message = String(body.message ?? "").trim();
      if (!message) return sendJson(res, 400, { error: "El mensaje no puede estar vacio" });
      if (message.length > 4000) return sendJson(res, 400, { error: "El mensaje excede 4000 caracteres" });
      const ticket = ticketStore.get(ticketId);
      if (!ticket) return sendJson(res, 404, { error: "Ticket not found" });
      if (!ticket.customerPhone) return sendJson(res, 400, { error: "El ticket no está vinculado a WhatsApp" });
      const delivery = await sendTicketWhatsApp(ticket.id, message, { author: actor.id, action: "whatsapp.technician_reply" });
      if (!delivery.sent) return sendJson(res, 502, { error: "WhatsApp no confirmo el envio", delivery, ticket: ticketStore.get(ticket.id) });
      return sendJson(res, 201, { ticket: ticketStore.get(ticket.id), delivery });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/installation-link$/)) {
      authService.require(actor, "ticket:write");
      const ticketId = url.pathname.split("/")[3];
      const ticket = ticketStore.get(ticketId);
      if (!ticket) return sendJson(res, 404, { error: "Ticket not found" });
      const enrollment = clientEnrollmentStore.create({ ticketId, customerPhone: ticket.customerPhone, createdBy: actor.id });
      const internalInstallationUrl = `${config.publicBaseUrl}/i/${enrollment.shortCode}`;
      const shortened = await shortUrlService.shorten(internalInstallationUrl);
      const installationUrl = shortened.url;
      const message = ["Para instalar SAS Cliente de forma segura abre esta liga corta:", installationUrl, `Codigo: ${enrollment.shortCode}`, "La liga y el codigo son temporales; solo vinculan este equipo. Windows solicitara permiso de administrador.", "Instalar SAS no autoriza soporte remoto; cada permiso se solicita por separado."].join("\\n");
      const delivery = ticket.source === "whatsapp" ? await sendTicketWhatsApp(ticket.id, message, { action: "whatsapp.client_install_link" }) : { skipped: true };
      ticketStore.addMessage(ticket.id, { direction: "internal", channel: "installation", author: actor.id, body: `Liga de instalacion ${enrollment.shortCode} creada con ${shortened.provider}; vence ${enrollment.expiresAt}.` });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "client.enrollment_created", entityType: "ticket", entityId: ticket.id, metadata: { enrollmentId: enrollment.id, expiresAt: enrollment.expiresAt, shortUrlProvider: shortened.provider, shortUrlFallback: shortened.fallback, sent: delivery.sent === true } });
      return sendJson(res, 201, { enrollment: { ...enrollment, token: undefined }, installationUrl, shortUrl: { provider: shortened.provider, fallback: shortened.fallback }, delivery });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/notes$/)) {
      authService.require(actor, "ticket:write");
      const ticketId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const ticket = ticketStore.addMessage(ticketId, {
        direction: "internal",
        channel: "console",
        author: actor.id,
        body: body.note
      });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "ticket.note", entityType: "ticket", entityId: ticket.id });
      return sendJson(res, 201, { ticket });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/learn$/)) {
      authService.require(actor, "kb:write");
      const ticketId = url.pathname.split("/")[3];
      const ticket = ticketStore.get(ticketId);
      if (!ticket) {
        return sendJson(res, 404, { error: "Ticket not found" });
      }

      const body = await readJsonBody(req);
      const resolutionSteps = normalizeResolutionSteps(body.resolutionSteps ?? body.resolution ?? body.note);
      if (resolutionSteps.length === 0) {
        return sendJson(res, 400, { error: "Resolution steps are required" });
      }

      const article = knowledgeBaseStore.create({
        title: body.title ?? `Resolucion: ${ticket.subject}`,
        category: body.category ?? inferKnowledgeCategory(`${ticket.subject} ${ticket.description}`),
        keywords: Array.isArray(body.keywords) ? body.keywords : extractKeywords(`${ticket.subject} ${ticket.description}`),
        resolutionSteps,
        sourceTicketId: ticket.id,
        status: body.status ?? "approved"
      }, actor.id);

      ticketStore.addMessage(ticket.id, {
        direction: "internal",
        channel: "knowledge",
        author: actor.id,
        body: `Resolucion aprendida en base de conocimiento: ${article.title} (${article.id}).`
      });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "knowledge.learn_from_ticket", entityType: "knowledge", entityId: article.id, metadata: { ticketId: ticket.id, category: article.category } });
      return sendJson(res, 201, { article });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/research-google-ai$/)) {
      authService.require(actor, "kb:write");
      const ticketId = url.pathname.split("/")[3];
      const ticket = ticketStore.get(ticketId);
      if (!ticket) {
        return sendJson(res, 404, { error: "Ticket not found" });
      }

      const body = await readJsonBody(req);
      const research = await googleAiResearchService.researchTicket({ ticket, operatorPrompt: body.prompt });
      const article = knowledgeBaseStore.create({
        title: research.title,
        category: research.category,
        keywords: research.keywords.length > 0 ? research.keywords : extractKeywords(`${ticket.subject} ${ticket.description}`),
        prerequisites: research.prerequisites,
        diagnosticChecks: research.diagnosticChecks,
        resolutionSteps: research.resolutionSteps,
        rollbackSteps: research.rollbackSteps,
        status: research.status,
        sourceTicketId: ticket.id,
        provider: research.provider,
        model: research.model,
        researchSummary: research.researchSummary,
        riskNotes: research.riskNotes,
        adminRequired: research.adminRequired,
        serviceImpact: research.serviceImpact,
        sourceTrust: research.sourceTrust,
        approvalRequired: true,
        privacy: research.privacy,
        citations: research.citations,
        reviewScore: research.reviewScore,
        reviewRecommendation: research.reviewRecommendation,
        reviewSignals: research.reviewSignals
      }, actor.id);

      ticketStore.addMessage(ticket.id, {
        direction: "internal",
        channel: "google_ai",
        author: actor.id,
        body: `Google AI genero propuesta ${article.status}: ${article.title} (${article.id}). Requiere revision antes de uso automatico.`
      });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "google_ai.research_ticket", entityType: "knowledge", entityId: article.id, metadata: { ticketId: ticket.id, status: article.status, provider: research.provider, model: research.model, redactionCount: research.privacy?.redactionCount ?? 0 } });
      return sendJson(res, 201, { article, research });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/research-openai$/)) {
      authService.require(actor, "kb:write");
      const ticketId = url.pathname.split("/")[3];
      const ticket = ticketStore.get(ticketId);
      if (!ticket) return sendJson(res, 404, { error: "Ticket not found" });
      const body = await readJsonBody(req);
      const research = await openAiResearchService.researchTicket({ ticket, operatorPrompt: body.prompt });
      const article = knowledgeBaseStore.create({
        title: research.title, category: research.category,
        keywords: research.keywords.length > 0 ? research.keywords : extractKeywords(`${ticket.subject} ${ticket.description}`),
        prerequisites: research.prerequisites, diagnosticChecks: research.diagnosticChecks,
        resolutionSteps: research.resolutionSteps, rollbackSteps: research.rollbackSteps,
        status: "pending_review", sourceTicketId: ticket.id, provider: research.provider, model: research.model,
        researchSummary: research.researchSummary, riskNotes: research.riskNotes,
        adminRequired: research.adminRequired, serviceImpact: research.serviceImpact,
        sourceTrust: research.sourceTrust, approvalRequired: true, privacy: research.privacy, citations: research.citations,
        reviewScore: research.reviewScore, reviewRecommendation: research.reviewRecommendation,
        reviewSignals: research.reviewSignals
      }, actor.id);
      ticketStore.addMessage(ticket.id, { direction: "internal", channel: "openai", author: actor.id, body: `OpenAI genero propuesta ${article.status}: ${article.title} (${article.id}). Requiere revision antes de uso.` });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "openai.research_ticket", entityType: "knowledge", entityId: article.id, metadata: { ticketId: ticket.id, status: article.status, provider: research.provider, model: research.model, redactionCount: research.privacy?.redactionCount ?? 0 } });
      return sendJson(res, 201, { article, research });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/research-consensus$/)) {
      authService.require(actor, "kb:write");
      const ticketId = url.pathname.split("/")[3];
      const ticket = ticketStore.get(ticketId);
      if (!ticket) return sendJson(res, 404, { error: "Ticket not found" });
      const body = await readJsonBody(req);
      const research = await researchConsensusService.researchTicket({ ticket, operatorPrompt: body.prompt });
      const article = knowledgeBaseStore.create({ title: research.title, category: research.category, keywords: research.keywords, prerequisites: research.prerequisites, diagnosticChecks: research.diagnosticChecks, resolutionSteps: research.resolutionSteps, rollbackSteps: research.rollbackSteps, riskNotes: research.riskNotes, adminRequired: research.adminRequired, serviceImpact: research.serviceImpact, researchSummary: research.researchSummary, citations: research.citations, provider: research.provider, model: research.model, status: "pending_review", sourceTicketId: ticket.id, approvalRequired: true, privacy: { sanitized: true }, providerComparison: research.comparison, reviewScore: research.reviewScore, reviewRecommendation: research.reviewRecommendation, reviewSignals: research.reviewSignals }, actor.id);
      ticketStore.addMessage(ticket.id, { direction: "internal", channel: "ai_consensus", author: actor.id, body: `Comparacion Google/OpenAI generada: ${research.comparison.recommendation}. Propuesta ${article.id} pendiente de revision.` });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "ai.consensus_research", entityType: "knowledge", entityId: article.id, metadata: { ticketId: ticket.id, providerCount: research.comparison.providerCount, categoryAgreement: research.comparison.categoryAgreement, recommendation: research.comparison.recommendation } });
      return sendJson(res, 201, { article, research });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/repair-plan$/)) {
      authService.require(actor, "repair:queue");
      const ticketId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const plan = repairPlanService.buildPlan({
        ticketId,
        message: body.message,
        sessionId: body.sessionId,
        autoQueue: body.autoQueue === true,
        actor
      });
      return sendJson(res, 200, { plan });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/fisher\/observation$/)) {
      authService.require(actor, "repair:queue");
      const sessionId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const session = remoteSessionStore.configureFisherObservation(sessionId, { enabled: body.enabled === true, intervalSeconds: body.intervalSeconds, actorId: actor.id });
      if (!session) return sendJson(res, 404, { error: "Remote session not found" });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: body.enabled === true ? "fisher.observation.started" : "fisher.observation.paused", entityType: "remote_session", entityId: session.id, metadata: { ticketId: session.ticketId, intervalSeconds: session.fisherObservation.intervalSeconds } });
      return sendJson(res, 200, { observer: session.fisherObservation });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/fisher\/observe$/)) {
      authService.require(actor, "repair:queue");
      const sessionId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const session = remoteSessionStore.get(sessionId);
      if (!session) return sendJson(res, 404, { error: "Remote session not found" });
      if (!session.fisherObservation?.enabled) return sendJson(res, 409, { error: "Activa primero Observar pantalla" });
      if (session.consent?.decision !== "approved") return sendJson(res, 409, { error: "El usuario debe autorizar la pantalla antes de que Fisher observe" });
      const frame = session.screenShare?.lastFrame;
      if (!frame?.imageBase64) return sendJson(res, 409, { error: "Aún no hay una imagen de la pantalla para analizar" });
      const frameHash = crypto.createHash("sha256").update(frame.imageBase64).digest("hex");
      if (frameHash === session.fisherObservation?.lastFrameHash) return sendJson(res, 200, { unchanged: true, observer: session.fisherObservation });
      const ticket = ticketStore.get(session.ticketId);
      const analysis = await imageAnalysisService.analyzeScreenFrame({ imageBase64: frame.imageBase64, mimeType: frame.mimeType, ticket, session, operatorContext: body.context });
      analysis.frameHash = frameHash;
      const observation = remoteSessionStore.recordFisherObservation(sessionId, analysis, { frameAt: session.screenShare.lastFrameAt });
      ticketStore.addMessage(ticket.id, { direction: "internal", channel: "fisher_observation", author: "Fisher", body: `Observación ${observation.id}: ${observation.summary}` });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "fisher.screen_observed", entityType: "remote_session", entityId: session.id, metadata: { ticketId: ticket.id, observationId: observation.id, urgency: observation.urgency, needsHuman: observation.needsHuman } });
      return sendJson(res, 201, { observation, observer: remoteSessionStore.get(sessionId).fisherObservation });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/fisher\/observations\/[^/]+\/review$/)) {
      authService.require(actor, "repair:queue");
      const parts = url.pathname.split("/"), sessionId = parts[3], observationId = parts[6];
      const body = await readJsonBody(req);
      const observation = remoteSessionStore.reviewFisherObservation(sessionId, observationId, { decision: body.decision, note: body.note, actorId: actor.id });
      if (!observation) return sendJson(res, 404, { error: "Observación de Fisher no encontrada" });
      const session = remoteSessionStore.get(sessionId);
      ticketStore.addMessage(session.ticketId, { direction: "internal", channel: "fisher_feedback", author: actor.id, body: `Supervisión de ${observation.id}: ${observation.review.decision}. ${observation.review.note}` });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "fisher.observation.reviewed", entityType: "remote_session", entityId: sessionId, metadata: { ticketId: session.ticketId, observationId, decision: observation.review.decision } });
      return sendJson(res, 200, { observation });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/tickets\/[^/]+\/workflow$/)) {
      authService.require(actor, "ticket:write");
      const ticketId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const workflow = workflowService.resolveNextActions({ ticketId, message: body.message, actor });
      return sendJson(res, 200, { workflow });
    }

    if (req.method === "GET" && url.pathname === "/api/repair-actions") {
      authService.require(actor, "ticket:read");
      return sendJson(res, 200, { actions: listRepairActions() });
    }

    if (req.method === "GET" && url.pathname === "/api/repair-outcomes") {
      authService.require(actor, "audit:read");
      return sendJson(res, 200, {
        outcomes: repairOutcomeStore.list().slice(0, Number(url.searchParams.get("limit") ?? 100)),
        summary: repairOutcomeStore.summary()
      });
    }
    if (req.method === "PATCH" && url.pathname.match(/^\/api\/repair-outcomes\/[^/]+$/)) {
      authService.require(actor, "repair:queue");
      const outcomeId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const outcome = repairOutcomeStore.confirm(outcomeId, {
        resolution: body.resolution,
        note: body.note,
        resolvedBy: actor.id
      });
      if (!outcome) {
        return sendJson(res, 404, { error: "Repair outcome not found" });
      }
      if (outcome.ticketId) {
        ticketStore.addMessage(outcome.ticketId, {
          direction: "internal",
          channel: "repair_feedback",
          author: actor.id,
          body: `Confirmacion de reparacion ${outcome.actionId}: ${outcome.resolution}.`
        });
      }
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "repair.feedback", entityType: "ticket", entityId: outcome.ticketId, metadata: { outcomeId: outcome.id, actionId: outcome.actionId, resolution: outcome.resolution } });
      return sendJson(res, 200, { outcome, summary: repairOutcomeStore.summary() });
    }
    if (req.method === "POST" && url.pathname === "/api/repair-outcomes/knowledge-proposals") {
      authService.require(actor, "kb:write");
      const body = await readJsonBody(req);
      const result = repairKnowledgeService.createPendingArticles({
        actor,
        minConfirmed: Number(body.minConfirmed ?? 2),
        minResolutionRate: Number(body.minResolutionRate ?? 0.75)
      });
      return sendJson(res, 201, result);
    }
    if (req.method === "GET" && url.pathname === "/api/remote-sessions") {
      authService.require(actor, "ticket:read");
      return sendJson(res, 200, { sessions: remoteSessionStore.list().map(operatorRemoteSession) });
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/remote-sessions\/code\/[^/]+$/)) {
      const joinCode = url.pathname.split("/").pop();
      const session = remoteSessionStore.findByJoinCode(joinCode);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      return sendJson(res, 200, { session: publicRemoteSession(session) });
    }

    if (req.method === "POST" && url.pathname === "/api/remote-sessions") {
      authService.require(actor, "remote:request");
      const body = await readJsonBody(req);
      const session = remoteSessionStore.create({
        ticketId: body.ticketId,
        requestedBy: body.requestedBy ?? actor.id,
        customerPhone: body.customerPhone,
        agentId: body.agentId || null
      });
      if (session.ticketId && session.agentId && ticketStore.get(session.ticketId)) ticketStore.update(session.ticketId, { equipmentId: session.agentId });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.request", entityType: "remote_session", entityId: session.id, metadata: { joinCode: session.joinCode, expiresAt: session.expiresAt } });

      return sendJson(res, 201, { session, consentUrl: `${config.publicBaseUrl}/remote/consent/${session.joinCode}` });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/code\/[^/]+\/consent$/)) {
      const joinCode = url.pathname.split("/")[4];
      const body = await readJsonBody(req);
      const metadata = {
        decidedBy: body.decidedBy ?? "customer",
        ipAddress: req.socket.remoteAddress,
        userAgent: req.headers["user-agent"]
      };
      const session = body.decision === "approved"
        ? remoteSessionStore.approveConsent(joinCode, metadata)
        : remoteSessionStore.rejectConsent(joinCode, metadata);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ action: `remote.consent.${session.consent.decision}`, entityType: "remote_session", entityId: session.id, metadata: { joinCode: session.joinCode, ipAddress: metadata.ipAddress, status: session.status, attempts: session.security?.consentAttempts, lockedReason: session.security?.lockedReason } });
      await sendTicketWhatsApp(session.ticketId, session.consent.decision === "approved"
        ? `Permiso recibido para la sesion ${session.joinCode}. Un tecnico conectara el equipo cuando este listo.`
        : `El permiso de soporte remoto ${session.joinCode} fue rechazado. No se realizara ninguna conexion.`, { action: `whatsapp.remote_consent_${session.consent.decision}` });
      return sendJson(res, 200, { session: publicRemoteSession(session) });
    }


    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/code\/[^/]+\/close$/)) {
      const joinCode = url.pathname.split("/")[4];
      const session = remoteSessionStore.closeByJoinCode(joinCode, "customer");
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ action: "remote.close.customer", entityType: "remote_session", entityId: session.id, metadata: { joinCode: session.joinCode, ipAddress: req.socket.remoteAddress, status: session.status, lockedReason: session.security?.lockedReason } });
      return sendJson(res, 200, { session: publicRemoteSession(session) });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/assign-agent$/)) {
      authService.require(actor, "remote:request");
      const sessionId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const session = remoteSessionStore.assignAgent(sessionId, body.agentId);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      if (session.ticketId && ticketStore.get(session.ticketId)) ticketStore.update(session.ticketId, { equipmentId: session.agentId });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.assign_agent", entityType: "remote_session", entityId: session.id, metadata: { agentId: session.agentId } });
      await sendTicketWhatsApp(session.ticketId, `Un tecnico fue asignado a la sesion remota ${session.joinCode}. Te avisaremos antes de iniciar.`, { action: "whatsapp.remote_assigned" });
      return sendJson(res, 200, { session });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/unattended-request$/)) {
      authService.require(actor, "remote:unattended");
      const sessionId = url.pathname.split("/")[3];
      const pendingSession = remoteSessionStore.get(sessionId);
      if (!pendingSession) return sendJson(res, 404, { error: "Sesión remota no encontrada" });
      if (!pendingSession.agentId) return sendJson(res, 409, { error: "Asigna primero el equipo remoto" });
      const agent = agentStore.list().find((item) => item.machineId === pendingSession.agentId);
      if (!agent?.unattendedAccess?.enabled) return sendJson(res, 409, { error: "La contraseña desatendida no está establecida en SAS Cliente" });
      if (agent.status !== "online") return sendJson(res, 409, { error: "SAS Cliente debe estar conectado para validar la solicitud" });
      const session = remoteSessionStore.requestUnattended(sessionId, { requestedBy: actor.id });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.unattended.requested", entityType: "remote_session", entityId: session.id, metadata: { agentId: session.agentId, requestId: session.unattendedRequest?.id } });
      return sendJson(res, 202, { requested: true, session: operatorRemoteSession(session) });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/unattended-authorize$/)) {
      authService.require(actor, "remote:unattended");
      return sendJson(res, 410, { error: "La contraseña desatendida ya no se captura en la web. Configúrala en SAS Cliente y solicita el acceso desde Equipos." });
    }
    if (req.method === "GET" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/status$/)) {
      authService.require(actor, "ticket:read");
      const sessionId = url.pathname.split("/")[3];
      const remoteSession = remoteSessionStore.get(sessionId);
      if (!remoteSession) return sendJson(res, 404, { error: "Remote session not found" });
      return sendJson(res, 200, { session: { ...remoteSession, screenShare: { ...remoteSession.screenShare, lastFrame: null } } });
    }
    if (req.method === "GET" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/frame$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      const remoteSession = remoteSessionStore.get(sessionId);
      if (!remoteSession) return sendJson(res, 404, { error: "Remote session not found" });
      const after = String(url.searchParams.get("after") ?? "");
      const capturedAt = String(remoteSession.screenShare?.lastFrameAt ?? "");
      if (!remoteSession.screenShare?.lastFrame?.imageBase64 || (after && after === capturedAt)) return sendJson(res, 200, { unchanged: true, capturedAt });
      return sendJson(res, 200, { frame: remoteSession.screenShare.lastFrame, capturedAt, latencyMs: remoteSession.screenShare.lastFrameLatencyMs ?? null });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/evidence\/screenshot$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      if (!remoteSessionStore.get(sessionId)) return sendJson(res, 404, { error: "Remote session not found" });
      const body = JSON.parse(await readRawBody(req, 12 * 1024 * 1024) || "{}");
      const bytes = Buffer.from(String(body.imageBase64 ?? ""), "base64");
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) return sendJson(res, 400, { error: "Captura inválida o demasiado grande" });
      const folder = path.join(captureRoot, sessionId); fs.mkdirSync(folder, { recursive: true });
      const extension = body.mimeType === "image/png" ? ".png" : ".jpg";
      const filePath = path.join(folder, `captura-${new Date().toISOString().replace(/[:.]/g, "-")}${extension}`);
      fs.writeFileSync(filePath, bytes);
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.evidence.screenshot", entityType: "remote_session", entityId: sessionId, metadata: { filePath, bytes: bytes.length } });
      return sendJson(res, 201, { saved: true, filePath, bytes: bytes.length });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/evidence\/recordings\/start$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      if (!remoteSessionStore.get(sessionId)) return sendJson(res, 404, { error: "Remote session not found" });
      const folder = path.join(captureRoot, sessionId); fs.mkdirSync(folder, { recursive: true });
      const recordingId = crypto.randomUUID();
      const filePath = path.join(folder, `grabacion-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`);
      recordingUploads.set(recordingId, { recordingId, sessionId, filePath, bytes: 0, startedAt: new Date().toISOString(), actorId: actor.id });
      return sendJson(res, 201, { recordingId, filePath });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/evidence\/recordings\/[^/]+\/chunk$/)) {
      authService.require(actor, "remote:approve");
      const parts = url.pathname.split("/"), sessionId = parts[3], recordingId = parts[6];
      const upload = recordingUploads.get(recordingId);
      if (!upload || upload.sessionId !== sessionId) return sendJson(res, 404, { error: "Grabación no encontrada" });
      const body = JSON.parse(await readRawBody(req, 4 * 1024 * 1024) || "{}");
      const bytes = Buffer.from(String(body.dataBase64 ?? ""), "base64");
      if (!bytes.length || bytes.length > 3 * 1024 * 1024) return sendJson(res, 400, { error: "Fragmento de grabación inválido" });
      fs.appendFileSync(upload.filePath, bytes); upload.bytes += bytes.length;
      return sendJson(res, 201, { received: true, bytes: upload.bytes });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/evidence\/recordings\/[^/]+\/stop$/)) {
      authService.require(actor, "remote:approve");
      const parts = url.pathname.split("/"), sessionId = parts[3], recordingId = parts[6];
      const upload = recordingUploads.get(recordingId);
      if (!upload || upload.sessionId !== sessionId) return sendJson(res, 404, { error: "Grabación no encontrada" });
      recordingUploads.delete(recordingId);
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.evidence.recording", entityType: "remote_session", entityId: sessionId, metadata: { filePath: upload.filePath, bytes: upload.bytes, startedAt: upload.startedAt } });
      return sendJson(res, 200, { saved: true, filePath: upload.filePath, bytes: upload.bytes });
    }
    if (url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/webrtc\/signals$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      const remoteSession = remoteSessionStore.get(sessionId);
      if (!remoteSession) return sendJson(res, 404, { error: "Remote session not found" });
      if (req.method === "GET") {
        const after = Number(url.searchParams.get("after") ?? 0);
        return sendJson(res, 200, { signals: listWebRtcSignals(sessionId, "operator", after), webrtc: { enabled: config.webrtcEnabled, iceServers: browserWebRtcIceServers(sessionId), turnConfigured: turnIsConfigured(config), guaranteedConnectivity: turnIsConfigured(config), udpMinPort: config.webrtcUdpMinPort, udpMaxPort: config.webrtcUdpMaxPort, transport: "datachannel" } });
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const signal = queueWebRtcSignal(sessionId, { type: body.type, sdp: body.sdp, candidate: body.candidate, negotiationId: body.negotiationId }, { sender: "operator", target: "agent" });
        auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.webrtc.signal", entityType: "remote_session", entityId: sessionId, metadata: { signalType: signal.type, target: signal.target } });
        return sendJson(res, 201, { signal });
      }
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/commands$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const command = remoteSessionStore.queueCommand(sessionId, { type: body.type, requestedBy: actor.id, fileTransfer: body.fileTransfer, clipboardText: body.clipboardText });
      if (!command) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      const commandSession = remoteSessionStore.get(sessionId);
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.command.queue", entityType: "remote_session", entityId: sessionId, metadata: { commandId: command.id, type: command.type, ticketId: commandSession?.ticketId ?? null, agentId: commandSession?.agentId ?? null, contentLength: command.type === "clipboard_set" ? Number(command.clipboardText?.length ?? 0) : null } });
      return sendJson(res, 201, { command });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/repair-actions$/)) {
      authService.require(actor, "repair:queue");
      const sessionId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const repairAction = assertRepairActionAllowed(body.actionId, { maxRisk: body.maxRisk ?? "medium" });
      const command = remoteSessionStore.queueCommand(sessionId, {
        type: "repair_action",
        requestedBy: actor.id,
        repairAction
      });
      if (!command) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "repair.queue", entityType: "remote_session", entityId: sessionId, metadata: { commandId: command.id, actionId: repairAction.id, risk: repairAction.risk, decisionMode: body.decisionMode ?? null } });
      return sendJson(res, 201, { command, repairAction });
    }


    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/events$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const event = remoteSessionStore.queueInteractiveEvent(sessionId, {
        type: body.type,
        payload: body.payload,
        requestedBy: actor.id
      });
      if (!event) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      if (event.type !== "mouse_move" && event.type !== "mouse_move_relative") {
        const eventSession = remoteSessionStore.get(sessionId);
        auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.event.queue", entityType: "remote_session", entityId: sessionId, metadata: { eventId: event.id, type: event.type, ticketId: eventSession?.ticketId ?? null, agentId: eventSession?.agentId ?? null, contentLength: event.type === "text_input" ? Number(event.payload?.text?.length ?? 0) : null } });
      }
      return sendJson(res, 201, { event });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/control\/request$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      const session = remoteSessionStore.requestControl(sessionId, actor.id);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.control.request", entityType: "remote_session", entityId: session.id });
      await sendTicketWhatsApp(session.ticketId, `El técnico solicitó permiso para usar teclado, ratón y aplicaciones elevadas/UAC en la sesión ${session.joinCode}. Revisa y decide el permiso desde la pantalla de SAS; nunca compartas contrasenas.`, { action: "whatsapp.remote_control_requested" });
      return sendJson(res, 200, { session });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/code\/[^/]+\/control$/)) {
      const joinCode = url.pathname.split("/")[4];
      const body = await readJsonBody(req);
      const session = remoteSessionStore.decideControl(joinCode, body.decision, {
        decidedBy: body.decidedBy ?? "customer",
        ipAddress: req.socket.remoteAddress,
        userAgent: req.headers["user-agent"]
      });
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ action: `remote.control.${session.controlConsent.decision}`, entityType: "remote_session", entityId: session.id, metadata: { joinCode: session.joinCode, ipAddress: req.socket.remoteAddress, status: session.status, lockedReason: session.security?.lockedReason } });
      return sendJson(res, 200, { session: publicRemoteSession(session) });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/screen\/start$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      const body = await readJsonBody(req);
      const session = remoteSessionStore.startScreenShare(sessionId, actor.id, {
        intervalSeconds: body.intervalSeconds ?? 2,
        quality: body.quality ?? 62,
        maxWidth: body.maxWidth ?? 1280,
        monitorIndex: body.monitorIndex ?? 0,
        nativeResolution: body.nativeResolution === true,
        profile: body.profile
      });
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.screen.start", entityType: "remote_session", entityId: session.id, metadata: { intervalSeconds: session.screenShare.intervalSeconds, quality: session.screenShare.quality, maxWidth: session.screenShare.maxWidth } });
      return sendJson(res, 200, { session });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/screen\/stop$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      const session = remoteSessionStore.stopScreenShare(sessionId, actor.id);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.screen.stop", entityType: "remote_session", entityId: session.id });
      return sendJson(res, 200, { session });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/start$/)) {
      authService.require(actor, "remote:approve");
      const sessionId = url.pathname.split("/")[3];
      const session = remoteSessionStore.start(sessionId, actor.id);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.start", entityType: "remote_session", entityId: session.id });
      await sendTicketWhatsApp(session.ticketId, `La sesion remota ${session.joinCode} ya esta activa. Puedes detenerla desde SAS en cualquier momento.`, { action: "whatsapp.remote_started" });
      return sendJson(res, 200, { session });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/remote-sessions\/[^/]+\/close$/)) {
      authService.require(actor, "remote:request");
      const sessionId = url.pathname.split("/")[3];
      const session = remoteSessionStore.close(sessionId, actor.id);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "remote.close", entityType: "remote_session", entityId: session.id });
      await sendTicketWhatsApp(session.ticketId, `La sesion remota ${session.joinCode} termino. El ticket sigue abierto hasta validar contigo que el problema quedo resuelto.`, { action: "whatsapp.remote_closed" });
      return sendJson(res, 200, { session });
    }

    if (req.method === "GET" && url.pathname === "/api/agents") {
      authService.require(actor, "agent:read");
      return sendJson(res, 200, { agents: agentStore.list() });
    }

    if (req.method === "GET" && url.pathname === "/api/deployment-campaigns") {
      authService.require(actor, "agent:read");
      return sendJson(res, 200, { campaigns: deploymentCampaignStore.list() });
    }
    if (req.method === "POST" && url.pathname === "/api/deployment-campaigns") {
      authService.require(actor, "agent:write");
      const body = await readJsonBody(req);
      const created = deploymentCampaignStore.create({ ...body, createdBy: actor.id });
      const { token, ...campaign } = created;
      const profile = { schemaVersion: 1, product: "SAS Cliente Deployment", campaignId: campaign.id, campaignName: campaign.name, company: campaign.company, serverUrl: config.publicBaseUrl, deploymentToken: token, expiresAt: campaign.expiresAt, maxDevices: campaign.maxDevices };
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "deployment.campaign_created", entityType: "deployment_campaign", entityId: campaign.id, metadata: { company: campaign.company, maxDevices: campaign.maxDevices, expiresAt: campaign.expiresAt } });
      return sendJson(res, 201, { campaign, profile, filename: sanitizeDeploymentFilename(campaign.company) + ".sasdeploy" });
    }
    if (req.method === "POST" && url.pathname.match(/^\/api\/deployment-campaigns\/[^/]+\/revoke$/)) {
      authService.require(actor, "agent:write");
      const campaign = deploymentCampaignStore.revoke(url.pathname.split("/")[3]);
      if (!campaign) return sendJson(res, 404, { error: "Campaña no encontrada" });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "deployment.campaign_revoked", entityType: "deployment_campaign", entityId: campaign.id });
      return sendJson(res, 200, { campaign });
    }
    if (req.method === "POST" && url.pathname === "/api/agents/unattended-policy") {
      assertIndividualAgentSecret(req);
      const body = await readJsonBody(req);
      const machineId = String(body.machineId ?? "").trim();
      if (!machineId || machineId !== String(req.headers["x-agent-id"] ?? "").trim()) {
        const error = new Error("La identidad del equipo no coincide");
        error.statusCode = 403;
        throw error;
      }
      if (Object.prototype.hasOwnProperty.call(body, "password")) return sendJson(res, 400, { error: "La contraseña debe permanecer únicamente en SAS Cliente y nunca enviarse al servidor" });
      const agent = agentStore.configureUnattended(machineId, {
        enabled: body.enabled === true,
        allowControl: body.enabled === true && Boolean(body.allowControl),
        configuredAt: body.configuredAt,
        disabledAt: body.disabledAt,
        policyRevision: body.policyRevision
      });
      const closedSessions = [];
      for (const session of remoteSessionStore.list()) {
        if (session.agentId !== machineId || session.accessMode !== "unattended" || isTerminalRemoteStatus(session.status)) continue;
        const closed = remoteSessionStore.closeByAgent(session.id, machineId);
        if (closed) {
          closedSessions.push(closed.id);
          auditStore.record({ action: "remote.close.unattended_policy_changed", entityType: "remote_session", entityId: closed.id, metadata: { agentId: machineId, status: closed.status } });
        }
      }
      auditStore.record({ action: agent.unattendedAccess?.enabled ? "agent.unattended.enabled" : "agent.unattended.disabled", entityType: "agent", entityId: machineId, metadata: { hostname: agent.hostname, allowControl: agent.unattendedAccess?.allowControl, source: "sas_client", closedSessions: closedSessions.length } });
      return sendJson(res, 200, { agent, closedSessions });
    }

    if (req.method === "POST" && url.pathname === "/api/agents/unattended-decision") {
      assertIndividualAgentSecret(req);
      const body = await readJsonBody(req);
      const machineId = String(req.headers["x-agent-id"] ?? "").trim();
      const pending = remoteSessionStore.get(String(body.sessionId ?? ""));
      if (!pending) return sendJson(res, 404, { error: "Sesión remota no encontrada" });
      if (pending.agentId !== machineId) return sendJson(res, 403, { error: "La solicitud no corresponde a este equipo" });
      if (!pending.unattendedRequest || pending.unattendedRequest.id !== String(body.requestId ?? "") || pending.unattendedRequest.decision !== "pending") {
        return sendJson(res, 409, { error: "La solicitud desatendida ya no está pendiente", session: operatorRemoteSession(pending) });
      }
      const agent = agentStore.list().find((item) => item.machineId === machineId);
      const approved = body.decision === "approved" && agent?.unattendedAccess?.enabled === true;
      if (!approved) {
        const session = remoteSessionStore.rejectUnattended(pending.id, { requestId: body.requestId, reason: body.reason || "local_policy_unavailable" });
        auditStore.record({ action: "remote.unattended.denied", entityType: "remote_session", entityId: session.id, metadata: { agentId: machineId, requestId: body.requestId, reason: body.reason || "local_policy_unavailable" } });
        return sendJson(res, 200, { authorized: false, session: operatorRemoteSession(session) });
      }
      const allowControl = body.allowControl === true && agent.unattendedAccess.allowControl === true;
      let session = remoteSessionStore.authorizeUnattended(pending.id, { requestId: body.requestId, authorizedBy: pending.unattendedRequest.requestedBy, allowControl, ipAddress: req.socket.remoteAddress, userAgent: "SAS Cliente" });
      agentStore.recordUnattendedUse(machineId);
      session = remoteSessionStore.start(session.id, "unattended_device_policy");
      session = remoteSessionStore.startScreenShare(session.id, "unattended_device_policy", { intervalSeconds: 0.25, quality: 62, maxWidth: 1920, monitorIndex: 0, nativeResolution: false, profile: "lowLatency" });
      auditStore.record({ action: "remote.unattended.approved", entityType: "remote_session", entityId: session.id, metadata: { agentId: machineId, requestId: body.requestId, allowControl, accessMode: session.accessMode, source: "sas_client_local_policy" } });
      await sendTicketWhatsApp(session.ticketId, `SAS Cliente autorizó el soporte desatendido para la sesión ${session.joinCode}. El acceso queda registrado y puede detenerse desde el equipo.`, { action: "whatsapp.remote_unattended_authorized" });
      return sendJson(res, 200, { authorized: true, session: operatorRemoteSession(session) });
    }
    if (req.method === "GET" && url.pathname.match(/^\/api\/client-installations\/(?:token|code)\/[^/]+$/)) {
      const credential = url.pathname.split("/").pop();
      const enrollment = clientEnrollmentStore.inspect(credential);
      if (!enrollment) return sendJson(res, 404, { error: "Liga de instalacion no encontrada" });
      const enrolledAgent = enrollment.agentId ? agentStore.list().find((item) => item.machineId === enrollment.agentId) : null;
      return sendJson(res, 200, {
        enrollment: { status: enrollment.status, expiresAt: enrollment.expiresAt, usedAt: enrollment.usedAt ?? null },
        equipment: enrolledAgent ? { machineId: enrolledAgent.machineId, hostname: enrolledAgent.hostname, status: enrolledAgent.status } : null,
        downloadUrl: `/downloads/sas-client-setup.exe?code=${encodeURIComponent(credential)}`
      });
    }

    if (req.method === "GET" && url.pathname === "/downloads/sas-client-setup.exe") {
      const credential = url.searchParams.get("code") ?? url.searchParams.get("token");
      const enrollment = clientEnrollmentStore.inspect(credential);
      if (!enrollment || enrollment.status !== "pending") return sendJson(res, 410, { error: "La liga vencio o ya fue utilizada" });
      const installer = readClientInstallerMetadata();
      return serveDownload(res, installer.path, "SAS-Cliente-Setup.exe", installer);
    }

    if (req.method === "POST" && url.pathname === "/api/agents/deploy-enroll") {
      const body = await readJsonBody(req);
      const campaign = deploymentCampaignStore.authorize(body.deploymentToken, body.machineId);
      const agent = agentStore.register({ ...body, deployment: { campaignId: campaign.id, campaignName: campaign.name, company: campaign.company, enrolledAt: new Date().toISOString(), associationStatus: "pending_user" } });
      const deviceSecret = crypto.randomBytes(32).toString("base64url");
      agentStore.issueCredential(agent.machineId, deviceSecret);
      auditStore.record({ action: "client.mass_enrolled", entityType: "agent", entityId: agent.machineId, metadata: { campaignId: campaign.id, company: campaign.company, hostname: agent.hostname } });
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 201, { agent: agentStore.list().find((item) => item.machineId === agent.machineId), agentSecret: deviceSecret, campaign: { id: campaign.id, name: campaign.name, company: campaign.company } });
    }
    if (req.method === "POST" && url.pathname === "/api/agents/associate-enrollment") {
      assertIndividualAgentSecret(req);
      const body = await readJsonBody(req);
      const machineId = String(req.headers["x-agent-id"] ?? "").trim();
      const enrollment = clientEnrollmentStore.inspect(body.enrollmentToken);
      if (!enrollment || enrollment.status !== "pending") return sendJson(res, 410, { error: "Liga de asociación vencida o utilizada" });
      const agent = agentStore.list().find((item) => item.machineId === machineId);
      if (!agent) return sendJson(res, 404, { error: "Equipo no registrado" });
      const consumed = clientEnrollmentStore.consume(body.enrollmentToken, machineId);
      const session = remoteSessionStore.list().reverse().find((item) => item.ticketId === consumed.ticketId && !isTerminalRemoteStatus(item.status));
      if (session && !session.agentId) remoteSessionStore.assignAgent(session.id, machineId);
      if (consumed.ticketId && ticketStore.get(consumed.ticketId)) {
        ticketStore.update(consumed.ticketId, { equipmentId: machineId, intakeStage: "problem_details" });
        ticketStore.addMessage(consumed.ticketId, { direction: "internal", channel: "association", author: "SAS Cliente", body: "Equipo " + (agent.hostname || machineId) + " asociado desde una instalación administrada." });
        await sendTicketWhatsApp(consumed.ticketId, "El equipo " + (agent.hostname || "del usuario") + " quedó asociado. Ahora describe el problema o envía una imagen.", { action: "whatsapp.client_associated" });
      }
      auditStore.record({ action: "client.associated", entityType: "agent", entityId: machineId, metadata: { enrollmentId: consumed.id, ticketId: consumed.ticketId } });
      return sendJson(res, 200, { associated: true, agent: { machineId, hostname: agent.hostname }, ticketId: consumed.ticketId });
    }
    if (req.method === "POST" && url.pathname === "/api/agents/enroll") {
      const body = await readJsonBody(req);
      const enrollment = clientEnrollmentStore.inspect(body.enrollmentToken);
      if (!enrollment || enrollment.status !== "pending") return sendJson(res, 410, { error: "Codigo de instalacion vencido o utilizado" });
      const agent = agentStore.register(body);
      const deviceSecret = crypto.randomBytes(32).toString("base64url");
      agentStore.issueCredential(agent.machineId, deviceSecret);
      const consumed = clientEnrollmentStore.consume(body.enrollmentToken, agent.machineId);
      const session = remoteSessionStore.list().reverse().find((item) => item.ticketId === consumed.ticketId && !isTerminalRemoteStatus(item.status));
      if (session && !session.agentId) remoteSessionStore.assignAgent(session.id, agent.machineId);
      if (consumed.ticketId && ticketStore.get(consumed.ticketId)) {
        ticketStore.update(consumed.ticketId, { equipmentId: agent.machineId, intakeStage: "problem_details" });
        ticketStore.addMessage(consumed.ticketId, { direction: "internal", channel: "installation", author: "SAS Agent", body: `SAS Cliente instalado y vinculado en ${agent.hostname || agent.machineId}.` });
        await sendTicketWhatsApp(consumed.ticketId, `SAS Cliente quedó instalado y el equipo ${agent.hostname || "del usuario"} ya está vinculado. Ahora describe el problema con detalle o envía una imagen; después Fisher creará el ticket.`, { action: "whatsapp.client_enrolled" });
      }
      auditStore.record({ action: "client.enrolled", entityType: "agent", entityId: agent.machineId, metadata: { enrollmentId: consumed.id, ticketId: consumed.ticketId, hostname: agent.hostname } });
      res.setHeader("Cache-Control", "no-store");
      return sendJson(res, 201, { agent: agentStore.list().find((item) => item.machineId === agent.machineId), agentSecret: deviceSecret, ticketId: consumed.ticketId });
    }

    if (req.method === "POST" && url.pathname === "/api/agents/register") {
      assertAgentSecret(req);
      const body = await readJsonBody(req);
      const agent = agentStore.register(body);
      auditStore.record({ action: "agent.register", entityType: "agent", entityId: agent.id, metadata: { hostname: agent.hostname, capabilities: agent.capabilities } });
      return sendJson(res, 201, { agent, heartbeatSeconds: config.agentHeartbeatSeconds });
    }

    if (req.method === "POST" && url.pathname === "/api/agents/heartbeat") {
      assertAgentSecret(req);
      const body = await readJsonBody(req);
      const agent = agentStore.heartbeat(body);
      return sendJson(res, 200, { agent, heartbeatSeconds: config.agentHeartbeatSeconds });
    }

    if (req.method === "POST" && url.pathname === "/api/agents/support-request") {
      assertIndividualAgentSecret(req);
      const body = await readJsonBody(req);
      const agent = agentStore.heartbeat({ ...body, machineId: req.headers["x-agent-id"] });
      const customerName = String(body.customerName ?? "").trim();
      const company = String(body.company ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const description = String(body.description ?? "").trim();
      if (customerName.length < 2) return sendJson(res, 400, { error: "Escribe el nombre completo" });
      if (company.length < 2) return sendJson(res, 400, { error: "Escribe el nombre de la empresa" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendJson(res, 400, { error: "Escribe un correo electrónico válido" });
      if (description.length < 5) return sendJson(res, 400, { error: "Describe el problema con al menos 5 caracteres" });
      let customerPhone;
      try { customerPhone = normalizeMexicanWhatsappPhone(body.customerPhone); }
      catch (error) { return sendJson(res, 400, { error: error.message }); }
      let contact = customerPhone ? contactStore.findByPhone(customerPhone) : null;
      if (contact) contact = contactStore.update(contact.id, { name: customerName, company, email, phone: customerPhone });
      else if (customerPhone) contact = contactStore.create({ name: customerName, company, email, phone: customerPhone, notes: `Solicitud enviada desde ${agent.hostname}.` });
      const ticket = ticketStore.create({
        customerName,
        customerPhone,
        contactId: contact?.id,
        equipmentId: agent.machineId,
        subject: String(body.subject ?? description).slice(0, 80),
        description,
        source: "sas_client",
        priority: body.priority ?? "normal"
      });
      const session = remoteSessionStore.create({ ticketId: ticket.id, requestedBy: customerName, customerPhone, agentId: agent.machineId });
      ticketStore.addMessage(ticket.id, { direction: "internal", channel: "sas_client", author: "SAS Cliente", body: `Solicitud creada desde ${agent.hostname}; equipo vinculado automáticamente.` });
      auditStore.record({ action: "ticket.create.client", entityType: "ticket", entityId: ticket.id, metadata: { agentId: agent.machineId, hostname: agent.hostname, sessionId: session.id } });
      return sendJson(res, 201, { ticket: ticketStore.get(ticket.id), session, consentUrl: `${config.publicBaseUrl}/remote/consent/${session.joinCode}` });
    }
    if (req.method === "POST" && url.pathname === "/api/agents/session-consent") {
      assertIndividualAgentSecret(req);
      const body = await readJsonBody(req);
      const machineId = String(req.headers["x-agent-id"] ?? "");
      const pending = remoteSessionStore.get(body.sessionId);
      if (!pending) return sendJson(res, 404, { error: "Sesión remota no encontrada" });
      if (pending.agentId !== machineId) return sendJson(res, 403, { error: "La sesión no corresponde a este equipo" });
      if (pending.consent?.decision !== "pending" || pending.status !== "pending_customer_consent") {
        return sendJson(res, 409, { error: "La solicitud ya fue respondida", session: publicRemoteSession(pending) });
      }
      const metadata = {
        decidedBy: "sas_client_desktop",
        ipAddress: req.socket.remoteAddress,
        userAgent: "SAS Cliente",
        allowControl: body.allowControl === true
      };
      const session = body.decision === "approved"
        ? remoteSessionStore.approveConsent(pending.joinCode, metadata)
        : remoteSessionStore.rejectConsent(pending.joinCode, metadata);
      auditStore.record({ action: `remote.consent.desktop.${session.consent.decision}`, entityType: "remote_session", entityId: session.id, metadata: { agentId: machineId, allowControl: body.allowControl === true } });
      await sendTicketWhatsApp(session.ticketId, session.consent.decision === "approved"
        ? `El usuario autorizo desde SAS Cliente la sesion ${session.joinCode}${body.allowControl === true ? " con teclado, raton y portapapeles" : " solo para visualizar la pantalla"}.`
        : `El usuario rechazo desde SAS Cliente la sesion ${session.joinCode}.`, { action: `whatsapp.remote_desktop_${session.consent.decision}` });
      return sendJson(res, 200, { session: publicRemoteSession(session) });
    }
    if (req.method === "POST" && url.pathname === "/api/agents/control-consent") {
      assertIndividualAgentSecret(req);
      const body = await readJsonBody(req);
      const machineId = String(req.headers["x-agent-id"] ?? "");
      const pending = remoteSessionStore.get(body.sessionId);
      if (!pending) return sendJson(res, 404, { error: "Sesión remota no encontrada" });
      if (pending.agentId !== machineId) return sendJson(res, 403, { error: "La sesión no corresponde a este equipo" });
      if (pending.consent?.decision !== "approved") return sendJson(res, 409, { error: "Primero debe autorizarse la sesión de soporte" });
      if (pending.controlConsent?.decision !== "pending") {
        return sendJson(res, 409, { error: "La solicitud de control ya fue respondida", session: publicRemoteSession(pending) });
      }
      const session = remoteSessionStore.decideControl(pending.joinCode, body.decision, {
        decidedBy: "sas_client_desktop",
        ipAddress: req.socket.remoteAddress,
        userAgent: "SAS Cliente"
      });
      auditStore.record({ action: `remote.control.desktop.${session.controlConsent.decision}`, entityType: "remote_session", entityId: session.id, metadata: { agentId: machineId } });
      await sendTicketWhatsApp(session.ticketId, session.controlConsent.decision === "approved"
        ? `El usuario autorizó desde SAS Cliente el teclado y ratón para la sesión ${session.joinCode}.`
        : `El usuario rechazó desde SAS Cliente el control de teclado y ratón para la sesión ${session.joinCode}.`, { action: `whatsapp.remote_control_desktop_${session.controlConsent.decision}` });
      return sendJson(res, 200, { session: publicRemoteSession(session) });
    }
    if (req.method === "POST" && url.pathname === "/api/agents/security-event") {
      assertIndividualAgentSecret(req);
      const body = await readJsonBody(req);
      const machineId = String(req.headers["x-agent-id"] ?? "");
      const agent = agentStore.list().find((item) => item.machineId === machineId);
      if (!agent) return sendJson(res, 404, { error: "Equipo no registrado" });
      const event = {
        operation: "realtime_detection",
        engine: "ClamAV",
        detectedAt: body.event?.detectedAt ?? new Date().toISOString(),
        fileName: path.basename(String(body.event?.file ?? "archivo")),
        file: String(body.event?.file ?? "").slice(0, 2000),
        size: Math.max(0, Number(body.event?.size ?? 0)),
        status: String(body.event?.status ?? "infected").slice(0, 40),
        scannedAt: body.event?.scannedAt ?? body.event?.detectedAt ?? new Date().toISOString(),
        result: String(body.event?.result ?? "").slice(-1000),
        action: "reported_not_deleted"
      };
      agentStore.recordInventory(machineId, "security", event);
      auditStore.record({ action: "agent.security.detected", entityType: "agent", entityId: machineId, metadata: { hostname: agent.hostname, fileName: event.fileName, action: event.action } });
      return sendJson(res, 202, { accepted: true });
    }
    if (req.method === "POST" && url.pathname === "/api/agents/poll") {
      assertAgentSecret(req);
      const body = await readJsonBody(req);
      const agent = agentStore.heartbeat(body);
      const sessions = remoteSessionStore.pendingForAgent(agent.machineId).map((session) => {
        const ticket = session.ticketId ? ticketStore.get(session.ticketId) : null;
        return { ...session, ticketSubject: ticket?.subject ?? null, customerName: ticket?.customerName ?? null };
      });
      return sendJson(res, 200, { agent, sessions, heartbeatSeconds: config.agentHeartbeatSeconds });
    }

    if (req.method === "POST" && url.pathname === "/api/agents/pair") {
      assertAgentSecret(req);
      const body = await readJsonBody(req);
      const joinCode = String(body.joinCode ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(joinCode)) {
        const error = new Error("El código debe contener 6 letras o números");
        error.statusCode = 400;
        throw error;
      }
      const agent = agentStore.heartbeat(body);
      const session = remoteSessionStore.pairAgentByJoinCode(joinCode, agent.machineId, {
        pairedBy: "agent_local_panel",
        hostname: agent.hostname
      });
      if (!session) {
        return sendJson(res, 404, { error: "Código de sesión no encontrado" });
      }
      if (session.ticketId && ticketStore.get(session.ticketId)) {
        ticketStore.update(session.ticketId, { equipmentId: agent.machineId });
        ticketStore.addMessage(session.ticketId, {
          direction: "internal",
          channel: "agent",
          author: "SAS Agent",
          body: `Equipo ${agent.hostname || agent.machineId} vinculado mediante código de sesión.`
        });
      }
      auditStore.record({
        action: "remote.pair_agent",
        entityType: "remote_session",
        entityId: session.id,
        metadata: { agentId: agent.machineId, hostname: agent.hostname, pairingMethod: "join_code" }
      });
      return sendJson(res, 200, {
        paired: true,
        requiresConsent: session.consent?.decision !== "approved",
        agent: { machineId: agent.machineId, hostname: agent.hostname },
        session: {
          id: session.id,
          ticketId: session.ticketId,
          joinCode: session.joinCode,
          status: session.status,
          agentId: session.agentId,
          consent: { decision: session.consent?.decision ?? "pending" }
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/api/agents/quick-authorize") {
      assertAgentSecret(req);
      const body = await readJsonBody(req);
      const joinCode = String(body.joinCode ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(joinCode)) { const error = new Error("El código debe contener 6 letras o números"); error.statusCode = 400; throw error; }
      const agent = agentStore.heartbeat(body);
      const paired = remoteSessionStore.pairAgentByJoinCode(joinCode, agent.machineId, { pairedBy: "agent_quick_authorize", hostname: agent.hostname });
      if (!paired) return sendJson(res, 404, { error: "Código de sesión no encontrado" });
      if (paired.consent?.decision === "approved") { const error = new Error("Esta sesión ya fue autorizada o utilizada"); error.statusCode = 409; throw error; }
      const session = remoteSessionStore.approveConsent(joinCode, { decidedBy: "customer_quick_authorize", allowControl: body.allowControl === true, ipAddress: req.socket.remoteAddress, userAgent: req.headers["user-agent"] });
      if (!session) return sendJson(res, 404, { error: "Código de sesión no encontrado" });
      if (session.agentId) {
        remoteSessionStore.start(session.id, "customer_quick_authorize");
        remoteSessionStore.startScreenShare(session.id, "customer_quick_authorize", { intervalSeconds: 0.25, quality: 62, maxWidth: 1920, monitorIndex: body.monitorIndex ?? 0, nativeResolution: body.nativeResolution === true, profile: "lowLatency" });
      }
      if (session.ticketId && ticketStore.get(session.ticketId)) {
        ticketStore.update(session.ticketId, { equipmentId: agent.machineId });
        ticketStore.addMessage(session.ticketId, { direction: "internal", channel: "agent", author: "SAS Cliente", body: `Autorización rápida única confirmada para ${agent.hostname || agent.machineId}.` });
      }
      auditStore.record({ action: "remote.quick_authorize", entityType: "remote_session", entityId: session.id, metadata: { agentId: agent.machineId, joinCode, pairingMethod: "single_use_quick_authorize" } });
      return sendJson(res, 200, { authorized: true, paired: true, oneTime: true, agent: { machineId: agent.machineId, hostname: agent.hostname }, session: { id: session.id, ticketId: session.ticketId, joinCode: session.joinCode, status: session.status, agentId: session.agentId, consent: { decision: session.consent?.decision ?? "pending" } } });
    }
    if (req.method === "POST" && url.pathname === "/api/agents/screen-frame") {
      assertIndividualAgentSecret(req);
      const machineId = String(req.headers["x-agent-id"] ?? "").trim();
      const body = JSON.parse(await readRawBody(req, 12 * 1024 * 1024) || "{}");
      const published = remoteSessionStore.publishScreenFrame(String(body.sessionId ?? ""), machineId, body.frame);
      if (!published) return sendJson(res, 404, { error: "Active screen session not found for this agent" });
      return sendJson(res, 202, { received: true, capturedAt: published.session.screenShare.lastFrameAt });
    }
    if (url.pathname === "/api/agents/webrtc-signals") {
      assertIndividualAgentSecret(req);
      const machineId = String(req.headers["x-agent-id"] ?? "").trim();
      if (req.method === "GET") {
        const sessionId = String(url.searchParams.get("sessionId") ?? "").trim();
        const remoteSession = remoteSessionStore.get(sessionId);
        if (!remoteSession || remoteSession.agentId !== machineId) return sendJson(res, 404, { error: "Remote session not found for this agent" });
        return sendJson(res, 200, { signals: listWebRtcSignals(sessionId, "agent", Number(url.searchParams.get("after") ?? 0)), webrtc: { enabled: config.webrtcEnabled, iceServers: nativeWebRtcIceServers(machineId), turnConfigured: turnIsConfigured(config), guaranteedConnectivity: turnIsConfigured(config), udpMinPort: config.webrtcUdpMinPort, udpMaxPort: config.webrtcUdpMaxPort, transport: "datachannel" } });
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req); const sessionId = String(body.sessionId ?? "").trim();
        const remoteSession = remoteSessionStore.get(sessionId);
        if (!remoteSession || remoteSession.agentId !== machineId) return sendJson(res, 404, { error: "Remote session not found for this agent" });
        const signal = queueWebRtcSignal(sessionId, { type: body.type, sdp: body.sdp, candidate: body.candidate, negotiationId: body.negotiationId }, { sender: "agent", target: "operator" });
        return sendJson(res, 201, { signal });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/agents/command-results") {
      assertAgentSecret(req);
      const body = await readJsonBody(req);
      const updated = remoteSessionStore.completeCommand(body.sessionId, body.commandId, body.result);
      if (!updated) {
        return sendJson(res, 404, { error: "Command not found" });
      }
      if (updated.session.ticketId) {
        ticketStore.addMessage(updated.session.ticketId, {
          direction: "internal",
          channel: "agent",
          author: "SAS Agent",
          body: `Comando ${updated.command.type} ${updated.command.status}. Resultado registrado en sesion ${updated.session.joinCode}.`
        });
      }
      const inventoryKind = ({ software_inventory: "applications", startup_inventory: "startup", security_status: "security", security_definitions_update: "security", security_scan_startup: "security", security_quarantine_file: "security" })[updated.command.type];
      if (inventoryKind && body.result?.data) {
        agentStore.recordInventory(updated.session.agentId, inventoryKind, body.result.data);
        auditStore.record({ action: `agent.${updated.command.type}`, entityType: "agent", entityId: updated.session.agentId, metadata: { sessionId: updated.session.id, commandId: updated.command.id, count: body.result.data.items?.length ?? body.result.data.scanned ?? null, infected: body.result.data.infected ?? null } });
      }
      if (updated.command.type === "repair_action") {
        const outcome = repairOutcomeStore.record({
          ticketId: updated.session.ticketId,
          sessionId: updated.session.id,
          command: updated.command,
          result: body.result
        });
        ticketStore.addMessage(updated.session.ticketId, {
          direction: "internal",
          channel: "repair_outcome",
          author: "Fisher",
          body: `Resultado de reparacion ${outcome.actionId}: ${outcome.status}.`
        });
        auditStore.record({ action: "repair.outcome", entityType: "ticket", entityId: updated.session.ticketId, metadata: { outcomeId: outcome.id, sessionId: updated.session.id, commandId: updated.command.id, actionId: outcome.actionId, status: outcome.status, simulated: outcome.simulated } });
      }
      auditStore.record({ action: "remote.command.result", entityType: "remote_session", entityId: body.sessionId, metadata: { commandId: body.commandId, type: updated.command.type, status: updated.command.status } });
      return sendJson(res, 200, { command: updated.command });
    }

    if (req.method === "POST" && url.pathname === "/api/agents/event-results") {
      assertAgentSecret(req);
      const body = await readJsonBody(req);
      const updated = remoteSessionStore.completeInteractiveEvent(body.sessionId, body.eventId, body.result);
      if (!updated) {
        return sendJson(res, 404, { error: "Interactive event not found" });
      }
      if (updated.event.type === "secure_attention") {
        auditStore.record({ action: "remote.event.result", entityType: "remote_session", entityId: body.sessionId, metadata: buildInteractiveEventAuditMetadata(updated.event) });
      }
      return sendJson(res, 200, { event: updated.event });
    }




    if (req.method === "POST" && url.pathname === "/api/agents/session-close") {
      assertAgentSecret(req);
      const body = await readJsonBody(req);
      const session = remoteSessionStore.closeByAgent(body.sessionId, body.machineId);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found for agent" });
      }
      auditStore.record({ action: "remote.close.agent_local_stop", entityType: "remote_session", entityId: session.id, metadata: { agentId: body.machineId } });
      return sendJson(res, 200, { session });
    }
    if (req.method === "POST" && url.pathname === "/api/agent/diagnose") {
      authService.require(actor, "ticket:write");
      const body = await readJsonBody(req);
      const diagnosis = agentService.diagnose({ ticketId: body.ticketId, message: body.message });
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "agent.diagnose", entityType: "ticket", entityId: body.ticketId, metadata: { category: diagnosis.category } });
      return sendJson(res, 200, { diagnosis });
    }

    if (req.method === "POST" && url.pathname === "/api/dev/whatsapp-simulate") {
      authService.require(actor, "ticket:write");
      const body = await readJsonBody(req);
      const event = {
        id: `SIM-${Date.now()}`,
        from: String(body.from ?? "5215559002000"),
        profileName: String(body.profileName ?? body.name ?? "Cliente WhatsApp"),
        type: "text",
        text: String(body.text ?? body.message ?? "").trim(),
        timestamp: String(Math.floor(Date.now() / 1000))
      };
      if (!event.text) {
        return sendJson(res, 400, { error: "Message text is required" });
      }
      const result = await conversationService.handleWhatsAppMessage(event);
      auditStore.record({ actorId: actor.id, actorRole: actor.role, action: "whatsapp.simulate", entityType: "ticket", entityId: result.ticketId, metadata: { from: event.from, category: result.diagnosis.category, command: result.command ?? null } });
      return sendJson(res, 200, { simulated: true, event, result });
    }
    if (req.method === "GET" && url.pathname === "/webhooks/whatsapp") {
      const challenge = verifyWhatsAppWebhook(url.searchParams, config.whatsappVerifyToken);
      if (!challenge) {
        return sendJson(res, 403, { error: "Invalid WhatsApp verify token" });
      }

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(challenge);
    }

    if (req.method === "POST" && url.pathname === "/webhooks/whatsapp") {
      const rawBody = await readRawBody(req);
      if (config.whatsappAppSecret && !verifyWhatsAppSignature(rawBody, req.headers["x-hub-signature-256"], config.whatsappAppSecret)) {
        auditStore.record({ action: "whatsapp.signature_rejected", entityType: "security", metadata: { ipAddress: req.socket.remoteAddress } });
        return sendJson(res, 401, { error: "Invalid WhatsApp signature" });
      }
      const body = rawBody.trim() ? JSON.parse(rawBody) : {};
      const events = parseWhatsAppWebhook(body);
      const processed = [];

      for (const event of events) {
        const result = await conversationService.handleWhatsAppMessage(event);
        auditStore.record({ action: "whatsapp.message", entityType: "ticket", entityId: result.ticketId, metadata: { from: event.from, category: result.diagnosis.category, command: result.command ?? null } });
        processed.push(result);
      }

      return sendJson(res, 200, { received: true, processed });
    }

    if (req.method === "GET" && url.pathname.startsWith("/remote/join/")) {
      const joinCode = url.pathname.split("/").pop();
      const session = remoteSessionStore.findByJoinCode(joinCode);
      if (!session) {
        return sendJson(res, 404, { error: "Remote session not found" });
      }
      return sendJson(res, 200, {
        message: "SAS Remote Support",
        session: publicRemoteSession(session),
        consentUrl: `${config.publicBaseUrl}/remote/consent/${session.joinCode}`
      });
    }

    return createJsonResponse(res, 404, { error: "Route not found" });
  } catch (error) {
    const statusCode = error?.statusCode ?? 500;
    recordAuthFailure(error, req, requestContext);
    return sendJson(res, statusCode, {
      error: statusCode === 500 ? "Internal server error" : error.message,
      detail: statusCode === 500 && error instanceof Error ? error.message : undefined
    });
  }
};

function recordAuthFailure(error, req, context) {
  if (![401, 403].includes(error?.statusCode) || !error?.authFailure) return;
  auditStore.record({
    actorId: context?.actor?.id ?? error.authFailure.actorId ?? "unknown",
    actorRole: context?.actor?.role ?? error.authFailure.role ?? "unknown",
    action: "auth.denied",
    entityType: "security",
    metadata: {
      reason: error.authFailure.reason,
      permission: error.authFailure.permission,
      method: req.method,
      path: context?.url?.pathname ?? req.url ?? "unknown",
      ipAddress: req.socket?.remoteAddress ?? null
    }
  });
}

startServers();

function startServers() {
  if (config.enableHttp) {
    http.createServer(requestHandler).listen(config.httpPort, () => {
      console.log(`SAS HTTP listening on http://localhost:${config.httpPort}`);
    });
  }

  if (config.enableHttps) {
    const tls = readTlsFiles();
    if (!tls) {
      console.warn("HTTPS enabled but TLS files are missing. Run scripts/install-server.ps1 to generate certs.");
      return;
    }

    https.createServer(tls, requestHandler).listen(config.httpsPort, () => {
      console.log(`SAS HTTPS listening on https://localhost:${config.httpsPort}`);
    });
  }
}

function readTlsFiles() {
  if (!fs.existsSync(config.tlsKeyPath) || !fs.existsSync(config.tlsCertPath)) {
    return null;
  }

  return {
    key: fs.readFileSync(config.tlsKeyPath),
    cert: fs.readFileSync(config.tlsCertPath)
  };
}

function normalizeResolutionSteps(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/\r?\n|\s*;\s*/)
    .map((item) => item.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
}

function inferKnowledgeCategory(value) {
  const normalized = String(value ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/correo|outlook|smtp|imap|mail/.test(normalized)) return "email";
  if (/internet|wifi|red|conexion/.test(normalized)) return "internet";
  if (/impresora|imprimir|toner|scanner/.test(normalized)) return "printer";
  if (/remoto|anydesk|teamviewer|control/.test(normalized)) return "remote_support";
  return "general";
}
function runGuidedAutoStep({ actor }) {
  const agents = agentStore.list();
  const onlineAgent = agents.find((item) => item.status === "online") ?? null;
  let report = buildGuidedTestReport();
  let ticket = report.ticket ? ticketStore.get(report.ticket.id) : null;
  let session = report.session ? remoteSessionStore.get(report.session.id) : null;

  if (!ticket) {
    ticket = ticketStore.create({
      customerName: "Cliente Prueba Guiada",
      customerPhone: `521555${String(Date.now()).slice(-7)}`,
      subject: "Prueba guiada automatica de soporte remoto",
      description: "Validar flujo automatico: ticket, sesion, consentimiento, pantalla, diagnostico, control y cierre.",
      source: "guided_test",
      priority: "normal"
    });
    session = remoteSessionStore.create({ ticketId: ticket.id, requestedBy: actor.id, customerPhone: ticket.customerPhone, agentId: onlineAgent?.machineId ?? "" });
    return guidedAutoResult("create", "Ticket y sesión remota creados.", ticket, session);
  }

  if (!session) {
    session = remoteSessionStore.create({ ticketId: ticket.id, requestedBy: actor.id, customerPhone: ticket.customerPhone, agentId: onlineAgent?.machineId ?? "" });
    return guidedAutoResult("remote_session", "Sesión remota creada para el ticket de prueba.", ticket, session);
  }

  if (session.status === "closed") {
    ticket = ticketStore.create({
      customerName: "Cliente Prueba Guiada",
      customerPhone: `521555${String(Date.now()).slice(-7)}`,
      subject: "Prueba guiada automatica de soporte remoto",
      description: "Repetir flujo automatico: ticket, sesion, consentimiento, pantalla, diagnostico, control y cierre.",
      source: "guided_test",
      priority: "normal"
    });
    session = remoteSessionStore.create({ ticketId: ticket.id, requestedBy: actor.id, customerPhone: ticket.customerPhone, agentId: onlineAgent?.machineId ?? "" });
    return guidedAutoResult("repeat", "Prueba anterior cerrada. Se creo una nueva prueba guiada.", ticket, session);
  }

  if (!session.agentId) {
    if (!onlineAgent) return guidedAutoResult("waiting_agent", "No hay agente online para asignar.", ticket, session, false);
    session = remoteSessionStore.assignAgent(session.id, onlineAgent.machineId);
    return guidedAutoResult("assign_agent", "Agente online asignado a la sesion.", ticket, session);
  }

  if (session.consent?.decision !== "approved") {
    session = remoteSessionStore.approveConsent(session.joinCode, { decidedBy: "guided-test-customer", ipAddress: "local-guided-test" });
    return guidedAutoResult("approve_consent", "Consentimiento de soporte aprobado en modo prueba guiada.", ticket, session);
  }

  if (!session.startedAt && session.status !== "active" && session.status !== "closed") {
    session = remoteSessionStore.start(session.id, actor.id);
    return guidedAutoResult("start", "Sesion remota iniciada.", ticket, session);
  }

  if (!session.screenShare?.enabled && !session.screenShare?.lastFrameAt) {
    session = remoteSessionStore.startScreenShare(session.id, actor.id, { intervalSeconds: 0.25, quality: 58, maxWidth: 1600, profile: "lowLatency" });
    return guidedAutoResult("screen", "Vista fluida activada.", ticket, session);
  }

  if (!(session.commands ?? []).some((command) => command.type === "system_info")) {
    remoteSessionStore.queueCommand(session.id, { type: "system_info", requestedBy: actor.id });
    session = remoteSessionStore.get(session.id);
    return guidedAutoResult("system_command", "Diagnostico de sistema solicitado al agente.", ticket, session);
  }

  if (session.controlConsent?.decision !== "approved") {
    session = remoteSessionStore.requestControl(session.id, actor.id);
    session = remoteSessionStore.decideControl(session.joinCode, "approved", { decidedBy: "guided-test-customer", ipAddress: "local-guided-test" });
    return guidedAutoResult("approve_control", "Control aprobado en modo prueba guiada.", ticket, session);
  }

  const interactiveEvents = session.interactiveEvents ?? [];
  const hasInteractiveEvent = interactiveEvents.some((event) => event.type === "key_press");
  const hasCompletedInteractiveEvent = interactiveEvents.some((event) => ["simulated", "completed"].includes(event.status));
  if (!hasInteractiveEvent) {
    remoteSessionStore.queueInteractiveEvent(session.id, { type: "key_press", payload: { key: "Enter" }, requestedBy: actor.id });
    session = remoteSessionStore.get(session.id);
    return guidedAutoResult("interactive_event", "Evento Enter simulado enviado.", ticket, session);
  }
  if (!hasCompletedInteractiveEvent) {
    return guidedAutoResult("waiting_event", "Enter enviado. Esperando resultado del agente.", ticket, session);
  }

  if (session.status !== "closed") {
    session = remoteSessionStore.close(session.id, actor.id);
    ticketStore.addMessage(ticket.id, { direction: "internal", channel: "guided_test", author: actor.id, body: "La sesión de prueba terminó; el ticket permanece abierto hasta documentarlo y cerrarlo manualmente desde Tickets." });
    ticket = ticketStore.update(ticket.id, { status: "in_progress" });
    return guidedAutoResult("close", "Prueba guiada terminada; el ticket permanece abierto para documentación y cierre manual.", ticket, session);
  }

  return guidedAutoResult("completed", "Prueba guiada completada. Revisa auditoria y evidencia.", ticket, session);
}

function guidedAutoResult(step, message, ticket, session, ok = true) {
  return {
    ok,
    step,
    message,
    ticket: ticket ? summarizeTicket(ticket) : null,
    session: session ? summarizeRemoteSession(session) : null,
    report: buildGuidedTestReport({ ticketId: ticket?.id, sessionId: session?.id })
  };
}
function buildGuidedTestReport({ ticketId = null, sessionId = null } = {}) {
  const sessions = remoteSessionStore.list();
  const tickets = ticketStore.list();
  const agents = agentStore.list();
  const session = sessionId
    ? sessions.find((item) => item.id === sessionId) ?? null
    : pickGuidedSession({ sessions, ticketId, agents });
  const ticket = ticketId
    ? ticketStore.get(ticketId)
    : session?.ticketId
      ? ticketStore.get(session.ticketId)
      : tickets[0] ?? null;
  const agent = session?.agentId ? agents.find((item) => item.machineId === session.agentId || item.id === session.agentId) ?? null : null;
  const events = auditStore.list(500).filter((event) => {
    if (!session && !ticket) return true;
    return event.entityId === session?.id
      || event.entityId === ticket?.id
      || event.metadata?.ticketId === ticket?.id
      || event.metadata?.sessionId === session?.id
      || event.metadata?.joinCode === session?.joinCode;
  });
  const checks = buildGuidedChecks({ ticket, session, agent, events });
  const completed = checks.filter((check) => check.done).length;
  const total = checks.length;
  const status = total > 0 && completed === total ? "completed" : session ? "in_progress" : "not_started";

  return {
    generatedAt: new Date().toISOString(),
    status,
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    nextAction: checks.find((check) => !check.done)?.action ?? "Revisar auditoria y conservar evidencia de prueba.",
    ticket: ticket ? summarizeTicket(ticket) : null,
    session: session ? summarizeRemoteSession(session) : null,
    agent: agent ? summarizeAgent(agent) : null,
    checks,
    auditEvents: events.slice(0, 80)
  };
}

function pickGuidedSession({ sessions, ticketId, agents }) {
  const candidates = ticketId ? sessions.filter((session) => session.ticketId === ticketId) : sessions;
  return [...candidates].sort((a, b) => {
    const terminalDiff = Number(isGuidedTerminalSession(a)) - Number(isGuidedTerminalSession(b));
    if (terminalDiff !== 0) return terminalDiff;
    const scoreDiff = scoreGuidedSession(b, agents) - scoreGuidedSession(a, agents);
    if (scoreDiff !== 0) return scoreDiff;
    return String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt));
  })[0] ?? null;
}

function isGuidedTerminalSession(session) {
  return ["closed", "consent_rejected", "expired", "consent_locked", "control_locked"].includes(session?.status);
}

function scoreGuidedSession(session, agents) {
  const agent = session?.agentId ? agents.find((item) => item.machineId === session.agentId || item.id === session.agentId) ?? null : null;
  const events = auditStore.list(500).filter((event) => {
    return event.entityId === session?.id
      || event.metadata?.sessionId === session?.id
      || event.metadata?.joinCode === session?.joinCode;
  });
  return buildGuidedChecks({
    ticket: session?.ticketId ? ticketStore.get(session.ticketId) : null,
    session,
    agent,
    events
  }).filter((check) => check.done).length;
}
function buildGuidedChecks({ ticket, session, agent, events = [] }) {
  const controlApproved = session?.controlConsent?.decision === "approved"
    || events.some((event) => event.action === "remote.control.approved");
  return [
    { key: "ticket", label: "Ticket de prueba", done: Boolean(ticket), action: "Crear ticket de prueba." },
    { key: "remote_session", label: "Sesion remota", done: Boolean(session), action: "Crear sesion remota para el ticket." },
    { key: "agent_assigned", label: "Agente asignado", done: Boolean(session?.agentId), action: "Asignar agente online." },
    { key: "agent_online", label: "Agente online", done: agent?.status === "online", action: "Iniciar cliente Windows o revisar heartbeat." },
    { key: "consent", label: "Consentimiento aprobado", done: session?.consent?.decision === "approved", action: "Abrir consentimiento y aprobar soporte." },
    { key: "started", label: "Sesion iniciada", done: Boolean(session?.startedAt) || session?.status === "active" || session?.status === "closed", action: "Iniciar sesion remota." },
    { key: "screen", label: "Vista remota validada", done: Boolean(session?.screenShare?.enabled || session?.screenShare?.startedAt || session?.screenShare?.lastFrameAt), action: "Activar Baja latencia." },
    { key: "system_command", label: "Comando de sistema completado", done: Boolean((session?.commands ?? []).some((command) => command.type === "system_info" && command.status === "completed")), action: "Enviar comando Sistema." },
    { key: "control", label: "Control aprobado", done: controlApproved, action: "Solicitar y aprobar control." },
    { key: "interactive_event", label: "Evento simulado recibido", done: Boolean((session?.interactiveEvents ?? []).some((event) => event.status === "simulated" || event.status === "completed")), action: "Enviar Enter simulado." },
    { key: "closed", label: "Sesion cerrada", done: session?.status === "closed", action: "Presionar Cerrar prueba." }
  ];
}

function summarizeTicket(ticket) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    customerName: ticket.customerName,
    customerPhone: ticket.customerPhone,
    status: ticket.status,
    priority: ticket.priority,
    source: ticket.source,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt
  };
}

function summarizeRemoteSession(session) {
  return {
    id: session.id,
    ticketId: session.ticketId,
    joinCode: session.joinCode,
    status: session.status,
    agentId: session.agentId,
    consent: session.consent,
    controlConsent: session.controlConsent,
    screenShare: {
      enabled: session.screenShare?.enabled ?? false,
      intervalSeconds: session.screenShare?.intervalSeconds ?? null,
      quality: session.screenShare?.quality ?? null,
      maxWidth: session.screenShare?.maxWidth ?? null,
      startedAt: session.screenShare?.startedAt ?? null,
      stoppedAt: session.screenShare?.stoppedAt ?? null,
      lastFrameAt: session.screenShare?.lastFrameAt ?? null
    },
    commandCount: (session.commands ?? []).length,
    completedCommandCount: (session.commands ?? []).filter((command) => command.status === "completed").length,
    interactiveEventCount: (session.interactiveEvents ?? []).length,
    completedInteractiveEventCount: (session.interactiveEvents ?? []).filter((event) => ["simulated", "completed"].includes(event.status)).length,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function buildInteractiveEventAuditMetadata(event) {
  const result = event?.result ?? {};
  return {
    eventId: event?.id,
    type: event?.type,
    status: event?.status,
    simulated: result.simulated !== false,
    executed: Boolean(result.executed),
    helper: result.helper ?? null,
    executedAt: result.executedAt ?? null,
    error: event?.error ?? null
  };
}
function summarizeAgent(agent) {
  return {
    id: agent.id,
    machineId: agent.machineId,
    hostname: agent.hostname,
    username: agent.username,
    os: agent.os,
    version: agent.version,
    status: agent.status,
    lastSeenAt: agent.lastSeenAt,
    capabilities: agent.capabilities ?? {}
  };
}
function readClientPreflightReport() {
  if (!fs.existsSync(clientPreflightReportPath)) {
    return {
      exists: false,
      status: "missing",
      path: clientPreflightReportPath,
      generatedAt: null,
      checks: []
    };
  }

  try {
    const raw = fs.readFileSync(clientPreflightReportPath, "utf-8");
    const normalizedRaw = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    const report = JSON.parse(normalizedRaw);
    return {
      exists: true,
      path: clientPreflightReportPath,
      generatedAt: report.generatedAt ?? null,
      status: report.status ?? "unknown",
      serverUrl: report.serverUrl ?? null,
      agentPanelUrl: report.agentPanelUrl ?? null,
      checks: Array.isArray(report.checks) ? report.checks : [],
      nextSteps: Array.isArray(report.nextSteps) ? report.nextSteps : []
    };
  } catch (error) {
    return {
      exists: true,
      status: "invalid",
      path: clientPreflightReportPath,
      generatedAt: null,
      checks: [],
      error: error.message
    };
  }
}

function browserWebRtcIceServers(sessionId = "operator") {
  return createTurnIceServers(config, `operator-${sessionId}`);
}
function nativeWebRtcIceServers(machineId = "agent") {
  return createNativeTurnIceServers(config, machineId);
}

function pruneTransientRemoteState() {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [sessionId, signals] of webrtcSignals) {
    const session = remoteSessionStore.get(sessionId);
    const recent = signals.filter((signal) => Date.parse(signal.createdAt) >= cutoff).slice(-50);
    if (!session || isTerminalRemoteStatus(session.status) || recent.length === 0) webrtcSignals.delete(sessionId);
    else webrtcSignals.set(sessionId, recent);
  }
  const recordingCutoff = Date.now() - 4 * 60 * 60_000;
  for (const [recordingId, upload] of recordingUploads) {
    if (Date.parse(upload.startedAt) < recordingCutoff) recordingUploads.delete(recordingId);
  }
}
function queueWebRtcSignal(sessionId, input, routing = {}) {
  const type = String(input?.type ?? "").trim().toLowerCase();
  if (!["offer", "answer", "ice", "capability", "bye"].includes(type)) { const error = new Error("Tipo de señal WebRTC no permitido"); error.statusCode = 400; throw error; }
  let negotiationId = String(input?.negotiationId ?? "").trim();
  if (negotiationId && !/^[a-zA-Z0-9_-]{8,80}$/.test(negotiationId)) { const error = new Error("Identificador de negociación WebRTC inválido"); error.statusCode = 400; throw error; }
  const existing = webrtcSignals.get(sessionId) ?? [];
  if (!negotiationId && routing.sender === "agent") negotiationId = String([...existing].reverse().find((item) => item.type === "offer")?.negotiationId ?? "");
  if (!negotiationId && type === "offer") negotiationId = `legacy_${Date.now().toString(36)}`;
  const rawCandidate = input?.candidate;
  const candidate = rawCandidate && typeof rawCandidate === "object" ? {
    candidate: String(rawCandidate.candidate ?? "").slice(0, 4096),
    sdpMid: String(rawCandidate.sdpMid ?? "0").slice(0, 128),
    sdpMLineIndex: Number.isInteger(Number(rawCandidate.sdpMLineIndex)) ? Number(rawCandidate.sdpMLineIndex) : null
  } : null;
  const signal = { id: ++webrtcSignalSequence, sessionId, negotiationId, type, sender: routing.sender ?? "operator", target: routing.target ?? "agent", sdp: typeof input.sdp === "string" ? input.sdp.slice(0, 200000) : null, candidate, createdAt: new Date().toISOString() };
  const items = type === "offer" && signal.sender === "operator" ? [] : existing;
  items.push(signal);
  webrtcSignals.set(sessionId, items.filter((item) => Date.now() - Date.parse(item.createdAt) < 10 * 60_000).slice(-50));
  return signal;
}
function listWebRtcSignals(sessionId, target, after = 0) { return (webrtcSignals.get(sessionId) ?? []).filter((item) => item.target === target && item.id > after); }
function normalizeMexicanWhatsappPhone(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `52${digits}`;
  if (digits.length === 13 && digits.startsWith("521")) digits = `52${digits.slice(3)}`;
  if (!/^52[2-9]\d{9}$/.test(digits)) {
    const error = new Error("Escribe un WhatsApp de México con 10 dígitos, por ejemplo 55 1234 5678");
    error.statusCode = 400;
    throw error;
  }
  return digits;
}
function isTerminalRemoteStatus(status) {
  return ["closed", "consent_rejected", "expired", "consent_locked", "control_locked"].includes(String(status ?? ""));
}

function assertIndividualAgentSecret(req) {
  const secret = req.headers["x-agent-secret"];
  const machineId = req.headers["x-agent-id"];
  if (!agentStore.authenticate(machineId, secret)) {
    const error = new Error("Individual agent credential required");
    error.statusCode = 401;
    throw error;
  }
}

function assertAgentSecret(req) {
  const secret = req.headers["x-agent-secret"];
  const machineId = req.headers["x-agent-id"];
  if (secret !== config.agentSharedSecret && !agentStore.authenticate(machineId, secret)) {
    const error = new Error("Invalid agent secret");
    error.statusCode = 401;
    throw error;
  }
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readClientInstallerMetadata() {
  const configuredPath = path.resolve(projectRoot, config.clientInstallerPath);
  const canonicalPath = path.resolve(projectRoot, "downloads", "SAS-Cliente-Setup.exe");
  const candidates = [...new Set([configuredPath, canonicalPath])];
  for (const installerPath of candidates) {
    try { return readClientInstallerCandidateMetadata(installerPath); }
    catch (error) {
      if (error?.statusCode !== 503) throw error;
    }
  }
  throw httpError("La actualización de SAS Cliente no está publicada o no superó la verificación de integridad", 503);
}

function readClientInstallerCandidateMetadata(installerPath) {
  const manifestPath = `${installerPath}.manifest.json`;
  const sidecarPath = `${installerPath}.sha256.txt`;
  if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) throw httpError("La actualización de SAS Cliente aún no está publicada", 503);
  if (!fs.existsSync(manifestPath)) throw httpError("El instalador de SAS Cliente no tiene manifiesto de integridad", 503);
  const stat = fs.statSync(installerPath);
  const manifestStat = fs.statSync(manifestPath);
  const cacheKey = `${installerPath}:${stat.size}:${stat.mtimeMs}:${manifestStat.size}:${manifestStat.mtimeMs}`;
  if (clientInstallerMetadataCache?.cacheKey === cacheKey) return clientInstallerMetadataCache;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")); }
  catch { throw httpError("El manifiesto del instalador de SAS Cliente no es válido", 503); }
  const actualHash = crypto.createHash("sha256").update(fs.readFileSync(installerPath)).digest("hex").toUpperCase();
  const declaredHash = String(manifest.sha256 ?? "").trim().toUpperCase();
  const sidecarHash = fs.existsSync(sidecarPath) ? fs.readFileSync(sidecarPath, "ascii").match(/\b[A-F0-9]{64}\b/i)?.[0]?.toUpperCase() : null;
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version ?? ""))) throw httpError("El manifiesto del instalador no declara una versión válida", 503);
  if (manifest.compiler !== "NSIS" || Number(manifest.size) !== stat.size || declaredHash !== actualHash || (sidecarHash && sidecarHash !== actualHash)) {
    throw httpError("El instalador de SAS Cliente no superó la verificación de integridad", 503);
  }
  clientInstallerMetadataCache = { cacheKey, path: installerPath, version: String(manifest.version), size: stat.size, sha256: actualHash };
  return clientInstallerMetadataCache;
}

function serveDownload(res, filePath, filename, metadata = null) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendJson(res, 503, { error: "El instalador de cliente aun no esta publicado" });
  res.writeHead(200, { "Content-Type": "application/vnd.microsoft.portable-executable", "Content-Disposition": `attachment; filename="${filename}"`, "Content-Length": fs.statSync(filePath).size, "Cache-Control": "private, no-store", ...(metadata?.sha256 ? { "X-SAS-SHA256": metadata.sha256, ETag: `"sha256-${metadata.sha256}"` } : {}) });
  fs.createReadStream(filePath).pipe(res);
}
function serveUpdateFile(res, relativePath) {
  const root = path.resolve(projectRoot, config.updateRoot);
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(root, safePath);
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendJson(res, 404, { error: "Update file not found" });
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".json" ? "application/json; charset=utf-8" : ext === ".zip" ? "application/zip" : "application/octet-stream";
  const cache = [".js", ".css", ".html"].includes(ext) || ext === ".json" ? "no-cache, no-store, must-revalidate" : "public, max-age=31536000, immutable"; res.writeHead(200, { "Content-Type": type, "Content-Length": fs.statSync(filePath).size, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(res, relativePath) {
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return createJsonResponse(res, 404, { error: "File not found" });
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  };

  res.writeHead(200, { "Content-Type": contentTypes[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
}



function operatorRemoteSession(session) {
  return {
    ...session,
    screenShare: { ...session.screenShare, lastFrame: null },
    commands: (session.commands ?? []).slice(-120).map((command) => ({
      ...command,
      result: command.purpose === "screen_share" ? null : command.result,
      fileTransfer: command.fileTransfer ? { ...command.fileTransfer, dataBase64: null } : null
    })),
    interactiveEvents: (session.interactiveEvents ?? []).slice(-20)
  };
}
function publicRemoteSession(session) {
  return {
    id: session.id,
    ticketId: session.ticketId,
    joinCode: session.joinCode,
    status: session.status,
    accessMode: session.accessMode === "unattended" ? "unattended" : "attended",
    consent: {
      decision: session.consent?.decision ?? "pending",
      required: session.consent?.required !== false,
      decidedAt: session.consent?.decidedAt ?? null
    },
    agentId: session.agentId,
    screenShare: {
      enabled: session.screenShare?.enabled ?? false,
      intervalSeconds: session.screenShare?.intervalSeconds ?? 2,
      quality: session.screenShare?.quality ?? 62,
      maxWidth: session.screenShare?.maxWidth ?? 1280,
      lastFrameAt: session.screenShare?.lastFrameAt ?? null
    },
    controlConsent: {
      decision: session.controlConsent?.decision ?? "not_requested",
      requestedAt: session.controlConsent?.requestedAt ?? null,
      decidedAt: session.controlConsent?.decidedAt ?? null
    },
    permissions: session.permissions ?? null,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    expiresAt: session.expiresAt,
    security: {
      consentAttempts: session.security?.consentAttempts ?? 0,
      consentMaxAttempts: session.security?.consentMaxAttempts ?? config.remoteConsentMaxAttempts,
      controlAttempts: session.security?.controlAttempts ?? 0,
      controlMaxAttempts: session.security?.controlMaxAttempts ?? config.remoteControlMaxAttempts,
      lockedReason: session.security?.lockedReason ?? null
    },
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}
function enforceRecoveryRateLimit(req, phone) {
  const now = Date.now();
  const windowMs = 15 * 60_000;
  const ip = String(req.socket?.remoteAddress ?? "unknown");
  const phoneKey = String(phone ?? "").replace(/\D/g, "").slice(-12);
  const key = `${ip}:${phoneKey}`;
  const recent = (passwordRecoveryAttempts.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= 3) {
    const error = new Error("Espera antes de solicitar otra liga de recuperación");
    error.statusCode = 429;
    throw error;
  }
  recent.push(now);
  passwordRecoveryAttempts.set(key, recent);
  if (passwordRecoveryAttempts.size > 2000) {
    for (const [entryKey, timestamps] of passwordRecoveryAttempts) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) passwordRecoveryAttempts.delete(entryKey);
    }
  }
}



