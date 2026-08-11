import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readPublic(file) {
  return fs.readFileSync(path.join(process.cwd(), "public", file), "utf8").replace(/^\uFEFF/, "");
}

function literalPattern(text) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test("operator console keeps simplified visible labels", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const surface = `${html}\n${app}`;

  for (const label of [
    "SAS Soporte",
    "Tickets",
    "Remoto",
    "Operación",
    "Equipos",
    "Soluciones",
    "Estado",
    "Nuevo ticket",
    "Pedir ayuda a Fisher",
    "Semáforo de producción",
    "Soporte remoto"
  ]) {
    assert.match(surface, literalPattern(label));
  }
});

test("operator console avoids legacy technical labels", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const surface = `${html}\n${app}`;

  for (const legacyLabel of [
    "Support Console",
    "MVP operativo",
    "Gate de liberacion",
    "Liberacion MVP",
    "Preflight cliente",
    "Laboratorio control real",
    "Fisher avanzado",
    "Detalle tecnico",
    "Crear caso",
    "Simular WhatsApp",
    "Conexion remota",
    "Guia de prueba",
    "Operacion productiva"
  ]) {
    assert.doesNotMatch(surface, literalPattern(legacyLabel));
  }
});

test("all customer-facing support surfaces call records Tickets", () => {
  const surfaces = [
    readPublic("remote-workspace.html"),
    readPublic("remote-consent.js"),
    fs.readFileSync(path.join(process.cwd(), "src", "mobile", "mobile-notification-store.js"), "utf8"),
    fs.readFileSync(path.join(process.cwd(), "src", "mobile", "mobile-fisher-service.js"), "utf8").replace(/\/urgente\|casos[^\n]+/, "")
  ].join("\n");
  assert.doesNotMatch(surfaces, /\bcasos?\b/i);
  assert.match(surfaces, /Ticket urgente/);
  assert.match(surfaces, /Mensajes del ticket/);
});
test("remote-control identifiers are not damaged by copy cleanup", () => {
  const app = readPublic("app.js");
  const workspace = readPublic("remote-workspace.html");
  for (const identifier of ["openRemoteTicket", "requestInteractiveControl", "filterControl", "realLabControl"]) {
    assert.match(app, new RegExp("\\b" + identifier + "\\b"));
  }
  for (const marker of ["clipboard-set", "clipboard-get", "Solicitar control", "Pantalla completa"]) assert.match(workspace, literalPattern(marker));
  assert.doesNotMatch(app, /[A-Za-z]+Teclado y mouse/);
  assert.doesNotMatch(app, /Teclado y mouse[A-Za-z]+/);
});
test("operator console exposes color-coded operational alerts", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const css = readPublic("styles.css");

  assert.match(html, /id="alertCenter"/);
  assert.match(app, /function renderOperationalAlerts/);
  assert.match(app, /Producción bloqueada/);
  assert.match(app, /Sin equipos en línea/);
  assert.match(css, /\.alert-card\.danger/);
  assert.match(css, /\.alert-card\.warning/);
  assert.match(css, /\.ticket-row\.priority-urgent/);
});
test("operator console exposes per-view summary cards", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const css = readPublic("styles.css");

  for (const id of ["ticketsSummary", "remoteSummary", "testsSummary", "agentsSummary", "knowledgeSummary", "auditSummary"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(app, /function renderViewSummaries/);
  assert.match(app, /summary-card/);
  assert.match(app, /Tickets abiertos/);
  assert.match(app, /Esperan permiso/);
  assert.match(css, /\.view-summary/);
  assert.match(css, /\.summary-card\.danger/);
  assert.match(css, /\.agent-card\.status-online/);
  assert.match(css, /\.knowledge-card\.status-pending_review/);
});
test("operator console exposes navigation status signals", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const css = readPublic("styles.css");

  assert.match(html, /id="topbarSignal"/);
  assert.match(app, /function renderTopbarSignal/);
  assert.match(app, /function renderNavigationSignals/);
  assert.match(app, /navSignal/);
  assert.match(app, /nav-warning/);
  assert.match(app, /nav-danger/);
  assert.match(css, /\.topbar-signal\.success/);
  assert.match(css, /\.nav-signal/);
  assert.match(css, /navigation-signal-pass/);
});
test("Tickets use compact grouped rows without next-click cards", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const css = readPublic("styles.css");
  for (const id of ["ticketSearch", "ticketStatusFilter", "ticketGroupBy", "ticketsList"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const marker of ["ticketMatchesCurrentFilter", "ticketGroup", "ticket-row", "ticket-row-group"]) assert.match(app, literalPattern(marker));
  assert.match(css, /\.ticket-row\s*\{/);
  assert.match(css, /\.ticket-table-toolbar\s*\{/);
  assert.doesNotMatch(app, /function nextHint|Siguiente clic/);
});
test("operator console exposes dual AI research providers", () => {
  const app = readPublic("app.js");
  assert.match(app, /id="researchGoogleAi">Buscar con Google/);
  assert.match(app, /id="researchOpenAi">Buscar con OpenAI/);
  assert.match(app, /id="researchConsensus">Comparar ambos/);
  assert.match(app, /function researchWithAi/);
  assert.match(app, /research-openai/);
  assert.match(app, /research-google-ai/);
  assert.match(app, /research-consensus/);
});
test("knowledge cards expose AI consensus and safety details", () => {
  const app = readPublic("app.js");
  const css = readPublic("styles.css");
  assert.match(app, /function renderConsensusSummary/);
  assert.match(app, /Proveedores no coinciden/);
  assert.match(app, /function renderResearchSafety/);
  assert.match(app, /Datos protegidos/);
  assert.match(app, /renderResearchList\("Reversion"/);
  assert.match(app, /window\.confirm/);
  assert.match(css, /\.consensus-summary\.danger/);
  assert.match(css, /\.research-safety/);
});


test("operator console manages mobile users with explicit revocation warnings", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const css = readPublic("styles.css");
  assert.match(html, /data-view="mobile-users"/);
  assert.match(html, /id="createMobileUser"/);
  assert.match(html, /Contraseña temporal/);
  assert.match(app, /function renderMobileUsers/);
  assert.match(app, /api\/mobile-admin\/v1\/users/);
  assert.match(app, /sesiones se cerrarán inmediatamente/);
  assert.match(app, /Todas las sesiones y dispositivos.*serán revocados/);
  assert.match(css, /\.mobile-user-form/);
  assert.match(css, /\.mobile-password-reset/);
});

test("operator console presents Fisher as an accessible visual workbench", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const css = readPublic("styles.css");

  assert.match(html, /class="panel fisher-workbench"/);
  assert.match(html, /id="diagnosisResult" class="diagnosis-result" aria-live="polite"/);
  assert.match(html, /Asistente de diagnóstico y resolución supervisada/);
  assert.match(app, /function setButtonLoading/);
  assert.match(app, /fisher-thinking/);
  assert.match(app, /fisher-feedback error/);
  assert.match(css, /visual-refresh-2026-07/);
  assert.match(css, /\.fisher-response-label/);
  assert.match(css, /prefers-reduced-motion/);
});


test("remote consent explains capabilities without raw session data", () => {
  const html = readPublic("remote-consent.html");
  const app = readPublic("remote-consent.js");
  assert.match(html, /Tu sesión de soporte/);
  assert.match(html, /id="currentCapability"/);
  assert.match(html, /Información técnica/);
  assert.match(app, /function renderCapability/);
  assert.match(app, /Teclado y mouse autorizados/);
  assert.match(app, /window\.confirm/);
  assert.doesNotMatch(app, /consentimiento:\s*session\.consent/);
  assert.doesNotMatch(app, /Error HTTP/);
  assert.doesNotMatch(app, /\}\[value\] \?\? value/);
});

