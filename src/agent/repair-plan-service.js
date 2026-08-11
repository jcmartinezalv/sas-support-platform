import { applyOutcomeLearning } from "./repair-learning-score.js";
import { assertRepairActionAllowed } from "../repairs/repair-catalog.js";

const TERMINAL_REMOTE_STATUSES = new Set(["closed", "consent_rejected", "expired", "consent_locked", "control_locked"]);

export function createRepairPlanService({ ticketStore, remoteSessionStore, agentService, auditStore, repairOutcomeStore = null }) {
  return {
    buildPlan({ ticketId, message, sessionId = null, autoQueue = false, actor }) {
      const ticket = ticketStore.get(ticketId);
      if (!ticket) {
        const error = new Error(`Ticket ${ticketId} not found`);
        error.statusCode = 404;
        throw error;
      }

      const session = sessionId ? remoteSessionStore.get(sessionId) : findBestSession(remoteSessionStore, ticket.id);
      if (sessionId && !session) {
        const error = new Error(`Remote session ${sessionId} not found`);
        error.statusCode = 404;
        throw error;
      }

      const supervisedObservations = (session?.fisherObservation?.observations ?? []).filter((item) => ["confirmed", "corrected"].includes(item.review?.decision)).slice(-3);
      const visualContext = supervisedObservations.map((item) => [item.summary, item.review?.note].filter(Boolean).join(". ")).join("\n");
      const diagnosis = agentService.diagnose({
        ticketId: ticket.id,
        message: [message || ticket.description, visualContext ? `Observaciones visuales supervisadas por el técnico:\n${visualContext}` : ""].filter(Boolean).join("\n"),
        remoteSession: session
      });

      const outcomeSummary = repairOutcomeStore?.summary?.() ?? [];
      let actions = diagnosis.repairActions.map((action) => ({
        ...action,
        outcomeStats: outcomeSummary.find((item) => item.actionId === action.id) ?? null,
        queuedCommand: null,
        skippedReason: action.decision?.canQueue ? null : action.decision?.mode ?? "not_queueable"
      }));

      actions = applyOutcomeLearning(actions);

      if (autoQueue && session) {
        for (const action of actions) {
          if (!action.decision?.canAutoExecute) continue;
          const repairAction = assertRepairActionAllowed(action.id, { maxRisk: "low" });
          const command = remoteSessionStore.queueCommand(session.id, {
            type: "repair_action",
            requestedBy: actor?.id ?? "Fisher",
            repairAction
          });
          action.queuedCommand = command ? { id: command.id, status: command.status, type: command.type } : null;
          action.skippedReason = command ? null : "queue_failed";
        }
      }

      const queuedCount = actions.filter((action) => action.queuedCommand).length;
      const plan = {
        ticketId: ticket.id,
        sessionId: session?.id ?? null,
        autoQueue: Boolean(autoQueue),
        queuedCount,
        diagnosis,
        actions,
        createdAt: new Date().toISOString()
      };

      ticketStore.addMessage(ticket.id, {
        direction: "internal",
        channel: "repair_plan",
        author: actor?.id ?? "Fisher",
        body: `Plan de reparacion Fisher: ${actions.length} accion(es), ${queuedCount} encolada(s).`
      });

      auditStore?.record({
        actorId: actor?.id,
        actorRole: actor?.role,
        action: "fisher.repair_plan",
        entityType: "ticket",
        entityId: ticket.id,
        metadata: {
          sessionId: session?.id ?? null,
          autoQueue: Boolean(autoQueue),
          actionCount: actions.length,
          queuedCount,
          decisionModes: actions.map((action) => action.decision?.mode ?? "unknown"),
          supervisedObservationCount: supervisedObservations.length
        }
      });

      return plan;
    }
  };
}

function findBestSession(remoteSessionStore, ticketId) {
  return [...remoteSessionStore.list()].reverse().find((session) => {
    return session.ticketId === ticketId
      && !TERMINAL_REMOTE_STATUSES.has(session.status)
      && session.consent?.decision === "approved"
      && Boolean(session.agentId);
  }) ?? null;
}



