const STATUS_LABELS = {
  active: "Activa",
  approved: "Aprobado",
  authorized_waiting_agent: "Lista para conectar",
  authorized_waiting_agent_assignment: "Esperando equipo",
  closed: "Cerrado",
  completed: "Completada",
  consent_rejected: "Rechazada",
  expired: "Expirada",
  fail: "Error",
  high: "Alta",
  in_progress: "En progreso",
  locked: "Bloqueada",
  low: "Baja",
  normal: "Normal",
  not_requested: "No solicitado",
  not_started: "Sin iniciar",
  offline: "Desconectado",
  ok: "OK",
  online: "En línea",
  open: "Abierto",
  pass: "Correcto",
  pending: "Pendiente",
  pending_customer_consent: "Esperando permiso",
  pending_unattended_authorization: "Validando en SAS Cliente",
  pending_review: "Por revisar",
  rejected: "Rechazado",
  resolved: "Resuelto",
  revoked: "Revocado",
  urgent: "Urgente",
  waiting_customer: "Esperando cliente",
  warn: "Aviso"
};

function labelStatus(value) {
  const key = String(value ?? "").toLowerCase();
  return STATUS_LABELS[key] ?? String(value ?? "Sin dato");
}

function roleLabel(value) {
  return ({ admin: "Administrador", supervisor: "Supervisor", technician: "Técnico", viewer: "Consulta" })[value] ?? "Perfil sin identificar";
}

function sourceLabel(value) {
  return ({ whatsapp: "WhatsApp", console: "Consola", mobile: "Aplicación móvil", sas_client: "SAS Cliente", fisher: "Fisher" })[String(value ?? "console").toLowerCase()] ?? "Otro canal";
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function statusClass(value) {
  return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}
const state = {
  tickets: [],
  agents: [],
  deploymentCampaigns: [],
  sessions: [],
  articles: [],
  mobileUsers: [],
  repairActions: [],
  repairOutcomes: null,
  reviewMetrics: null,
  audit: [],
  contacts: [],
  companies: [],
  health: null,
  updates: null,
  storage: null,
  readiness: null,
  installations: null,
  operations: null,
  releaseGate: null,
  productionTrafficHistory: [],
  preflightReport: null,
  guidedReport: null,
  notice: null,
  selectedTicketId: null,
  authRequired: false,
  auditFilter: "all",
  auditLoading: false,
  connectionIssue: false,
  lastRefreshAt: null,
  consoleSession: null,
  updateChannel: null,
  consoleAuthMode: null,
  consoleAuthenticated: false,
  refreshPromise: null,
  dataRefreshPromise: null,
  refreshTimer: null,
  refreshRetryTimer: null,
  refreshRetryCount: 0,
  refreshFailureKind: null,
  ticketVersions: {},
  changedTicketIds: new Set(),
  ticketSearch: "",
  ticketStatusFilter: "active",
  ticketGroupBy: "date",
  remoteLaunchAgentIds: new Set(),
  report: null,
  reportLoading: false,
  reportFilters: null
};

const CONSOLE_SESSION_KEY = "sasConsoleSessionV1";
const RECOVERY_TOKEN_KEY = "sasRecoveryToken";
const WEB_DEVICE_KEY = "sasWebDeviceId";

const headers = () => {
  const base = { "Content-Type": "application/json" };
  if (state.consoleAuthMode === "account" && state.consoleSession?.accessToken) {
    return { ...base, Authorization: `Bearer ${state.consoleSession.accessToken}` };
  }
  if (state.consoleAuthMode === "recovery") {
    const token = sessionStorage.getItem(RECOVERY_TOKEN_KEY) ?? "";
    return { ...base, "x-sas-role": "admin", "x-sas-actor": "console-recovery", ...(token ? { "x-sas-console-token": token } : {}) };
  }
  return base;
};

function currentConsoleRole() {
  return state.consoleAuthMode === "recovery" ? "admin" : (state.consoleSession?.user?.role ?? "viewer");
}

function showView(viewName) {
  const target = document.querySelector(`#view-${viewName}`);
  const button = document.querySelector(`.nav-button[data-view="${viewName}"]`);
  if (!target || !button) return false;
  document.querySelectorAll(".nav-button").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  target.classList.add("active");
  if (viewName === "reports" && state.consoleAuthenticated) refreshReports().catch(() => {});
  return true;
}

document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

const loginForm = document.querySelector("#consoleLoginForm");
const passwordChangeForm = document.querySelector("#consolePasswordChangeForm");
const loginResult = document.querySelector("#consoleLoginResult");
loginForm?.addEventListener("submit", loginConsoleAccount);
passwordChangeForm?.addEventListener("submit", changeConsolePassword);
document.querySelector("#consoleLogout")?.addEventListener("click", logoutConsole);
document.querySelector("#useRecoveryToken")?.addEventListener("click", useRecoveryAccess);
document.querySelector("#toggleConsolePassword")?.addEventListener("click", () => {
  const input = document.querySelector("#consolePassword");
  if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  document.querySelector("#toggleConsolePassword").textContent = show ? "Ocultar" : "Ver";
});

function webDeviceId(account = state.consoleSession?.user?.username ?? "default") {
  const accountKey = `${WEB_DEVICE_KEY}:${String(account).trim().toLowerCase() || "default"}`;
  let id = localStorage.getItem(accountKey);
  if (!id) {
    id = `sas-web-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    localStorage.setItem(accountKey, id);
  }
  return id;
}

const consoleAuthChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("sas-console-auth") : null;
function readStoredConsoleSession() {
  for (const storage of [localStorage, sessionStorage]) { try { const raw=storage.getItem(CONSOLE_SESSION_KEY); if(!raw) continue; const session=JSON.parse(raw); if(session?.accessToken&&session?.refreshToken&&session?.device?.id) return session; } catch {} }
  return null;
}
function saveConsoleSession(session,{broadcast=true}={}) {
  state.consoleSession=session; state.consoleAuthMode="account"; state.refreshFailureKind=null; state.refreshRetryCount=0;
  const continuity=document.querySelector("#consoleSessionState");if(continuity){continuity.textContent="Activa y sincronizada";continuity.className="session-continuity active";}
  if(state.refreshRetryTimer) window.clearTimeout(state.refreshRetryTimer); state.refreshRetryTimer=null;
  const serialized=JSON.stringify(session); localStorage.setItem(CONSOLE_SESSION_KEY,serialized); sessionStorage.setItem(CONSOLE_SESSION_KEY,serialized); sessionStorage.removeItem(RECOVERY_TOKEN_KEY);
  scheduleConsoleRefresh(session); if(broadcast) consoleAuthChannel?.postMessage({type:"session",session});
}
function scheduleConsoleRefresh(session) {
  if(state.refreshTimer) window.clearTimeout(state.refreshTimer); state.refreshTimer=null; const expiresAt=Date.parse(session?.accessExpiresAt??""); if(!Number.isFinite(expiresAt)) return;
  const delay=Math.max(5000,expiresAt-Date.now()-60000); state.refreshTimer=window.setTimeout(async()=>{const refreshed=await refreshConsoleSession();if(refreshed)return;if(state.refreshFailureKind==="invalid"){clearConsoleCredentials({broadcast:true});showLogin({message:"La sesión fue revocada o venció definitivamente. Inicia sesión nuevamente.",type:"warning"});return;}scheduleConsoleRefreshRetry();const continuity=document.querySelector("#consoleSessionState");if(continuity){continuity.textContent="Reconectando…";continuity.className="session-continuity reconnecting";}if(state.consoleAuthenticated)showNotice("Conexión inestable. SAS conservará tu sesión y volverá a renovarla automáticamente.","warning");},Math.min(delay,2147000000));
}
function scheduleConsoleRefreshRetry() {
  if(state.refreshRetryTimer||state.consoleAuthMode!=="account")return;const delays=[5000,15000,30000,60000],delay=delays[Math.min(state.refreshRetryCount,delays.length-1)];state.refreshRetryCount+=1;
  state.refreshRetryTimer=window.setTimeout(async()=>{state.refreshRetryTimer=null;const refreshed=await refreshConsoleSession();if(refreshed){if(state.consoleAuthenticated)showNotice("Sesión recuperada sin interrumpir tu trabajo.","success");refresh().catch(()=>{});}else if(state.refreshFailureKind==="transient")scheduleConsoleRefreshRetry();},delay);
}
function clearConsoleCredentials({broadcast=false}={}) {
  if(state.refreshTimer)window.clearTimeout(state.refreshTimer);if(state.refreshRetryTimer)window.clearTimeout(state.refreshRetryTimer);
  state.refreshTimer=null;state.refreshRetryTimer=null;state.refreshRetryCount=0;state.refreshFailureKind=null;state.consoleSession=null;state.consoleAuthMode=null;state.consoleAuthenticated=false;
  localStorage.removeItem(CONSOLE_SESSION_KEY);sessionStorage.removeItem(CONSOLE_SESSION_KEY);sessionStorage.removeItem(RECOVERY_TOKEN_KEY);if(broadcast)consoleAuthChannel?.postMessage({type:"logout"});
}
function setLoginResult(message = "", type = "") {
  if (!loginResult) return;
  loginResult.textContent = message;
  loginResult.className = `login-result ${type}`.trim();
}

function showLogin({ passwordChange = false, message = "", type = "" } = {}) {
  document.body.classList.add("console-locked");
  const panel = document.querySelector("#consoleLogin");
  if (panel) panel.hidden = false;
  if (loginForm) loginForm.hidden = passwordChange;
  if (passwordChangeForm) passwordChangeForm.hidden = !passwordChange;
  document.querySelector("#consoleSession")?.setAttribute("hidden", "");
  const safety = document.querySelector("#consoleLoginSafety");
  if (safety) safety.hidden = !(type === "warning" || type === "error");
  setLoginResult(message, type);
  (passwordChange ? document.querySelector("#currentConsolePassword") : document.querySelector("#consoleUsername"))?.focus();
}

function enterConsole() {
  state.consoleAuthenticated = true;
  state.authRequired = false;
  document.body.classList.remove("console-locked");
  const panel = document.querySelector("#consoleLogin");
  if (panel) panel.hidden = true;
  const sessionPanel = document.querySelector("#consoleSession");
  if (sessionPanel) sessionPanel.hidden = false;
  const safety = document.querySelector("#consoleLoginSafety");
  if (safety) safety.hidden = true;
  const user = state.consoleSession?.user;
  const name = state.consoleAuthMode === "recovery" ? "Recuperacion local" : (user?.displayName ?? user?.username ?? "Usuario");
  const role = currentConsoleRole();
  document.querySelector("#consoleSessionName").textContent = name;
  document.querySelector("#consoleSessionRole").textContent = roleLabel(role);
  document.querySelector("#consoleSessionAvatar").textContent = name.slice(0, 1).toUpperCase();
}

async function loginConsoleAccount(event) {
  event.preventDefault();
  const button = document.querySelector("#consoleLoginButton");
  const username = document.querySelector("#consoleUsername")?.value?.trim() ?? "";
  const password = document.querySelector("#consolePassword")?.value ?? "";
  setButtonLoading(button, true, "Validando...");
  setLoginResult("Validando la cuenta autorizada...", "info");
  try {
    const response = await fetch("/api/mobile/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, deviceId: webDeviceId(username), deviceName: `Consola web - ${navigator.platform || "Windows"}`, platform: "web" }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? (response.status === 429 ? "Cuenta bloqueada temporalmente." : "Usuario o contraseña incorrectos."));
    saveConsoleSession(body.session);
    if (body.session.user?.mustChangePassword) {
      document.querySelector("#currentConsolePassword").value = password;
      showLogin({ passwordChange: true, message: "Debes cambiar la contraseña temporal antes de continuar.", type: "warning" });
      return;
    }
    enterConsole();
    setLoginResult();
    await refresh();
  } catch (error) {
    showLogin({ message: error.message, type: "error" });
  } finally {
    setButtonLoading(button, false);
  }
}

async function changeConsolePassword(event) {
  event.preventDefault();
  const currentPassword = document.querySelector("#currentConsolePassword")?.value ?? "";
  const newPassword = document.querySelector("#newConsolePassword")?.value ?? "";
  const confirmation = document.querySelector("#confirmConsolePassword")?.value ?? "";
  if (newPassword !== confirmation) return setLoginResult("Las contraseñas nuevas no coinciden.", "error");
  if (newPassword.length < 12) return setLoginResult("La nueva contraseña debe tener al menos 12 caracteres.", "error");
  try {
    const response = await fetch("/api/mobile/v1/auth/change-password", { method: "POST", headers: headers(), body: JSON.stringify({ currentPassword, newPassword }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "No fue posible cambiar la contraseña.");
    clearConsoleCredentials({ broadcast: true });
    passwordChangeForm?.reset();
    loginForm?.reset();
    showLogin({ message: "Contraseña actualizada. Inicia sesión nuevamente.", type: "success" });
  } catch (error) {
    setLoginResult(error.message, "error");
  }
}

async function performConsoleRefresh() {
  const shared=readStoredConsoleSession(),sharedExpiry=Date.parse(shared?.accessExpiresAt??"");
  if(shared?.refreshToken&&shared.accessToken!==state.consoleSession?.accessToken&&sharedExpiry>Date.now()+45000){saveConsoleSession(shared,{broadcast:false});return true;}
  const session=state.consoleSession;if(!session?.refreshToken||!session?.device?.id){state.refreshFailureKind="invalid";return false;}
  try{const response=await fetch("/api/mobile/v1/auth/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refreshToken:session.refreshToken,deviceId:session.device.id})});const body=await response.json().catch(()=>({}));if(response.ok&&body.session){saveConsoleSession(body.session);return true;}state.refreshFailureKind=[401,403].includes(response.status)?"invalid":"transient";return false;}catch{state.refreshFailureKind="transient";return false;}
}
async function refreshConsoleSession() {
  if(state.consoleAuthMode!=="account"||!state.consoleSession?.refreshToken)return false;if(state.refreshPromise)return state.refreshPromise;const run=()=>performConsoleRefresh();state.refreshPromise=(navigator.locks?.request?navigator.locks.request("sas-console-session-refresh",{mode:"exclusive"},run):run()).finally(()=>{state.refreshPromise=null;});return state.refreshPromise;
}
async function authenticatedFetch(path,options={},allowRefresh=true) {
  let response=await fetch(path,{...options,headers:{...headers(),...(options.headers??{})}});if(response.status===401&&allowRefresh&&state.consoleAuthMode==="account"){const refreshed=await refreshConsoleSession();if(refreshed)response=await fetch(path,{...options,headers:{...headers(),...(options.headers??{})}});}
  if(response.status===401&&state.consoleAuthenticated){if(state.refreshFailureKind==="invalid"){clearConsoleCredentials({broadcast:true});showLogin({message:"La sesión fue revocada o venció definitivamente. Inicia sesión nuevamente.",type:"warning"});}else{state.refreshFailureKind="transient";scheduleConsoleRefreshRetry();}}return response;
}
consoleAuthChannel?.addEventListener("message",event=>{if(event.data?.type==="session"&&event.data.session){saveConsoleSession(event.data.session,{broadcast:false});if(state.consoleAuthenticated)enterConsole();}else if(event.data?.type==="logout"){clearConsoleCredentials();showLogin({message:"La sesión se cerró desde otra pestaña.",type:"info"});}});
window.addEventListener("online",()=>{if(state.consoleAuthMode==="account")refreshConsoleSession().then(ok=>{if(ok)refresh().catch(()=>{});});});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState!=="visible"||state.consoleAuthMode!=="account")return;const expiresAt=Date.parse(state.consoleSession?.accessExpiresAt??"");if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()+60000)refreshConsoleSession().then(ok=>{if(ok)refresh().catch(()=>{});});});
async function useRecoveryAccess() {
  const token = document.querySelector("#recoveryToken")?.value?.trim() ?? "";
  if (!token) return setLoginResult("Escribe el token maestro de recuperación.", "error");
  state.consoleAuthMode = "recovery";
  sessionStorage.setItem(RECOVERY_TOKEN_KEY, token);
  try {
    const response = await fetch("/api/admin/storage", { headers: headers() });
    if (!response.ok) throw new Error("El token maestro no es valido.");
    state.consoleSession = { user: { displayName: "Recuperacion local", role: "admin" } };
    enterConsole();
    await refresh();
  } catch (error) {
    clearConsoleCredentials();
    showLogin({ message: error.message, type: "error" });
  }
}

async function logoutConsole() {
  const accessToken = state.consoleSession?.accessToken;
  const openRemoteSessions = state.sessions.filter((session) => !isTerminalRemoteStatus(session.status));
  if (openRemoteSessions.length && !confirm(`Al salir se cerrar\u00e1n ${openRemoteSessions.length} sesiones remotas abiertas por seguridad. \u00bfContinuar?`)) return;
  let closedRemoteSessions = [];
  if (state.consoleAuthMode === "account" && accessToken) {
    const response = await fetch("/api/mobile/v1/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }).catch(() => null);
    const body = await response?.json().catch(() => ({}));
    closedRemoteSessions = body?.closedRemoteSessions ?? [];
  }
  clearConsoleCredentials({ broadcast: true });
  showLogin({ message: closedRemoteSessions.length ? `Sesi\u00f3n cerrada y ${closedRemoteSessions.length} soportes remotos finalizados.` : "Sesi\u00f3n cerrada correctamente.", type: "success" });
}

async function bootstrapConsoleAuth() {
  try {
    const stored = readStoredConsoleSession();
    if (stored) {
      saveConsoleSession(stored, { broadcast: false });
      let response = await authenticatedFetch("/api/mobile/v1/me", {}, true);
      if (response.ok) {
        const body = await response.json();
        state.consoleSession.user = { ...state.consoleSession.user, ...body.user };
        saveConsoleSession(state.consoleSession);
        if (body.user?.mustChangePassword) return showLogin({ passwordChange: true, message: "Debes cambiar tu contraseña temporal.", type: "warning" });
        enterConsole();
        return refresh();
      }
    }
    const recovery = sessionStorage.getItem(RECOVERY_TOKEN_KEY);
    if (recovery) {
      state.consoleAuthMode = "recovery";
      const response = await fetch("/api/admin/storage", { headers: headers() });
      if (response.ok) {
        state.consoleSession = { user: { displayName: "Recuperacion local", role: "admin" } };
        enterConsole();
        return refresh();
      }
    }
  } catch {}
  clearConsoleCredentials();
  showLogin();
}

document.querySelector("#createDemoTicket").addEventListener("click", createDemoTicket);
document.querySelector("#closeTicketDialog")?.addEventListener("click", closeTicketDialog);
document.querySelector("#ticketDialog")?.addEventListener("close", () => document.body.classList.remove("case-dialog-open"));
document.querySelector("#ticketDialog")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeTicketDialog();
});
document.querySelector("#runDiagnosis").addEventListener("click", runDiagnosis);
document.querySelector("#runGuidedSetup")?.addEventListener("click", createGuidedTicketAndSession);
document.querySelector("#simulateWhatsapp")?.addEventListener("click", simulateWhatsappMessage);
document.querySelector("#exportAuditCsv")?.addEventListener("click", () => downloadAuditExport("csv"));
document.querySelector("#exportAuditJson")?.addEventListener("click", () => downloadAuditExport("json"));
document.querySelector("#createMobileUser")?.addEventListener("click", createMobileUser);
document.querySelector("#refreshMobileUsers")?.addEventListener("click", refresh);
document.querySelector("#refreshContacts")?.addEventListener("click", refresh);
document.querySelector("#contactSearch")?.addEventListener("input", renderContacts);
document.querySelector("#createContact")?.addEventListener("click", createContact);
document.querySelector("#companySearch")?.addEventListener("input", renderCompanies);
document.querySelector("#previewAspelClients")?.addEventListener("click", () => importAspelClients(true));
document.querySelector("#importAspelClients")?.addEventListener("click", () => importAspelClients(false));
document.querySelector("#assignContactCompany")?.addEventListener("click", assignContactCompany);
document.querySelector("#refreshReports")?.addEventListener("click", () => refreshReports(true));
document.querySelector("#applyReportFilters")?.addEventListener("click", () => applyReportFilters());
document.querySelector("#exportTicketReport")?.addEventListener("click", exportTicketReport);
document.querySelectorAll("[data-report-days]").forEach((button) => button.addEventListener("click", () => setReportPeriod(Number(button.dataset.reportDays))));
document.querySelector("#auditFilter")?.addEventListener("change", (event) => {
  state.auditFilter = event.target.value;
  state.audit = [];
  state.auditLoading = true;
  renderAudit();
  refresh();
});

initializeReportFilters();
bootstrapConsoleAuth();
setInterval(() => {
  if (state.consoleAuthenticated && !hasVisiblePasswordDraft()) refresh().catch(() => {});
}, 10000);

function hasVisiblePasswordDraft() {
  const view = document.querySelector("#view-mobile-users.active");
  return Boolean(view && [...view.querySelectorAll("[data-mobile-password]")].some((input) => input.value.length > 0));
}

function ticketVersion(ticket) {
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  const latestMessage = messages[messages.length - 1];
  return [ticket.updatedAt ?? ticket.createdAt ?? "", ticket.status ?? "", ticket.priority ?? "", messages.length, latestMessage?.createdAt ?? latestMessage?.id ?? ""].join("|");
}

function updateTickets(incomingTickets) {
  const nextVersions = {};
  const hasPreviousSnapshot = Object.keys(state.ticketVersions).length > 0;
  for (const ticket of incomingTickets) {
    const version = ticketVersion(ticket);
    nextVersions[ticket.id] = version;
    if (hasPreviousSnapshot && state.ticketVersions[ticket.id] !== version) {
      state.changedTicketIds.add(ticket.id);
    }
  }
  for (const ticketId of [...state.changedTicketIds]) {
    if (!nextVersions[ticketId]) state.changedTicketIds.delete(ticketId);
  }
  state.ticketVersions = nextVersions;
  state.tickets = incomingTickets;
}

async function refresh() {
  if (state.dataRefreshPromise) return state.dataRefreshPromise;
  state.dataRefreshPromise = performRefresh().finally(() => { state.dataRefreshPromise = null; });
  return state.dataRefreshPromise;
}

async function performRefresh() {
  state.authRequired = false;
  state.connectionIssue = false;
  state.auditLoading = true;
  await Promise.allSettled([
    loadJson("/health", false).then((data) => state.health = data),
    loadJson("/api/client-preflight").then((data) => state.preflightReport = data.report ?? null),
    loadJson("/api/admin/storage").then((data) => state.storage = data.storage ?? null),
    loadJson("/api/admin/updates").then((data) => state.updates = data.updates ?? null),
    loadJson("/api/admin/readiness").then((data) => state.readiness = data.readiness ?? null),
    loadJson("/api/admin/installations").then((data) => state.installations = data.installations ?? null),
    loadJson("/api/admin/operations").then((data) => state.operations = data.operations ?? null),
    loadJson("/api/admin/production-traffic-light").then((data) => state.releaseGate = data.releaseGate ?? null),
    loadJson("/api/admin/production-traffic-light-history").then((data) => state.productionTrafficHistory = data.history ?? []),
    loadJson("/api/tests/guided-report").then((data) => state.guidedReport = data.report ?? null),
    loadJson("/api/tickets").then((data) => updateTickets(data.tickets ?? [])),
    loadJson("/api/contacts").then((data) => { state.contacts = data.contacts ?? []; renderContacts(); }),
    loadJson("/api/companies").then((data) => { state.companies = data.companies ?? []; renderCompanies(); }),
    loadJson("/api/agents").then((data) => state.agents = data.agents ?? []),
    loadJson("/api/deployment-campaigns").then((data) => state.deploymentCampaigns = data.campaigns ?? []),
    loadJson("/api/remote-sessions").then((data) => state.sessions = data.sessions ?? []),
    loadJson("/api/knowledge").then((data) => state.articles = data.articles ?? []),
    loadJson("/api/mobile-admin/v1/users").then((data) => state.mobileUsers = data.users ?? []),
    loadJson("/api/repair-actions").then((data) => state.repairActions = data.actions ?? []),
    loadJson("/api/repair-outcomes?limit=8").then((data) => state.repairOutcomes = data),
    loadJson("/api/knowledge/review-metrics").then((data) => state.reviewMetrics = data.metrics ?? null),
    loadJson(`/api/audit?limit=40&filter=${encodeURIComponent(state.auditFilter ?? "all")}`).then((data) => {
      state.audit = data.events ?? [];
    })
  ]);
  state.auditLoading = false;
  state.lastRefreshAt = new Date().toISOString();
  render();
}

function isLiveRemoteView() {
  return Boolean(document.querySelector("#view-remote.active")) && state.sessions.some((session) => session.screenShare?.enabled);
}

async function createDemoTicket() {
  const data = await apiFetch("/api/tickets", {
    method: "POST",
    body: JSON.stringify({
      customerName: "Cliente Demo",
      customerPhone: "5215550000000",
      subject: "Soporte remoto solicitado",
      description: "Necesito que se conecten por remoto a mi equipo con problema de correo",
      source: "console",
      priority: "normal"
    })
  });
  state.selectedTicketId = data.ticket?.id ?? state.selectedTicketId;
  showNotice("Ticket demo creado.", "success");
  await refresh();
  renderTicketDetail();
  openTicketDialog();
}

async function runDiagnosis() {
  const button = document.querySelector("#runDiagnosis");
  const resultContainer = document.querySelector("#diagnosisResult");
  const message = document.querySelector("#diagnoseText").value.trim() || "Necesito soporte remoto por AnyDesk";
  let ticketId = state.selectedTicketId;
  if (!ticketId && state.tickets[0]) ticketId = state.tickets[0].id;
  if (!ticketId) {
    resultContainer.innerHTML = empty("Crea o recibe un ticket primero.");
    return;
  }

  setButtonLoading(button, true, "Fisher está analizando...");
  if (resultContainer) resultContainer.innerHTML = `<div class="fisher-thinking"><span class="thinking-orbit" aria-hidden="true"></span><div><strong>Analizando el ticket</strong><small>Revisando categoría, riesgo y siguientes pasos.</small></div></div>`;
  try {
    const diagnosisResponse = await apiFetch("/api/agent/diagnose", {
      method: "POST",
      body: JSON.stringify({ ticketId, message })
    });

    const workflowResponse = await apiFetch(`/api/tickets/${ticketId}/workflow`, {
      method: "POST",
      body: JSON.stringify({ message })
    });

    const planResponse = await apiFetch(`/api/tickets/${ticketId}/repair-plan`, {
      method: "POST",
      body: JSON.stringify({ message, autoQueue: false })
    }).catch(() => null);

    renderDiagnosisResult(planResponse?.plan?.diagnosis ?? diagnosisResponse.diagnosis ?? diagnosisResponse, workflowResponse.workflow ?? workflowResponse, planResponse?.plan ?? null);
    await refresh();
  } catch (error) {
    if (resultContainer) resultContainer.innerHTML = `<div class="fisher-feedback error"><strong>No fue posible completar el análisis</strong><span>${escapeHtml(error.message ?? "Revisa la conexión e inténtalo nuevamente.")}</span></div>`;
  } finally {
    setButtonLoading(button, false);
  }
}

function setButtonLoading(button, loading, loadingLabel = "Procesando...") {
  if (!button) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.innerHTML;
  button.disabled = loading;
  button.setAttribute("aria-busy", String(loading));
  button.innerHTML = loading ? `<span class="button-spinner" aria-hidden="true"></span>${escapeHtml(loadingLabel)}` : button.dataset.defaultLabel;
}

function renderDiagnosisResult(diagnosis, workflow, repairPlan = null) {
  const container = document.querySelector("#diagnosisResult");
  if (!container) return;

  const confidence = Math.round(Number(diagnosis.confidence ?? 0) * 100);
  const steps = (diagnosis.recommendedSteps ?? []).slice(0, 5).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  const workflowActions = (workflow.actions ?? []).filter((action) => action.type !== "guided_resolution");
  const actions = workflowActions.map((action) => renderWorkflowAction(action)).join("");
  const repairs = renderDiagnosisRepairActions(diagnosis, repairPlan);
  const source = diagnosis.source === "knowledge_base"
    ? "Base de conocimiento"
    : diagnosis.source === "pending_review_ranked"
      ? "Propuesta por revisar"
      : "Reglas de Fisher";

  container.innerHTML = `
    <div class="diagnosis-card fisher-response">
      <div class="fisher-response-label"><span class="fisher-avatar small" aria-hidden="true">F</span><span><strong>Recomendación de Fisher</strong><small>Resultado supervisado</small></span></div>
      <div class="diagnosis-head">
        <span class="badge">${escapeHtml(labelCategory(diagnosis.category))}</span>
        <strong>${confidence}% confianza</strong>
      </div>
      <h4>${escapeHtml(labelNextAction(diagnosis.nextAction))}</h4>
      <small>Fuente: ${escapeHtml(source)}</small>
      ${steps ? `<ol>${steps}</ol>` : ""}
      ${diagnosis.shouldEscalate ? `<p class="warning-copy">Requiere revisión de técnico humano.</p>` : ""}
      ${repairs}
      ${actions ? `<div class="workflow-actions">${actions}</div>` : ""}
    </div>
  `;
  container.querySelectorAll("[data-repair-action]").forEach((button) => {
    button.addEventListener("click", () => queueRepairAction(button.dataset.repairAction, button.dataset.actionId, button.dataset.decisionMode));
  });
}

function renderDiagnosisRepairActions(diagnosis, repairPlan = null) {
  const repairs = (repairPlan?.actions ?? diagnosis.repairActions ?? []).slice(0, 3);
  if (!repairs.length) return "";
  const session = findActionableSessionForTicket(diagnosis.ticketId);
  return `
    <div class="workflow-actions repair-suggestions">
      ${repairs.map((action) => `
        <div class="workflow-action">
          <strong>${escapeHtml(action.title)}</strong>
          <p>${escapeHtml(action.summary)}</p>
          <small>Riesgo ${escapeHtml(labelStatus(action.risk))}: ${escapeHtml(action.expectedImpact)}</small>
          <small>Decision Fisher: ${escapeHtml(labelRepairDecision(action.decision?.mode))}</small>
          ${action.outcomeStats ? `<small>Historial: ${escapeHtml(formatRepairOutcomeStats(action.outcomeStats))}</small>` : ""}
          ${action.learningAdjustment ? `<small>Aprendizaje: ${escapeHtml(formatRepairLearning(action.learningAdjustment))}</small>` : ""}
          ${session ? `<button class="secondary" data-repair-action="${escapeHtml(session.id)}" data-action-id="${escapeHtml(action.id)}" data-decision-mode="${escapeHtml(action.decision?.mode ?? "suggest_only")}">Enviar reparación</button>` : `<span class="inline-state">Requiere sesión remota autorizada</span>`}
        </div>
      `).join("")}
    </div>
  `;
}

function formatRepairLearning(learning) {
  const sign = Number(learning.adjustment ?? 0) > 0 ? "+" : "";
  return `${labelRepairLearningSignal(learning.confidenceSignal)} (${sign}${learning.adjustment ?? 0})`;
}

function labelRepairLearningSignal(signal) {
  return ({
    confirmed_promote: "Confirmado: sube prioridad",
    confirmed_degrade: "Confirmado: baja prioridad",
    promote: "Sube prioridad",
    degrade: "Baja prioridad",
    avoid: "Evitar hasta revisión",
    neutral: "Sin cambio",
    no_history: "Sin historial",
    simulation_only: "Solo simulaciones"
  })[signal] ?? labelStatus(signal);
}
function formatRepairOutcomeStats(stats) {
  const rate = Math.round(Number(stats.successRate ?? 0) * 100);
  return `${stats.executed ?? 0} ejecutada(s), ${stats.simulated ?? 0} simulada(s), ${stats.failed ?? 0} fallida(s), exito ${rate}%`;
}
function labelRepairDecision(mode) {
  return ({
    auto_allowed: "Puede ejecutarse automaticamente",
    technician_approval_required: "Requiere aprobación del técnico",
    remote_consent_required: "Requiere sesión autorizada",
    customer_control_required: "Requiere permiso de control",
    human_review: "Requiere revisión humana",
    suggest_only: "Solo sugerencia",
    blocked: "Bloqueada"
  })[mode] ?? labelStatus(mode);
}
function findActionableSessionForTicket(ticketId) {
  return [...state.sessions].reverse().find((session) => {
    return session.ticketId === ticketId
      && session.consent?.decision === "approved"
      && Boolean(session.agentId)
      && !isTerminalRemoteStatus(session.status);
  }) ?? null;
}
function renderWorkflowAction(action) {
  if (action.type === "remote_session") {
    return `<div class="workflow-action"><strong>Sesión remota lista</strong><p>Código ${escapeHtml(action.session?.joinCode ?? "pendiente")}</p></div>`;
  }
  if (action.type === "guided_resolution") {
    const steps = (action.steps ?? []).slice(0, 4).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
    return `<div class="workflow-action"><strong>${escapeHtml(action.title ?? "Resolución guiada")}</strong>${steps ? `<ol>${steps}</ol>` : ""}</div>`;
  }
  if (action.type === "human_review") {
    return `<div class="workflow-action"><strong>Revisión humana</strong><p>Solicita evidencia y clasifica el ticket.</p></div>`;
  }
  return `<div class="workflow-action"><strong>${escapeHtml(action.type ?? "Acción")}</strong></div>`;
}

function labelCategory(value) {
  return ({
    email: "Correo",
    general: "General",
    internet: "Internet",
    printer: "Impresora",
    remote_support: "Soporte remoto"
  }[value] ?? labelStatus(value));
}

function labelNextAction(value) {
  return ({
    conversation_command: "Comando atendido",
    human_review: "Pasar a técnico",
    request_remote_support: "Preparar soporte remoto",
    review_ai_proposal: "Revisar propuesta Fisher",
    send_guided_steps: "Enviar pasos sugeridos"
  }[value] ?? labelStatus(value));
}
async function simulateWhatsappMessage() {
  const from = document.querySelector("#whatsappFrom")?.value.trim() || "5215559002000";
  const text = document.querySelector("#whatsappMessage")?.value.trim();
  const resultEl = document.querySelector("#whatsappResult");
  if (!text) {
    if (resultEl) resultEl.innerHTML = empty("Escribe un mensaje para simular WhatsApp.");
    return;
  }

  const payload = await apiFetch("/api/dev/whatsapp-simulate", {
    method: "POST",
    body: JSON.stringify({ from, profileName: "Cliente Simulado", text })
  });

  if (payload.result?.ticketId) {
    state.selectedTicketId = payload.result.ticketId;
  }

  const remoteLine = payload.result?.remoteSessionId
    ? `<p>Sesión remota preparada: ${escapeHtml(payload.result.remoteSessionId)}</p>`
    : "";
  if (resultEl) {
    resultEl.innerHTML = `
      <div class="whatsapp-summary">
        <strong>Mensaje recibido por Fisher</strong>
        <p>Ticket ${escapeHtml(payload.result?.ticketId ?? "pendiente")}</p>
        <p>${escapeHtml(labelCategory(payload.result?.diagnosis?.category ?? "general"))}</p>
        ${remoteLine}
      </div>
    `;
  }
  showNotice("WhatsApp simulado procesado por Fisher.", "success");
  await refresh();
}
async function downloadAuditExport(format) {
  const filter = state.auditFilter ?? "all";
  const response = await fetch(`/api/audit/export?format=${encodeURIComponent(format)}&limit=1000&filter=${encodeURIComponent(filter)}`, { headers: headers() });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    showNotice(body.error ?? "No se pudo exportar auditoría.", "error");
    return;
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const filename = filenameMatch?.[1] ?? `sas-audit.${format}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showNotice(`Auditoría ${filter === "all" ? "" : filter + " "}exportada en ${format.toUpperCase()}.`, "success");
  await refresh();
}
async function loadJson(path, withAuth = true) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = withAuth ? await authenticatedFetch(path, { signal: controller.signal }) : await fetch(path, { signal: controller.signal });
    if (response.status === 401) {
      if (withAuth) state.authRequired = true;
      return { authRequired: true };
    }
    if (response.status === 403) return { forbidden: true };
    if (!response.ok) {
      state.connectionIssue = true;
      return {};
    }
    return response.json();
  } catch {
    state.connectionIssue = true;
    return { connectionIssue: true };
  } finally {
    window.clearTimeout(timeout);
  }
}
function render() {
  renderNotice();
  renderOperationalAlerts();
  renderTopbarSignal();
  renderNavigationSignals();
  renderOpsStrip();
  renderMetrics();
  renderViewSummaries();
  renderTickets();
  renderTicketDetail();
  renderRemote();
  renderTests();
  renderPreflightReport();
  renderRealInputLabPanel();
  renderGuidedReport();
  renderAgents();
  renderKnowledge();
  renderReports();
  renderMobileUsers();
  renderSystemStatus();
  renderUpdates();
  renderProductionReadiness();
  renderReleaseGate();
  renderInstallations();
  renderProductionOperations();
  renderRepairOutcomes();
  renderAudit();
}