test("local Windows panel leads with human safety states", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "client", "agent-client.js"), "utf8");
  assert.match(source, /SAS en este equipo/);
  assert.match(source, /function localSessionLabel/);
  assert.match(source, /Teclado y mouse/);
  assert.match(source, /<summary>Información técnica<\/summary>/);
  assert.doesNotMatch(source, /<span>Helper de control<\/span>/);
  assert.doesNotMatch(source, /<strong>Archivo de paro:<\/strong>/);
});

test("Android translates roles, states and activity for people", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "android-app", "app", "src", "main", "java", "mx", "setinfo", "fisher", "MainActivity.kt"), "utf8");
  assert.match(source, /mobileRoleLabel/);
  assert.match(source, /mobileStatusLabel/);
  assert.match(source, /mobilePriorityLabel/);
  assert.match(source, /mobileActionLabel/);
  assert.match(source, /mobileDateLabel/);
  assert.doesNotMatch(source, /title\.take\(1\)/);
  assert.doesNotMatch(source, /Text\(item\.optString\("priority"\)\)/);
});

test("operator console exposes the WhatsApp conversation inbox", () => {
  const app = readPublic("app.js");
  const css = readPublic("styles.css");
  for (const text of ["Conversacion por WhatsApp", "Responder al cliente", "Enviar por WhatsApp", "/reply", "Actividad interna"]) assert.match(app, literalPattern(text));
  for (const selector of [".whatsapp-thread", ".chat-bubble.inbound", ".chat-bubble.outbound", ".whatsapp-composer", ".evidence-chip"]) assert.match(css, literalPattern(selector));
});


