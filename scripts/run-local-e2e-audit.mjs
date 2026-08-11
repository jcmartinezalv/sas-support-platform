import fs from "node:fs";
import path from "node:path";

const serverUrl = process.argv.find((arg) => arg.startsWith("--server="))?.split("=")[1] ?? process.env.SAS_SERVER_URL ?? "http://127.0.0.1:3110";
const outDir = path.resolve("output", "reports");
const startedAt = new Date().toISOString();
const steps = [];
const artifacts = {};

function headers(extra = {}) {
  return {
    "content-type": "application/json",
    "x-sas-role": "admin",
    "x-sas-actor": "e2e-auditor",
    ...extra
  };
}

async function request(method, route, body) {
  const res = await fetch(`${serverUrl}${route}`, {
    method,
    headers: headers(),
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    const error = new Error(payload?.error ?? `${method} ${route} failed with ${res.status}`);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function step(name, fn, options = {}) {
  const started = Date.now();
  try {
    const data = await fn();
    const status = options.warn ? "warn" : "pass";
    steps.push({ name, status, ms: Date.now() - started, data });
    return data;
  } catch (error) {
    const status = options.optional ? "warn" : "fail";
    steps.push({ name, status, ms: Date.now() - started, error: error.message, details: error.payload ?? null });
    if (!options.optional) throw error;
    return null;
  }
}

function latestOpenSessionForTicket(sessions, ticketId) {
  return [...sessions]
    .reverse()
    .find((session) => session.ticketId === ticketId && !["closed", "expired", "consent_rejected"].includes(session.status));
}

function scoreReport() {
  const pass = steps.filter((item) => item.status === "pass").length;
  const warn = steps.filter((item) => item.status === "warn").length;
  const fail = steps.filter((item) => item.status === "fail").length;
  const percent = Math.round((pass / Math.max(1, steps.length)) * 100);
  const status = fail ? "fail" : warn ? "warn" : "pass";
  return { status, percent, pass, warn, fail, total: steps.length };
}

function writeReports(report) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "local-e2e-audit.json");
  const mdPath = path.join(outDir, "local-e2e-audit.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  const rows = report.steps.map((item) => `| ${item.status.toUpperCase()} | ${item.name} | ${item.ms} ms | ${item.error ?? summarize(item.data)} |`).join("\n");
  fs.writeFileSync(mdPath, `# SAS - Auditoria local extremo a extremo\n\nFecha: ${report.startedAt}\nServidor: ${report.serverUrl}\nEstado: ${report.summary.status}\nAvance: ${report.summary.percent}%\n\n| Estado | Paso | Tiempo | Resultado |\n|---|---:|---:|---|\n${rows}\n\n## Siguientes acciones\n\n${report.nextActions.map((item) => `- ${item}`).join("\n")}\n`, "utf8");
  return { jsonPath, mdPath };
}

function summarize(data) {
  if (!data) return "OK";
  if (data.status) return String(data.status);
  if (data.id) return String(data.id);
  if (data.ticketId) return String(data.ticketId);
  if (data.joinCode) return String(data.joinCode);
  if (data.percent != null) return `${data.percent}%`;
  return "OK";
}

const nextActions = [];
const auditPhone = `521555${String(Date.now()).slice(-7)}`;
let ticketId = null;
let session = null;
let onlineAgent = null;

try {
  const health = await step("Servidor responde /health", () => request("GET", "/health"));
  artifacts.health = health;

  const readinessPayload = await step("Checklist de produccion disponible", () => request("GET", "/api/admin/readiness"), { optional: true });
  artifacts.readiness = readinessPayload?.readiness ?? null;
  if (artifacts.readiness?.status !== "pass") nextActions.push("Completar pendientes de Preparacion antes de produccion real.");

  const agentsPayload = await step("Buscar agente Windows en linea", () => request("GET", "/api/agents"), { optional: true });
  onlineAgent = (agentsPayload?.agents ?? []).find((agent) => agent.status === "online") ?? null;
  if (!onlineAgent) nextActions.push("Iniciar o revisar el agente Windows antes de probar pantalla/control reales.");

  let simulated = await step("WhatsApp simulado abre el caso con Fisher", () => request("POST", "/api/dev/whatsapp-simulate", {
    from: auditPhone,
    profileName: "Cliente Auditoría",
    text: "Necesito soporte remoto, no abre Outlook y quiero que revisen mi equipo"
  }));
  ticketId = simulated?.result?.ticketId;

  if (simulated?.result?.intakeStage === "customer_details") {
    await step("Fisher vincula datos del cliente con Agenda", () => request("POST", "/api/dev/whatsapp-simulate", {
      from: auditPhone,
      profileName: "Cliente Auditoría",
      text: "Nombre: Cliente Auditoría\nEmpresa: SAS Pruebas\nCorreo: auditoria@example.test"
    }));
    if (!onlineAgent) {
      const installation = await step("Crear vinculacion temporal para la auditoria", () => request("POST", `/api/tickets/${ticketId}/installation-link`, {}));
      const auditAgent = { machineId: `e2e-agent-${String(Date.now()).slice(-10)}`, hostname: "SAS-E2E-TEMP", username: "auditoria", os: "Windows 11", version: health.version, capabilities: { screenCapture: true, interactiveControl: true, realInputEnabled: true, inputHelperAvailable: true, inputHelperReady: true } };
      const enrolled = await step("Vincular agente temporal aislado", () => request("POST", "/api/agents/enroll", { ...auditAgent, enrollmentToken: installation.enrollment.shortCode }));
      onlineAgent = enrolled.agent ?? auditAgent;
    }    simulated = await step("Fisher recibe el problema y prepara soporte", () => request("POST", "/api/dev/whatsapp-simulate", {
      from: auditPhone,
      profileName: "Cliente Auditoría",
      text: "Necesito soporte remoto, no abre Outlook y quiero que revisen mi equipo"
    }));
  }
  artifacts.whatsapp = { ticketId, category: simulated?.result?.diagnosis?.category, command: simulated?.result?.command ?? null };

  const sessionsPayload = await request("GET", "/api/remote-sessions");
  session = latestOpenSessionForTicket(sessionsPayload.sessions ?? [], ticketId);
  if (!session) throw new Error("No se encontro sesion remota abierta para el ticket generado");
  await step("Localizar sesion remota generada", async () => ({ id: session.id, joinCode: session.joinCode, status: session.status, ticketId: session.ticketId }));
  artifacts.session = { id: session.id, joinCode: session.joinCode, status: session.status };

  const consent = await step("Aprobar consentimiento del cliente", () => request("POST", `/api/remote-sessions/code/${session.joinCode}/consent`, {
    decision: "approved",
    decidedBy: "e2e-customer"
  }));
  session = consent.session;

  if (onlineAgent && !session.agentId) {
    const assigned = await step("Asignar agente Windows", () => request("POST", `/api/remote-sessions/${session.id}/assign-agent`, { agentId: onlineAgent.machineId }));
    session = assigned.session;
  } else if (!onlineAgent) {
    await step("Asignar agente Windows", async () => ({ skipped: true, reason: "Sin agente online" }), { warn: true });
  }

  if (session.agentId) {
    const started = await step("Iniciar conexion remota", () => request("POST", `/api/remote-sessions/${session.id}/start`));
    session = started.session;
    const screen = await step("Activar vista fluida", () => request("POST", `/api/remote-sessions/${session.id}/screen/start`, {
      intervalSeconds: 1,
      quality: 45,
      maxWidth: 960,
      profile: "lowLatency"
    }));
    session = screen.session;
    artifacts.screenShare = screen.session.screenShare;
    if (screen.session.screenShare?.profile !== "lowLatency") nextActions.push("Revisar perfil de pantalla fluida; no quedo como lowLatency.");
    await step("Solicitar diagnostico del equipo remoto", () => request("POST", `/api/remote-sessions/${session.id}/commands`, { type: "system_info" }));
  } else {
    nextActions.push("Repetir prueba con agente online para validar inicio, pantalla fluida y diagnostico remoto.");
  }

  const finalSessions = await request("GET", "/api/remote-sessions");
  const latest = finalSessions.sessions.find((item) => item.id === session.id) ?? session;
  await step("Leer estado final de sesiones", async () => ({ id: latest.id, status: latest.status, agentId: latest.agentId, commandCount: (latest.commands ?? []).length, screenProfile: latest.screenShare?.profile ?? null }));
  artifacts.finalSession = {
    id: latest.id,
    status: latest.status,
    agentId: latest.agentId,
    screenShare: latest.screenShare,
    commandCount: (latest.commands ?? []).length
  };

  const closed = await step("Cerrar sesion de auditoria", () => request("POST", `/api/remote-sessions/${session.id}/close`), { optional: true });
  artifacts.closed = closed?.session ? { id: closed.session.id, status: closed.session.status } : null;
} catch (error) {
  steps.push({ name: "Completar flujo extremo a extremo", status: "fail", ms: 0, error: error.message, details: error.payload ?? null });
  nextActions.push(`Corregir bloqueo de auditoría: ${error.message}`);
}

if (!nextActions.length) nextActions.push("Flujo local listo para repetir con usuario final y WhatsApp real.");

const report = {
  serverUrl,
  startedAt,
  finishedAt: new Date().toISOString(),
  summary: scoreReport(),
  steps,
  artifacts,
  nextActions
};
report.files = writeReports(report);
console.log(JSON.stringify(report, null, 2));
process.exit(report.summary.fail ? 1 : 0);