function renderTopbarSignal() {
  const container = document.querySelector("#topbarSignal");
  if (!container) return;
  const onlineAgents = state.agents.filter((agent) => agent.status === "online").length;
  const blockers = Number(state.releaseGate?.summary?.blockers ?? 0);
  const warnings = Number(state.releaseGate?.summary?.warnings ?? 0);

  const type = state.connectionIssue || blockers > 0 ? "danger" : warnings > 0 || onlineAgents === 0 ? "warning" : "success";
  const title = state.connectionIssue
    ? "Servidor sin respuesta"
    : blockers > 0
      ? "Producción bloqueada"
      : warnings > 0
        ? "Listo con avisos"
        : onlineAgents === 0
          ? "Servidor listo, sin agente"
          : "Listo para operar";
  const detail = state.lastRefreshAt ? `Actualizado ${formatDateTime(state.lastRefreshAt)}` : "Iniciando";
  container.className = `topbar-signal ${type}`;
  container.innerHTML = `<span>${escapeHtml(title)}</span><small>${escapeHtml(detail)}</small>`;
}

function navSignal(type, count, label) {
  return { type, count, label };
}

function renderNavigationSignals() {
  const openTickets = state.tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));
  const urgentTickets = openTickets.filter((ticket) => ticket.priority === "urgent");
  const activeSessions = state.sessions.filter((session) => !isTerminalRemoteStatus(session.status));
  const waitingConsent = activeSessions.filter((session) => session.status === "pending_customer_consent");
  const onlineAgents = state.agents.filter((agent) => agent.status === "online");
  const pendingReviews = state.articles.filter((article) => article.status === "pending_review");
  const blockers = Number(state.releaseGate?.summary?.blockers ?? 0);
  const warnings = Number(state.releaseGate?.summary?.warnings ?? 0);

  const guidedIncomplete = state.guidedReport?.status !== "completed";

  const signals = {
    tickets: openTickets.length ? navSignal(urgentTickets.length ? "danger" : "warning", openTickets.length, urgentTickets.length ? "urgente" : "abierto") : navSignal("success", 0, "ok"),
    remote: activeSessions.length ? navSignal(waitingConsent.length ? "warning" : "info", activeSessions.length, waitingConsent.length ? "permiso" : "activo") : navSignal("success", 0, "ok"),
    tests: guidedIncomplete ? navSignal("warning", 1, "revisar") : navSignal("success", 0, "ok"),
    agents: onlineAgents.length ? navSignal("success", onlineAgents.length, "en línea") : navSignal("danger", 0, "sin agente"),
    knowledge: pendingReviews.length ? navSignal("warning", pendingReviews.length, "review") : navSignal("success", 0, "ok"),
    "mobile-users": state.mobileUsers.some((user) => user.status === "disabled") ? navSignal("warning", state.mobileUsers.length, "usuarios") : navSignal("success", state.mobileUsers.length, "usuarios"),
    audit: blockers ? navSignal("danger", blockers, "bloqueo") : warnings ? navSignal("warning", warnings, "aviso") : navSignal("success", 0, "ok")
  };

  document.querySelectorAll(".nav-button").forEach((button) => {
    const label = button.dataset.label || button.textContent.trim();
    const icon = button.dataset.icon ?? "";
    button.dataset.label = label;
    const signal = signals[button.dataset.view] ?? navSignal("info", 0, "ok");
    button.classList.remove("nav-success", "nav-info", "nav-warning", "nav-danger");
    button.classList.add(`nav-${signal.type}`);
    const count = signal.count > 0 ? String(signal.count) : "";
    button.innerHTML = `<span class="nav-label"><i aria-hidden="true">${escapeHtml(icon)}</i>${escapeHtml(label)}</span><span class="nav-signal ${escapeHtml(signal.type)}"><strong>${escapeHtml(count)}</strong><small>${escapeHtml(signal.label)}</small></span>`;
  });
}
function getOperationalAlerts() {
  const alerts = [];
  const onlineAgents = state.agents.filter((agent) => agent.status === "online").length;
  const waitingConsent = state.sessions.filter((session) => session.status === "pending_customer_consent").length;
  const waitingAgent = state.sessions.filter((session) => session.status === "authorized_waiting_agent" || session.status === "authorized_waiting_agent_assignment").length;
  const pendingReviews = state.articles.filter((article) => article.status === "pending_review").length;
  const openUrgentTickets = state.tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status) && ticket.priority === "urgent").length;  const renamedAgents = state.agents.filter((agent) => {
    const changedAt = new Date(agent.hostnameChangedAt ?? 0).getTime();
    return Number.isFinite(changedAt) && Date.now() - changedAt <= 7 * 24 * 60 * 60 * 1000;
  });
  const blockers = Number(state.releaseGate?.summary?.blockers ?? 0);
  const warnings = Number(state.releaseGate?.summary?.warnings ?? 0);


  if (state.connectionIssue) {
    alerts.push({ type: "danger", title: "Servidor sin respuesta", message: "No fue posible actualizar la información. Comprueba que SAS esté abierto y vuelve a intentarlo." });
  }
  if (state.authRequired) {
    alerts.push({ type: "danger", title: "Sesión requerida", message: "Inicia sesión con tu cuenta autorizada para consultar la información protegida." });
  }
  if (blockers > 0) {
    alerts.push({ type: "danger", title: "Producción bloqueada", message: `${countLabel(blockers, "bloqueo")} en el semáforo. Abre Estado para ver la acción exacta.` });
  } else if (warnings > 0) {
    alerts.push({ type: "warning", title: "Producción con avisos", message: `${countLabel(warnings, "aviso")} ${warnings === 1 ? "pendiente" : "pendientes"}. Se puede operar, pero conviene revisarlos.` });
  }
  if (openUrgentTickets > 0) {
    alerts.push({ type: "danger", title: "Ticket urgente", message: `${countLabel(openUrgentTickets, "ticket urgente", "tickets urgentes")} ${openUrgentTickets === 1 ? "necesita" : "necesitan"} atención.` });
  }
  if (renamedAgents.length > 0) {
    const latest = renamedAgents.sort((a, b) => new Date(b.hostnameChangedAt) - new Date(a.hostnameChangedAt))[0];
    const message = renamedAgents.length === 1
      ? `${latest.previousHostname || "Nombre anterior"} ahora se identifica como ${latest.hostname}. El historial y la vinculación se conservaron.`
      : `${countLabel(renamedAgents.length, "equipo cambió", "equipos cambiaron")} de nombre durante los últimos 7 días.`;
    alerts.push({ type: "info", title: "Nombre de equipo actualizado", message });
  }
  if (waitingConsent > 0) {
    alerts.push({ type: "warning", title: "Permiso del cliente", message: `${countLabel(waitingConsent, "sesión remota", "sesiones remotas")} ${waitingConsent === 1 ? "espera" : "esperan"} autorización del cliente.` });
  }
  if (waitingAgent > 0) {
    alerts.push({ type: "info", title: "Asignar técnico", message: `${countLabel(waitingAgent, "sesión", "sesiones")} ${waitingAgent === 1 ? "ya tiene" : "ya tienen"} permiso y ${waitingAgent === 1 ? "espera" : "esperan"} equipo o inicio.` });
  }
  if (state.health?.status === "ok" && onlineAgents === 0) {
    alerts.push({ type: "warning", title: "Sin equipos en línea", message: "El servidor responde, pero ninguna computadora con SAS está conectada." });
  }
  if (pendingReviews > 0) {
    alerts.push({ type: "info", title: "Soluciones por revisar", message: `${countLabel(pendingReviews, "propuesta")} ${pendingReviews === 1 ? "puede" : "pueden"} alimentar a Fisher después de revisión.` });
  }

  return alerts.slice(0, 4);
}

function renderOperationalAlerts() {
  const container = document.querySelector("#alertCenter");
  if (!container) return;
  const alerts = getOperationalAlerts();
  container.innerHTML = alerts.map((alert) => `
    <article class="alert-card ${escapeHtml(alert.type)}">
      <div class="alert-icon" aria-hidden="true">${alert.type === "danger" || alert.type === "warning" ? "!" : "i"}</div>
      <div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.message)}</span></div>
    </article>
  `).join("");
  container.hidden = alerts.length === 0;
}
function summaryCard(type, label, value, hint) {
  return `
    <article class="summary-card ${escapeHtml(type)}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(hint)}</small>
    </article>
  `;
}

function renderSummary(containerId, cards) {
  const container = document.querySelector(containerId);
  if (!container) return;
  container.innerHTML = cards.join("");
}

function renderViewSummaries() {
  const openTickets = state.tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));
  const urgentTickets = openTickets.filter((ticket) => ticket.priority === "urgent");
  const activeSessions = state.sessions.filter((session) => !isTerminalRemoteStatus(session.status));
  const waitingConsent = activeSessions.filter((session) => session.status === "pending_customer_consent");
  const onlineAgents = state.agents.filter((agent) => agent.status === "online");
  const pendingReviews = state.articles.filter((article) => article.status === "pending_review");
  const gateBlocked = Number(state.releaseGate?.summary?.blockers ?? 0);
  const gateWarnings = Number(state.releaseGate?.summary?.warnings ?? 0);

  renderSummary("#ticketsSummary", [
    summaryCard(urgentTickets.length ? "danger" : openTickets.length ? "warning" : "success", "Atención", String(openTickets.length), urgentTickets.length ? `${urgentTickets.length} urgente(s)` : "Lista de trabajo actual"),
    summaryCard("info", "WhatsApp", "Listo", "Entrada preparada para clientes"),
    summaryCard(pendingReviews.length ? "warning" : "success", "Fisher: pendientes", String(pendingReviews.length), "Soluciones por revisar"),
    summaryCard("info", "Clientes", String(state.contacts.length), "Agenda disponible")
  ]);

  renderSummary("#contactsSummary", [summaryCard("info", "Personas", String(state.contacts.length), "Fichas en Agenda"), summaryCard("success", "Empresas SAE", String(state.companies.length), "Razones sociales disponibles"), summaryCard(state.contacts.some((contact) => !contact.companyId) ? "warning" : "success", "Asignadas", String(state.contacts.filter((contact) => contact.companyId).length), `${state.contacts.filter((contact) => !contact.companyId).length} pendientes`)]);

  renderSummary("#remoteSummary", [
    summaryCard(activeSessions.length ? "warning" : "success", "Sesiones activas", String(activeSessions.length), activeSessions.length ? "Revisa permisos y equipo" : "Sin conexiones pendientes"),
    summaryCard(waitingConsent.length ? "warning" : "info", "Esperan permiso", String(waitingConsent.length), "Cliente debe autorizar"),
    summaryCard(onlineAgents.length ? "success" : "danger", "Equipos en línea", String(onlineAgents.length), onlineAgents.length ? "Listos para asignar" : "Abre SAS en la computadora")
  ]);

  renderSummary("#testsSummary", [
    summaryCard(state.guidedReport?.status === "completed" ? "success" : "warning", "Validación", `${state.guidedReport?.percent ?? 0}%`, labelStatus(state.guidedReport?.status ?? "not_started")),
    summaryCard(state.health?.status === "ok" ? "success" : "danger", "Servidor", labelStatus(state.health?.status ?? "fail"), "API y servicios")
  ]);

  renderSummary("#agentsSummary", [
    summaryCard(onlineAgents.length ? "success" : "danger", "En línea", String(onlineAgents.length), "Computadoras conectadas"),
    summaryCard(state.agents.length > onlineAgents.length ? "warning" : "success", "Sin contacto", String(Math.max(0, state.agents.length - onlineAgents.length)), "Revisar equipos apagados"),
    summaryCard("info", "Registrados", String(state.agents.length), "Inventario actual")
  ]);

  renderSummary("#knowledgeSummary", [
    summaryCard(pendingReviews.length ? "warning" : "success", "Por revisar", String(pendingReviews.length), "Propuestas que requieren decisión"),
    summaryCard("success", "Aprobadas", String(state.articles.filter((article) => article.status === "approved").length), "Fisher puede usarlas"),
    summaryCard("info", "Total", String(state.articles.length), "Base de conocimiento")
  ]);

  renderSummary("#auditSummary", [
    summaryCard(gateBlocked ? "danger" : gateWarnings ? "warning" : "success", "Semáforo", state.releaseGate?.label ?? "Sin dato", gateBlocked ? `${gateBlocked} bloqueo(s)` : `${gateWarnings} aviso(s)`),
    summaryCard(state.connectionIssue ? "danger" : "success", "Conexión", state.connectionIssue ? "Sin respuesta" : "OK", "Consola y API"),
    summaryCard("info", "Eventos", String(state.audit.length), "Registro visible")
  ]);
}
function renderOpsStrip() {
  const container = document.querySelector("#opsStrip");
  if (!container) return;

  const onlineAgents = state.agents.filter((agent) => agent.status === "online").length;
  const lastRefresh = state.lastRefreshAt ? formatDateTime(state.lastRefreshAt) : "Iniciando";
  const checks = [
    ...(state.connectionIssue ? [{ label: "Conexión", ok: false, value: "Reintentando" }] : []),
    ...(state.authRequired ? [{ label: "Token", ok: false, value: "Requerido" }] : []),
    { label: "Servidor", ok: state.health?.status === "ok", value: state.connectionIssue ? "Sin respuesta" : labelStatus(state.health?.status ?? "sin conexión") },
    { label: "Agente", ok: onlineAgents > 0, value: onlineAgents > 0 ? `${onlineAgents} en línea` : "Sin agente" },
  ];
  const ready = checks.every((check) => check.ok);
  const next = checks.find((check) => !check.ok);
  const message = state.connectionIssue
    ? "Servidor o API sin respuesta. SAS reintenta automaticamente."
    : state.authRequired
      ? "Inicia sesión para cargar datos protegidos."
      : ready
        ? "Servidor y agente responden correctamente."
        : `Pendiente: ${escapeHtml(next?.label ?? "validación")}`;

  container.innerHTML = `
    <div class="ops-main ${state.connectionIssue ? "error" : ready ? "ready" : "review"}">
      <strong>${state.connectionIssue ? "Servidor sin respuesta" : ready ? "Listo para trabajar" : "Atención requerida"}</strong>
      <span>${message}</span>
      <small>Última revisión: ${escapeHtml(lastRefresh)}</small>
    </div>
    <div class="ops-checks">
      ${checks.map((check) => `
        <div class="ops-check ${check.ok ? "ok" : "warn"}">
          <strong>${escapeHtml(check.label)}</strong>
          <span>${escapeHtml(check.value)}</span>
        </div>
      `).join("")}
    </div>
  `;
}
function renderMetrics() {
  const openTickets = state.tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status)).length;
  const onlineAgents = state.agents.filter((agent) => agent.status === "online").length;
  const activeSessions = state.sessions.filter((session) => !isTerminalRemoteStatus(session.status)).length;
  const pendingReviews = state.articles.filter((article) => article.status === "pending_review").length;
  const metrics = [
    { label: "Tickets abiertos", value: openTickets, status: openTickets ? "warn" : "pass" },
    { label: "Equipos listos", value: onlineAgents, status: onlineAgents ? "pass" : "warn" },
    { label: "Remotos activos", value: activeSessions, status: activeSessions ? "warn" : "pass" },
    { label: "Soluciones pendientes", value: pendingReviews, status: pendingReviews ? "warn" : "pass" }
  ];
  document.querySelector("#metrics").innerHTML = metrics.map((item) => `<div class="metric metric-${escapeHtml(item.status)}"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`).join("");
}
function ticketSession(ticketId) {
  return state.sessions
    .filter((session) => session.ticketId === ticketId && !["expired", "consent_rejected"].includes(session.status))
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0))[0] ?? null;
}

