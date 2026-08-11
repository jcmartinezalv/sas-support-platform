import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAgentService } from "../src/agent/agent-service.js";
import { createConversationService } from "../src/agent/conversation-service.js";
import { createContactStore } from "../src/contacts/contact-store.js";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";
import { createTicketStore } from "../src/tickets/ticket-store.js";

test("Fisher waits for data and client installation before exposing a ticket", async () => {
  const deliveries = [];
  const ticketStore = createTicketStore();
  const contactStore = createContactStore();
  const remoteSessionStore = createRemoteSessionStore({ security: { ttlMinutes: 60 } });
  let installed = false;
  const service = createConversationService({
    agentService: createAgentService({ ticketStore }), remoteSessionStore, ticketStore, contactStore,
    whatsappClient: { async sendText(message) { deliveries.push(message); return { sent: true }; } },
    resolveClientInstallation: async () => installed
      ? { installed: true, agent: { machineId: "PC-DESKTOP-BRD5IOH", hostname: "DESKTOP-BRD5IOH" } }
      : { installed: false, installationUrl: "https://sas.example.test/i/ABCDEFGH", enrollment: { shortCode: "ABCDEFGH" } },
    config: { publicBaseUrl: "https://sas.example.test" }
  });

  const first = await service.handleWhatsAppMessage({ from: "5215551234567", profileName: "Ana", text: "Necesito ayuda" });
  assert.equal(first.intakeStage, "customer_details");
  assert.equal(ticketStore.get(first.ticketId).status, "intake");

  const data = await service.handleWhatsAppMessage({ from: "5215551234567", profileName: "Ana", text: "Nombre: Ana López\nEmpresa: Contoso\nCorreo: ana@example.com" });
  assert.equal(data.intakeStage, "client_installation");
  assert.match(deliveries.at(-1).body, /sas\.example\.test\/i\/ABCDEFGH/);
  assert.equal(ticketStore.get(first.ticketId).status, "intake");

  installed = true;
  const ready = await service.handleWhatsAppMessage({ from: "5215551234567", profileName: "Ana", text: "Ya quedó instalado" });
  assert.equal(ready.intakeStage, "problem_details");
  assert.equal(ticketStore.get(first.ticketId).equipmentId, "PC-DESKTOP-BRD5IOH");

  const created = await service.handleWhatsAppMessage({ from: "5215551234567", profileName: "Ana", text: "Outlook no abre y muestra error 0x800" });
  assert.equal(created.diagnosis.category, "email");
  assert.equal(ticketStore.get(first.ticketId).status, "open");
  assert.match(ticketStore.get(first.ticketId).description, /Outlook no abre/);
});

test("ticket persists equipment and contact relationships", () => {
  const store = createTicketStore();
  const ticket = store.create({ customerName: "Ana", customerPhone: "521", description: "Prueba", status: "intake", contactId: "CNT-1", equipmentId: "PC-1", intakeStage: "client_installation" });
  assert.equal(ticket.status, "intake");
  assert.equal(ticket.contactId, "CNT-1");
  assert.equal(ticket.equipmentId, "PC-1");
  store.update(ticket.id, { status: "open", intakeStage: null, equipmentId: "PC-2", description: "Problema final" });
  assert.equal(store.get(ticket.id).equipmentId, "PC-2");
  assert.equal(store.get(ticket.id).intakeStage, null);
  assert.equal(store.get(ticket.id).description, "Problema final");
});

test("ticket UI groups by equipment and never auto-closes the remote popup", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(app, /ticket-row-group/);
  assert.match(app, /state.ticketGroupBy === "equipment"/);
  assert.match(app, /function ticketEquipment/);
  assert.match(app, /function openTicketRemoteSupport/);
  assert.match(app, /Abrir pantalla de soporte/);
  assert.doesNotMatch(app, /popup\.close\(\)/);
  assert.doesNotMatch(app, /existingPopup\.location\.href !== workspaceUrl/);
  assert.match(app, /existingPopup\.location\.pathname/);
  assert.match(css, /\.ticket-context-grid/);
});
test("SAS Cliente creates and assigns a complete WhatsApp ticket without copying codes", () => {
  const agent = fs.readFileSync(new URL("../client/agent-client.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  for (const marker of [/supportSessionCount/, /Esperando soporte/, /normalizeSupportWhatsApp/, /asignado automáticamente a este equipo/, /supportCompany[^\n]+required/, /supportPhone[^\n]+required/, /supportEmail[^\n]+required/]) assert.match(agent, marker);
  assert.doesNotMatch(agent, /Código de seguimiento:/);
  assert.match(app, /const isWhatsApp = Boolean\(ticket\.customerPhone\)/);
});