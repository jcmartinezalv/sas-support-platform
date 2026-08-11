import test from "node:test";
import assert from "node:assert/strict";
import { createAgentService } from "../src/agent/agent-service.js";
import { listRepairActions, suggestRepairActions, assertRepairActionAllowed } from "../src/repairs/repair-catalog.js";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";
import { evaluateRepairActionDecision } from "../src/agent/repair-decision-engine.js";
import { createRepairPlanService } from "../src/agent/repair-plan-service.js";

function createTicketStoreStub() {
  return {
    get() {
      return {
        id: "TCK-1",
        status: "open",
        subject: "Internet lento",
        description: "No abre paginas, parece problema DNS"
      };
    },
    addMessage() {}
  };
}

function createApprovedSession() {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-1", requestedBy: "test", customerPhone: "5215550000000" });
  store.assignAgent(session.id, "agent-1");
  store.approveConsent(session.joinCode, { decidedBy: "customer" });
  return { store, session: store.get(session.id) };
}

test("repair catalog exposes controlled actions", () => {
  const actions = listRepairActions();
  assert.ok(actions.length >= 3);
  assert.ok(actions.some((action) => action.id === "flush_dns"));
  assert.ok(actions.every((action) => action.summary && action.expectedImpact && action.risk));
});

test("Fisher suggests repair actions from diagnosis context", () => {
  const service = createAgentService({ ticketStore: createTicketStoreStub() });
  const diagnosis = service.diagnose({ ticketId: "TCK-1", message: "Internet lento, no resuelve DNS" });

  assert.equal(diagnosis.category, "internet");
  assert.ok(diagnosis.repairActions.some((action) => action.id === "flush_dns"));
});

test("repair actions are ranked by category and keywords", () => {
  const suggestions = suggestRepairActions({ category: "printer", message: "La impresora no imprime y la cola esta atorada" });

  assert.equal(suggestions[0].id, "restart_print_spooler");
  assert.ok(suggestions[0].matchScore > 0);
});

test("remote session queues repair action metadata after consent", () => {
  const { store, session } = createApprovedSession();
  const repairAction = assertRepairActionAllowed("flush_dns", { maxRisk: "medium" });
  const command = store.queueCommand(session.id, {
    type: "repair_action",
    requestedBy: "operator",
    repairAction
  });

  assert.equal(command.type, "repair_action");
  assert.equal(command.repairAction.id, "flush_dns");
  assert.equal(command.repairAction.risk, "low");
});

test("repair decision engine allows low risk automatic execution with consent", () => {
  const action = assertRepairActionAllowed("flush_dns", { maxRisk: "medium" });
  const decision = evaluateRepairActionDecision(action, {
    confidence: 0.8,
    source: "rules",
    hasCustomerConsent: true,
    hasAssignedAgent: true
  });

  assert.equal(decision.mode, "auto_allowed");
  assert.equal(decision.canQueue, true);
  assert.equal(decision.canAutoExecute, true);
});

test("repair decision engine requires technician approval for medium risk", () => {
  const action = assertRepairActionAllowed("renew_ip", { maxRisk: "medium" });
  const decision = evaluateRepairActionDecision(action, {
    confidence: 0.85,
    source: "rules",
    hasCustomerConsent: true,
    hasAssignedAgent: true
  });

  assert.equal(decision.mode, "technician_approval_required");
  assert.equal(decision.canQueue, true);
  assert.equal(decision.canAutoExecute, false);
});

test("repair decision engine blocks execution before remote consent", () => {
  const action = assertRepairActionAllowed("flush_dns", { maxRisk: "medium" });
  const decision = evaluateRepairActionDecision(action, {
    confidence: 0.9,
    source: "rules",
    hasCustomerConsent: false,
    hasAssignedAgent: true
  });

  assert.equal(decision.mode, "remote_consent_required");
  assert.equal(decision.canQueue, false);
});

function createPlanHarness({ approvedSession = false, outcomeSummary = [] } = {}) {
  const messages = [];
  const ticketStore = {
    get() {
      return {
        id: "TCK-1",
        status: "open",
        subject: "Internet DNS",
        description: "Internet lento, no resuelve DNS"
      };
    },
    addMessage(ticketId, message) {
      messages.push({ ticketId, message });
    }
  };
  const remoteSessionStore = createRemoteSessionStore();
  let session = remoteSessionStore.create({ ticketId: "TCK-1", requestedBy: "test", customerPhone: "5215550000000" });
  if (approvedSession) {
    remoteSessionStore.assignAgent(session.id, "agent-1");
    remoteSessionStore.approveConsent(session.joinCode, { decidedBy: "customer" });
    session = remoteSessionStore.get(session.id);
  }
  const auditEvents = [];
  const service = createRepairPlanService({
    ticketStore,
    remoteSessionStore,
    agentService: createAgentService({ ticketStore }),
    auditStore: { record: (event) => auditEvents.push(event) },
    repairOutcomeStore: { summary: () => outcomeSummary }
  });
  return { auditEvents, messages, remoteSessionStore, service, session };
}

test("repair plan does not auto queue without approved remote session", () => {
  const { service } = createPlanHarness({ approvedSession: false });
  const plan = service.buildPlan({
    ticketId: "TCK-1",
    message: "Internet no resuelve DNS",
    autoQueue: true,
    actor: { id: "Fisher", role: "ai_agent" }
  });

  assert.equal(plan.queuedCount, 0);
  assert.equal(plan.actions[0].decision.mode, "remote_consent_required");
});

test("repair plan auto queues low risk action when Fisher policy allows it", () => {
  const { service, session, remoteSessionStore, auditEvents } = createPlanHarness({ approvedSession: true });
  const plan = service.buildPlan({
    ticketId: "TCK-1",
    sessionId: session.id,
    message: "Internet no resuelve DNS",
    autoQueue: true,
    actor: { id: "Fisher", role: "ai_agent" }
  });
  const updated = remoteSessionStore.get(session.id);

  assert.equal(plan.queuedCount, 1);
  assert.equal(plan.actions[0].queuedCommand.type, "repair_action");
  assert.ok(updated.commands.some((command) => command.type === "repair_action" && command.repairAction.id === "flush_dns"));
  assert.equal(auditEvents.at(-1).action, "fisher.repair_plan");
});

test("repair plan includes learning adjustment from historical outcomes", () => {
  const { service, session } = createPlanHarness({ approvedSession: true, outcomeSummary: [
    { actionId: "flush_dns", actionTitle: "Limpiar cache DNS", total: 3, executed: 3, simulated: 0, failed: 0, successRate: 1, lastOutcomeAt: new Date().toISOString() }
  ] });
  const plan = service.buildPlan({
    ticketId: "TCK-1",
    sessionId: session.id,
    message: "Internet no resuelve DNS",
    autoQueue: false,
    actor: { id: "Fisher", role: "ai_agent" }
  });

  assert.equal(plan.actions[0].id, "flush_dns");
  assert.equal(plan.actions[0].learningAdjustment.confidenceSignal, "promote");
  assert.ok(plan.actions[0].learningAdjustment.adjustment > 0);
});