function ticketEquipment(ticket) {
  const session = ticketSession(ticket.id);
  const equipmentId = ticket.equipmentId || session?.agentId || null;
  return state.agents.find((agent) => agent.machineId === equipmentId) ?? null;
}

function ticketContact(ticket) {
  if (ticket.contactId) {
    const direct = state.contacts.find((contact) => contact.id === ticket.contactId);
    if (direct) return direct;
  }
  const phone = String(ticket.customerPhone || "").replace(/\D/g, "");
  return state.contacts.find((contact) => String(contact.phone || "").replace(/\D/g, "") === phone) ?? null;
}

function ticketMatchesCurrentFilter(ticket) {
  const equipment = ticketEquipment(ticket);
  const contact = ticketContact(ticket);
  const search = state.ticketSearch.trim().toLowerCase();
  const haystack = [ticket.id, ticket.subject, ticket.description, ticket.customerName, ticket.customerPhone, contact?.company, equipment?.hostname, equipment?.username, labelStatus(ticket.status), sourceLabel(ticket.source)].filter(Boolean).join(" ").toLowerCase();
  if (search && !haystack.includes(search)) return false;
  const filter = state.ticketStatusFilter;
  if (filter === "active" && ["resolved", "closed"].includes(ticket.status)) return false;
  if (filter === "whatsapp" && !ticket.customerPhone) return false;
  if (!["all", "active", "whatsapp"].includes(filter) && ticket.status !== filter) return false;
  return true;
}

function ticketDateGroup(ticket) {
  const value = new Date(ticket.updatedAt || ticket.createdAt || 0);
  const today = new Date();
  const day = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const difference = Math.round((current - day) / 86400000);
  if (difference === 0) return { key: day.toISOString(), label: "Hoy" };
  if (difference === 1) return { key: day.toISOString(), label: "Ayer" };
  return { key: day.toISOString(), label: value.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: value.getFullYear() !== today.getFullYear() ? "numeric" : undefined }) };
}

function ticketGroup(ticket) {
  const equipment = ticketEquipment(ticket);
  if (state.ticketGroupBy === "equipment") return { key: equipment?.machineId || ticket.equipmentId || "unassigned", label: equipment?.hostname || (ticket.equipmentId ? shortId(ticket.equipmentId) : "Sin equipo asignado"), detail: equipment ? `${equipment.username || "Usuario no identificado"} · ${labelStatus(equipment.status)}` : "Equipo pendiente de vinculación" };
  if (state.ticketGroupBy === "whatsapp") return { key: ticket.customerPhone || "without-whatsapp", label: ticket.customerPhone || "Sin WhatsApp", detail: ticket.customerPhone ? "Conversación disponible" : "Origen distinto de WhatsApp" };
  if (state.ticketGroupBy === "status") return { key: ticket.status, label: labelStatus(ticket.status), detail: "Estado del ticket" };
  if (state.ticketGroupBy === "none") return { key: "all", label: "Resultados", detail: "Ordenados por última actividad" };
  return ticketDateGroup(ticket);
}

function renderTickets() {
  const filtered = state.tickets.filter(ticketMatchesCurrentFilter).sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0));
  const groups = new Map();
  for (const ticket of filtered) {
    const definition = ticketGroup(ticket);
    if (!groups.has(definition.key)) groups.set(definition.key, { ...definition, tickets: [] });
    groups.get(definition.key).tickets.push(ticket);
  }
  const container = document.querySelector("#ticketsList");
  container.innerHTML = [...groups.values()].map((group) => {
    const rows = group.tickets.map((ticket) => {
      const equipment = ticketEquipment(ticket);
      const contact = ticketContact(ticket);
      const selected = ticket.id === state.selectedTicketId;
      const changed = state.changedTicketIds.has(ticket.id);
      const phone = contact?.phone || ticket.customerPhone || "Sin WhatsApp";
      return `<article class="ticket-row priority-${escapeHtml(statusClass(ticket.priority))} ${selected ? "selected" : ""} ${changed ? "has-change" : ""}" data-ticket="${escapeHtml(ticket.id)}" tabindex="0" role="button">
        <div class="ticket-row-main"><small>${escapeHtml(ticket.id)}${changed ? ` · <span class="ticket-change-pill">Nuevo cambio</span>` : ""}</small><strong>${escapeHtml(ticket.subject)}</strong><span>${escapeHtml(ticket.description || "Sin descripción")}</span></div>
        <div class="ticket-row-cell"><small>Cliente</small><strong>${escapeHtml(contact?.name || ticket.customerName || "Sin nombre")}</strong><span>${escapeHtml(contact?.company || "Empresa sin registrar")}</span></div>
        <div class="ticket-row-cell"><small>Equipo</small><strong>${escapeHtml(equipment?.hostname || (ticket.equipmentId ? shortId(ticket.equipmentId) : "Sin asignar"))}</strong><span>${escapeHtml(equipment ? labelStatus(equipment.status) : "Pendiente")}</span></div>
        <div class="ticket-row-cell"><small>WhatsApp / origen</small><strong>${escapeHtml(phone)}</strong><span>${escapeHtml(sourceLabel(ticket.source))}</span></div>
        <div class="ticket-row-state"><span class="badge status-${escapeHtml(statusClass(ticket.status))}">${escapeHtml(labelStatus(ticket.status))}</span><small>${escapeHtml(formatDateTime(ticket.updatedAt || ticket.createdAt))}</small></div>
      </article>`;
    }).join("");
    return `<section class="ticket-row-group"><header><div><strong>${escapeHtml(group.label)}</strong><small>${escapeHtml(group.detail || "")}</small></div><span>${group.tickets.length}</span></header><div class="ticket-row-items">${rows}</div></section>`;
  }).join("") || emptyState("Sin coincidencias", "Cambia los filtros o espera la entrada de un nuevo ticket.", "");

  container.querySelectorAll("[data-ticket]").forEach((item) => {
    const open = () => {
      state.selectedTicketId = item.dataset.ticket;
      state.changedTicketIds.delete(state.selectedTicketId);
      document.querySelector("#diagnoseText").value = state.tickets.find((ticket) => ticket.id === state.selectedTicketId)?.description ?? "";
      renderTickets(); renderTicketDetail(); openTicketDialog();
    };
    item.addEventListener("click", open);
    item.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } });
  });
}

function initializeTicketFilters() {
  const search = document.querySelector("#ticketSearch"), status = document.querySelector("#ticketStatusFilter"), group = document.querySelector("#ticketGroupBy");
  search?.addEventListener("input", () => { state.ticketSearch = search.value; renderTickets(); });
  status?.addEventListener("change", () => { state.ticketStatusFilter = status.value; renderTickets(); });
  group?.addEventListener("change", () => { state.ticketGroupBy = group.value; renderTickets(); });
}
initializeTicketFilters();
function openTicketDialog() {
  const dialog = document.querySelector("#ticketDialog");
  if (!dialog || !state.selectedTicketId) return;
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
  document.body.classList.add("case-dialog-open");
}

function closeTicketDialog() {
  const dialog = document.querySelector("#ticketDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
  document.body.classList.remove("case-dialog-open");
}

function renderTicketDetail() {
  const container = document.querySelector("#ticketDetail");
  if (!container) return;
  const ticket = state.tickets.find((item) => item.id === state.selectedTicketId) ?? state.tickets[0];
  if (!ticket) {
    container.innerHTML = emptyState("Elige un ticket", "Aquí verás el cliente, la solicitud, el equipo y toda la actividad.", "Crea un ticket o selecciónalo en la lista.");
    return;
  }
  state.selectedTicketId = ticket.id;
  const allMessages = ticket.messages ?? [];
  const conversation = allMessages.filter((message) => message.channel === "whatsapp" && ["inbound", "outbound"].includes(message.direction));
  const internalMessages = allMessages.filter((message) => !conversation.includes(message));
  const isWhatsApp = Boolean(ticket.customerPhone);
  const contact = ticketContact(ticket);
  const session = ticketSession(ticket.id);
  const equipment = ticketEquipment(ticket);
  const documentation = ticket.documentation ?? {};
  const closureLocked = ticket.status === "closed";

  container.innerHTML = `
    <div class="ticket-focus-card ticket-overview">
      <div><small>Ticket ${escapeHtml(ticket.id)}</small><strong>${escapeHtml(ticket.subject)}</strong><span>${escapeHtml(ticket.description || "Sin descripción")}</span></div>
      <button id="openTicketRemoteSupport" type="button">${session ? "Abrir pantalla de soporte" : "Preparar soporte remoto"}</button>
    </div>
    <div class="ticket-context-grid">
      <section><span>Cliente</span><strong>${escapeHtml(contact?.name || ticket.customerName)}</strong><small>${escapeHtml(contact?.company || "Empresa sin registrar")} · ${escapeHtml(contact?.phone || ticket.customerPhone || "Sin teléfono")}</small><small>${escapeHtml(contact?.email || "Correo sin registrar")}</small></section>
      <section><span>Equipo</span><strong>${escapeHtml(equipment?.hostname || (ticket.equipmentId ? shortId(ticket.equipmentId) : "Sin equipo asignado"))}</strong><small>${equipment ? `${escapeHtml(equipment.username || "Usuario no identificado")} · ${escapeHtml(labelStatus(equipment.status))}` : "Instala o vincula SAS Cliente para continuar"}</small><small>${session ? `Sesión ${escapeHtml(session.joinCode)} · ${escapeHtml(labelStatus(session.status))}` : "Sesión remota todavía no creada"}</small></section>
      <section><span>Solicitud</span><strong>${escapeHtml(sourceLabel(ticket.source))}</strong><small>Creado ${escapeHtml(formatDateTime(ticket.createdAt))}</small><small>Último cambio ${escapeHtml(formatDateTime(ticket.updatedAt))}</small></section>
    </div>
    <div class="detail-grid">
      <label>Estado<select id="ticketStatus"><option value="open">Abierto</option><option value="waiting_customer">Esperando cliente</option><option value="in_progress">En progreso</option><option value="resolved">Resuelto</option><option value="closed">Cerrado</option></select></label>
      <label>Prioridad<select id="ticketPriority"><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
    </div>
    <section class="ticket-closure-panel ${closureLocked ? "is-closed" : ""}" id="ticketClosurePanel">
      <header><div><strong>Cierre documentado</strong><small>El ticket sólo se cierra aquí. Terminar sesiones, llamadas o accesos remotos no cambia su estado.</small></div><span>${closureLocked ? `Cerrado ${escapeHtml(formatDateTime(ticket.closedAt))}` : "Pendiente"}</span></header>
      <div class="ticket-closure-grid">
        <label>Diagnóstico final<textarea id="closureDiagnosis" ${closureLocked ? "disabled" : ""} placeholder="Causa confirmada y síntomas observados">${escapeHtml(documentation.diagnosis || "")}</textarea></label>
        <label>Trabajo realizado<textarea id="closureActions" ${closureLocked ? "disabled" : ""} placeholder="Pasos, cambios, comandos y correcciones aplicadas">${escapeHtml(documentation.actionsPerformed || "")}</textarea></label>
        <label>Resultado validado<textarea id="closureOutcome" ${closureLocked ? "disabled" : ""} placeholder="Cómo se comprobó que el problema quedó atendido">${escapeHtml(documentation.outcome || "")}</textarea></label>
        <label>Seguimiento<textarea id="closureFollowUp" ${closureLocked ? "disabled" : ""} placeholder="Recomendaciones o acciones posteriores">${escapeHtml(documentation.followUp || "")}</textarea></label>
      </div>
      <small class="closure-help">Para cerrar selecciona “Cerrado” y guarda. SAS agregará automáticamente las sesiones, autorizaciones y observaciones de Fisher.</small>
    </section>
    <textarea id="ticketNote" placeholder="Nota interna (el cliente no la vera)..."></textarea>
    <div class="item-actions"><button id="saveTicketState">Guardar estado</button><button class="secondary" id="addTicketNote">Agregar nota interna</button></div>
    <details class="action-menu"><summary>Herramientas de Fisher</summary><div class="item-actions"><button class="secondary" id="learnTicketResolution">Guardar solución</button><button class="secondary" id="researchGoogleAi">Buscar con Google</button><button class="secondary" id="researchOpenAi">Buscar con OpenAI</button><button class="secondary" id="researchConsensus">Comparar ambos</button></div></details>
    ${isWhatsApp ? `
      <section class="message-panel whatsapp-panel">
        <header><strong>Conversacion por WhatsApp</strong><span>${escapeHtml(String(conversation.length))} mensaje(s)</span></header>
        <div class="whatsapp-thread" id="whatsappThread">${renderTicketMessages(conversation, true)}</div>
        <div class="whatsapp-composer">
          <div class="click-help"><strong>Para responder</strong><span>1. Escribe el mensaje. 2. Revisa que no incluya datos internos. 3. Haz clic en Enviar por WhatsApp.</span></div>
          <label for="whatsappReply"><strong>Responder al cliente</strong></label>
          <textarea id="whatsappReply" maxlength="4000" placeholder="Escribe una respuesta clara. Se enviara desde el numero de Fisher."></textarea>
          <div class="composer-actions"><small>El cliente recibira este mensaje en WhatsApp.</small><button id="sendWhatsappReply">Enviar por WhatsApp</button></div>
        </div>
        <div class="client-install-action"><div><strong>Instalar SAS en el equipo del usuario</strong><span>Genera una liga temporal, la envia por WhatsApp y vincula un solo equipo.</span></div><button id="sendClientInstallationLink" class="secondary" type="button">Enviar liga de instalación</button></div>
      </section>` : `
      <section class="message-panel"><header><strong>Actividad del ticket</strong><span>${allMessages.length} registro(s)</span></header><div class="messages compact-messages">${renderTicketMessages(allMessages)}</div></section>`}
    ${internalMessages.length ? `<details class="action-menu full-width internal-history"><summary>Actividad interna (${internalMessages.length})</summary><div class="messages compact-messages">${renderTicketMessages(internalMessages)}</div></details>` : ""}
  `;
  document.querySelector("#ticketStatus").value = ticket.status;
  document.querySelector("#ticketPriority").value = ticket.priority;
  document.querySelector("#saveTicketState").addEventListener("click", saveTicketState);
  document.querySelector("#addTicketNote").addEventListener("click", addTicketNote);
  document.querySelector("#learnTicketResolution").addEventListener("click", learnTicketResolution);
  document.querySelector("#researchGoogleAi").addEventListener("click", () => researchWithAi("google"));
  document.querySelector("#researchOpenAi").addEventListener("click", () => researchWithAi("openai"));
  document.querySelector("#researchConsensus").addEventListener("click", () => researchWithAi("consensus"));
  document.querySelector("#sendWhatsappReply")?.addEventListener("click", sendWhatsappReply);
  document.querySelector("#sendClientInstallationLink")?.addEventListener("click", sendClientInstallationLink);
  document.querySelector("#openTicketRemoteSupport")?.addEventListener("click", () => openTicketRemoteSupport(ticket.id));
  const thread = document.querySelector("#whatsappThread");
  if (thread) thread.scrollTop = thread.scrollHeight;
}

function renderTicketMessages(messages, chat = false) {
  return messages.map((message) => {
    const attachments = (message.attachments ?? []).map((attachment) => `<span class="evidence-chip">${escapeHtml(labelAttachment(attachment))}</span>`).join("");
    const delivery = message.direction === "outbound" && message.delivery ? `<span class="delivery-state ${message.delivery.sent ? "sent" : "failed"}">${message.delivery.sent ? "Enviado" : "No confirmado"}</span>` : "";
    return `<div class="message ${escapeHtml(message.direction)} ${chat ? "chat-bubble" : ""}">
      <strong>${escapeHtml(labelMessageAuthor(message))}</strong>
      <p>${escapeHtml(simplifyMessageBody(message.body))}</p>
      ${attachments ? `<div class="evidence-list">${attachments}</div>` : ""}
      <small>${escapeHtml(formatDateTime(message.createdAt))} ${delivery}</small>
    </div>`;
  }).join("") || `<div class="message empty-message"><small>Sin mensajes registrados.</small></div>`;
}

function labelAttachment(attachment) {
  const labels = { image: "Imagen", audio: "Audio", video: "Video", document: "Documento", sticker: "Sticker" };
  return attachment.filename || `${labels[attachment.type] ?? "Archivo"}${attachment.mimeType ? ` - ${attachment.mimeType}` : ""}`;
}

function labelMessageAuthor(message) {
  const author = message.author === "SAS Agent" ? "Agente SAS" : message.author === "Fisher" ? "Fisher" : message.author ?? "Sistema";
  if (message.direction === "inbound" && message.channel === "whatsapp") return `${author} - Cliente`;
  if (message.direction === "outbound" && message.channel === "whatsapp") return `${author} - SAS`;
  return `${author} - interno`;
}

function simplifyMessageBody(body) {
  return String(body ?? "").replace(/^Comando\s+([a-z_]+)\s+completed\.\s+Resultado registrado en sesi.n\s+(.+)\.$/i, (_match, type, code) => `${labelRemoteCommandType(type)} completado en sesión ${code}.`);
}

async function sendClientInstallationLink() {
  if (!state.selectedTicketId) return;
  if (!window.confirm("Se enviara al cliente una liga temporal para instalar solamente SAS Cliente. La liga vincula un equipo y no concede acceso remoto. Deseas continuar?")) return;
  const button = document.querySelector("#sendClientInstallationLink");
  if (button) { button.disabled = true; button.textContent = "Generando liga..."; }
  try {
    const result = await apiFetch(`/api/tickets/${state.selectedTicketId}/installation-link`, { method: "POST", body: "{}" });
    const provider = result.shortUrl?.provider === "tinyurl" ? "TinyURL" : result.shortUrl?.provider === "bitly" ? "Bitly" : "SAS";
    const fallback = result.shortUrl?.fallback ? " El acortador externo no estuvo disponible; se uso la liga corta interna." : "";
    showNotice(result.delivery?.sent ? `Liga ${provider} enviada por WhatsApp.${fallback}` : `Liga ${provider} creada. WhatsApp no confirmo el envio.${fallback}`, result.delivery?.sent ? "success" : "warning");
    await refresh();
  } catch (error) {
    showNotice(error.message || "No fue posible crear la liga.", "error");
    if (button) { button.disabled = false; button.textContent = "Enviar liga de instalación"; }
  }
}

async function sendWhatsappReply() {
  if (!state.selectedTicketId) return;
  const input = document.querySelector("#whatsappReply");
  const message = input?.value.trim() ?? "";
  if (!message) return showNotice("Escribe el mensaje que deseas enviar.", "error");
  const button = document.querySelector("#sendWhatsappReply");
  if (button) { button.disabled = true; button.textContent = "Enviando..."; }
  try {
    await apiFetch(`/api/tickets/${state.selectedTicketId}/reply`, { method: "POST", body: JSON.stringify({ message }) });
    showNotice("Respuesta enviada por WhatsApp.", "success");
    await refresh();
  } catch (error) {
    showNotice(error.message || "No fue posible enviar la respuesta.", "error");
    if (button) { button.disabled = false; button.textContent = "Enviar por WhatsApp"; }
  }
}

async function saveTicketState() {
  if (!state.selectedTicketId) return;
  const ticket = state.tickets.find((item) => item.id === state.selectedTicketId);
  const status = document.querySelector("#ticketStatus").value;
  const priority = document.querySelector("#ticketPriority").value;
  const documentation = {
    diagnosis: document.querySelector("#closureDiagnosis")?.value.trim() ?? "",
    actionsPerformed: document.querySelector("#closureActions")?.value.trim() ?? "",
    outcome: document.querySelector("#closureOutcome")?.value.trim() ?? "",
    followUp: document.querySelector("#closureFollowUp")?.value.trim() ?? ""
  };
  try {
    if (status === "closed" && ticket?.status !== "closed") {
      if (!window.confirm("¿Cerrar este ticket? SAS terminará sus sesiones remotas abiertas y conservará toda la documentación.")) return;
      await apiFetch(`/api/tickets/${state.selectedTicketId}/close`, { method: "POST", body: JSON.stringify({ documentation }) });
      showNotice("Ticket cerrado manualmente con documentación y evidencia de sesión.", "success");
    } else {
      await apiFetch(`/api/tickets/${state.selectedTicketId}`, { method: "PATCH", body: JSON.stringify({ status, priority, documentation }) });
      showNotice("Ticket actualizado. Las sesiones remotas no modifican este estado.", "success");
    }
    await refresh();
  } catch (error) {
    showNotice(error.message || "No fue posible actualizar el ticket.", "error");
  }
}

async function addTicketNote() {
  if (!state.selectedTicketId) return;
  const note = document.querySelector("#ticketNote").value.trim();
  if (!note) return;
  await apiFetch(`/api/tickets/${state.selectedTicketId}/notes`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
  showNotice("Nota agregada.", "success");
  await refresh();
}

async function learnTicketResolution() {
  if (!state.selectedTicketId) return;
  const ticket = state.tickets.find((item) => item.id === state.selectedTicketId);
  const resolution = document.querySelector("#ticketNote").value.trim();
  if (!resolution) {
    showNotice("Escribe la resolución en la nota interna, una línea por paso.", "error");
    return;
  }

  const article = await apiFetch(`/api/tickets/${state.selectedTicketId}/learn`, {
    method: "POST",
    body: JSON.stringify({
      title: `Resolución: ${ticket?.subject ?? state.selectedTicketId}`,
      resolution
    })
  });
  document.querySelector("#ticketNote").value = "";
  showNotice(`Base de conocimiento actualizada: ${article.article?.title ?? "artículo creado"}.`, "success");
  await refresh();
}

async function researchWithAi(provider) {
  if (!state.selectedTicketId) return;
  const prompt = document.querySelector("#ticketNote")?.value.trim() ?? "";
  const endpoint = provider === "openai" ? "research-openai" : provider === "consensus" ? "research-consensus" : "research-google-ai";
  const label = provider === "openai" ? "OpenAI" : provider === "consensus" ? "Google y OpenAI" : "Google AI";
  showNotice(`${label} esta investigando. La propuesta quedara pendiente de revisión.`, "info");
  try {
    const result = await apiFetch(`/api/tickets/${state.selectedTicketId}/${endpoint}`, { method: "POST", body: JSON.stringify({ prompt }) });
    showNotice(`${label} generó: ${result.article?.title ?? "propuesta pendiente"}.`, "success");
    await refresh();
    showView("knowledge");
  } catch (error) {
    showNotice(error.message ?? `No fue posible consultar ${label}.`, "error");
  }
}
function openRemoteWorkspace(sessionId, existingPopup = null) {
  const workspaceUrl = `/remote/workspace.html?session=${encodeURIComponent(sessionId)}`;
  const popup = existingPopup ?? window.open(workspaceUrl, `sas-remote-${sessionId}`, "popup,width=1440,height=900,resizable=yes");
  if (existingPopup && `${existingPopup.location.pathname}${existingPopup.location.search}` !== workspaceUrl) existingPopup.location.replace(workspaceUrl);
  if (!popup) return showNotice("Permite ventanas emergentes para abrir el espacio remoto.", "error");
  const channel = new BroadcastChannel("sas-remote-workspace");
  const sendSession = (event) => { if (event.data?.type !== "ready") return; const remote = state.sessions.find((item) => item.id === sessionId); const ticket = remote ? state.tickets.find((item) => item.id === remote.ticketId) : null; channel.postMessage({ type: "session", sessionId, accessToken: state.consoleSession?.accessToken ?? null, session: remote ?? null, messages: ticket?.messages ?? [] }); };
  channel.addEventListener("message", sendSession);
  setTimeout(() => { const remote = state.sessions.find((item) => item.id === sessionId); const ticket = remote ? state.tickets.find((item) => item.id === remote.ticketId) : null; channel.postMessage({ type: "session", sessionId, accessToken: state.consoleSession?.accessToken ?? null, session: remote ?? null, messages: ticket?.messages ?? [] }); channel.close(); }, 3000);
  return popup;
}

async function openRemoteTicket(sessionId) {
  const current = state.sessions.find((item) => item.id === sessionId);
  if (!current) return showNotice("La sesión remota ya no está disponible.", "warning");
  const workspaceUrl = `/remote/workspace.html?session=${encodeURIComponent(sessionId)}`;
  const popup = window.open(workspaceUrl, `sas-remote-${sessionId}`, "popup,width=1440,height=900,resizable=yes");
  if (!popup) return showNotice("Permite ventanas emergentes para abrir el espacio remoto.", "error");
  openRemoteWorkspace(sessionId, popup);
  if (current.status === "authorized_waiting_agent" && current.agentId) {
    try {
      await apiFetch(`/api/remote-sessions/${sessionId}/start`, { method: "POST" });
      await refresh();
    } catch (error) {
      showNotice(`${error.message || "No fue posible iniciar automáticamente."} La pantalla de soporte permanece abierta para revisar el estado.`, "warning");
    }
  }
}

async function openTicketRemoteSupport(ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) return showNotice("El ticket ya no está disponible.", "warning");
  const existing = ticketSession(ticketId);
  if (existing) return openRemoteTicket(existing.id);
  const popup = window.open("about:blank", `sas-remote-ticket-${ticketId}`, "popup,width=1440,height=900,resizable=yes");
  if (!popup) return showNotice("Permite ventanas emergentes para preparar el soporte remoto.", "error");
  popup.document.title = "Preparando soporte SAS";
  popup.document.body.innerHTML = '<main style="font-family:Segoe UI,sans-serif;padding:32px"><h1>Preparando soporte remoto…</h1><p>El ticket y el equipo permanecerán visibles mientras se crea la sesión.</p></main>';
  try {
    const result = await apiFetch("/api/remote-sessions", { method: "POST", body: JSON.stringify({ ticketId, customerPhone: ticket.customerPhone, agentId: ticket.equipmentId || undefined }) });
    await refresh();
    openRemoteWorkspace(result.session.id, popup);
  } catch (error) {
    popup.document.body.innerHTML = `<main style="font-family:Segoe UI,sans-serif;padding:32px"><h1>No se pudo preparar el soporte</h1><p>${escapeHtml(error.message || "Error inesperado")}</p><p>Esta ventana no se cerró para que puedas copiar el mensaje o volver a intentarlo.</p></main>`;
    showNotice(error.message || "No fue posible preparar el soporte remoto.", "error");
  }
}
function remoteTicketContact(ticket, session) {
  const phone = String(ticket?.customerPhone || session.customerPhone || "").replace(/\D/g, "");
  return state.contacts.find((contact) => String(contact.phone || "").replace(/\D/g, "") === phone) || null;
}

function renderRemote() {
  const eligibleSessions = state.sessions.filter((session) => !["expired", "consent_rejected"].includes(session.status));
  const activeSessions = eligibleSessions
    .filter((session) => !isTerminalRemoteStatus(session.status))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  const recentClosedSessions = eligibleSessions
    .filter((session) => isTerminalRemoteStatus(session.status))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0))
    .slice(0, 6);
  const visibleSessions = [...activeSessions, ...recentClosedSessions];
  const host = document.querySelector("#remoteList");
  host.innerHTML = visibleSessions.map((session) => {
    const ticket = state.tickets.find((item) => item.id === session.ticketId) || null;
    const contact = remoteTicketContact(ticket, session);
    const assignedAgent = state.agents.find((agent) => agent.machineId === session.agentId) || null;
    const isClosed = isTerminalRemoteStatus(session.status);
    const customerName = ticket?.customerName || contact?.name || "Cliente sin identificar";
    const customerPhone = ticket?.customerPhone || contact?.phone || session.customerPhone || "Sin teléfono";
    const company = contact?.company || "Empresa sin registrar";
    const subject = ticket?.subject || "Soporte remoto";
    const equipmentName = assignedAgent?.hostname || (session.agentId ? shortId(session.agentId) : "Pendiente de asignar");
    const equipmentUser = assignedAgent?.username || (session.agentId ? "Equipo registrado" : "El cliente debe vincular SAS Cliente");
    const equipmentStatus = assignedAgent ? labelStatus(assignedAgent.status) : session.agentId ? "registrado" : "sin asignar";
    const consentUrl = `${location.origin}/remote/consent/${session.joinCode}`;
    const showConsentLink = !isClosed && session.consent?.decision !== "approved";
    const canClose = !isClosed;
    return `
      <article class="remote-ticket-card ${isClosed ? "is-closed" : "is-open"}" data-remote-ticket="${escapeHtml(session.id)}" tabindex="0" role="button" aria-label="Abrir soporte del ticket ${escapeHtml(session.ticketId)}">
        <header class="remote-ticket-header">
          <div><small>Ticket ${escapeHtml(session.ticketId)} · ${escapeHtml(session.joinCode)}</small><strong>${escapeHtml(subject)}</strong></div>
          <span class="badge status-${escapeHtml(statusClass(session.status))}">${escapeHtml(labelStatus(session.status))}</span>
        </header>
        <div class="remote-ticket-person">
          <strong>${escapeHtml(customerName)}</strong>
          <span>${escapeHtml(company)}</span>
          <small>${escapeHtml(customerPhone)}</small>
        </div>
        <div class="remote-ticket-equipment ${session.agentId ? "assigned" : "unassigned"}">
          <span>Equipo asignado</span>
          <strong>${escapeHtml(equipmentName)}</strong>
          <small>${escapeHtml(equipmentUser)} · ${escapeHtml(equipmentStatus)}</small>
        </div>
        <footer class="remote-ticket-footer">
          <small>${isClosed ? "Sesión terminada" : `Actualizado ${escapeHtml(formatDateTime(session.updatedAt || session.createdAt))}`}</small>
          <div class="remote-ticket-actions">
            ${showConsentLink ? `<a class="secondary" href="${consentUrl}" target="_blank" rel="noreferrer">Permiso del usuario</a>` : ""}
            ${!isClosed && !session.agentId ? `<button class="secondary" type="button" data-remote-assign="${escapeHtml(session.id)}">Asignar equipo</button>` : ""}
            <button type="button" data-open-remote-ticket="${escapeHtml(session.id)}">${isClosed ? "Revisar sesión" : "Abrir soporte"}</button>
            ${canClose ? `<button class="secondary" type="button" data-remote-close="${escapeHtml(session.id)}">Terminar</button>` : ""}
          </div>
        </footer>
      </article>`;
  }).join("") || emptyState("Sin tickets remotos", "Cuando Fisher o un técnico prepare soporte, el ticket aparecerá aquí.", "También puedes iniciar soporte desde la ficha del equipo.");

  host.querySelectorAll("[data-remote-ticket]").forEach((card) => {
    card.addEventListener("click", (event) => { if (!event.target.closest("a,button")) openRemoteTicket(card.dataset.remoteTicket); });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRemoteTicket(card.dataset.remoteTicket); } });
  });
  host.querySelectorAll("[data-open-remote-ticket]").forEach((button) => button.addEventListener("click", () => openRemoteTicket(button.dataset.openRemoteTicket)));
  host.querySelectorAll("[data-remote-close]").forEach((button) => button.addEventListener("click", () => updateRemoteSession(button.dataset.remoteClose, "close")));
  host.querySelectorAll("[data-remote-assign]").forEach((button) => button.addEventListener("click", () => assignRemoteAgent(button.dataset.remoteAssign)));
}
function renderRemoteEquipmentCards() {
  const host = document.querySelector("#remoteEquipmentCards");
  if (!host) return;
  const agents = [...state.agents].sort((a, b) => Number(b.status === "online") - Number(a.status === "online") || String(a.hostname).localeCompare(String(b.hostname)));
  host.innerHTML = agents.map((agent) => {
    const apps = agent.inventory?.applications;
    const startup = agent.inventory?.startup;
    const changes = Number(apps?.changes?.added?.length ?? 0) + Number(apps?.changes?.removed?.length ?? 0) + Number(apps?.changes?.changed?.length ?? 0) + Number(startup?.changes?.added?.length ?? 0) + Number(startup?.changes?.removed?.length ?? 0) + Number(startup?.changes?.changed?.length ?? 0);
    return `<article class="remote-equipment-card status-${escapeHtml(statusClass(agent.status))}"><div><strong>${escapeHtml(agent.hostname)}</strong><span class="status-dot" aria-hidden="true"></span></div><small>${escapeHtml(agent.username || "Usuario sin identificar")}</small><div class="equipment-bubbles"><span>${apps ? `${apps.count} aplicaciones` : "Aplicaciones pendientes"}</span><span>${startup ? `${startup.count} al inicio` : "Inicio pendiente"}</span>${changes ? `<span class="warn">${changes} cambios</span>` : ""}</div><button type="button" data-remote-agent-quick="${escapeHtml(agent.machineId)}" ${agent.status === "online" ? "" : "disabled"}>Abrir remoto</button></article>`;
  }).join("") || `<p class="muted">Los equipos vinculados aparecerán aquí.</p>`;
  host.querySelectorAll("[data-remote-agent-quick]").forEach((button) => button.addEventListener("click", () => startRemoteFromAgent(button.dataset.remoteAgentQuick)));
}
function renderRemoteEvidence(session, completedCommands, completedEvents) {
  const blocks = [
    renderLiveFrame(session),
    completedEvents.length ? renderInteractiveEvents(completedEvents.slice(-2)) : "",
    completedCommands.length ? renderCommandResults(completedCommands.slice(-2)) : ""
  ].filter(Boolean);
  return blocks.join("") || `<div class="remote-waiting"><span>Sin evidencia remota todavia.</span></div>`;
}