test("operator console removes obsolete click guidance while customer consent remains clear", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const consent = readPublic("remote-consent.html");
  const consentJs = readPublic("remote-consent.js");
  for (const text of ["Ayuda de esta pantalla", "Siguiente clic", "Mostrarme donde", "Revisar pendientes", "Revisión de Windows"]) assert.doesNotMatch(`${html}\n${app}`, literalPattern(text));
  for (const text of ["Que debes hacer ahora", "Mostrar boton"]) assert.match(consent, literalPattern(text));
  assert.match(consentJs, /renderCustomerHelp/);
});


test("SAS exposes a safe client-only installation journey", () => {
  const app=readPublic("app.js"); const html=readPublic("client-install.html"); const js=readPublic("client-install.js");
  for(const text of ["Enviar liga de instalación","instalar solamente SAS Cliente","/installation-link"]) assert.match(app,literalPattern(text));
  for(const text of ["SAS Cliente","Código corto","Descargar SAS Cliente","no autoriza soporte remoto"]) assert.match(html,new RegExp(text,"i"));
  assert.match(js,/client-installations\/code/); assert.match(js,/clipboard\.writeText/); assert.match(app,/TinyURL/); assert.match(app,/Bitly/); assert.match(app,/liga corta interna/);
});



test("desktop download and cases use focused responsive layouts", () => {
  const index = readPublic("index.html");
  const app = readPublic("app.js");
  const css = readPublic("styles.css");
  assert.match(index, /<dialog id="ticketDialog"/);
  assert.match(app, /openTicketDialog/);
  assert.match(app, /changedTicketIds/);
  assert.match(css, /body\.client-install-page\s*\{[^}]*display:\s*block/s);
  assert.match(css, /max-width:\s*1180px/);
  assert.match(css, /\.case-dialog::backdrop/);
  assert.match(css, /\.ticket-row\.has-change/);
  assert.match(css, /\.ticket-row\s*\{[^}]*grid-template-columns/s);
});


test("operator console exposes a guarded update workflow",()=>{const html=readPublic("index.html");const app=readPublic("app.js");for(const text of ["updateStatus","Buscar actualización","Descargar y verificar","ACTUALIZAR","revierte automáticamente","Programador:","lastSchedule","updateConfirmDialog","Frase de confirmación"])assert.match(`${html}\n${app}`,literalPattern(text));assert.doesNotMatch(app,/window\.prompt/);});

