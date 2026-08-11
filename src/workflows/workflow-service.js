export function createWorkflowService({ ticketStore, remoteSessionStore, knowledgeBaseStore, auditStore }) {
  return {
    resolveNextActions({ ticketId, message, actor }) {
      const ticket = ticketStore.get(ticketId);
      if (!ticket) {
        const error = new Error(`Ticket ${ticketId} not found`);
        error.statusCode = 404;
        throw error;
      }

      const matches = knowledgeBaseStore.search(message || ticket.description);
      const remoteRequested = /remoto|anydesk|teamviewer|control/i.test(message || ticket.description);
      const actions = [];

      if (matches[0]) {
        actions.push({
          type: "guided_resolution",
          title: matches[0].title,
          steps: matches[0].resolutionSteps
        });
      }

      if (remoteRequested) {
        const session = remoteSessionStore.create({
          ticketId: ticket.id,
          requestedBy: actor.id,
          customerPhone: ticket.customerPhone
        });
        actions.push({ type: "remote_session", session });
      }

      if (actions.length === 0) {
        actions.push({
          type: "human_review",
          steps: ["Revisar ticket manualmente", "Solicitar evidencia", "Clasificar categoria y prioridad"]
        });
      }

      auditStore.record({
        actorId: actor.id,
        actorRole: actor.role,
        action: "workflow.next_actions",
        entityType: "ticket",
        entityId: ticket.id,
        metadata: { actionTypes: actions.map((action) => action.type) }
      });

      return { ticketId: ticket.id, actions };
    }
  };
}

function findReusableRemoteSession(remoteSessionStore, ticketId) {
  return [...remoteSessionStore.list()].reverse().find((session) => {
    return session.ticketId === ticketId && !["closed", "consent_rejected", "expired"].includes(session.status);
  }) ?? null;
}