function shortId(value) {
  const clean = String(value ?? "");
  return clean.length > 12 ? `${clean.slice(0, 6)}...${clean.slice(-4)}` : clean;
}
function renderRealInputReadinessNotice(session = null) {
  const readiness = getRealInputReadiness();
  const controlApproved = session?.controlConsent?.decision === "approved";
  const mode = readiness.enabled ? "real" : "simulated";
  const classes = ["real-input-notice", readiness.status, mode].join(" ");
  const title = readiness.enabled
    ? readiness.ready
      ? "Teclado y mouse real de laboratorio activo"
      : "Teclado y mouse real activo con bloqueo"
    : "Teclado y mouse seguro en modo simulado";
  const detail = readiness.enabled
    ? readiness.ready
      ? "El preflight permite laboratorio controlado. Verifica consentimiento y paro local antes de enviar eventos."
      : "La bandera esta activa, pero falta firma valida o requisito de laboratorio. No enviar mouse/teclado real."
    : controlApproved
      ? "El cliente aprobo control, pero SAS ejecutara eventos simulados porque la entrada real esta apagada."
      : "Para pruebas normales, el control real permanece apagado hasta firma valida y activacion explicita.";
  return `
    <div class="${classes}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
      <small>${escapeHtml(readiness.summary)}</small>
    </div>
  `;
}

function getRealInputReadiness() {
  const checks = Array.isArray(state.preflightReport?.checks) ? state.preflightReport.checks : [];
  const guard = checks.find((check) => check.name === "real_input_guard");
  const labReady = checks.find((check) => check.name === "real_input_lab_ready");
  const signature = checks.find((check) => check.name === "input_helper_signature");
  const enabled = Boolean(guard?.details?.enabled);
  const ready = labReady?.status === "pass";
  const signatureValid = signature?.details?.status === "Valid";
  const status = enabled && ready ? "ready" : enabled ? "blocked" : "simulated";
  const summary = state.preflightReport
    ? `Preflight ${labelStatus(state.preflightReport.status ?? "unknown")} - firma control ${signatureValid ? "valida" : "pendiente"} - laboratorio ${labelStatus(labReady?.status ?? "missing")}`
    : "Sin reporte de preflight; ejecutar test-client-preflight.ps1 antes de pruebas reales.";
  return { enabled, ready, signatureValid, status, summary };
}
function renderRemoteSecuritySummary(session) {
  const commands = session.commands ?? [];
  const events = session.interactiveEvents ?? [];
  const queuedCommands = commands.filter((command) => command.status === "queued").length;
  const cancelledCommands = commands.filter((command) => command.status === "cancelled").length;
  const queuedEvents = events.filter((event) => event.status === "queued").length;
  const cancelledEvents = events.filter((event) => event.status === "cancelled").length;
  const checks = [
    {
      label: "Permiso",
      value: labelStatus(session.consent?.decision ?? "pending"),
      ok: session.consent?.decision === "approved"
    },
    {
      label: "Ver pantalla",
      value: session.screenShare?.enabled ? "Activa" : "Detenida",
      ok: !session.screenShare?.enabled
    },
    {
      label: "Teclado y mouse",
      value: labelStatus(session.controlConsent?.decision ?? "not_requested"),
      ok: session.controlConsent?.decision !== "approved"
    },
    {
      label: "Cola",
      value: `${queuedCommands + queuedEvents} pendiente(s)`,
      ok: queuedCommands + queuedEvents === 0
    },
    {
      label: "Cancelado",
      value: `${cancelledCommands + cancelledEvents} acción(es)`,
      ok: true
    }
  ];
  const hasRisk = checks.some((check) => !check.ok);

  return `
    <div class="remote-security ${hasRisk ? "attention" : "safe"}">
      <strong>${hasRisk ? "Revisar seguridad" : "Seguridad lista"}</strong>
      <div>
        ${checks.map((check) => `<span class="${check.ok ? "ok" : "warn"}">${escapeHtml(check.label)}: ${escapeHtml(check.value)}</span>`).join("")}
      </div>
    </div>
  `;
}
function isTerminalRemoteStatus(status) {
  return ["closed", "consent_rejected", "expired", "consent_locked", "control_locked"].includes(status);
}
async function updateRemoteSession(sessionId, action) {
  await apiFetch(`/api/remote-sessions/${sessionId}/${action}`, {
    method: "POST"
  });
  showNotice(`Sesión remota: ${action}.`, "success");
  await refresh();
}

async function assignRemoteAgent(sessionId) {
  const select = document.querySelector(`[data-agent-select="${sessionId}"]`);
  await apiFetch(`/api/remote-sessions/${sessionId}/assign-agent`, {
    method: "POST",
    body: JSON.stringify({ agentId: select?.value ?? "" })
  });
  showNotice("Agente asignado.", "success");
  await refresh();
}

async function queueRemoteCommand(sessionId, type) {
  await apiFetch(`/api/remote-sessions/${sessionId}/commands`, {
    method: "POST",
    body: JSON.stringify({ type })
  });
  showNotice(`Comando ${type} enviado al agente.`, "success");
  await refresh();
}

async function queueRepairAction(sessionId, actionId, decisionMode = "suggest_only") {
  await apiFetch(`/api/remote-sessions/${sessionId}/repair-actions`, {
    method: "POST",
    body: JSON.stringify({ actionId, maxRisk: "medium", decisionMode })
  });
  showNotice("Reparación enviada al agente en modo controlado.", "success");
  await refresh();
}

async function requestInteractiveControl(sessionId) {
  await apiFetch(`/api/remote-sessions/${sessionId}/control/request`, {
    method: "POST"
  });
  showNotice("Solicitud de control enviada. El cliente debe aprobarla.", "success");
  await refresh();
}

async function queueInteractiveEvent(sessionId, type, payload) {
  await apiFetch(`/api/remote-sessions/${sessionId}/events`, {
    method: "POST",
    body: JSON.stringify({ type, payload })
  });
  showNotice(`Evento ${type} enviado en modo simulacion.`, "success");
  await refresh();
}

async function updateScreenShare(sessionId, action, profile = "balanced", overrides = {}) {
  const profiles = {
    lowLatency: { intervalSeconds: 1, quality: 45, maxWidth: 960, monitorIndex: 0, nativeResolution: false, profile: "lowLatency" },
    balanced: { intervalSeconds: 2, quality: 62, maxWidth: 1280, monitorIndex: 0, nativeResolution: false, profile: "balanced" },
    quality: { intervalSeconds: 3, quality: 78, maxWidth: 1600, monitorIndex: 0, nativeResolution: false, profile: "quality" }
  };
  await apiFetch(`/api/remote-sessions/${sessionId}/screen/${action}`, {
    method: "POST",
    body: JSON.stringify({ ...(profiles[profile] ?? profiles.balanced), ...overrides })
  });
  showNotice(action === "start" ? "Vista en vivo activada." : "Vista en vivo detenida.", "success");
  await refresh();
}

function renderLiveFrame(session) {
  const frame = session.screenShare?.lastFrame;
  if (!frame?.imageBase64) {
    return session.screenShare?.enabled ? `<small>Vista en vivo activa, esperando frame...</small>` : "";
  }
  const capturedAt = session.screenShare.lastFrameAt ?? frame.capturedAt;
  const ageSeconds = frameAgeSeconds(capturedAt);
  const interval = session.screenShare.intervalSeconds ?? 2;
  const freshness = getFrameFreshness(ageSeconds, interval);
  const sizeKb = base64SizeKb(frame.imageBase64);
  const latencyMs = session.screenShare.lastFrameLatencyMs ?? frame.latencyMs;
  return `
    <div class="command-result live-frame">
      <header class="live-frame-header">
        <strong>Vista en vivo ${session.screenShare.enabled ? "activa" : "detenida"}</strong>
        <span class="live-status ${freshness}">${labelFrameFreshness(freshness)}</span>
      </header>
      <div class="live-viewer-toolbar" role="toolbar" aria-label="Controles de vista"><button class="secondary" data-viewer-action="monitor" data-viewer-target="${session.id}">Monitor 1</button><button class="secondary" data-viewer-action="native" data-viewer-target="${session.id}">Resolución nativa</button><button class="secondary" data-viewer-action="fit" data-viewer-target="${session.id}">Ajustar a ventana</button><button class="secondary" data-viewer-action="zoom-out" data-viewer-target="${session.id}">-</button><button class="secondary" data-viewer-action="reset" data-viewer-target="${session.id}">100 %</button><button class="secondary" data-viewer-action="zoom-in" data-viewer-target="${session.id}">+</button><button class="secondary" data-viewer-action="fullscreen" data-viewer-target="${session.id}">Pantalla completa</button></div><img class="screenshot-preview viewer-fit" data-interactive-image="${session.id}" data-viewer-id="${session.id}" src="data:${frame.mimeType};base64,${frame.imageBase64}" alt="Vista en vivo remota">
      <div class="live-metrics">
        <span>Edad ${ageSeconds}s</span>
        <span>Intervalo ${interval}s</span>
        ${latencyMs ? `<span>Latencia ${Math.round(latencyMs / 100) / 10}s</span>` : ""}
        <span>Peso ${sizeKb} KB</span>
        <span>${frame.width ?? "?"}x${frame.height ?? "?"}</span>
        <span>${labelScreenProfile(session.screenShare.profile)}</span>
        <span>${escapeHtml(frame.mimeType ?? "imagen")}</span>
      </div>
      <small>${capturedAt}</small>
    </div>
  `;
}

function updateViewer(action, targetId) {
  const image = document.querySelector(`[data-viewer-id="${CSS.escape(targetId)}"]`);
  if (!image) return;
  const card = image.closest(".live-frame");
  if (action === "fullscreen") { (card?.requestFullscreen?.() || image.requestFullscreen?.())?.catch?.(() => {}); return; }
  if (action === "monitor") {
    const current = Number(image.dataset.monitor ?? "0");
    const next = (current + 1) % 4;
    image.dataset.monitor = String(next);
    const button = card?.querySelector('[data-viewer-action="monitor"]');
    if (button) button.textContent = `Monitor ${next + 1}`;
    updateScreenShare(targetId, "start", "balanced", { monitorIndex: next }).catch((error) => showNotice(error.message, "error"));
    return;
  }
  if (action === "fit") { image.classList.add("viewer-fit"); image.classList.remove("viewer-native"); image.style.transform = "scale(1)"; return; }
  if (action === "native") {
    image.classList.remove("viewer-fit"); image.classList.add("viewer-native"); image.style.transform = "scale(1)";
    updateScreenShare(targetId, "start", "quality", { nativeResolution: true }).catch((error) => showNotice(error.message, "error"));
    return;
  }
  const current = Number(image.dataset.zoom ?? "1");
  const next = action === "zoom-in" ? Math.min(3, current + 0.25) : action === "zoom-out" ? Math.max(0.25, current - 0.25) : 1;
  image.dataset.zoom = String(next); image.style.transform = `scale(${next})`; image.style.transformOrigin = "center center";
}
function getFrameFreshness(ageSeconds, intervalSeconds) {
  if (ageSeconds <= Math.max(4, intervalSeconds * 2)) return "fresh";
  if (ageSeconds <= Math.max(12, intervalSeconds * 5)) return "lagging";
  return "stale";
}

function labelFrameFreshness(freshness) {
  if (freshness === "fresh") return "Reciente";
  if (freshness === "lagging") return "Lenta";
  return "Sin actualizar";
}

function labelScreenProfile(profile) {
  if (profile === "lowLatency") return "Fluida";
  if (profile === "quality") return "Calidad";
  return "Normal";
}

function frameAgeSeconds(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.round((Date.now() - time) / 1000));
}

function base64SizeKb(value) {
  const clean = String(value ?? "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(1, Math.round(((clean.length * 3) / 4 - padding) / 1024));
}
function renderInteractiveEvents(events) {
  return events.map((event) => {
    const result = event.result ?? {};
    const mode = event.status === "failed" ? "Error" : result.simulated === false ? "Ejecutado" : "Simulado";
    const detail = event.status === "failed"
      ? event.error ?? "Evento fallido"
      : result.helper
        ? `${result.helper} - ${result.helperMessage ?? "ejecutado"}`
        : result.note ?? "Evento recibido sin tocar mouse/teclado real.";
    return `
      <div class="command-result interactive-result ${event.status === "failed" ? "failed" : result.simulated === false ? "executed" : "simulated"}">
        <header><strong>${escapeHtml(event.type)}</strong><span>${escapeHtml(mode)}</span></header>
        <p>${escapeHtml(detail)}</p>
        <small>${escapeHtml(event.updatedAt ?? result.executedAt ?? result.receivedAt ?? "sin fecha")}</small>
      </div>
    `;
  }).join("");
}

function renderCommandResults(commands) {
  return commands.map((command) => renderCommandResult(command)).join("");
}

function renderCommandResult(command) {
  if (command.type === "screenshot_preview" && command.result?.imageBase64) {
    return `
      <div class="command-result friendly-command screenshot-command">
        <header><strong>Captura de pantalla</strong><span>${escapeHtml(labelStatus(command.status))}</span></header>
        <img class="screenshot-preview" src="data:${command.result.mimeType};base64,${command.result.imageBase64}" alt="Captura de pantalla remota">
        <small>${escapeHtml(formatCommandTime(command))}</small>
      </div>
    `;
  }

  const result = command.result;
  if (command.status === "failed" || command.error) {
    return renderFriendlyCommandShell(command, `<p class="command-warning">${escapeHtml(command.error ?? result?.error ?? "No se pudo obtener la información.")}</p>`);
  }
  if (!result) {
    return renderFriendlyCommandShell(command, `<p class="command-muted">Sin resultado disponible todavia.</p>`);
  }

  const body = {
    system_info: renderSystemInfoResult,
    network_info: renderNetworkInfoResult,
    disk_info: renderDiskInfoResult,
    process_snapshot: renderProcessSnapshotResult,
    service_snapshot: renderServiceSnapshotResult,
    repair_action: renderRepairActionResult
  }[command.type]?.(result) ?? renderGenericCommandResult(result);

  return renderFriendlyCommandShell(command, body);
}

function renderFriendlyCommandShell(command, body) {
  return `
    <div class="command-result friendly-command command-${escapeHtml(statusClass(command.type))}">
      <header><strong>${escapeHtml(labelRemoteCommandType(command.type))}</strong><span>${escapeHtml(labelStatus(command.status))}</span></header>
      ${body}
      <small>${escapeHtml(formatCommandTime(command))}</small>
      <details class="action-menu full-width technical-details command-details"><summary>Detalle avanzado</summary><pre class="compact-json">${escapeHtml(JSON.stringify({ type: command.type, status: command.status, result: command.result, error: command.error }, null, 2))}</pre></details>
    </div>
  `;
}

function renderRepairActionResult(result) {
  const simulated = result?.simulated === true;
  return `
    <div class="friendly-facts">
      ${friendlyFact("Acción", result?.title ?? result?.actionId)}
      ${friendlyFact("Modo", simulated ? "Simulacion segura" : "Ejecutada")}
      ${friendlyFact("Riesgo", labelStatus(result?.risk))}
      ${friendlyFact("Resultado", simulated ? "No se hicieron cambios reales" : "Completada por el agente")}
    </div>
    <p class="command-muted">${escapeHtml(result?.note ?? result?.skippedReason ?? "Resultado de reparación recibido.")}</p>
  `;
}
function renderSystemInfoResult(result) {
  const memoryUsed = Number(result.totalMemory ?? 0) - Number(result.freeMemory ?? 0);
  const cpuModel = Array.isArray(result.cpus) && result.cpus.length ? result.cpus[0] : "Sin dato";
  const cpuCount = Array.isArray(result.cpus) ? result.cpus.length : 0;
  return `
    <div class="friendly-facts">
      ${friendlyFact("Equipo", result.hostname)}
      ${friendlyFact("Usuario", result.username)}
      ${friendlyFact("Windows", result.release ? `${result.type ?? "Windows"} ${result.release}` : result.type)}
      ${friendlyFact("Arquitectura", result.arch)}
      ${friendlyFact("Encendido", formatDuration(result.uptimeSeconds))}
      ${friendlyFact("Memoria", `${formatBytes(memoryUsed)} usada de ${formatBytes(result.totalMemory)}`)}
    </div>
    <p class="command-muted">Procesador: ${escapeHtml(cpuModel)}${cpuCount ? ` (${cpuCount} nucleos/hilos reportados)` : ""}</p>
  `;
}

function renderNetworkInfoResult(result) {
  const interfaces = Object.entries(result.interfaces ?? {})
    .flatMap(([name, values]) => (values ?? []).map((item) => ({ name, ...item })))
    .filter((item) => !item.internal)
    .slice(0, 8);
  if (!interfaces.length) return `<p class="command-muted">No se encontraron adaptadores de red activos.</p>`;
  return `
    <div class="friendly-table">
      ${interfaces.map((item) => `
        <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.family ?? "red")} - ${escapeHtml(item.address ?? "sin IP")}</span><small>${escapeHtml(item.mac && item.mac !== "00:00:00:00:00:00" ? item.mac : "MAC no reportada")}</small></div>
      `).join("")}
    </div>
  `;
}

function renderDiskInfoResult(result) {
  if (!Array.isArray(result)) return renderGenericCommandResult(result);
  const disks = result.filter((disk) => disk.caption || disk.size || disk.freeSpace).slice(0, 8);
  if (!disks.length) return `<p class="command-muted">No se encontraron discos para mostrar.</p>`;
  return `
    <div class="friendly-table">
      ${disks.map((disk) => {
        const size = Number(disk.size ?? 0);
        const free = Number(disk.freeSpace ?? 0);
        const used = size > 0 ? size - free : 0;
        return `<div><strong>${escapeHtml(disk.caption ?? "Disco")}</strong><span>${escapeHtml(disk.volumeName || "Sin etiqueta")}</span><small>${formatBytes(used)} usado de ${formatBytes(size)} - libre ${formatBytes(free)}</small></div>`;
      }).join("")}
    </div>
  `;
}

function renderProcessSnapshotResult(result) {
  if (!Array.isArray(result)) return renderGenericCommandResult(result);
  const processes = result.slice(0, 10);
  if (!processes.length) return `<p class="command-muted">No se encontraron procesos para mostrar.</p>`;
  return `
    <div class="friendly-table compact-rows">
      ${processes.map((process) => `<div><strong>${escapeHtml(process.imageName ?? "Proceso")}</strong><span>PID ${escapeHtml(process.pid ?? "?")}</span><small>Memoria ${escapeHtml(process.memoryUsage ?? "sin dato")}</small></div>`).join("")}
    </div>
  `;
}

function renderServiceSnapshotResult(result) {
  if (!Array.isArray(result)) return renderGenericCommandResult(result);
  const services = parseServiceSnapshotLines(result).slice(0, 10);
  if (!services.length) return `<p class="command-muted">No se encontraron servicios para mostrar.</p>`;
  return `
    <div class="friendly-table compact-rows">
      ${services.map((service) => `<div><strong>${escapeHtml(service.name)}</strong><span>${escapeHtml(service.state)}</span><small>Servicio Windows</small></div>`).join("")}
    </div>
  `;
}