test("console explains detected Windows computer name changes", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  assert.match(app, /Nombre de equipo actualizado/);
  assert.match(app, /Nombre actualizado/);
  assert.match(app, /Historial de nombres/);
  assert.match(app, /se conservaron su historial y vinculación/);
  assert.match(app, /agent\.hostname_changed/);
});

test("Windows agent persists a stable identity across hostname changes", () => {
  const client = fs.readFileSync(path.join(process.cwd(), "client", "agent-client.js"), "utf8");
  const installer = fs.readFileSync(path.join(process.cwd(), "scripts", "install-client.ps1"), "utf8");
  assert.match(client, /SAS_AGENT_IDENTITY_FILE/);
  assert.match(client, /credential\?\.agentId/);
  assert.match(client, /resolveStableMachineId/);
  assert.match(client, /const machineId = credentialMachineId \|\| storedMachineId \|\| legacyMachineId/);
  assert.match(installer, /SAS_AGENT_IDENTITY_FILE=\$InstallPath\\agent-identity\.json/);
});
test("quick support starts from Equipos while the unattended password stays in SAS Cliente", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  const client = fs.readFileSync(path.join(process.cwd(), "client", "agent-client.js"), "utf8");
  const server = fs.readFileSync(path.join(process.cwd(), "src", "server.js"), "utf8");
  assert.match(app, /function startRemoteFromAgent/);
  assert.match(app, /function showView\(viewName\)/);
  assert.match(app, /data-agent-remote/);
  assert.match(app, /data-agent-card/);
  assert.match(app, /Contraseña desatendida establecida/);
  assert.match(app, /unattended-request/);
  assert.match(client, /Acceso desatendido de este equipo/);
  assert.match(client, /no uses la contraseña de Windows/);
  assert.match(client, /La contraseña ya no se solicita desde esta página/);
  assert.doesNotMatch(client, /id="unattendedPassword"/);
  const tray = fs.readFileSync(path.join(process.cwd(), "scripts", "sas-client-tray.ps1"), "utf8");
  assert.match(tray, /Configurar acceso desatendido/);
  assert.match(tray, /UseSystemPasswordChar/);
  assert.match(client, /SAS_UNATTENDED_POLICY_FILE/);
  assert.match(client, /\/unattended-access/);
  assert.match(client, /\/api\/agents\/unattended-decision/);
  assert.match(server, /remote:unattended/);
  assert.match(server, /assertIndividualAgentSecret/);
  assert.match(server, /La contraseña debe permanecer únicamente en SAS Cliente/);
  assert.doesNotMatch(server, /verifyUnattended/);
});test("Windows agent explains and repairs an expired individual credential", () => {
  const client = fs.readFileSync(path.join(process.cwd(), "client", "agent-client.js"), "utf8");
  assert.match(client, /Requiere vinculación/);
  assert.match(client, /No necesitas reinstalar SAS/);
  assert.match(client, /url\.pathname === "\/enroll"/);
  assert.match(client, /\^\[A-HJ-NP-Z2-9\]\{8\}\$/);
  assert.match(client, /credentialRejected/);
  assert.match(client, /enrollWithToken/);
});
test("hostname rename notice is rendered only inside agent cards", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  assert.equal((app.match(/\$\{renameNotice\}/g) ?? []).length, 1);
});

test("remote view is a compact ticket launcher without duplicated equipment inventory", () => {
  const html = readPublic("index.html");
  const app = readPublic("app.js");
  const css = readPublic("styles.css");
  assert.match(html, /id="remoteList" class="remote-ticket-grid"/);
  assert.doesNotMatch(html, /id="remoteEquipmentCards"/);
  assert.doesNotMatch(html, /id="quickSupportForm"/);
  for (const marker of [/remote-ticket-card/,/remote-ticket-person/,/remote-ticket-equipment/,/data-open-remote-ticket/,/function openRemoteTicket/]) assert.match(app, marker);
  assert.match(css, /\.remote-ticket-grid/);
  assert.match(css, /\.remote-ticket-equipment\.unassigned/);
});