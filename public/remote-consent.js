const joinCode = location.pathname.split("/").pop();
const statusEl = document.querySelector("#consentStatus");
const codeEl = document.querySelector("#joinCode");
const resultEl = document.querySelector("#consentResult");
const bannerEl = document.querySelector("#safetyBanner");
const capabilityEl = document.querySelector("#currentCapability");
const technicalEl = document.querySelector("#consentTechnical");
const approveConsentButton = document.querySelector("#approveConsent");
const rejectConsentButton = document.querySelector("#rejectConsent");
const closeSessionButton = document.querySelector("#closeSession");
const approveControlButton = document.querySelector("#approveControl");
const rejectControlButton = document.querySelector("#rejectControl");
const customerNextTitle = document.querySelector("#customerNextTitle");
const customerNextDetail = document.querySelector("#customerNextDetail");
const showCustomerActionButton = document.querySelector("#showCustomerAction");
let customerActionTarget = null;
let requestInProgress = false;

approveConsentButton.addEventListener("click", () => confirmAndRun("Autorizarás al técnico para ver la pantalla y utilizar mouse, clics, teclado, portapapeles, archivos y asistencia UAC durante este ticket. Puedes finalizar todo en cualquier momento.", () => sendDecision("approved"), approveConsentButton));
rejectConsentButton.addEventListener("click", () => confirmAndRun("¿Deseas rechazar esta solicitud? El técnico no podrá iniciar el soporte remoto.", () => sendDecision("rejected"), rejectConsentButton));
closeSessionButton.addEventListener("click", () => confirmAndRun("¿Finalizar la sesión ahora? Se detendrá la vista en vivo y se cancelará cualquier acción pendiente.", closeSession, closeSessionButton));
approveControlButton.addEventListener("click", () => confirmAndRun("El técnico podrá usar teclado y mouse mientras esta sesión permanezca activa. Puedes retirar el permiso en cualquier momento.", () => decideControl("approved"), approveControlButton));
rejectControlButton.addEventListener("click", () => confirmAndRun("¿Deseas mantener bloqueados el teclado y el mouse?", () => decideControl("rejected"), rejectControlButton));
showCustomerActionButton.addEventListener("click", () => {
  if (!customerActionTarget) return;
  customerActionTarget.scrollIntoView({ behavior: "smooth", block: "center" });
  customerActionTarget.classList.remove("help-highlight");
  void customerActionTarget.offsetWidth;
  customerActionTarget.classList.add("help-highlight");
  customerActionTarget.focus({ preventScroll: true });
  window.setTimeout(() => customerActionTarget?.classList.remove("help-highlight"), 4200);
});

loadSession();
setInterval(() => { if (!requestInProgress) loadSession(); }, 5000);