function renderGenericCommandResult(result) {
  if (result?.note) return `<p class="command-muted">${escapeHtml(result.note)}</p>`;
  if (Array.isArray(result)) return `<p class="command-muted">${result.length} registro(s) recibidos. Abre el detalle técnico para revisarlos.</p>`;
  return `<p class="command-muted">Información recibida. Abre el detalle técnico para verla completa.</p>`;
}

function parseServiceSnapshotLines(lines) {
  const services = [];
  let current = null;
  for (const line of lines) {
    const serviceMatch = String(line).match(/SERVICE_NAME:\s*(.+)$/i);
    if (serviceMatch) {
      current = { name: serviceMatch[1].trim(), state: "Sin estado" };
      services.push(current);
      continue;
    }
    const stateMatch = String(line).match(/STATE\s*:\s*\d+\s+(.+)$/i);
    if (stateMatch && current) current.state = stateMatch[1].trim();
  }
  return services;
}

function friendlyFact(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? "Sin dato")}</strong></div>`;
}

function formatCommandTime(command) {
  return command.updatedAt ? `Actualizado ${formatDateTime(command.updatedAt)}` : command.createdAt ? `Solicitado ${formatDateTime(command.createdAt)}` : "Sin fecha";
}

function formatDuration(seconds) {
  const value = Number(seconds ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "Sin dato";
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (days > 0) return `${days} dia(s), ${hours} hora(s)`;
  if (hours > 0) return `${hours} hora(s), ${minutes} min`;
  return `${minutes} min`;
}

function labelRemoteCommandType(type) {
  return ({
    system_info: "Información del equipo",
    network_info: "Red del equipo",
    disk_info: "Discos y espacio",
    process_snapshot: "Procesos principales",
    service_snapshot: "Servicios de Windows",
    software_inventory: "Aplicaciones instaladas",
    startup_inventory: "Programas al inicio",
    security_status: "Estado de ClamAV",
    security_definitions_update: "Actualización de firmas",
    security_scan_startup: "Análisis de programas al inicio",
    screenshot_preview: "Captura de pantalla"
  })[type] ?? labelStatus(type);
}
async function startRemoteFromAgent(agentId) {
  const agent = state.agents.find((item) => item.machineId === agentId);
  if (!agent) return showNotice("El equipo ya no está disponible.", "error");
  if (agent.status !== "online") return showNotice("El equipo está desconectado. Inicia SAS Cliente antes de continuar.", "warning");
  const existingSession = state.sessions.find((session) => session.agentId === agentId && !isTerminalRemoteStatus(session.status));
  if (existingSession) {
    const existingPopup = window.open("about:blank", `sas-remote-${existingSession.id}`, "popup,width=1440,height=900,resizable=yes");
    if (!existingPopup) return showNotice("Permite ventanas emergentes para abrir el soporte remoto.", "error");
    openRemoteWorkspace(existingSession.id, existingPopup);
    return showNotice(`Se abrió la solicitud activa ${existingSession.joinCode}; no se creó un ticket duplicado.`, "info");
  }
  if (state.remoteLaunchAgentIds.has(agentId)) return showNotice("La solicitud ya se está preparando.", "info");
  const popup = window.open("about:blank", `sas-remote-new-${agentId}`, "popup,width=1440,height=900,resizable=yes");
  if (!popup) return showNotice("Permite ventanas emergentes para abrir el soporte remoto.", "error");
  popup.document.title = "Preparando soporte remoto";
  popup.document.body.innerHTML = '<main style="font-family:Segoe UI,sans-serif;padding:32px"><h1>Preparando soporte remoto…</h1><p>Creando el ticket y la sesión protegida.</p></main>';
  state.remoteLaunchAgentIds.add(agentId);
  let ticketId = null;
  let sessionId = null;
  try {
    const ticketResult = await apiFetch("/api/tickets", { method: "POST", body: JSON.stringify({ customerName: `Equipo ${agent.hostname}`, customerPhone: "", subject: `Soporte remoto - ${agent.hostname}`, description: "Acceso remoto iniciado desde Equipos", source: "console", priority: "normal", equipmentId: agentId }) });
    ticketId = ticketResult.ticket.id;
    const remoteResult = await apiFetch("/api/remote-sessions", { method: "POST", body: JSON.stringify({ ticketId, agentId }) });
    sessionId = remoteResult.session.id;
    const unattended = agent.unattendedAccess?.enabled === true;
    if (unattended) await apiFetch(`/api/remote-sessions/${sessionId}/unattended-request`, { method: "POST" });
    await refresh();
    showView("remote");
    openRemoteWorkspace(sessionId, popup);
    showNotice(unattended ? `Solicitud enviada a SAS Cliente para ${agent.hostname}. SAS Cliente lo autorizará automáticamente con su política local.` : `Solicitud ${remoteResult.session.joinCode} enviada al escritorio del usuario.`, "success");
  } catch (error) {
    popup.document.body.innerHTML = `<main style="font-family:Segoe UI,sans-serif;padding:32px"><h1>No se pudo abrir el soporte</h1><p>${escapeHtml(error.message || "Error inesperado")}</p><p>La ventana permanecerá abierta para consultar el error.</p></main>`;
    if (sessionId) await apiFetch(`/api/remote-sessions/${sessionId}/close`, { method: "POST" }).catch(() => {});
    if (ticketId) await apiFetch(`/api/tickets/${ticketId}/notes`, { method: "POST", body: JSON.stringify({ note: `No se pudo iniciar la sesión remota: ${error.message || "error inesperado"}. El ticket permanece abierto.` }) }).catch(() => {});
    showNotice(error.message || "No fue posible iniciar el soporte remoto.", "error");
  } finally {
    state.remoteLaunchAgentIds.delete(agentId);
  }
}
function renderDeploymentCampaigns() {
  const host = document.querySelector("#deploymentCampaigns");
  if (!host) return;
  host.innerHTML = state.deploymentCampaigns.map((campaign) => `<article class="item deployment-row status-${escapeHtml(statusClass(campaign.status))}"><div><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(campaign.company)} · ${campaign.enrolledDevices}/${campaign.maxDevices} equipos</span><small>Vence ${escapeHtml(formatDateTime(campaign.expiresAt))} · clave …${escapeHtml(campaign.tokenHint)}</small></div><div class="item-actions">${campaign.status === "active" ? `<button type="button" class="secondary" data-deployment-revoke="${escapeHtml(campaign.id)}">Revocar</button>` : `<span class="badge status-${escapeHtml(statusClass(campaign.status))}">${escapeHtml(labelStatus(campaign.status))}</span>`}</div></article>`).join("") || `<p class="muted">Todavía no hay campañas de instalación.</p>`;
  host.querySelectorAll("[data-deployment-revoke]").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("Revocar esta campaña impedirá registrar equipos nuevos. Las credenciales individuales existentes seguirán funcionando.")) return;
    try { await apiFetch(`/api/deployment-campaigns/${encodeURIComponent(button.dataset.deploymentRevoke)}/revoke`, { method: "POST" }); await refresh(); showNotice("Campaña revocada.", "success"); } catch (error) { showNotice(error.message, "error"); }
  }));
}
async function createDeploymentCampaign() {
  const result = document.querySelector("#deploymentResult"), expiresInput = document.querySelector("#deploymentExpires")?.value;
  result.textContent = "Creando perfil seguro…";
  try {
    const body = await apiFetch("/api/deployment-campaigns", { method: "POST", body: JSON.stringify({ name: document.querySelector("#deploymentName")?.value, company: document.querySelector("#deploymentCompany")?.value, maxDevices: Number(document.querySelector("#deploymentLimit")?.value || 100), expiresAt: expiresInput ? new Date(expiresInput + "T23:59:59").toISOString() : undefined }) });
    const blob = new Blob([JSON.stringify(body.profile, null, 2) + "\n"], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = body.filename || "empresa.sasdeploy"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    result.textContent = `Perfil ${body.filename} descargado. Guárdalo como secreto administrativo.`;
    await refresh();
  } catch (error) { result.textContent = error.message; }
}
function renderAgents() {
  renderDeploymentCampaigns();
  document.querySelector("#agentsList").innerHTML = state.agents.map((agent) => {
    const caps = agent.capabilities ?? {};
    const ready = agent.status === "online" && (caps.optimizedCapture || caps.unsignedRestrictedProduction || caps.localPanelPort);
    const healthLabel = ready ? "Listo para soporte" : agent.status === "online" ? "Conectado, revisar permisos" : "Sin conexión reciente";
    const lastSeen = agent.lastSeenAt ? formatDateTime(agent.lastSeenAt) : "Sin contacto";
    const renameNotice = agent.hostnameChangedAt && agent.previousHostname
      ? `<div class="safety-banner warning agent-rename-notice"><strong>Nombre actualizado</strong><span>${escapeHtml(agent.previousHostname)} → ${escapeHtml(agent.hostname)}</span><small>Detectado ${escapeHtml(formatDateTime(agent.hostnameChangedAt))}. Es el mismo equipo; se conservaron su historial y vinculación.</small></div>`
      : "";
    const unattendedReady = agent.unattendedAccess?.enabled === true;
    const unattendedMessage = unattendedReady
      ? `Contraseña desatendida establecida · acceso automático${agent.unattendedAccess.allowControl ? " · pantalla, teclado y mouse" : " · solo pantalla"}`
      : "Acceso atendido · el usuario deberá autorizar";
    return `
      <article class="item agent-card status-${escapeHtml(statusClass(agent.status))} ${unattendedReady ? "unattended-ready" : "attended-only"}" data-agent-card="${escapeHtml(agent.machineId)}" tabindex="0" title="${unattendedReady ? "Doble clic para iniciar acceso automático" : "Doble clic para solicitar autorización al usuario"}">
        <header><strong>${escapeHtml(agent.hostname)}</strong><span class="badge status-${escapeHtml(statusClass(agent.status))}">${escapeHtml(labelStatus(agent.status))}</span></header>
        <div class="agent-summary">
          <span>${escapeHtml(healthLabel)}</span>
          <small>${escapeHtml(agent.username)} - ${escapeHtml(agent.os)}</small>
        </div>
        <div class="unattended-state ${unattendedReady ? "ready" : "attention"}"><strong>${escapeHtml(unattendedMessage)}</strong><small>${unattendedReady ? "Doble clic para entrar sin validación adicional del usuario" : "Doble clic para enviar la solicitud al escritorio"}</small></div>
        <div class="item-actions agent-primary-actions"><button type="button" data-agent-remote="${escapeHtml(agent.machineId)}" ${agent.status === "online" ? "" : "disabled"}>${unattendedReady ? "Solicitar acceso" : "Solicitar soporte"}</button></div>
        ${renameNotice}
        <details class="agent-detail-popover"><summary>Ver detalles del equipo</summary><div class="agent-detail-popover-body">${renderAgentCapabilities(agent)}${renderAgentInventory(agent)}</div></details>
        <small>Último contacto ${escapeHtml(lastSeen)}</small>
      </article>
    `;
  }).join("") || emptyState("Sin equipos conectados", "El cliente Windows se mostrará aquí cuando el agente quede registrado.", "Inicia SAS Cliente para que el equipo aparezca aquí.");
  document.querySelectorAll("[data-agent-remote]").forEach((button) => {
    button.addEventListener("click", () => startRemoteFromAgent(button.dataset.agentRemote));
  });
  document.querySelectorAll("[data-agent-card]").forEach((card) => {
    card.addEventListener("dblclick", (event) => {
      if (event.target.closest("button, a, summary, details")) return;
      startRemoteFromAgent(card.dataset.agentCard);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      startRemoteFromAgent(card.dataset.agentCard);
    });
  });
}

function renderAgentCapabilities(agent) {
  const caps = agent.capabilities ?? {};
  const unattended = agent.unattendedAccess ?? { enabled: false };
  const unattendedLocked = Date.parse(unattended.lockedUntil ?? 0) > Date.now();
  const primary = [
    { label: unattended.enabled ? (unattended.allowControl ? "Desatendido: pantalla y control" : "Desatendido: solo pantalla") : "Desatendido apagado", ok: !unattendedLocked },
    { label: caps.unsignedRestrictedProduction ? "Modo restringido" : "Modo normal", ok: true },
    { label: caps.optimizedCapture ? "Ver pantalla fluida" : caps.unsignedRestrictedProduction ? "Ver pantalla basica" : "Ver pantalla pendiente", ok: Boolean(caps.optimizedCapture) || Boolean(caps.unsignedRestrictedProduction) },
    { label: caps.realInputEnabled ? "Teclado y mouse real" : "Teclado y mouse seguro", ok: true }
  ];
  const history = Array.isArray(agent.hostnameHistory) ? [...agent.hostnameHistory].reverse() : [];
  const details = [
    { label: caps.inputHelperReady ? "Teclado y mouse listos" : caps.inputHelperAvailable ? "Helper instalado; canal interactivo pendiente" : caps.unsignedRestrictedProduction ? "Helper deshabilitado por seguridad" : "Helper control pendiente", ok: Boolean(caps.inputHelperReady) || Boolean(caps.unsignedRestrictedProduction) },
    { label: caps.localPanelPort ? `Panel local ${caps.localPanelPort}` : "Panel local pendiente", ok: Boolean(caps.localPanelPort) },
    { label: caps.optimizedCapture ? "Captura optimizada activa" : "Captura optimizada pendiente", ok: Boolean(caps.optimizedCapture) },
    { label: caps.softwareInventory ? "Inventario de software disponible" : "Inventario de software pendiente", ok: Boolean(caps.softwareInventory) },
    { label: caps.securityEngine === "clamav" ? "Análisis ClamAV disponible" : "ClamAV pendiente de instalar", ok: caps.securityEngine === "clamav" },
    { label: unattendedLocked ? `Acceso bloqueado hasta ${formatDateTime(unattended.lockedUntil)}` : unattended.lastUsedAt ? `Último desatendido ${formatDateTime(unattended.lastUsedAt)}` : "Sin accesos desatendidos", ok: !unattendedLocked }
  ];
  return `
    <div class="agent-capabilities primary-capabilities">${primary.map((item) => `<span class="${item.ok ? "ok" : "warn"}">${escapeHtml(item.label)}</span>`).join("")}</div>
    <details class="action-menu full-width technical-details agent-details"><summary>Datos del equipo</summary><div class="agent-capabilities">${details.map((item) => `<span class="${item.ok ? "ok" : "warn"}">${escapeHtml(item.label)}</span>`).join("")}</div>${history.length ? `<div class="agent-name-history"><strong>Historial de nombres</strong>${history.map((entry) => `<span>${escapeHtml(entry.previousHostname)} → ${escapeHtml(entry.hostname)} · ${escapeHtml(formatDateTime(entry.changedAt))}</span>`).join("")}</div>` : ""}</details>
  `;
}

function renderAgentInventory(agent) {
  const applications = agent.inventory?.applications;
  const startup = agent.inventory?.startup;
  const security = agent.inventory?.security?.latest;
  const changeCount = (section) => Number(section?.changes?.added?.length ?? 0) + Number(section?.changes?.removed?.length ?? 0) + Number(section?.changes?.changed?.length ?? 0);
  const sample = (items, field) => (items ?? []).slice(0, 8).map((item) => `<li>${escapeHtml(item[field] || "Sin nombre")}${item.version ? ` <small>${escapeHtml(item.version)}</small>` : ""}</li>`).join("");
  return `<div class="agent-inventory"><div class="inventory-summary"><span>${applications ? `${applications.count} aplicaciones` : "Sin inventario de aplicaciones"}</span><span>${startup ? `${startup.count} programas de inicio` : "Sin inventario de inicio"}</span><span class="${changeCount(applications) + changeCount(startup) ? "warn" : "ok"}">${changeCount(applications) + changeCount(startup)} cambios recientes</span><span class="${security?.infected ? "danger" : security?.available ? "ok" : "warn"}">${security?.available ? `${security.infected ?? 0} detecciones` : "ClamAV sin validar"}</span></div>${applications?.items?.length ? `<details><summary>Aplicaciones instaladas</summary><ul>${sample(applications.items, "name")}</ul></details>` : ""}${startup?.items?.length ? `<details><summary>Programas al inicio</summary><ul>${sample(startup.items, "name")}</ul></details>` : ""}</div>`;
}
function labelResearchProvider(article) {
  const provider = String(article.provider ?? "");
  if (provider === "ai_consensus") return "Google + OpenAI";
  if (provider.startsWith("openai")) return "OpenAI";
  if (provider.startsWith("google")) return "Google AI";
  return provider ? "Investigacion externa" : "Conocimiento SAS";
}

function renderConsensusSummary(article) {
  const comparison = article.providerComparison;
  if (!comparison) return "";
  const tone = comparison.providerCount < 2 || !comparison.categoryAgreement ? "danger" : comparison.highRisk ? "warning" : "success";
  const title = comparison.providerCount < 2 ? "Comparacion incompleta" : comparison.categoryAgreement ? "Proveedores coinciden" : "Proveedores no coinciden";
  const detail = comparison.providerCount < 2
    ? "Solo un proveedor respondio; revisar antes de aprobar."
    : comparison.categoryAgreement
      ? `Categoría compartida: ${Object.values(comparison.categories ?? {})[0] ?? article.category}.`
      : `Google: ${comparison.categories?.google ?? "sin dato"} - OpenAI: ${comparison.categories?.openai ?? "sin dato"}.`;
  return `<div class="consensus-summary ${tone}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function renderResearchList(label, items) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  return values.length ? `<div class="research-list"><strong>${escapeHtml(label)}</strong><ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : "";
}

