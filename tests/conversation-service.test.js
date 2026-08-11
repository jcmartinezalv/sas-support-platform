import test from "node:test";
import assert from "node:assert/strict";
import { createAgentService } from "../src/agent/agent-service.js";
import { createConversationService } from "../src/agent/conversation-service.js";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";
import { createTicketStore } from "../src/tickets/ticket-store.js";
import { createContactStore } from "../src/contacts/contact-store.js";

function createHarness() {
  const deliveries = [];
  const ticketStore = createTicketStore();
  const remoteSessionStore = createRemoteSessionStore({ security: { ttlMinutes: 60 } });
  const agentService = createAgentService({ ticketStore });
  const whatsappClient = {
    async sendText(message) {
      deliveries.push(message);
      return { ok: true, skipped: true };
    }
  };
  const config = { publicBaseUrl: "https://sas.example.test" };
  const service = createConversationService({ agentService, remoteSessionStore, ticketStore, whatsappClient, config });
  return { deliveries, service, ticketStore, remoteSessionStore };
}

const remoteEvent = {
  from: "5215551002000",
  profileName: "Cliente WhatsApp",
  text: "Necesito soporte remoto por AnyDesk, no abre Outlook"
};

test("whatsapp remote intent creates ticket and remote session", async () => {
  const { deliveries, service, ticketStore, remoteSessionStore } = createHarness();

  const result = await service.handleWhatsAppMessage(remoteEvent);
  const ticket = ticketStore.get(result.ticketId);
  const session = remoteSessionStore.get(result.remoteSessionId);

  assert.equal(ticket.source, "whatsapp");
  assert.equal(result.diagnosis.category, "remote_support");
  assert.equal(result.diagnosis.nextAction, "request_remote_support");
  assert.ok(session, "remote session should be created");
  assert.equal(session.ticketId, ticket.id);
  assert.equal(deliveries.length, 1);
  assert.match(deliveries[0].body, new RegExp(session.joinCode));
  assert.match(deliveries[0].body, /remote\/consent\//);
  assert.match(deliveries[0].body, /abre SAS Cliente.*código/i);
});

test("remote link command reuses existing open session", async () => {
  const { deliveries, service, remoteSessionStore } = createHarness();

  const first = await service.handleWhatsAppMessage(remoteEvent);
  const second = await service.handleWhatsAppMessage({
    ...remoteEvent,
    text: "mandame el enlace remoto"
  });

  assert.equal(second.command, "remote_link");
  assert.equal(second.remoteSessionId, first.remoteSessionId);
  assert.equal(remoteSessionStore.list().length, 1);
  assert.equal(deliveries.length, 2);
  assert.match(deliveries[1].body, /soporte remoto seguro listo/i);
});

test("customer closure request preserves ticket and remote session for documented manual closure", async () => {
  const { deliveries, service, ticketStore, remoteSessionStore } = createHarness();

  const first = await service.handleWhatsAppMessage(remoteEvent);
  const closed = await service.handleWhatsAppMessage({
    ...remoteEvent,
    text: "gracias ya quedo, cerrar ticket"
  });

  assert.equal(closed.command, "resolve");
  assert.equal(ticketStore.get(first.ticketId).status, "resolved");
  assert.notEqual(remoteSessionStore.get(first.remoteSessionId).status, "closed");

  const confirmed = await service.handleWhatsAppMessage({ ...remoteEvent, text: "confirmar cierre" });
  assert.equal(confirmed.command, "confirm_close");
  assert.equal(ticketStore.get(first.ticketId).status, "resolved");
  assert.notEqual(remoteSessionStore.get(first.remoteSessionId).status, "closed");
  assert.match(deliveries.at(-1).body, /(permanece|seguirá) abierto.*documente.*Tickets/i);
});

test("cancel remote command closes remote session but keeps ticket open", async () => {
  const { deliveries, service, ticketStore, remoteSessionStore } = createHarness();

  const first = await service.handleWhatsAppMessage(remoteEvent);
  const cancelled = await service.handleWhatsAppMessage({
    ...remoteEvent,
    text: "cancelar soporte remoto por favor"
  });

  const ticket = ticketStore.get(first.ticketId);
  const session = remoteSessionStore.get(first.remoteSessionId);

  assert.equal(cancelled.command, "cancel_remote");
  assert.equal(ticket.status, "waiting_customer");
  assert.equal(session.status, "closed");
  assert.match(deliveries.at(-1).body, /ticket sigue abierto/i);
});

test("status command returns friendly spanish labels", async () => {
  const { deliveries, service } = createHarness();

  await service.handleWhatsAppMessage(remoteEvent);
  const status = await service.handleWhatsAppMessage({
    ...remoteEvent,
    text: "estado de mi ticket"
  });

  assert.equal(status.command, "status");
  assert.match(deliveries.at(-1).body, /Estado: Abierto/);
  assert.match(deliveries.at(-1).body, /Prioridad: Normal/);
  assert.match(deliveries.at(-1).body, /Sesion remota: Esperando consentimiento/);
});



test("help inside a problem description is diagnosed instead of opening the menu", async () => {
  const { service } = createHarness();
  const result = await service.handleWhatsAppMessage({ ...remoteEvent, text: "Outlook no abre y necesito ayuda" });
  assert.equal(result.command, undefined);
  assert.equal(result.diagnosis.category, "email");
});

test("customer reply hides internal category and confidence", async () => {
  const { service, deliveries } = createHarness();
  await service.handleWhatsAppMessage({ ...remoteEvent, text: "Outlook no abre" });
  assert.doesNotMatch(deliveries[0].body, /confidence|confianza|Diagnostico inicial:|email \(/i);
  assert.match(deliveries[0].body, /correo/i);
});

test("security reports become urgent", async () => {
  const { service, ticketStore } = createHarness();
  const result = await service.handleWhatsAppMessage({ ...remoteEvent, text: "Creo que abrí un correo de phishing y puede tener malware" });
  assert.equal(ticketStore.get(result.ticketId).priority, "urgent");
});

test("duplicate Meta message id is ignored", async () => {
  const { service, deliveries } = createHarness();
  const event = { ...remoteEvent, id: "wamid.same", text: "Outlook no abre" };
  await service.handleWhatsAppMessage(event);
  const duplicate = await service.handleWhatsAppMessage(event);
  assert.equal(duplicate.duplicate, true);
  assert.equal(deliveries.length, 1);
});

test("WhatsApp attachment metadata is stored as evidence", async () => {
  const { service, ticketStore } = createHarness();
  const result = await service.handleWhatsAppMessage({ ...remoteEvent, id: "wamid.image", type: "image", text: "Captura del error", attachments: [{ id: "media-1", type: "image", mimeType: "image/jpeg" }] });
  const first = ticketStore.get(result.ticketId).messages[0];
  assert.equal(first.attachments[0].id, "media-1");
  assert.equal(first.messageType, "image");
});
test("Fisher completes WhatsApp customer data before diagnosis and links Agenda", async () => {
  const deliveries = [];
  const ticketStore = createTicketStore();
  const contactStore = createContactStore();
  const remoteSessionStore = createRemoteSessionStore({ security: { ttlMinutes: 60 } });
  const agentService = createAgentService({ ticketStore });
  const auditEvents = [];
  const service = createConversationService({
    agentService,
    remoteSessionStore,
    ticketStore,
    contactStore,
    auditStore: { record(event) { auditEvents.push(event); } },
    whatsappClient: { async sendText(message) { deliveries.push(message); return { ok: true, skipped: true }; } },
    config: { publicBaseUrl: "https://sas.example.test" }
  });

  const first = await service.handleWhatsAppMessage({ from: "5215559876543", profileName: "Perfil WA", text: "Necesito soporte" });
  assert.equal(first.intakeStage, "customer_details");
  assert.match(deliveries.at(-1).body, /Nombre:.*Empresa:.*Correo:/s);
  assert.equal(contactStore.list().length, 0);

  const identified = await service.handleWhatsAppMessage({ from: "5215559876543", profileName: "Perfil WA", text: "Nombre: Ana López\nEmpresa: Contoso México\nCorreo: ana@example.com" });
  assert.equal(identified.intakeStage, "problem_details");
  assert.equal(contactStore.findByPhone("+52 1 555 987 6543").email, "ana@example.com");
  assert.match(deliveries.at(-1).body, /Agenda de SAS/);
  assert.match(deliveries.at(-1).body, /describe el problema.*fotografía\/captura/i);

  const diagnosed = await service.handleWhatsAppMessage({ from: "5215559876543", profileName: "Perfil WA", text: "Creo que abrí un correo de phishing y puede tener malware" });
  assert.equal(diagnosed.diagnosis.category, "security");
  assert.equal(diagnosed.remoteSessionId, null, "Un incidente de seguridad no debe abrir acceso remoto automáticamente");
  assert.equal(auditEvents.at(-1).action, "agent.escalated");
  const remoteLink = await service.handleWhatsAppMessage({ from: "5215559876543", profileName: "Perfil WA", text: "enlace remoto" });
  assert.ok(remoteLink.remoteSessionId);
  assert.match(deliveries.at(-1).body, /Liga: .*remote\/consent\//);
  assert.equal(auditEvents.at(-1).metadata.status, "escalated");
});

test("Fisher analyzes WhatsApp images, escalates risk and notifies a technician immediately", async () => {
  const deliveries = [];
  const escalations = [];
  const ticketStore = createTicketStore();
  const remoteSessionStore = createRemoteSessionStore({ security: { ttlMinutes: 60 } });
  const agentService = createAgentService({ ticketStore });
  const service = createConversationService({
    agentService,
    remoteSessionStore,
    ticketStore,
    imageAnalysisService: {
      async analyzeWhatsAppAttachments() {
        return {
          status: "completed",
          summary: "Se observa un aviso de pérdida de datos.",
          visibleText: ["Error crítico"],
          likelyCauses: ["Disco"],
          safeChecks: ["No reiniciar el equipo"],
          riskSignals: ["Posible pérdida de datos"],
          needsHuman: true,
          urgency: "urgent",
          confidence: 0.94,
          imageCount: 1,
          model: "gpt-test"
        };
      }
    },
    auditStore: { record(event) { return { id: `A-${escalations.length}`, ...event }; } },
    onHumanEscalation(payload) { escalations.push(payload); },
    whatsappClient: { async sendText(message) { deliveries.push(message); return { sent: true }; } },
    config: { publicBaseUrl: "https://sas.example.test" }
  });

  const result = await service.handleWhatsAppMessage({
    ...remoteEvent,
    id: "wamid.visual-risk",
    type: "image",
    text: "Apareció este mensaje",
    attachments: [{ id: "MEDIA1", type: "image", mimeType: "image/png" }]
  });
  assert.equal(result.imageAnalysis.needsHuman, true);
  assert.equal(ticketStore.get(result.ticketId).priority, "urgent");
  assert.equal(escalations.length, 1);
  assert.match(deliveries.at(-1).body, /Fisher analizó la imagen/);
  assert.match(ticketStore.get(result.ticketId).messages.find((item) => item.author === "Fisher Vision").body, /Análisis visual/);
});