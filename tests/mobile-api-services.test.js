import test from "node:test";
import assert from "node:assert/strict";
import { buildMobileActivity, buildMobileDashboard } from "../src/mobile/mobile-view-service.js";
import { createMobileFisherService } from "../src/mobile/mobile-fisher-service.js";

const tickets = [{ id: "TCK-UNO", subject: "VPN", customerName: "Ana", status: "open", priority: "urgent", source: "whatsapp", updatedAt: "2026-07-12T10:00:00Z" }];

test("mobile dashboard returns compact operational counts without phone numbers", () => {
  const dashboard = buildMobileDashboard({ tickets: [{ ...tickets[0], customerPhone: "555-secret" }], sessions: [{ status: "active" }], agents: [{ status: "online" }], articles: [{ status: "pending_review" }], now: () => new Date("2026-07-12T11:00:00Z") });
  assert.equal(dashboard.counts.urgentTickets, 1);
  assert.equal(dashboard.counts.activeRemoteSessions, 1);
  assert.equal(dashboard.tickets[0].customerPhone, undefined);
});

test("mobile activity exposes only safe Fisher metadata", () => {
  const events = buildMobileActivity({ events: [{ id: "A1", action: "openai.research_ticket", actorId: "u", actorRole: "admin", entityType: "knowledge", entityId: "K1", createdAt: "now", metadata: { provider: "openai", secret: "hidden", model: "gpt" } }, { id: "A2", action: "whatsapp.message", metadata: { phone: "secret" } }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].metadata.provider, "openai");
  assert.equal(events[0].metadata.secret, undefined);
});

test("mobile Fisher answers urgent, ticket, knowledge and activity questions read-only", () => {
  const service = createMobileFisherService({ ticketStore: { get: (id) => tickets.find((item) => item.id === id) }, knowledgeBaseStore: { list: () => [{ id: "KB1", title: "VPN", status: "pending_review", provider: "ai_consensus", reviewScore: 80 }] }, auditStore: { list: () => [{ id: "A1", action: "ai.consensus_research", entityId: "KB1", createdAt: "now" }] }, dashboardProvider: () => buildMobileDashboard({ tickets }) });
  assert.equal(service.ask({ message: "casos urgentes" }).type, "ticket_overview");
  assert.equal(service.ask({ message: "resume TCK-UNO" }).type, "ticket_summary");
  assert.equal(service.ask({ message: "propuestas pendientes" }).type, "knowledge_review");
  assert.equal(service.ask({ message: "actividad de Fisher" }).type, "fisher_activity");
  assert.equal(service.ask({ message: "actividad de Fisher" }).readOnly, true);
});

test("mobile activity supports bounded offset pagination", () => {
  const events = Array.from({ length: 6 }, (_, index) => ({ id: `A${index}`, action: "agent.activity", createdAt: String(index), metadata: {} }));
  const page = buildMobileActivity({ events, limit: 2, offset: 2 });
  assert.deepEqual(page.map((item) => item.id), ["A2", "A3"]);
});