function renderResearchSafety(article) {
  if (!article.provider && !article.approvalRequired) return "";
  const privacy = article.privacy?.sanitized ? "Datos protegidos" : "Privacidad sin evidencia";
  const admin = article.adminRequired ? "Requiere administrador" : "Sin administrador declarado";
  return `<div class="research-safety ${article.adminRequired ? "warning" : "info"}"><span>${escapeHtml(labelResearchProvider(article))}</span><span>${escapeHtml(privacy)}</span><span>${escapeHtml(admin)}</span></div>`;
}
function renderKnowledge() {
  const metrics = state.reviewMetrics;
  const metricsHtml = metrics ? `<div class="metrics compact"><div class="metric"><strong>${metrics.pending}</strong><span>Pendientes*</span></div><div class="metric"><strong>${metrics.approved}</strong><span>Aprobadas</span></div><div class="metric"><strong>${metrics.rejected}</strong><span>Rechazadas</span></div><div class="metric"><strong>${metrics.averageScore}</strong><span>Score prom.*</span></div></div>` : "";
  document.querySelector("#knowledgeList").innerHTML = metricsHtml + (state.articles.slice().sort((a,b) => { const statusOrder = { pending_review: 0, approved: 1, rejected: 2 }; return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || Number(b.reviewScore ?? 0) - Number(a.reviewScore ?? 0); }).map((article) => {
    const citations = (article.citations ?? []).map((citation) => `<a href="${escapeHtml(citation.uri)}" target="_blank" rel="noreferrer">${escapeHtml(citation.title || citation.uri)}</a>`).join(" - ");
    const canApprove = article.status === "pending_review";
    const steps = article.resolutionSteps ?? [];
    const visibleSteps = steps.slice(0, 3);
    const hiddenSteps = steps.slice(3);
    const scoreLabel = article.reviewScore ? `Ranking* ${article.reviewScore}/100` : "Sin ranking";
    const recommendation = article.reviewRecommendation ?? "sin recomendacion";
    const providerLabel = labelResearchProvider(article);
    return `
      <article class="item knowledge-card status-${escapeHtml(statusClass(article.status ?? "approved"))}">
        <header><strong>${escapeHtml(article.title)}</strong><span class="badge status-${escapeHtml(statusClass(article.status ?? "approved"))}">${escapeHtml(labelStatus(article.status ?? "approved"))}</span></header>
        <div class="knowledge-meta">
          <span><strong class="knowledge-score">${escapeHtml(scoreLabel)}</strong></span>
          ${article.sourceTicketId ? `<span>Ticket ${escapeHtml(article.sourceTicketId)}</span>` : ""}
          <span>${escapeHtml(providerLabel)}</span>
        </div>
        ${renderConsensusSummary(article)}
        ${renderResearchSafety(article)}

        <ol class="knowledge-steps">${visibleSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
        ${canApprove ? `<div class="item-actions"><button data-approve-article="${article.id}">Aprobar</button><button class="secondary" data-reject-article="${article.id}">Rechazar</button></div>` : ""}
        <details class="action-menu full-width technical-details knowledge-details"><summary>Datos Fisher</summary>
          ${hiddenSteps.length ? `<p><strong>Mas pasos:</strong> ${hiddenSteps.map(escapeHtml).join(" - ")}</p>` : ""}
          ${renderResearchList("Prerrequisitos", article.prerequisites)}
          ${renderResearchList("Comprobaciones", article.diagnosticChecks)}
          ${renderResearchList("Reversion", article.rollbackSteps)}
          ${renderResearchList("Riesgos", article.riskNotes)}
          ${article.serviceImpact ? `<p><strong>Impacto:</strong> ${escapeHtml(article.serviceImpact)}</p>` : ""}
          ${article.researchSummary ? `<p>${escapeHtml(article.researchSummary)}</p>` : ""}
          <p><strong>Recomendacion:</strong> ${escapeHtml(recommendation)}</p>
          ${article.reviewSignals?.length ? `<p><strong>Senales:</strong> ${article.reviewSignals.map(escapeHtml).join(" - ")}</p>` : ""}
          ${article.reviewedBy ? `<p><strong>Revisión:</strong> ${escapeHtml(article.reviewedBy)} - ${escapeHtml(article.reviewNote ?? "sin nota")}</p>` : ""}
          ${citations ? `<p><strong>Fuentes:</strong> ${citations}</p>` : ""}
          ${(article.keywords ?? []).length ? `<p><strong>Claves:</strong> ${(article.keywords ?? []).map(escapeHtml).join(" - ")}</p>` : ""}
        </details>
      </article>
    `;
  }).join("") || emptyState("Sin soluciones todavia", "Fisher ira guardando respuestas aprobadas para reutilizarlas en proximos tickets.", "Resuelve un ticket y usa Aprender desde su detalle."));

  document.querySelectorAll("[data-approve-article]").forEach((button) => {
    button.addEventListener("click", () => reviewKnowledgeArticle(button.dataset.approveArticle, "approved"));
  });
  document.querySelectorAll("[data-reject-article]").forEach((button) => {
    button.addEventListener("click", () => reviewKnowledgeArticle(button.dataset.rejectArticle, "rejected"));
  });
}
async function reviewKnowledgeArticle(articleId, status) {
  const article = state.articles.find((item) => item.id === articleId);
  if (status === "approved" && (article?.approvalRequired || article?.provider)) {
    const accepted = window.confirm(`Vas a aprobar una propuesta de ${labelResearchProvider(article)}. Confirma que revisaste fuentes, riesgos, impacto y reversion.`);
    if (!accepted) return;
  }
  await apiFetch(`/api/knowledge/${articleId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, reviewNote: status === "approved" ? "Aprobado desde consola" : "Rechazado desde consola" })
  });
  showNotice(status === "approved" ? "Articulo aprobado para Fisher." : "Articulo rechazado.", "success");
  await refresh();
}

function authRequiredCard(area = "esta seccion") {
  return `
    <div class="auth-required-card">
      <strong>Sesión requerida</strong>
      <p>Inicia sesión con tu cuenta autorizada para cargar ${escapeHtml(area)}.</p>
      <small>Esto protege información operativa cuando SAS se usa fuera del laboratorio local.</small>
    </div>
  `;
}
function renderSystemStatus() {
  const container = document.querySelector("#systemStatus");
  if (!container) return;
  const storage = state.storage;
  if (!storage) {
    container.innerHTML = state.authRequired ? authRequiredCard("el estado del sistema") : empty("Sin datos de almacenamiento.");
    return;
  }

  const latestBackup = storage.latestBackup;
  const updatedAt = storage.updatedAt ? formatDateTime(storage.updatedAt) : "Sin archivo";
  const latestBackupAt = latestBackup?.createdAt ? formatDateTime(latestBackup.createdAt) : "Sin respaldo";
  const collections = storage.collections ?? {};
  const collectionRows = [
    ["Tickets", collections.tickets ?? 0],
    ["Sesiones", collections.remoteSessions ?? 0],
    ["Equipos", collections.agents ?? 0],
    ["Auditoría", collections.auditEvents ?? 0],
    ["Soluciones", collections.knowledgeArticles ?? 0]
  ];

  container.innerHTML = `
    <div class="system-summary">
      <div><strong>${escapeHtml(storage.exists ? "Base activa" : "Base pendiente")}</strong><span>${escapeHtml(formatBytes(storage.size ?? 0))}</span></div>
      <div><strong>${escapeHtml(String(storage.backupCount ?? 0))}</strong><span>Respaldos</span></div>
      <div><strong>${escapeHtml(labelStatus(state.health?.status ?? "sin conexión"))}</strong><span>Servidor</span></div>
    </div>
    <div class="system-paths">
      <small>Datos</small><code>${escapeHtml(storage.filePath ?? "sin ruta")}</code>
      <small>Backups</small><code>${escapeHtml(storage.backupDir ?? "sin ruta")}</code>
    </div>
    <div class="system-facts">
      <span>Actualizado: ${escapeHtml(updatedAt)}</span>
      <span>Último respaldo: ${escapeHtml(latestBackupAt)}</span>
    </div>
    <div class="audit-details system-counts">
      ${collectionRows.map(([label, value]) => `<span>${escapeHtml(label)}: ${escapeHtml(value)}</span>`).join("")}
    </div>
    <div class="item-actions"><button id="createBackup">Respaldar ahora</button></div>
  `;

  document.querySelector("#createBackup")?.addEventListener("click", createBackup);
}

function renderUpdates() {
  const container = document.querySelector("#updateStatus"); if (!container) return;
  const updates = state.updates;
  if (!updates) { container.innerHTML = empty("Estado de actualizaciones no disponible."); return; }
  const latest = updates.latest;
  const staged = updates.staged;
  const last = updates.lastResult;
  const rawSchedule = updates.lastSchedule;
  const schedule = rawSchedule && rawSchedule.targetVersion && updates.currentVersion && rawSchedule.targetVersion.split(".").map(Number).some((v,i)=>v > Number(updates.currentVersion.split(".")[i]||0)) ? rawSchedule : null;
  const available = latest?.available === true || Boolean(latest?.version && latest.version !== updates.currentVersion);
  const scheduling = ["requested", "validating", "registered", "started"].includes(schedule?.status);
  const selectedChannel = state.updateChannel ?? updates.channel ?? "stable";
  const scheduleLabels = {
    requested: "Solicitud recibida",
    validating: "Validando permisos y archivos",
    registered: "Tarea registrada",
    started: "Instalación iniciada",
    applying: "Aplicando actualización",
    completed: "Instalación completada",
    failed: "No se pudo iniciar la instalación"
  };
  container.innerHTML = `<article class="installation-card ${last?.status === "fail" || schedule?.status === "failed" ? "danger" : available ? "warning" : "safe"}">
    <header><div><strong>Actualizaciones de SAS</strong><label>Canal <select id="updateChannel"><option value="stable"${selectedChannel === "stable" ? " selected" : ""}>stable</option><option value="testing"${selectedChannel === "testing" ? " selected" : ""}>testing</option></select></label></div><span class="badge status-${available ? "warn" : "pass"}">${available ? "Disponible" : "Al día"}</span></header>
    <div class="system-facts"><span>Instalada: ${escapeHtml(updates.currentVersion)}</span><span>Disponible: ${escapeHtml(latest?.version ?? "Sin consultar")}</span><span>Firma: ${latest ? (latest.signatureValid ? "Verificada" : updates.signatureRequired ? "Requerida" : "SHA-256") : "Pendiente"}</span></div>
    ${latest?.notes?.length ? `<ul>${latest.notes.map(note=>`<li>${escapeHtml(note)}</li>`).join("")}</ul>` : ""}
    ${staged ? `<div class="safety-banner safe">Versión ${escapeHtml(staged.version)} descargada y verificada.</div>` : ""}
    ${schedule ? `<div class="safety-banner ${schedule.status === "failed" ? "danger" : scheduling ? "warning" : "safe"}">Programador: ${escapeHtml(scheduleLabels[schedule.status] ?? schedule.status)}${schedule.targetVersion ? ` para ${escapeHtml(schedule.targetVersion)}` : ""}${schedule.error ? `. ${escapeHtml(schedule.error)}` : ""}.</div>` : ""}
    ${last ? `<div class="safety-banner ${last.status === "pass" ? "safe" : "danger"}">Último resultado: ${last.status === "pass" ? "actualización correcta" : last.rolledBack ? "falló y se restauró la versión anterior" : "requiere revisión"}.${last.error ? ` ${escapeHtml(last.error)}` : ""}</div>${last.checks?.length ? `<details class="technical-details"><summary>Detalle del actualizador</summary><ul>${last.checks.map(check=>`<li><strong>${escapeHtml(check.name ?? "comprobación")}</strong>: ${escapeHtml(check.status ?? "unknown")} — ${escapeHtml(check.message ?? "Sin detalle")}</li>`).join("")}</ul></details>` : ""}` : ""}
    <div class="item-actions"><button class="secondary" id="checkUpdates" type="button">Buscar actualización</button>${available && !staged ? '<button id="stageUpdate" type="button">Descargar y verificar</button>' : ""}${staged && updates.applyEnabled && !scheduling ? '<button id="applyUpdate" type="button">Instalar actualización</button>' : ""}${staged ? '<button class="secondary" id="resetUpdate" type="button">Reiniciar flujo</button>' : ""}</div>
    <small>La instalación crea un respaldo y revierte automáticamente si el servidor no recupera su salud.</small>
  </article>`;
  document.querySelector("#checkUpdates")?.addEventListener("click", checkUpdates);
  document.querySelector("#updateChannel")?.addEventListener("change", (event)=>{ state.updateChannel=event.target.value; state.updates={...state.updates,latest:null,staged:null}; renderUpdates(); });
  document.querySelector("#stageUpdate")?.addEventListener("click", stageUpdate);
  document.querySelector("#applyUpdate")?.addEventListener("click", applyUpdate); document.querySelector("#resetUpdate")?.addEventListener("click", resetUpdate);
}
async function resetUpdate(){ try { showNotice("Reiniciando flujo de actualización...","info"); const result=await apiFetch("/api/admin/updates/reset",{method:"POST",body:JSON.stringify({})}); state.updates=result.updates; showNotice(result.message,"success"); renderUpdates(); } catch(error) { showNotice(error.message,"error"); } } async function checkUpdates(){
  try {
    showNotice("Consultando el canal de actualizaciones...","info");
    const result=await apiFetch("/api/admin/updates/check",{method:"POST",body:JSON.stringify({channel:state.updateChannel??state.updates?.channel??"stable"})});
    state.updates=result.updates;
    showNotice(result.release?.available?`SAS ${result.release.version} está disponible.`:"SAS ya está actualizado.",result.release?.available?"warning":"success");
    renderUpdates();
  } catch(error) { showNotice(error.message,"error"); }
}
async function stageUpdate(){
  if(!window.confirm("Se descargará la actualización y se verificará su integridad. Todavía no se reiniciará SAS. ¿Continuar?")) return;
  try {
    showNotice("Descargando y verificando actualización...","info");
    const result=await apiFetch("/api/admin/updates/stage",{method:"POST",body:JSON.stringify({channel:state.updateChannel??state.updates?.channel??"stable"})});
    state.updates=result.updates;
    showNotice("Actualización preparada correctamente.","success");
    renderUpdates();
  } catch(error) { showNotice(error.message,"error"); }
}
async function applyUpdate(){
  const version=state.updates?.staged?.version;
  if(!version) return;
  const confirmation=await requestUpdateConfirmation(version);
  if(!confirmation) return;
  try {
    const result=await apiFetch("/api/admin/updates/apply",{method:"POST",body:JSON.stringify({version,confirm:confirmation})});
    state.updates=result.updates ?? state.updates;
    showNotice(result.message ?? "Actualización programada. SAS se reiniciará y volverá automáticamente.","success");
    renderUpdates();
  } catch(error) { showNotice(error.message,"error"); }
}
function requestUpdateConfirmation(version){
  const dialog=document.querySelector("#updateConfirmDialog");
  const form=document.querySelector("#updateConfirmForm");
  const input=document.querySelector("#updateConfirmInput");
  const phrase=document.querySelector("#updateConfirmPhrase");
  const error=document.querySelector("#updateConfirmError");
  const accept=document.querySelector("#acceptUpdateConfirm");
  const cancel=document.querySelector("#cancelUpdateConfirm");
  const expected=`ACTUALIZAR ${version}`;
  if(!dialog||!form||!input||!phrase||!error||!accept||!cancel||typeof dialog.showModal!=="function"){
    showNotice("Este navegador no puede mostrar la confirmación segura. Actualiza el navegador e inténtalo nuevamente.","error");
    return Promise.resolve(null);
  }
  phrase.textContent=expected;
  input.value="";
  error.textContent="";
  accept.disabled=true;
  return new Promise((resolve)=>{
    const finish=(value)=>{if(dialog.open)dialog.close();resolve(value);};
    input.oninput=()=>{const matches=input.value.trim()===expected;accept.disabled=!matches;error.textContent=input.value&&!matches?`Escribe exactamente: ${expected}`:"";};
    form.onsubmit=(event)=>{event.preventDefault();if(input.value.trim()!==expected){error.textContent=`Escribe exactamente: ${expected}`;return;}finish(expected);};
    cancel.onclick=()=>finish(null);
    dialog.oncancel=(event)=>{event.preventDefault();finish(null);};
    dialog.showModal();
    input.focus();
  });
}
async function createBackup() {
  const payload = await apiFetch("/api/admin/backup", { method: "POST" });
  state.storage = payload.storage ?? state.storage;
  showNotice("Respaldo creado correctamente.", "success");
  await refresh();
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function renderRepairOutcomes() {
  const container = document.querySelector("#repairOutcomes");
  if (!container) return;
  const payload = state.repairOutcomes;
  if (!payload || payload.authRequired) {
    container.innerHTML = state.authRequired ? authRequiredCard("los resultados de reparaciones") : empty("Sin resultados de reparaciones.");
    return;
  }

  const outcomes = (payload.outcomes ?? []).slice(0, 5);
  if (!outcomes.length) {
    container.innerHTML = empty("Sin reparaciones registradas.");
    return;
  }

  container.innerHTML = `
    <div class="install-panel">
      <div class="install-head"><strong>Reparaciones recientes</strong><span>${escapeHtml(String(outcomes.length))} recientes</span></div>
      <div class="item-actions compact-actions"><button class="secondary" id="createRepairKnowledge">Crear solución</button></div>
      <div class="install-list">
        ${outcomes.map((item) => `
          <article class="install-card ${escapeHtml(item.status ?? "unknown")}">
            <header><strong>${escapeHtml(item.actionTitle || item.actionId)}</strong><span>${escapeHtml(labelRepairResolution(item.resolution))}</span></header>
            <small>${escapeHtml(item.status)} - ${escapeHtml(formatDateTime(item.createdAt))}</small>
            <div class="audit-details">
              <span>Ticket ${escapeHtml(item.ticketId || "sin ticket")}</span>
              <span>${escapeHtml(item.simulated ? "Simulada" : "Real")}</span>
              ${item.error ? `<span>Error: ${escapeHtml(item.error)}</span>` : ""}
            </div>
            <div class="item-actions compact-actions">
              <button class="secondary" data-repair-feedback="${escapeHtml(item.id)}" data-resolution="resolved">Funciono</button>
              <button class="secondary" data-repair-feedback="${escapeHtml(item.id)}" data-resolution="unresolved">No funciono</button>
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `;
  container.querySelector("#createRepairKnowledge")?.addEventListener("click", createRepairKnowledgeProposals);
  container.querySelectorAll("[data-repair-feedback]").forEach((button) => {
    button.addEventListener("click", () => confirmRepairOutcome(button.dataset.repairFeedback, button.dataset.resolution));
  });
}

async function createRepairKnowledgeProposals() {
  const result = await apiFetch("/api/repair-outcomes/knowledge-proposals", {
    method: "POST",
    body: JSON.stringify({ minConfirmed: 2, minResolutionRate: 0.75 })
  });
  const count = result.articles?.length ?? 0;
  showNotice(count ? `${count} propuesta(s) enviada(s) a revisión.` : "No hay reparaciones con suficiente confirmacion para proponer.", count ? "success" : "info");
  await refresh();
}
function labelRepairResolution(value) {
  return ({ resolved: "Funciono", unresolved: "No funciono", unknown: "Sin confirmar" })[value] ?? "Sin confirmar";
}

async function confirmRepairOutcome(outcomeId, resolution) {
  await apiFetch(`/api/repair-outcomes/${outcomeId}`, {
    method: "PATCH",
    body: JSON.stringify({ resolution })
  });
  showNotice(resolution === "resolved" ? "Reparación marcada como resuelta." : "Reparación marcada como no resuelta.", "success");
  await refresh();
}
function renderReleaseGate() {
  const container = document.querySelector("#releaseGate");
  if (!container) return;
  const gate = state.releaseGate;
  if (!gate) {
    container.innerHTML = state.authRequired ? authRequiredCard("el semáforo de producción") : empty("Sin semáforo de producción.");
    return;
  }

  const actions = gate.nextActions ?? [];
  const history = state.productionTrafficHistory ?? [];
  container.innerHTML = `
    <div class="release-gate-card ${escapeHtml(gate.decision ?? "blocked")}">
      <div class="release-gate-head">
        <div><strong>${escapeHtml(gate.label ?? "Semáforo de producción")}</strong><span>${escapeHtml((gate.productionAllowed ?? gate.mvpAllowed) ? "Producción permitida" : "Producción bloqueada")}</span></div>
        <span>${escapeHtml(String(gate.summary?.blockers ?? 0))} bloqueos</span>
      </div>
      ${actions.length ? `<div class="release-gate-actions">${actions.slice(0, 3).map((item) => renderReleaseGateAction(item)).join("")}</div>` : `<p>Sin acciones inmediatas.</p>`}
      ${history.length ? `<details class="action-menu full-width traffic-history"><summary>Historial del semáforo (${history.length})</summary><div class="traffic-history-list">${history.map((item) => renderTrafficHistoryItem(item)).join("")}</div></details>` : ""}
    </div>
  `;
}

function renderTrafficHistoryItem(item) {
  return `
    <article class="traffic-history-item ${escapeHtml(item.decision ?? "ready_with_warnings")}">
      <header><strong>${escapeHtml(item.label ?? "Sin decision")}</strong><span>${escapeHtml(formatDateTime(item.generatedAt))}</span></header>
      <small>${escapeHtml(item.productionAllowed ? "Producción permitida" : "Producción bloqueada")} - ${escapeHtml(String(item.blockers ?? 0))} bloqueos - ${escapeHtml(String(item.warnings ?? 0))} avisos</small>
    </article>
  `;
}
function renderReleaseGateAction(item) {
  return `
    <article class="release-action priority-${escapeHtml(String(item.severity ?? "Baja").toLowerCase())}">
      <header><span>${escapeHtml(item.severity ?? "Baja")}</span><strong>${escapeHtml(item.label ?? "Pendiente")}</strong></header>
      <p>${escapeHtml(item.action ?? "Revisar pendiente.")}</p>
      <small>${escapeHtml(item.source ?? "Producción")} - ${escapeHtml(item.owner ?? "Técnico")}${item.command ? ` - ${escapeHtml(item.command)}` : ""}</small>
    </article>
  `;
}
function renderProductionReadiness() {
  const container = document.querySelector("#productionReadiness");
  if (!container) return;
  const readiness = state.readiness;
  if (!readiness) {
    container.innerHTML = state.authRequired ? authRequiredCard("la preparación de producción") : empty("Sin evaluación de producción.");
    return;
  }

  const checks = readiness.checks ?? [];
  const nextSteps = readiness.nextSteps ?? (readiness.nextActions ?? []).map((action) => ({ title: "Pendiente", action, owner: "Técnico", priority: "Media" }));
  container.innerHTML = `
    <div class="readiness-head ${escapeHtml(readiness.mvpStatus ?? readiness.status ?? "warn")}">
      <div><strong>${escapeHtml(String(readiness.mvpPercent ?? readiness.percent ?? 0))}%</strong><span>Producción inicial</span></div>
      <p>${escapeHtml(readiness.mvpStatus === "pass" && readiness.summary?.warn ? "Usable con pendientes" : readiness.summary?.fail ? "Bloqueos pendientes" : readiness.summary?.warn ? "Avisos pendientes" : "Listo para producción controlada")}</p>
      <small>Total ${escapeHtml(String(readiness.percent ?? 0))}%</small>
    </div>
    ${nextSteps.length ? `
      <div class="readiness-next">
        <strong>Siguiente paso</strong>
        ${nextSteps.map((step) => `
          <article class="readiness-step priority-${escapeHtml(String(step.priority ?? "Media").toLowerCase())}">
            <header><span>${escapeHtml(step.priority ?? "Media")}</span><strong>${escapeHtml(step.title ?? "Pendiente")}</strong></header>
            <p>${escapeHtml(step.action ?? "Revisar pendiente.")}</p>
            <small>${escapeHtml(step.owner ?? "Técnico")}</small>
          </article>
        `).join("")}
      </div>
    ` : ""}
    <div class="readiness-checks">
      ${checks.map((item) => `
        <div class="readiness-check ${escapeHtml(item.status)}">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(labelStatus(item.status))} - ${escapeHtml(labelReadinessTier(item.tier))}</span>
        </div>
      `).join("")}
    </div>
  `;
}
function labelReadinessTier(tier) {
  const labels = {
    required: "Requerido",
    recommended: "Recomendado",
    optional: "Opcional"
  };
  return labels[tier] ?? "Recomendado";
}
function renderInstallations() {
  const container = document.querySelector("#installationStatus");
  if (!container) return;
  const report = state.installations;
  if (!report) {
    container.innerHTML = state.authRequired ? authRequiredCard("la evidencia de instalación") : empty("Sin evidencia de instalación.");
    return;
  }

  const installations = report.installations ?? [];
  container.innerHTML = `
    <div class="install-panel">
      <div class="install-head">
        <strong>Instalaciones</strong>
        <span>${escapeHtml(String(report.summary?.missing ?? 0))} pendientes</span>
      </div>
      <div class="install-list">
        ${installations.map((item) => renderInstallationItem(item)).join("")}
      </div>
    </div>
  `;
}

function renderInstallationItem(item) {
  const summary = item.checkSummary ?? {};
  const flags = [
    item.unsignedRestrictedProduction ? "Producción restringida" : null,
    item.consoleTokenConfigured ? "Token consola" : null,
    item.generatedSecrets?.length ? `Secretos: ${item.generatedSecrets.length}` : null
  ].filter(Boolean);
  const checks = (item.checks ?? []).slice(0, 4).map((check) => `<span>${escapeHtml(check.name)}: ${escapeHtml(labelStatus(check.status))}</span>`).join("");
  const statusLabel = item.exists ? labelStatus(item.status) : "Sin manifest";

  return `
    <article class="install-card ${escapeHtml(item.status ?? "missing")}">
      <header><strong>${escapeHtml(item.label ?? item.role)}</strong><span>${escapeHtml(statusLabel)}</span></header>
      <small>${escapeHtml(item.installPath ?? "sin ruta")}</small>
      <div class="audit-details">
        <span>Correctos: ${escapeHtml(summary.pass ?? 0)}</span>
        <span>Avisos: ${escapeHtml(summary.warn ?? 0)}</span>
        <span>Errores: ${escapeHtml(summary.fail ?? 0)}</span>
        ${flags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join("")}
      </div>
      ${checks ? `<div class="audit-details install-checks">${checks}</div>` : ""}
    </article>
  `;
}
function renderProductionOperations() {
  const container = document.querySelector("#productionOperations");
  if (!container) return;
  const operations = state.operations;
  if (!operations) {
    container.innerHTML = state.authRequired ? authRequiredCard("el centro de operación") : empty("Sin reportes operativos.");
    return;
  }

  const summary = operations.summary ?? {};
  const reports = operations.reports ?? [];
  const nextActions = operations.nextActions ?? [];
  const actionPlan = operations.actionPlan ?? [];
  container.innerHTML = `
    <div class="install-panel operations-panel">
      <div class="install-head operations-head ${escapeHtml(operations.status ?? "warn")}">
        <div><strong>Operación diaria</strong><span>${escapeHtml(labelStatus(operations.status ?? "warn"))}</span></div>
        <span>${escapeHtml(String(summary.pass ?? 0))}/${escapeHtml(String(summary.total ?? reports.length))} listos</span>
      </div>
      ${actionPlan.length ? `<div class="operations-actions">${actionPlan.slice(0, 4).map((item) => renderOperationAction(item)).join("")}</div>` : nextActions.length ? `<div class="operations-next">${nextActions.map((item) => `<span>${escapeHtml(item.label)}: ${escapeHtml(item.action)}</span>`).join("")}</div>` : ""}
      <div class="install-list">
        ${reports.map((report) => renderOperationReport(report)).join("")}
      </div>
    </div>
  `;
}

function renderOperationAction(item) {
  return `
    <article class="operation-action priority-${escapeHtml(String(item.severity ?? "Baja").toLowerCase())}">
      <header><span>${escapeHtml(item.severity ?? "Baja")}</span><strong>${escapeHtml(item.label ?? "Pendiente")}</strong></header>
      <p>${escapeHtml(item.action ?? "Revisar pendiente.")}</p>
      <small>${escapeHtml(item.owner ?? "Técnico")}${item.command ? ` - ${escapeHtml(item.command)}` : ""}</small>
    </article>
  `;
}
function renderOperationReport(report) {
  const when = report.generatedAt ? formatDateTime(report.generatedAt) : "Sin fecha";
  return `
    <article class="install-card operation-card ${escapeHtml(report.status ?? "warn")}">
      <header><strong>${escapeHtml(report.label ?? report.key)}</strong><span>${escapeHtml(labelStatus(report.status ?? "warn"))}</span></header>
      <small>${escapeHtml(report.required ? "Requerido" : "Opcional")} - ${escapeHtml(when)} - ${escapeHtml(report.freshness?.label ?? "Sin vigencia")}</small>
      <div class="audit-details">
        <span>${escapeHtml(report.summary ?? "Sin resumen")}</span>
        <span>${escapeHtml(report.nextAction ?? "Sin acción inmediata")}</span>
      </div>
    </article>
  `;
}
function renderAudit() {
  const filter = state.auditFilter ?? "all";
  const filterControl = document.querySelector("#auditFilter");
  if (filterControl) filterControl.value = filter;
  if (state.auditLoading) {
    document.querySelector("#auditList").innerHTML = `<div class="audit-loading"><strong>Cargando eventos...</strong><small>Actualizando el Registro con el filtro seleccionado.</small></div>`;
    return;
  }
  const events = state.audit;
  const visibleEvents = events.slice(0, 6);
  const hiddenEvents = events.slice(6);
  const securityHtml = renderAuditSecuritySummary(state.audit);
  const visibleHtml = visibleEvents.map(renderAuditCard).join("");
  const hiddenHtml = hiddenEvents.length ? `
    <details class="action-menu full-width audit-history"><summary>Ver eventos anteriores (${hiddenEvents.length})</summary>
      ${hiddenEvents.slice(0, 40).map(renderAuditCard).join("")}
      ${hiddenEvents.length > 40 ? `<div class="remote-waiting"><span>Exporta CSV/JSON para revisar el historial completo.</span></div>` : ""}
    </details>
  ` : "";
  const emptyMessage = auditEmptyMessage(filter);
  document.querySelector("#auditList").innerHTML = securityHtml + visibleHtml + hiddenHtml || empty(emptyMessage);
}

function auditEmptyMessage(filter) {
  const messages = {
    security: "Sin eventos de seguridad visibles",
    remote: "Sin eventos remotos visibles",
    tickets: "Sin eventos de tickets visibles"
  };
  return messages[filter] ?? "Sin eventos visibles para este rol";
}
function renderAuditSecuritySummary(events) {
  const denied = events.filter((event) => event.action === "auth.denied");
  if (!denied.length) return "";
  const latest = denied[0];
  const reason = labelAuthDeniedReason(latest.metadata?.reason);
  return `
    <div class="audit-security-summary">
      <div><strong>${escapeHtml(String(denied.length))}</strong><span>Acceso(s) denegado(s)</span></div>
      <p>${escapeHtml(reason)} - último ${escapeHtml(formatDateTime(latest.createdAt))}</p>
    </div>
  `;
}

function renderAuditCard(event) {
  const summary = describeAuditEvent(event);
  return `
    <article class="item audit-card ${escapeHtml(summary.kind ?? "normal")}">
      <header><strong>${escapeHtml(summary.title)}</strong><span class="badge status-${escapeHtml(statusClass(event.actorRole))}">${escapeHtml(labelAuditActor(event.actorRole))}</span></header>
      <p>${escapeHtml(summary.body)}</p>
      ${summary.details.length ? `<div class="audit-details">${summary.details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join("")}</div>` : ""}
      <small>${escapeHtml(formatDateTime(event.createdAt))}</small>
    </article>
  `;
}
function describeAuditEvent(event) {
  const metadata = event.metadata ?? {};
  const actionLabels = {
    "admin.backup": "Respaldo creado",
    "system.update_checked": "Actualizaci?n consultada",
    "system.update_staged": "Actualizaci?n verificada",
    "system.update_scheduled": "Actualizaci?n programada",
    "auth.denied": "Acceso denegado",
    "console.auth.login": "Sesión web iniciada",
    "console.auth.failed": "Inicio web rechazado",
    "console.auth.refresh": "Sesión web renovada",
    "console.auth.password_changed": "Contrasena web actualizada",
    "console.auth.logout": "Sesión web cerrada",
    "agent.diagnose": "Fisher diagnostico ticket",
    "agent.register": "Equipo conectado",
    "agent.hostname_changed": "Nombre de equipo actualizado",
    "agent.unattended.enabled": "Acceso desatendido habilitado",
    "agent.unattended.disabled": "Acceso desatendido deshabilitado",
    "remote.unattended.approved": "Acceso desatendido autorizado",
    "remote.unattended.denied": "Acceso desatendido rechazado",
    "google_ai.research_ticket": "Investigacion IA creada",
    "knowledge.create": "Solución creada",
    "knowledge.learn_from_ticket": "Fisher aprendió resolución",
    "knowledge.update": "Solución actualizada",
    "remote.assign_agent": "Equipo asignado",
    "remote.pair_agent": "Equipo vinculado por código",
    "remote.close": "Sesión remota cerrada",
    "remote.close.agent_local_stop": "Sesión detenida desde cliente",
    "remote.close.customer": "Sesión cerrada por cliente",
    "remote.close.unattended_policy_changed": "Sesión cerrada por cambio de acceso desatendido",
    "remote.command.queue": "Comando remoto enviado",
    "remote.command.result": "Resultado de comando recibido",
    "remote.consent.approved": "Cliente aprobo soporte",
    "remote.consent.rejected": "Cliente rechazo soporte",
    "remote.control.approved": "Cliente aprobo control",
    "remote.control.rejected": "Cliente rechazo control",
    "remote.control.request": "Teclado y mouse solicitado",
    "remote.event.queue": "Evento de control enviado",
    "remote.event.result": "Resultado de control recibido",
    "remote.request": "Sesión remota creada",
    "remote.screen.start": "Vista en vivo iniciada",
    "remote.screen.stop": "Vista en vivo detenida",
    "remote.start": "Soporte remoto iniciado",
    "server.boot": "Servidor iniciado",
    "ticket.create": "Ticket creado",
    "ticket.note": "Nota agregada",
    "ticket.update": "Ticket actualizado",
    "whatsapp.message": "Mensaje WhatsApp recibido",
    "whatsapp.simulate": "WhatsApp simulado"
  };
  const title = actionLabels[event.action] ?? event.action;
  const entity = labelAuditEntity(event.entityType, event.entityId);
  const details = summarizeAuditMetadata(metadata);
  const body = event.action === "auth.denied" ? labelAuthDeniedReason(metadata.reason) : entity ? `${entity}` : "Evento del sistema";
  const kind = event.action === "auth.denied" ? "security-event" : "normal";
  return { title, body, details, kind };
}
function labelAuditEntity(type, id) {
  const labels = {
    agent: "Equipo",
    mobile_device: "Dispositivo",
    mobile_user: "Usuario",
    knowledge: "Solución",
    remote_session: "Sesión remota",
    system: "Sistema",
    ticket: "Ticket"
  };
  const label = labels[type] ?? type;
  return id ? `${label} ${id}` : label;
}

function labelAuditActor(role) {
  const labels = {
    admin: "Admin",
    ai_agent: "Fisher",
    supervisor: "Supervisor",
    system: "Sistema",
    technician: "Técnico",
    viewer: "Consulta"
  };
  return labels[role] ?? role ?? "Sistema";
}

function labelAuthDeniedReason(reason) {
  const labels = {
    console_token_required: "Sesión sin token válido (caducado o ausente)",
    permission_denied: "Rol autenticado sin permiso para esta acción"
  };
  return labels[reason] ?? "Acceso bloqueado";
}

function summarizeAuditMetadata(metadata) {
  const pairs = [
    ["reason", "Motivo", labelAuthDeniedReason],
    ["permission", "Permiso"],
    ["method", "Metodo"],
    ["path", "Ruta"],
    ["joinCode", "Código"],
    ["status", "Estado", labelStatus],
    ["type", "Tipo"],
    ["command", "Comando"],
    ["category", "Categoría"],
    ["agentId", "Agente"],
    ["previousHostname", "Nombre anterior"],
    ["hostname", "Nombre actual"],
    ["changedAt", "Detectado", formatDateTime],
    ["accessMode", "Modalidad", (value) => value === "unattended" ? "Desatendido" : "Atendido"],
    ["allowControl", "Teclado y mouse", (value) => value ? "Permitidos" : "Bloqueados"],
    ["attemptsRemaining", "Intentos restantes"],
    ["lockedUntil", "Bloqueado hasta", formatDateTime],
    ["ipAddress", "IP"],
    ["lockedReason", "Bloqueo"],
    ["simulated", "Simulado", (value) => value ? "Si" : "No"],
    ["executed", "Ejecutado", (value) => value ? "Si" : "No"],
    ["helper", "Helper"],
    ["attempts", "Intentos"],
    ["quality", "Calidad"],
    ["intervalSeconds", "Intervalo"],
    ["maxWidth", "Ancho"],
    ["httpPort", "HTTP"],
    ["httpsPort", "HTTPS"]
  ];

  return pairs.flatMap(([key, label, formatter]) => {
    const value = metadata?.[key];
    if (value === undefined || value === null || value === "") return [];
    const formatted = formatter ? formatter(value) : value;
    return [`${label}: ${formatted}`];
  }).slice(0, 6);
}

function initializeReportFilters(){const today=new Date();const from=new Date(today);from.setDate(from.getDate()-29);state.reportFilters={from:localDateInput(from),to:localDateInput(today),status:"all",priority:"all",source:"all",equipmentId:"all",technicianId:"all"};syncReportFilterControls();}

function localDateInput(value){const year=value.getFullYear();const month=String(value.getMonth()+1).padStart(2,"0");const day=String(value.getDate()).padStart(2,"0");return `${year}-${month}-${day}`;}

function syncReportFilterControls(){const mapping={reportFrom:"from",reportTo:"to",reportStatus:"status",reportPriority:"priority",reportSource:"source",reportEquipment:"equipmentId",reportTechnician:"technicianId"};for(const [id,key] of Object.entries(mapping)){const input=document.querySelector(`#${id}`);if(input&&state.reportFilters?.[key]!==undefined)input.value=state.reportFilters[key];}}

function readReportFilterControls(){return{from:document.querySelector("#reportFrom")?.value||state.reportFilters?.from,to:document.querySelector("#reportTo")?.value||state.reportFilters?.to,status:document.querySelector("#reportStatus")?.value||"all",priority:document.querySelector("#reportPriority")?.value||"all",source:document.querySelector("#reportSource")?.value||"all",equipmentId:document.querySelector("#reportEquipment")?.value||"all",technicianId:document.querySelector("#reportTechnician")?.value||"all"};}

function reportQuery(filters=state.reportFilters){const params=new URLSearchParams();for(const [key,value] of Object.entries(filters??{})){if(value!==undefined&&value!==null&&value!=="")params.set(key,value);}return params.toString();}

async function refreshReports(showFeedback=false){if(state.reportLoading)return;state.reportLoading=true;renderReports();try{const body=await apiFetch(`/api/reports/tickets?${reportQuery()}`);state.report=body.report??null;state.reportFilters=state.report?.filters??state.reportFilters;syncReportFilterControls();if(showFeedback)showNotice("Dashboard actualizado.","success");}finally{state.reportLoading=false;renderReports();}}

async function applyReportFilters(){state.reportFilters=readReportFilterControls();document.querySelectorAll("[data-report-days]").forEach((button)=>button.classList.remove("active"));await refreshReports(true);}

async function setReportPeriod(days){const today=new Date();const from=new Date(today);from.setDate(from.getDate()-Math.max(1,days-1));state.reportFilters={...readReportFilterControls(),from:localDateInput(from),to:localDateInput(today)};syncReportFilterControls();document.querySelectorAll("[data-report-days]").forEach((button)=>button.classList.toggle("active",Number(button.dataset.reportDays)===days));await refreshReports();}

async function exportTicketReport(){const button=document.querySelector("#exportTicketReport");setButtonLoading(button,true,"Preparando...");try{const response=await authenticatedFetch(`/api/reports/tickets/export?${reportQuery()}`);if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error??`HTTP ${response.status}`);}const blob=await response.blob();const disposition=response.headers.get("Content-Disposition")??"";const filename=disposition.match(/filename="?([^";]+)"?/i)?.[1]??"sas-reporte-tickets.csv";const objectUrl=URL.createObjectURL(blob);const link=document.createElement("a");link.href=objectUrl;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(objectUrl);showNotice("Reporte CSV exportado con los filtros actuales.","success");}catch(error){showNotice(error.message??"No fue posible exportar el reporte.","error");}finally{setButtonLoading(button,false);}}

function renderReports(){const summary=document.querySelector("#reportSummary");if(!summary)return;if(state.reportLoading&&!state.report){summary.innerHTML='<div class="report-loading"><span class="button-spinner"></span><strong>Calculando indicadores...</strong></div>';return;}if(!state.report){summary.innerHTML=empty("Abre Reportes para calcular el dashboard.");return;}const report=state.report;populateReportOptions(report.options);const cards=[{label:"Tickets creados",value:report.summary.created,hint:"Entrada durante el periodo",tone:"info"},{label:"Tickets cerrados",value:report.summary.closed,hint:"Cierre manual documentado",tone:"success"},{label:"Backlog actual",value:report.summary.activeBacklog,hint:"Todavía requieren seguimiento",tone:report.summary.activeBacklog?"warning":"success"},{label:"Mediana de resolución",value:reportMetric(report.summary.medianResolutionHours," h"),hint:`${report.coverage.resolutionMeasured} de ${report.coverage.resolutionEligible} medibles`,tone:report.summary.medianResolutionHours===null?"neutral":"info"},{label:"P90 de resolución",value:reportMetric(report.summary.p90ResolutionHours," h"),hint:"90 % terminó antes de este tiempo",tone:"info"},{label:"Primera respuesta",value:reportMetric(report.summary.medianFirstResponseMinutes," min"),hint:`${report.coverage.firstResponseMeasured} de ${report.coverage.firstResponseEligible} medibles`,tone:"info"},{label:"Objetivo de resolución",value:reportPercent(report.summary.resolutionTargetRate),hint:`≤ ${report.filters.resolutionTargetHours} horas`,tone:report.summary.resolutionTargetRate!==null&&report.summary.resolutionTargetRate>=80?"success":"warning"},{label:"Documentación completa",value:reportPercent(report.summary.documentationRate),hint:"Diagnóstico, acciones y resultado",tone:report.summary.documentationRate===100?"success":"warning"}];summary.innerHTML=cards.map((card)=>`<article class="report-kpi ${escapeHtml(card.tone)}"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.hint)}</small></article>`).join("");const freshness=document.querySelector("#reportFreshness");if(freshness)freshness.innerHTML=`<span>Periodo: <strong>${escapeHtml(report.filters.from)}</strong> a <strong>${escapeHtml(report.filters.to)}</strong></span><span>Calculado: ${escapeHtml(formatDateTime(report.generatedAt))}</span>`;renderReportCoverage(report);renderTrendChart(report.trend);renderBarChart("#reportStatusChart",report.distributions.status,(item)=>labelStatus(item.label),"status");renderBarChart("#reportPriorityChart",report.distributions.priority,(item)=>labelStatus(item.label),"priority");renderBarChart("#reportSourceChart",report.distributions.source,(item)=>sourceLabel(item.label),"source");renderBarChart("#reportEquipmentChart",report.distributions.equipment,(item)=>item.label,"equipment");renderBarChart("#reportTechnicianChart",report.distributions.technician,(item)=>item.label,"technician");renderReportBacklog(report);renderRemoteReportMetrics(report.remote);renderReportDetails(report.details);}

function populateReportOptions(options={}){const definitions=[["#reportSource",options.sources??[],"Todos los canales",(item)=>sourceLabel(item.label)],["#reportEquipment",options.equipment??[],"Todos los equipos",(item)=>item.label],["#reportTechnician",options.technicians??[],"Todos los técnicos",(item)=>item.label]];for(const [selector,items,allLabel,formatter] of definitions){const select=document.querySelector(selector);if(!select)continue;const current=select.value||"all";select.innerHTML=`<option value="all">${escapeHtml(allLabel)}</option>${items.map((item)=>`<option value="${escapeHtml(item.value)}">${escapeHtml(formatter(item))}</option>`).join("")}`;select.value=items.some((item)=>item.value===current)?current:"all";}}

function renderReportCoverage(report){const container=document.querySelector("#reportCoverage");if(!container)return;const resolutionComplete=report.coverage.resolutionEligible===report.coverage.resolutionMeasured;const responseComplete=report.coverage.firstResponseEligible===report.coverage.firstResponseMeasured;container.className=`report-coverage ${resolutionComplete&&responseComplete?"complete":"partial"}`;container.innerHTML=`<div><strong>${resolutionComplete&&responseComplete?"Cobertura completa":"Cobertura parcial de datos"}</strong><span>${escapeHtml(report.definitions.resolution)}</span></div><div class="coverage-badges"><span>Resolución ${report.coverage.resolutionMeasured}/${report.coverage.resolutionEligible}</span><span>Primera respuesta ${report.coverage.firstResponseMeasured}/${report.coverage.firstResponseEligible}</span></div>`;}

function reportMetric(value,suffix=""){return value===null||value===undefined?"Sin datos":`${value}${suffix}`;}

function reportPercent(value){return value===null||value===undefined?"Sin datos":`${value}%`;}

function renderTrendChart(rows=[]){const container=document.querySelector("#reportTrend");if(!container)return;if(!rows.length||!rows.some((row)=>row.created||row.closed)){container.innerHTML=empty("No hay actividad registrada en este periodo.");return;}const width=760,height=230,padding={left:40,right:16,top:18,bottom:34},plotWidth=width-padding.left-padding.right,plotHeight=height-padding.top-padding.bottom,max=Math.max(1,...rows.flatMap((row)=>[row.created,row.closed]));const coords=(row,index,key)=>{const x=padding.left+(rows.length===1?plotWidth/2:index/(rows.length-1)*plotWidth);const y=padding.top+plotHeight-row[key]/max*plotHeight;return{x,y};};const createdPoints=rows.map((row,index)=>{const p=coords(row,index,"created");return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(" ");const closedPoints=rows.map((row,index)=>{const p=coords(row,index,"closed");return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;}).join(" ");const labelStep=Math.max(1,Math.ceil(rows.length/6));const grid=[0,.25,.5,.75,1].map((ratio)=>{const y=padding.top+plotHeight-ratio*plotHeight;return `<line x1="${padding.left}" x2="${width-padding.right}" y1="${y}" y2="${y}" class="chart-grid-line"/><text x="${padding.left-8}" y="${y+4}" text-anchor="end">${Math.round(max*ratio)}</text>`;}).join("");const labels=rows.map((row,index)=>index%labelStep===0||index===rows.length-1?`<text x="${coords(row,index,"created").x}" y="${height-9}" text-anchor="middle">${escapeHtml(row.date.slice(5))}</text>`:"").join("");const points=rows.map((row,index)=>{const created=coords(row,index,"created"),closed=coords(row,index,"closed");return `<circle class="trend-point created" cx="${created.x}" cy="${created.y}" r="3"><title>${row.date}: ${row.created} creados</title></circle><circle class="trend-point closed" cx="${closed.x}" cy="${closed.y}" r="3"><title>${row.date}: ${row.closed} cerrados</title></circle>`;}).join("");container.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendencia de tickets creados y cerrados">${grid}${labels}<polyline class="trend-line created" points="${createdPoints}"/><polyline class="trend-line closed" points="${closedPoints}"/>${points}</svg>`;}

function renderBarChart(selector,rows=[],labelFormatter=(item)=>item.label,variant=""){const container=document.querySelector(selector);if(!container)return;if(!rows.length){container.innerHTML=empty("Sin datos para estos filtros.");return;}const max=Math.max(1,...rows.map((row)=>row.count));container.innerHTML=rows.slice(0,10).map((row)=>`<div class="bar-row ${escapeHtml(variant)}"><div><span>${escapeHtml(labelFormatter(row))}</span><strong>${escapeHtml(row.count)}</strong></div><div class="bar-track"><i style="width:${Math.max(3,row.count/max*100).toFixed(1)}%"></i></div></div>`).join("");}

function renderReportBacklog(report){const count=document.querySelector("#reportBacklogCount");if(count)count.textContent=`${report.summary.activeBacklog} activo(s)`;const buckets=document.querySelector("#reportAgeBuckets");if(buckets)buckets.innerHTML=report.backlog.ageBuckets.map((bucket)=>`<div class="${bucket.key==="over_7d"&&bucket.count?"danger":""}"><strong>${bucket.count}</strong><span>${escapeHtml(bucket.label)}</span></div>`).join("");const oldest=document.querySelector("#reportOldestTickets");if(!oldest)return;oldest.innerHTML=report.backlog.oldest.length?`<table class="report-table"><thead><tr><th>Ticket</th><th>Cliente / equipo</th><th>Estado</th><th>Antigüedad</th></tr></thead><tbody>${report.backlog.oldest.map((row)=>`<tr><td><button class="report-ticket-link" data-report-ticket="${escapeHtml(row.ticketId)}">${escapeHtml(row.ticketId)}</button></td><td><strong>${escapeHtml(row.customerName||"Sin nombre")}</strong><small>${escapeHtml(row.equipment)}</small></td><td>${escapeHtml(labelStatus(row.status))}</td><td>${escapeHtml(reportMetric(row.ageHours," h"))}</td></tr>`).join("")}</tbody></table>`:empty("No hay tickets pendientes.");oldest.querySelectorAll("[data-report-ticket]").forEach((button)=>button.addEventListener("click",()=>openReportTicket(button.dataset.reportTicket)));}

function renderRemoteReportMetrics(remote={}){const container=document.querySelector("#reportRemoteMetrics");if(!container)return;const metrics=[["Sesiones",remote.sessions??0],["Completadas",remote.completed??0],["Duración mediana",reportMetric(remote.medianDurationMinutes," min")],["Control autorizado",reportPercent(remote.controlAuthorizedRate)],["Acceso desatendido",reportPercent(remote.unattendedRate)],["Observaciones Fisher",remote.fisherObservations??0],["Revisiones técnicas",remote.fisherReviews??0]];container.innerHTML=metrics.map(([label,value])=>`<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("");}

function renderReportDetails(rows=[]){const container=document.querySelector("#reportTicketDetails");if(!container)return;if(!rows.length){container.innerHTML=empty("No hay tickets en el alcance actual.");return;}container.innerHTML=`<table class="report-table report-detail-table"><thead><tr><th>Ticket</th><th>Creación</th><th>Cliente</th><th>Equipo</th><th>Canal</th><th>Estado</th><th>Resolución</th></tr></thead><tbody>${rows.map((row)=>`<tr><td><button class="report-ticket-link" data-report-ticket="${escapeHtml(row.ticketId)}">${escapeHtml(row.ticketId)}</button></td><td>${escapeHtml(formatDateTime(row.createdAt))}</td><td><strong>${escapeHtml(row.customerName||"Sin nombre")}</strong><small>${escapeHtml(row.company||row.whatsapp||"Sin empresa")}</small></td><td>${escapeHtml(row.equipment)}</td><td>${escapeHtml(sourceLabel(row.source))}</td><td>${escapeHtml(labelStatus(row.status))}</td><td>${escapeHtml(reportMetric(row.resolutionHours," h"))}</td></tr>`).join("")}</tbody></table>`;container.querySelectorAll("[data-report-ticket]").forEach((button)=>button.addEventListener("click",()=>openReportTicket(button.dataset.reportTicket)));}

function openReportTicket(ticketId){const ticket=state.tickets.find((item)=>item.id===ticketId);if(!ticket)return showNotice("El ticket ya no está disponible en la lista actual.","warning");state.selectedTicketId=ticketId;renderTicketDetail();openTicketDialog();}

async function apiFetch(path, options = {}) {
  const response = await authenticatedFetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.error ?? `HTTP ${response.status}`;
    showNotice(message, "error");
    throw new Error(message);
  }
  return body;
}

function renderNotice() {
  const notice = document.querySelector("#notice");
  if (!notice) return;
  if (!state.notice) {
    notice.hidden = true;
    notice.textContent = "";
    notice.className = "notice";
    return;
  }
  notice.hidden = false;
  notice.className = `notice ${state.notice.type}`;
  notice.textContent = state.notice.message;
}

function showNotice(message, type = "info") {
  state.notice = { message, type };
  renderNotice();
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    state.notice = null;
    renderNotice();
  }, 7000);
}

async function createGuidedTicketAndSession() {
  const ticketData = await apiFetch("/api/tickets", {
    method: "POST",
    body: JSON.stringify({
      customerName: "Cliente Prueba Guíada",
      customerPhone: "5215550000001",
      subject: "Prueba guiada de soporte remoto",
      description: "Validar ticket, sesión remota, consentimiento, vista en vivo y control simulado",
      source: "console",
      priority: "normal"
    })
  });
  const ticket = ticketData.ticket;
  const firstAgent = state.agents.find((agent) => agent.status === "online") ?? state.agents[0];
  await apiFetch("/api/remote-sessions", {
    method: "POST",
    body: JSON.stringify({
      ticketId: ticket.id,
      customerPhone: ticket.customerPhone,
      agentId: firstAgent?.machineId ?? ""
    })
  });
  state.selectedTicketId = ticket.id;
  showNotice("Operación guiada creada. Abre el consentimiento para continuar.", "success");
  await refresh();
  activateView("tests");
}

async function assignFirstOnlineAgent(sessionId) {
  const agent = state.agents.find((item) => item.status === "online") ?? state.agents[0];
  if (!agent) return showNotice("No hay agentes disponibles.", "error");
  await apiFetch(`/api/remote-sessions/${sessionId}/assign-agent`, {
    method: "POST",
    body: JSON.stringify({ agentId: agent.machineId })
  });
  showNotice("Primer agente online asignado.", "success");
  await refresh();
}

function renderRealInputLabPanel() {
  const container = document.querySelector("#realInputLab");
  if (!container) return;

  const readiness = getRealInputReadiness();
  const ticket = selectedTicket() ?? state.tickets[0] ?? null;
  const session = ticket ? sessionForTicket(ticket.id) : latestOpenSession();
  const controlApproved = session?.controlConsent?.decision === "approved";
  const canRequestControl = Boolean(session) && session?.consent?.decision === "approved" && !isTerminalRemoteStatus(session.status);
  const canRunLabEvent = readiness.enabled && readiness.ready && controlApproved && !isTerminalRemoteStatus(session?.status);
  const checks = [
    { label: "Preflight ejecutado", done: Boolean(state.preflightReport) },
    { label: "Helper de control firmado", done: readiness.signatureValid },
    { label: "Entrada real activada", done: readiness.enabled },
    { label: "Laboratorio listo", done: readiness.ready },
    { label: "Teclado y mouse aprobado", done: controlApproved }
  ];

  container.innerHTML = `
    ${renderRealInputReadinessNotice(session)}
    <div class="checklist compact">
      ${checks.map((check) => `<div class="check ${check.done ? "done" : "pending"}"><span>${check.done ? "OK" : "--"}</span><p>${escapeHtml(check.label)}</p></div>`).join("")}
    </div>
    <div class="item-actions">
      ${canRequestControl && !controlApproved ? `<button class="secondary" data-real-lab-control="${session.id}">Pedir control</button>` : ""}
      ${canRunLabEvent ? `<button data-real-lab-event="${session.id}" data-key="Enter">Probar Enter real</button>` : `<span class="inline-state blocked">Enter real bloqueado</span>`}
    </div>
    <small>Este laboratorio no reemplaza el flujo normal. Requiere preflight listo, firma valida, bandera activa y consentimiento de control.</small>
  `;

  container.querySelector("[data-real-lab-control]")?.addEventListener("click", (event) => requestInteractiveControl(event.target.dataset.realLabControl));
  container.querySelector("[data-real-lab-event]")?.addEventListener("click", (event) => {
    const currentReadiness = getRealInputReadiness();
    if (!currentReadiness.enabled || !currentReadiness.ready) {
      showNotice("Teclado y mouse real bloqueado por preflight. Revisa firma y SAS_ENABLE_REAL_INPUT.", "error");
      return;
    }
    queueInteractiveEvent(event.target.dataset.realLabEvent, "key_press", { key: event.target.dataset.key, labMode: "real_input" });
  });
}
function renderPreflightReport() {
  const container = document.querySelector("#clientPreflight");
  if (!container) return;

  const report = state.preflightReport;
  if (!report) {
    container.innerHTML = `<div class="item"><small>Sin datos de preflight.</small></div>`;
    return;
  }

  const checks = Array.isArray(report.checks) ? report.checks : [];
  const pass = checks.filter((check) => check.status === "pass").length;
  const warn = checks.filter((check) => check.status === "warn").length;
  const fail = checks.filter((check) => check.status === "fail").length;
  const importantNames = ["input_helper_signature", "real_input_guard", "real_input_lab_ready"];
  const importantChecks = importantNames
    .map((name) => checks.find((check) => check.name === name))
    .filter(Boolean);
  const latestChecks = uniqueChecks([...importantChecks, ...checks.slice(-6)]).map((check) => `
    <div class="check ${check.status === "pass" ? "done" : check.status === "fail" ? "failed" : "pending"}">
      <span>${check.status === "pass" ? "OK" : check.status === "fail" ? "FAIL" : "WARN"}</span>
      <p>${escapeHtml(check.message ?? check.name)}</p>
    </div>
  `).join("");

  container.innerHTML = `
    <div class="preflight-summary ${escapeHtml(report.status ?? "missing")}">
      <strong>${escapeHtml(labelStatus(report.status ?? "missing"))}</strong>
      <span>${report.generatedAt ? escapeHtml(formatDateTime(report.generatedAt)) : "Sin reporte generado"}</span>
    </div>
    <div class="progress-line">
      <span class="done">${pass} pass</span>
      <span>${warn} warn</span>
      <span>${fail} fail</span>
    </div>
    <div class="preflight-path">${escapeHtml(report.path ?? "output/client-preflight-report.json")}</div>
    ${renderRealInputReadinessNotice()}
    <div class="checklist compact">${latestChecks || empty("Ejecuta scripts\\test-client-preflight.ps1 para generar el reporte.")}</div>
  `;
}
function uniqueChecks(checks) {
  const seen = new Set();
  return checks.filter((check) => {
    const key = check?.name ?? check?.message;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function guidedCheckDone(key, fallback) {
  const check = state.guidedReport?.checks?.find((item) => item.key === key);
  return typeof check?.done === "boolean" ? check.done : fallback;
}

function buildGuidedTestPlan({ ticket, session, onlineAgent }) {
  return [
    {
      key: "server",
      label: "Servidor activo",
      done: state.health?.status === "ok",
      action: "Inicia el servidor SAS y confirma /health.",
      detail: `Servidor: ${state.health?.status ?? "sin conexión"}.`
    },
    {
      key: "agent_online",
      label: "Agente online",
      done: guidedCheckDone("agent_online", Boolean(onlineAgent)),
      action: "Inicia el cliente Windows y revisa el panel local del agente.",
      detail: `${state.agents.filter((agent) => agent.status === "online").length} agente(s) online.`
    },
    {
      key: "ticket",
      label: "Ticket de prueba",
      done: guidedCheckDone("ticket", Boolean(ticket)),
      action: "Presiona Crear ticket y sesión.",
      detail: ticket ? `Ticket ${ticket.id}.` : "Aún no hay ticket seleccionado."
    },
    {
      key: "remote_session",
      label: "Sesión remota",
      done: guidedCheckDone("remote_session", Boolean(session)),
      action: "Crea una sesión remota para el ticket de prueba.",
      detail: session ? `Código ${session.joinCode}.` : "Sin código remoto."
    },
    {
      key: "agent_assigned",
      label: "Agente asignado",
      done: guidedCheckDone("agent_assigned", Boolean(session?.agentId)),
      action: "Asigna el primer agente online a la sesión.",
      detail: session?.agentId ? `Agente ${session.agentId}.` : "Sesión sin agente asignado."
    },
    {
      key: "consent",
      label: "Abrir permiso aprobado",
      done: guidedCheckDone("consent", session?.consent?.decision === "approved"),
      action: "Abre el consentimiento y apruebalo desde el panel del cliente.",
      detail: `Abrir permiso: ${labelStatus(session?.consent?.decision ?? "pending")}.`
    },
    {
      key: "started",
      label: "Sesión iniciada",
      done: guidedCheckDone("started", Boolean(session?.startedAt) || session?.status === "active" || session?.status === "closed"),
      action: "Presiona Iniciar conexión cuando el consentimiento este aprobado.",
      detail: `Estado remoto: ${labelStatus(session?.status ?? "sin sesión")}.`
    },
    {
      key: "screen",
      label: "Vista en vivo validada",
      done: guidedCheckDone("screen", Boolean(session?.screenShare?.enabled || session?.screenShare?.startedAt || session?.screenShare?.lastFrameAt)),
      action: "Activa Vista fluida para validar fluidez de pantalla.",
      detail: session?.screenShare?.enabled ? `Intervalo ${session.screenShare.intervalSeconds}s, calidad ${session.screenShare.quality}.` : "Vista aun apagada o ya detenida."
    },
    {
      key: "control",
      label: "Teclado y mouse aprobado",
      done: guidedCheckDone("control", session?.controlConsent?.decision === "approved"),
      action: "Solicita control y apruebalo desde el panel del cliente.",
      detail: `Teclado y mouse: ${labelStatus(session?.controlConsent?.decision ?? "not_requested")}.`
    },
    {
      key: "system_command",
      label: "Comando de sistema completado",
      done: guidedCheckDone("system_command", Boolean((session?.commands ?? []).some((command) => command.type === "system_info" && command.status === "completed"))),
      action: "Presiona Revisar equipo y espera resultado del agente.",
      detail: `${(session?.commands ?? []).length} comando(s) registrados.`
    },
    {
      key: "interactive_event",
      label: "Evento simulado recibido",
      done: guidedCheckDone("interactive_event", Boolean((session?.interactiveEvents ?? []).some((event) => ["simulated", "completed"].includes(event.status)))),
      action: "Envia Probar Enter para validar el canal de control.",
      detail: `${(session?.interactiveEvents ?? []).length} evento(s) registrados.`
    },
    {
      key: "closed",
      label: "Sesión de prueba cerrada",
      done: guidedCheckDone("closed", session?.status === "closed"),
      action: "Presiona Terminar prueba para apagar vista, cancelar pendientes y auditar el cierre.",
      detail: session?.status === "closed" ? `Cerrada en ${formatDateTime(session.endedAt)}.` : `Estado remoto: ${labelStatus(session?.status ?? "sin sesión")}.`
    }
  ];
}
function renderGuidedStep(steps) {
  const container = document.querySelector("#testGuide");
  if (!container) return;

  const currentIndex = steps.findIndex((step) => !step.done);
  const current = currentIndex >= 0 ? steps[currentIndex] : steps[steps.length - 1];
  const completed = steps.filter((step) => step.done).length;
  const total = steps.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  container.innerHTML = `
    <div class="guided-progress">
      <strong>${completed}/${total}</strong>
      <div><span style="width: ${percent}%"></span></div>
      <small>${percent}%</small>
    </div>
    <div class="guided-current ${currentIndex < 0 ? "done" : "pending"}">
      <span>${currentIndex < 0 ? "Listo" : `Paso ${currentIndex + 1}`}</span>
      <h4>${escapeHtml(currentIndex < 0 ? "Operación guiada completada" : current.label)}</h4>
      <p>${escapeHtml(currentIndex < 0 ? "El flujo principal ya fue validado. Revisa auditoría y cierra la sesión si corresponde." : current.action)}</p>
      <small>${escapeHtml(current?.detail ?? "")}</small>
    </div>
  `;
}
function renderGuidedReport() {
  const container = document.querySelector("#guidedReport");
  if (!container) return;

  const report = state.guidedReport;
  if (!report) {
    container.innerHTML = empty("Sin reporte de prueba todavia.");
    return;
  }

  const checks = Array.isArray(report.checks) ? report.checks : [];
  const failed = checks.filter((check) => !check.done).slice(0, 4);
  container.innerHTML = `
    <div class="guided-report-summary ${escapeHtml(report.status ?? "not_started")}">
      <strong>${escapeHtml(labelStatus(report.status ?? "not_started"))}</strong>
      <span>${escapeHtml(report.percent ?? 0)}%</span>
    </div>
    <div class="progress-line">
      <span class="done">${escapeHtml(report.completed ?? 0)}/${escapeHtml(report.total ?? 0)} pasos</span>
      <span>${escapeHtml(report.auditEvents?.length ?? 0)} registros</span>
    </div>
    <div class="guided-current pending">
      <span>Siguiente</span>
      <h4>${escapeHtml(report.nextAction ?? "Sin acción pendiente")}</h4>
      <p>${report.session ? `Sesión ${escapeHtml(report.session.joinCode)} · ${escapeHtml(labelStatus(report.session.status))}` : "Aún no hay sesión de prueba."}</p>
      <small>${report.ticket ? `Ticket ${escapeHtml(report.ticket.id)} - ${escapeHtml(report.ticket.subject)}` : "Sin ticket asociado."}</small>
    </div>
    ${failed.length ? `<div class="checklist compact">${failed.map((check) => `<div class="check pending"><span>--</span><p>${escapeHtml(check.label)}</p></div>`).join("")}</div>` : ""}
    <details class="action-menu full-width technical-details"><summary>Detalle avanzado</summary><pre class="compact-json">${escapeHtml(JSON.stringify({ status: report.status, percent: report.percent, ticket: report.ticket?.id, session: report.session?.id, nextAction: report.nextAction }, null, 2))}</pre></details>
  `;
}
function renderGuidedPrimaryAction({ step }) {
  if (!step) {
    return `<button data-guided-next-step>Repetir</button>`;
  }

  if (["preflight", "server", "agent_online"].includes(step.key)) {
    return `<button class="secondary" data-test-refresh>Actualizar</button>`;
  }

  return `<button data-guided-next-step>Siguiente</button>`;
}
function renderTests() {
  const status = document.querySelector("#testStatus");
  const checklist = document.querySelector("#testChecklist");
  const actions = document.querySelector("#testActions");
  if (!status || !checklist || !actions) return;

  const ticket = selectedTicket() ?? state.tickets[0] ?? null;
  const session = ticket ? sessionForTicket(ticket.id) : latestOpenSession();
  const onlineAgent = state.agents.find((agent) => agent.status === "online");
  const steps = buildGuidedTestPlan({ ticket, session, onlineAgent });
  const checks = steps.map((step) => [step.label, step.done]);
  const currentStep = steps.find((step) => !step.done) ?? null;
  const primaryAction = renderGuidedPrimaryAction({ step: currentStep, session });
  renderGuidedStep(steps);

  status.innerHTML = `
    <div class="status-tile status-${escapeHtml(statusClass(state.health?.status ?? "fail"))}"><strong>${escapeHtml(labelStatus(state.health?.status ?? "sin conexión"))}</strong><span>Servidor</span></div>
    <div class="status-tile status-${state.agents.some((agent) => agent.status === "online") ? "pass" : "warn"}"><strong>${state.agents.filter((agent) => agent.status === "online").length}</strong><span>Equipos conectados</span></div>
    <div class="status-tile status-${ticket ? "pass" : "warn"}"><strong>${ticket ? escapeHtml(ticket.id) : "pendiente"}</strong><span>Ticket seleccionado</span></div>
    <div class="status-tile status-${session ? "pass" : "warn"}"><strong>${session ? escapeHtml(session.joinCode) : "pendiente"}</strong><span>Código remoto</span></div>
    <div class="status-tile"><strong>${escapeHtml(roleLabel(currentConsoleRole()))}</strong><span>Perfil activo</span></div>
  `;
  const pendingChecks = checks.filter(([, done]) => !done);
  const visibleChecks = pendingChecks.length ? pendingChecks.slice(0, 5) : checks.slice(-3);
  checklist.innerHTML = visibleChecks.map(([label, done]) => `<div class="check ${done ? "done" : "pending"}"><span>${done ? "OK" : "--"}</span><p>${label}</p></div>`).join("");
  actions.innerHTML = `
    <div class="guided-main-action">
      ${primaryAction}
    </div>
    ${session ? `<details class="action-menu full-width"><summary>Más opciones</summary><div class="item-actions">
      ${session && !session.agentId && currentStep?.key !== "agent_assigned" ? `<button class="secondary" data-test-assign="${session.id}">Asignar equipo</button>` : ""}
      ${session?.consent?.decision === "approved" && currentStep?.key !== "system_command" ? `<button class="secondary" data-remote-command="${session.id}" data-command-type="system_info">Revisar equipo</button>` : ""}
      ${currentStep?.key !== "screen" ? `<button class="secondary" data-screen-start="${session.id}" data-screen-profile="balanced">Ver pantalla</button>` : ""}
      ${currentStep?.key !== "control" && currentStep?.key !== "interactive_event" ? `<button class="secondary" data-control-request="${session.id}">Pedir control</button>` : ""}
      ${session?.controlConsent?.decision === "approved" && !isTerminalRemoteStatus(session.status) && currentStep?.key !== "interactive_event" ? `<button class="secondary" data-key-event="${session.id}" data-key="Enter">Probar Enter</button>` : ""}
      ${session && !isTerminalRemoteStatus(session.status) && currentStep?.key !== "closed" ? `<button class="secondary danger-action" data-test-close="${session.id}">Terminar prueba</button>` : ""}
    </div></details>` : ""}
  `;
  actions.querySelector("[data-test-refresh]")?.addEventListener("click", refresh);
  actions.querySelector("[data-test-create]")?.addEventListener("click", createGuidedTicketAndSession);
  actions.querySelector("[data-guided-next-step]")?.addEventListener("click", runGuidedNextStep);
  actions.querySelector("[data-test-assign]")?.addEventListener("click", (event) => assignFirstOnlineAgent(event.target.dataset.testAssign));
  actions.querySelectorAll("[data-remote-start]").forEach((button) => button.addEventListener("click", () => updateRemoteSession(button.dataset.remoteStart, "start")));
  actions.querySelectorAll("[data-remote-command]").forEach((button) => button.addEventListener("click", () => queueRemoteCommand(button.dataset.remoteCommand, button.dataset.commandType)));
  actions.querySelectorAll("[data-screen-start]").forEach((button) => button.addEventListener("click", () => updateScreenShare(button.dataset.screenStart, "start", button.dataset.screenProfile)));
  actions.querySelectorAll("[data-control-request]").forEach((button) => button.addEventListener("click", () => requestInteractiveControl(button.dataset.controlRequest)));
  actions.querySelectorAll("[data-key-event]").forEach((button) => button.addEventListener("click", () => queueInteractiveEvent(button.dataset.keyEvent, "key_press", { key: button.dataset.key })));
  actions.querySelectorAll("[data-test-close]").forEach((button) => button.addEventListener("click", () => closeGuidedTest(button.dataset.testClose)));
}

async function runGuidedNextStep() {
  const result = await apiFetch("/api/tests/guided-next-step", { method: "POST", body: JSON.stringify({}) });
  if (result.ticket?.id) state.selectedTicketId = result.ticket.id;
  showNotice(result.message ?? "Operación guiada actualizada.", result.ok === false ? "error" : "success");
  await refresh();
  activateView("tests");
}
async function closeGuidedTest(sessionId) {
  await updateRemoteSession(sessionId, "close");
  showNotice("Operación guiada cerrada y auditada.", "success");
}

function selectedTicket() {
  return state.tickets.find((item) => item.id === state.selectedTicketId) ?? null;
}

function sessionForTicket(ticketId) {
  return [...state.sessions].reverse().find((session) => session.ticketId === ticketId && session.status !== "consent_rejected") ?? null;
}

function latestOpenSession() {
  return [...state.sessions].reverse().find((session) => session.status !== "consent_rejected") ?? null;
}
function activateView(view) {
  document.querySelector(`[data-view="${view}"]`)?.click();
}
function empty(text) { return `<div class="item"><small>${text}</small></div>`; }
function emptyState(title, text, nextAction = "") {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(text)}</p>
      ${nextAction ? `<small>${escapeHtml(nextAction)}</small>` : ""}
    </div>
  `;
}
function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short" }).format(date);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

































































































































































function renderContacts() {
  const list = document.querySelector("#contactsList"); if (!list) return;
  const q = document.querySelector("#contactSearch")?.value?.toLowerCase() ?? "";
  const contacts = state.contacts.filter((c) => [c.name,c.company,c.phone,c.email,c.address].some((v) => String(v ?? "").toLowerCase().includes(q)));
  const assigned = state.contacts.filter((contact) => contact.companyId).length;
  const summary = document.querySelector("#contactsSummary");
  if (summary) summary.innerHTML = [
    summaryCard("info", "Personas", String(state.contacts.length), `${contacts.length} en la búsqueda`),
    summaryCard("success", "Empresas SAE", String(state.companies.length), "Razones sociales disponibles"),
    summaryCard(assigned === state.contacts.length && assigned ? "success" : "warning", "Asignadas", String(assigned), `${Math.max(0, state.contacts.length - assigned)} pendientes`)
  ].join("");
  list.innerHTML = contacts.length ? contacts.map((contact) => {
    const company = state.companies.find((item) => item.id === contact.companyId);
    const address = contact.address || company?.address || "";
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([contact.company,address].filter(Boolean).join(", "))}`;
    return `<article class="list-item agenda-contact-row"><div><strong>${escapeHtml(contact.name)}</strong><small>${escapeHtml(contact.company || "Empresa pendiente de asignar")} · ${escapeHtml(contact.phone || "Sin teléfono")}</small><small>${escapeHtml(contact.email || "Sin correo")} · ${escapeHtml(address || "Sin dirección")}</small></div><div class="item-actions"><button class="secondary" data-assign-contact="${escapeHtml(contact.id)}">Asignar empresa</button><a class="secondary" href="https://wa.me/${encodeURIComponent((contact.phone || "").replace(/[^0-9]/g,""))}" target="_blank" rel="noreferrer">WhatsApp</a><a class="secondary" href="tel:${escapeHtml(contact.phone || "")}">Llamar</a><a class="secondary" href="${maps}" target="_blank" rel="noreferrer">Maps</a></div></article>`;
  }).join("") : empty("No hay fichas que coincidan.");
  list.querySelectorAll("[data-assign-contact]").forEach((button) => button.addEventListener("click", () => selectContactForCompany(button.dataset.assignContact)));
  renderCompanyPickers();
}

function renderCompanies() {
  const list = document.querySelector("#companiesList"); if (!list) return;
  const q = document.querySelector("#companySearch")?.value?.trim().toLowerCase() ?? "";
  const companies = state.companies.filter((company) => [company.legalName, company.rfc, company.externalKey].some((value) => String(value ?? "").toLowerCase().includes(q))).slice(0, 100);
  list.innerHTML = companies.length ? companies.map((company) => `<article class="company-compact-row"><strong>${escapeHtml(company.legalName)}</strong><span>${escapeHtml(company.rfc || "RFC sin registrar")} · SAE ${escapeHtml(company.externalKey || "sin clave")}</span></article>`).join("") : empty("No hay empresas importadas que coincidan.");
  renderCompanyPickers();
  renderContacts();
}

function renderCompanyPickers() {
  const companies = document.querySelector("#companyCatalogList");
  const contacts = document.querySelector("#contactCatalogList");
  if (companies) companies.innerHTML = state.companies.slice(0, 5000).map((company) => `<option value="${escapeHtml(company.legalName)}" data-id="${escapeHtml(company.id)}">${escapeHtml(company.rfc || company.externalKey || "")}</option>`).join("");
  if (contacts) contacts.innerHTML = state.contacts.map((contact) => `<option value="${escapeHtml(contactPickerLabel(contact))}" data-id="${escapeHtml(contact.id)}"></option>`).join("");
}

function contactPickerLabel(contact) { return `${contact.name} · ${contact.phone || contact.email || "sin teléfono"}`; }

function selectContactForCompany(contactId) {
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) return;
  document.querySelector("#companyContactPicker").value = contactPickerLabel(contact);
  document.querySelector("#companyPicker").value = contact.company || "";
  document.querySelector("#companyPicker").focus();
  document.querySelector(".company-assignment-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function assignContactCompany() {
  const contactInput = document.querySelector("#companyContactPicker");
  const companyInput = document.querySelector("#companyPicker");
  const resultHost = document.querySelector("#companyAssignmentResult");
  const contactOption = [...(document.querySelector("#contactCatalogList")?.options ?? [])].find((option) => option.value === contactInput?.value);
  const companyOption = [...(document.querySelector("#companyCatalogList")?.options ?? [])].find((option) => option.value === companyInput?.value);
  if (!contactOption) return showInlineResult(resultHost, "Selecciona una persona de la Agenda.", "error");
  if (!companyOption) return showInlineResult(resultHost, "Selecciona una razón social importada desde Aspel SAE.", "error");
  try {
    const response = await apiFetch(`/api/contacts/${encodeURIComponent(contactOption.dataset.id)}/company`, { method: "PATCH", body: JSON.stringify({ companyId: companyOption.dataset.id }) });
    const index = state.contacts.findIndex((item) => item.id === response.contact.id);
    if (index >= 0) state.contacts[index] = response.contact;
    renderContacts();
    showInlineResult(resultHost, `${response.contact.name} quedó asignado a ${response.company.legalName}.`, "success");
  } catch (error) { showInlineResult(resultHost, error.message, "error"); }
}

async function importAspelClients(previewOnly) {
  const resultHost = document.querySelector("#aspelImportResult");
  const previewButton = document.querySelector("#previewAspelClients");
  const importButton = document.querySelector("#importAspelClients");
  const body = { databasePath: document.querySelector("#aspelDatabasePath")?.value, username: document.querySelector("#aspelUsername")?.value, password: document.querySelector("#aspelPassword")?.value, isqlPath: document.querySelector("#aspelIsqlPath")?.value };
  previewButton.disabled = true; importButton.disabled = true;
  resultHost.innerHTML = `<div class="inline-progress"><span></span><strong>${previewOnly ? "Revisando base de datos" : "Importando empresas"}…</strong></div>`;
  try {
    const endpoint = previewOnly ? "/api/companies/aspel/preview" : "/api/companies/aspel/import";
    const response = await apiFetch(endpoint, { method: "POST", body: JSON.stringify(body) });
    if (previewOnly) {
      const preview = response.preview;
      resultHost.innerHTML = `<div class="aspel-result-success"><strong>${preview.detected} clientes detectados en ${escapeHtml(preview.databaseName)}</strong><span>Tablas: ${escapeHtml(preview.tableNames.join(", "))}</span></div><div class="aspel-preview-list">${preview.clients.slice(0, 12).map((client) => `<span><b>${escapeHtml(client.legalName)}</b><small>${escapeHtml(client.rfc || client.externalKey || "Sin RFC")}</small></span>`).join("")}</div>`;
    } else {
      const result = response.result;
      document.querySelector("#aspelPassword").value = "";
      const companies = await loadJson("/api/companies");
      state.companies = companies.companies ?? [];
      renderCompanies();
      resultHost.innerHTML = `<div class="aspel-result-success"><strong>Importación terminada</strong><span>${result.created} nuevas · ${result.updated} actualizadas · ${result.skipped} omitidas</span></div>`;
      showNotice("Empresas de Aspel SAE disponibles para asignar.", "success");
    }
  } catch (error) { resultHost.innerHTML = `<div class="aspel-result-error"><strong>No fue posible leer Aspel SAE</strong><span>${escapeHtml(error.message)}</span></div>`; }
  finally { previewButton.disabled = false; importButton.disabled = false; }
}

function showInlineResult(host, message, type) {
  if (!host) return;
  host.textContent = message;
  host.className = type === "success" ? "inline-result success" : "inline-result error";
}

async function createContact() {
  const companyName = document.querySelector("#contactCompany")?.value?.trim() ?? "";
  const company = state.companies.find((item) => item.legalName.toLowerCase() === companyName.toLowerCase());
  const body = { name: document.querySelector("#contactName")?.value, company: company?.legalName || companyName, companyId: company?.id || "", phone: document.querySelector("#contactPhone")?.value, email: document.querySelector("#contactEmail")?.value, address: document.querySelector("#contactAddress")?.value, notes: document.querySelector("#contactNotes")?.value };
  try {
    const result = await apiFetch("/api/contacts", { method:"POST", body:JSON.stringify(body) });
    state.contacts.unshift(result.contact);
    ["contactName","contactCompany","contactPhone","contactEmail","contactAddress","contactNotes"].forEach((id)=>{const element=document.querySelector("#"+id);if(element)element.value="";});
    renderContacts(); showNotice("Ficha guardada.","success");
  } catch (error) { showNotice(error.message,"error"); }
}
function renderMobileUsers() {
  const list = document.querySelector("#mobileUsersList");
  const count = document.querySelector("#mobileUsersCount");
  if (!list) return;
  const passwordDrafts = new Map([...list.querySelectorAll("[data-mobile-password]")].map((input) => [input.dataset.mobilePassword, input.value]));
  const activePassword = document.activeElement?.matches?.("[data-mobile-password]") ? {
    userId: document.activeElement.dataset.mobilePassword,
    start: document.activeElement.selectionStart,
    end: document.activeElement.selectionEnd
  } : null;
  if (count) count.textContent = `${state.mobileUsers.length} registrados`;
  list.innerHTML = state.mobileUsers.length ? state.mobileUsers.map((user) => `
    <article class="list-item mobile-user-card ${user.status === "disabled" ? "muted" : ""}">
      <div class="item-main"><strong>${escapeHtml(user.displayName)}</strong><span>${escapeHtml(user.username)}</span></div>
      <div class="research-safety"><span>${escapeHtml(mobileRoleLabel(user.role))}</span><span>${user.status === "active" ? "Activo" : "Desactivado"}</span>${user.mustChangePassword ? "<span>Contraseña temporal</span>" : ""}${user.lockedUntil ? `<span>Bloqueado hasta ${escapeHtml(formatDateTime(user.lockedUntil))}</span>` : ""}</div>
      <div class="mobile-user-controls">
        <select data-mobile-role="${escapeHtml(user.id)}" aria-label="Rol de ${escapeHtml(user.username)}">
          ${["viewer", "technician", "supervisor", "admin"].map((role) => `<option value="${role}" ${role === user.role ? "selected" : ""}>${mobileRoleLabel(role)}</option>`).join("")}
        </select>
        <button class="secondary" data-mobile-status="${escapeHtml(user.id)}" data-next-status="${user.status === "active" ? "disabled" : "active"}">${user.status === "active" ? "Desactivar" : "Reactivar"}</button>
      </div>
      <div class="mobile-password-reset"><input type="password" data-mobile-password="${escapeHtml(user.id)}" minlength="12" autocomplete="new-password" placeholder="Nueva contraseña (12+)"><button class="secondary" data-mobile-reset="${escapeHtml(user.id)}">Restablecer</button></div>
    </article>`).join("") : '<div class="empty-state">No hay usuarios móviles. Crea el primer acceso cuando el servidor esté configurado.</div>';
  list.querySelectorAll("[data-mobile-role]").forEach((select) => select.addEventListener("change", () => updateMobileUser(select.dataset.mobileRole, { role: select.value })));
  list.querySelectorAll("[data-mobile-status]").forEach((button) => button.addEventListener("click", () => changeMobileUserStatus(button.dataset.mobileStatus, button.dataset.nextStatus)));
  list.querySelectorAll("[data-mobile-reset]").forEach((button) => button.addEventListener("click", () => resetMobilePassword(button.dataset.mobileReset)));
  list.querySelectorAll("[data-mobile-password]").forEach((input) => {
    input.value = passwordDrafts.get(input.dataset.mobilePassword) ?? "";
  });
  if (activePassword) {
    const input = list.querySelector(`[data-mobile-password="${CSS.escape(activePassword.userId)}"]`);
    input?.focus({ preventScroll: true });
    if (Number.isInteger(activePassword.start) && Number.isInteger(activePassword.end)) input?.setSelectionRange(activePassword.start, activePassword.end);
  }
}

function mobileRoleLabel(role) { return ({ viewer: "Consulta", technician: "Técnico", supervisor: "Supervisor", admin: "Administrador" })[role] ?? role; }

async function createMobileUser() {
  const button = document.querySelector("#createMobileUser");
  const result = document.querySelector("#mobileCreateResult");
  const username = document.querySelector("#mobileUsername")?.value.trim();
  const displayName = document.querySelector("#mobileDisplayName")?.value.trim();
  const role = document.querySelector("#mobileRole")?.value;
  const password = document.querySelector("#mobilePassword")?.value ?? "";
  const showResult = (message, type) => {
    if (!result) return;
    result.hidden = false;
    result.textContent = message;
    result.className = `visible-log ${type}`;
  };
  if (!username) return showResult("Escribe un nombre de usuario.", "error");
  if (password.length < 12) return showResult("La contrase\u00f1a temporal debe tener al menos 12 caracteres.", "error");
  setButtonLoading(button, true, "Creando acceso...");
  showResult("Validando y creando la cuenta...", "info");
  try {
    await apiFetch("/api/mobile-admin/v1/users", { method: "POST", body: JSON.stringify({ username, displayName, role, password, phoneE164 }) });
    document.querySelector("#mobileUsername").value = "";
    document.querySelector("#mobileDisplayName").value = "";
    document.querySelector("#mobilePassword").value = "";
    showResult("Acceso creado correctamente. Ya puedes cerrar sesi\u00f3n e ingresar con este usuario.", "success");
    showNotice("Acceso m\u00f3vil creado.", "success");
    await refresh();
  } catch (error) {
    showResult(error.message ?? "No fue posible crear el acceso.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function updateMobileUser(userId, changes) {
  await apiFetch(`/api/mobile-admin/v1/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(changes) });
  showNotice("Usuario móvil actualizado.", "success");
  await refresh();
}

async function changeMobileUserStatus(userId, status) {
  const verb = status === "disabled" ? "desactivar" : "reactivar";
  if (!window.confirm(`¿Deseas ${verb} este acceso móvil?${status === "disabled" ? " Sus sesiones se cerrarán inmediatamente." : ""}`)) return;
  await updateMobileUser(userId, { status });
}

async function resetMobilePassword(userId) {
  const input = document.querySelector(`[data-mobile-password="${CSS.escape(userId)}"]`);
  const password = input?.value ?? "";
  if (password.length < 12) return showNotice("La nueva contraseña debe tener al menos 12 caracteres.", "error");
  if (!window.confirm("¿Restablecer la contraseña? Todas las sesiones y dispositivos de este usuario serán revocados.")) return;
  await apiFetch(`/api/mobile-admin/v1/users/${encodeURIComponent(userId)}/reset-password`, { method: "POST", body: JSON.stringify({ password }) });
  input.value = "";
  showNotice("Contraseña restablecida y sesiones revocadas.", "success");
  await refresh();
}






document.querySelector("#createDeploymentCampaign")?.addEventListener("click", createDeploymentCampaign);