async function loadSession() {
  try {
    const response = await fetch(`/api/remote-sessions/code/${joinCode}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw friendlyRequestError(response, payload);
    render(payload.session, { preserveMessage: true });
  } catch (error) {
    statusEl.textContent = "No pudimos consultar esta sesión";
    codeEl.textContent = "----";
    bannerEl.textContent = "Verifica tu conexión o solicita al técnico un enlace nuevo.";
    bannerEl.className = "safety-banner danger";
    showResult(error.message, "error");
  }
}

async function sendDecision(decision) {
  const payload = await postJson(`/api/remote-sessions/code/${joinCode}/consent`, { decision, decidedBy: "customer", allowControl: decision === "approved" });
  if (!payload) return;
  render(payload.session);
  showResult(decision === "approved" ? "Soporte completo autorizado. SAS iniciará la pantalla y todas las herramientas de esta sesión." : "Solicitud rechazada. No se iniciará ningún acceso remoto.", decision === "approved" ? "success" : "info");
}

async function decideControl(decision) {
  const payload = await postJson(`/api/remote-sessions/code/${joinCode}/control`, { decision, decidedBy: "customer", allowControl: decision === "approved" });
  if (!payload) return;
  render(payload.session);
  showResult(decision === "approved" ? "Teclado y mouse autorizados. Puedes retirar el permiso o finalizar la sesión en cualquier momento." : "Teclado y mouse permanecen bloqueados. Se cancelaron las acciones pendientes.", decision === "approved" ? "warning" : "success");
}

async function closeSession() {
  const payload = await postJson(`/api/remote-sessions/code/${joinCode}/close`, {});
  if (!payload) return;
  render(payload.session);
  showResult("Sesión finalizada. La vista en vivo, el teclado y el mouse quedaron desactivados.", "success");
}

async function confirmAndRun(message, action, button) {
  if (requestInProgress || !window.confirm(message)) return;
  requestInProgress = true;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Procesando…";
  try { await action(); }
  finally {
    requestInProgress = false;
    button.textContent = original;
    if (!button.hidden) button.disabled = false;
  }
}

async function postJson(path, body) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw friendlyRequestError(response, payload);
    return payload;
  } catch (error) {
    showResult(error.message, "error");
    return null;
  }
}

function friendlyRequestError(response, payload) {
  const message = response.status === 404
    ? "Esta solicitud ya no está disponible. Pide al técnico un enlace nuevo."
    : response.status === 429
      ? "Se realizaron demasiados intentos. Espera un momento antes de volver a probar."
      : payload.error || "No fue posible completar la acción. Revisa tu conexión e inténtalo de nuevo.";
  return new Error(message);
}

function showResult(message, type = "info") {
  resultEl.className = `visible-log ${type}`;
  resultEl.textContent = message;
}

function render(session, options = {}) {
  codeEl.textContent = session.joinCode;
  statusEl.textContent = `Ticket ${session.ticketId} · ${labelSessionStatus(session.status)}`;
  setState("#generalConsentState", "Soporte remoto", labelConsent(session.consent?.decision), session.consent?.decision === "approved" ? "ok" : session.consent?.decision === "rejected" ? "danger" : "pending");
  setState("#sessionState", "Sesión", labelSessionStatus(session.status), session.status === "active" ? "ok" : isTerminalStatus(session.status) ? "safe" : "pending");
  setState("#screenState", "Vista en vivo", session.screenShare?.enabled ? "Activa" : "Detenida", session.screenShare?.enabled ? "warning" : "safe");
  setState("#controlState", "Teclado y mouse", labelControl(session.controlConsent?.decision), session.controlConsent?.decision === "approved" ? "danger" : session.controlConsent?.decision === "pending" ? "pending" : "safe");
  renderBanner(session);
  renderCapability(session);
  renderButtons(session);
  renderCustomerHelp(session);
  technicalEl.textContent = `Modalidad: ${session.accessMode === "unattended" ? "soporte desatendido autorizado previamente en el equipo" : "soporte atendido"} · Última comprobación: ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date())}`;
  if (!options.preserveMessage || !resultEl.textContent.trim()) showResult("Revisa los permisos y el estado antes de continuar.", "info");
}

function renderCapability(session) {
  const closed = isTerminalStatus(session.status);
  let title = "Sin acceso activo";
  let detail = "El técnico no puede ver ni controlar este equipo.";
  let type = "safe";
  if (!closed && session.controlConsent?.decision === "approved") {
    title = "Teclado y mouse autorizados";
    detail = "El técnico puede interactuar con el equipo mientras la sesión esté activa.";
    type = "danger";
  } else if (!closed && session.screenShare?.enabled) {
    title = "Solo vista en vivo";
    detail = "El técnico puede ver la pantalla, pero no usar teclado ni mouse.";
    type = "warning";
  } else if (!closed && session.consent?.decision === "approved") {
    title = "Soporte autorizado, aún sin acceso";
    detail = "El técnico todavía debe iniciar la conexión.";
    type = "pending";
  }
  capabilityEl.className = `current-capability ${type}`;
  capabilityEl.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
}

function renderBanner(session) {
  if (isTerminalStatus(session.status)) {
    bannerEl.textContent = "Sesión finalizada. No hay acceso remoto activo.";
    bannerEl.className = "safety-banner safe";
  } else if (session.accessMode === "unattended" && session.controlConsent?.decision === "approved") {
    bannerEl.textContent = "Acceso desatendido activo: la política local permite pantalla, teclado y mouse.";
    bannerEl.className = "safety-banner danger";
  } else if (session.accessMode === "unattended" && session.consent?.decision === "approved") {
    bannerEl.textContent = "Acceso desatendido autorizado previamente en este equipo; teclado y mouse siguen bloqueados.";
    bannerEl.className = "safety-banner warning";
  } else if (session.controlConsent?.decision === "approved") {
    bannerEl.textContent = "Atención: el técnico tiene permiso para usar teclado y mouse.";
    bannerEl.className = "safety-banner danger";
  } else if (session.status === "active" || session.screenShare?.enabled) {
    bannerEl.textContent = "La pantalla puede estar visible; teclado y mouse continúan bloqueados.";
    bannerEl.className = "safety-banner warning";
  } else if (session.consent?.decision === "approved") {
    bannerEl.textContent = "Soporte autorizado. Esperando la conexión del técnico.";
    bannerEl.className = "safety-banner warning";
  } else {
    bannerEl.textContent = "Aún no has autorizado soporte remoto.";
    bannerEl.className = "safety-banner";
  }
}

function renderCustomerHelp(session) {
  const closed = isTerminalStatus(session.status);
  const consentApproved = session.consent?.decision === "approved";
  const controlPending = session.controlConsent?.decision === "pending";
  const controlApproved = session.controlConsent?.decision === "approved";
  customerActionTarget = null;
  if (closed) {
    customerNextTitle.textContent = "La sesion ya termino";
    customerNextDetail.textContent = "No necesitas pulsar nada. Ningun acceso remoto permanece activo.";
  } else if (!consentApproved) {
    customerNextTitle.textContent = "Revisa la solicitud y elige una opcion";
    customerNextDetail.textContent = "Si pediste ayuda y reconoces al tecnico, haz clic en Autorizar soporte. Si no, usa Rechazar soporte.";
    customerActionTarget = approveConsentButton;
  } else if (controlPending && !controlApproved) {
    customerNextTitle.textContent = "Decide el permiso de teclado y mouse";
    customerNextDetail.textContent = "Haz clic en Permitir teclado y mouse solo si el tecnico explico por que lo necesita. Tambien puedes mantenerlos bloqueados.";
    customerActionTarget = approveControlButton;
  } else if (controlApproved) {
    customerNextTitle.textContent = "Supervisa la sesion";
    customerNextDetail.textContent = "El tecnico puede usar teclado y mouse. Si algo no te parece correcto, haz clic en Finalizar sesion ahora.";
    customerActionTarget = closeSessionButton;
  } else if (session.status === "active" || session.screenShare?.enabled) {
    customerNextTitle.textContent = "Observa el trabajo del tecnico";
    customerNextDetail.textContent = "No necesitas pulsar nada. Puedes finalizar la sesion en cualquier momento.";
    customerActionTarget = closeSessionButton;
  } else {
    customerNextTitle.textContent = "Espera la conexion del tecnico";
    customerNextDetail.textContent = "El soporte esta autorizado, pero aun no existe acceso activo. No necesitas pulsar nada.";
  }
  showCustomerActionButton.hidden = !customerActionTarget;
}

function renderButtons(session) {
  const closed = isTerminalStatus(session.status);
  const consentApproved = session.consent?.decision === "approved";
  const controlRequested = session.controlConsent?.decision === "pending";
  const controlApproved = session.controlConsent?.decision === "approved";

  approveConsentButton.hidden = closed || consentApproved;
  rejectConsentButton.hidden = closed || consentApproved;
  approveControlButton.hidden = true;
  rejectControlButton.hidden = true;
  closeSessionButton.hidden = closed;
  approveControlButton.disabled = requestInProgress || controlApproved;
}

function setState(selector, title, text, status) {
  const el = document.querySelector(selector);
  el.className = `safety-state ${status}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`;
}


function isTerminalStatus(status) {
  return ["closed", "consent_rejected", "expired", "consent_locked", "control_locked"].includes(status);
}
function labelConsent(value) {
  return ({ approved: "Autorizado", rejected: "Rechazado", expired: "Vencido", pending: "Pendiente" }[value] ?? "Pendiente");
}

function labelControl(value) {
  return ({ approved: "Autorizados", rejected: "Bloqueados", pending: "Permiso solicitado", revoked: "Permiso retirado", locked: "Bloqueados", not_requested: "Bloqueados" }[value] ?? "Bloqueados");
}

function labelSessionStatus(value) {
  return ({
    pending_customer_consent: "Espera tu autorización",
    authorized_waiting_agent: "Espera la conexión del técnico",
    authorized_waiting_agent_assignment: "Espera un equipo de soporte",
    active: "Soporte activo",
    closed: "Sesión finalizada",
    consent_rejected: "Solicitud rechazada",
    expired: "Solicitud vencida",
    consent_locked: "Solicitud bloqueada",
    control_locked: "Control bloqueado"
  }[value] ?? "Estado en actualización");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}



