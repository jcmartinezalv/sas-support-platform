const VALID_STATUSES = new Set(["intake", "open", "waiting_customer", "in_progress", "resolved", "closed"]);
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

export function createTicketStore({ initialTickets = [], onChange = () => {} } = {}) {
  const tickets = new Map(initialTickets.map((ticket) => [ticket.id, ticket]));

  return {
    list() {
      return [...tickets.values()];
    },

    create(input) {
      const now = new Date().toISOString();
      const ticket = {
        id: createId("TCK"),
        customerName: cleanText(input.customerName) || "Cliente WhatsApp",
        customerPhone: cleanText(input.customerPhone),
        subject: cleanText(input.subject) || "Solicitud de soporte",
        description: cleanText(input.description),
        source: cleanText(input.source) || "manual",
        status: VALID_STATUSES.has(input.status) && input.status !== "closed" ? input.status : "open",
        priority: normalizePriority(input.priority),
        contactId: cleanText(input.contactId) || null,
        equipmentId: cleanText(input.equipmentId ?? input.agentId) || null,
        intakeStage: cleanText(input.intakeStage) || null,
        documentation: normalizeDocumentation(input.documentation),
        closedAt: null,
        closedBy: null,
        statusHistory: [{ status: VALID_STATUSES.has(input.status) && input.status !== "closed" ? input.status : "open", at: now, changedBy: cleanText(input.createdBy) || null, reason: "created" }],
        messages: [],
        createdAt: now,
        updatedAt: now
      };

      ticket.messages.push({
        id: createId("MSG"),
        direction: "inbound",
        channel: ticket.source,
        body: ticket.description,
        author: ticket.customerName,
        externalId: cleanText(input.initialMessage?.externalId) || null,
        messageType: cleanText(input.initialMessage?.messageType) || "text",
        attachments: normalizeAttachments(input.initialMessage?.attachments),
        createdAt: now
      });

      tickets.set(ticket.id, ticket);
      persist();
      return ticket;
    },

    get(id) {
      return tickets.get(id) ?? null;
    },

    findOpenByPhone(phone) {
      const cleanPhone = cleanText(phone);
      return [...tickets.values()].find((ticket) => {
        return ticket.customerPhone === cleanPhone && ticket.status !== "closed";
      }) ?? null;
    },

    hasExternalMessage(externalId) {
      const id = cleanText(externalId);
      if (!id) return false;
      return [...tickets.values()].some((ticket) => ticket.messages.some((message) => message.externalId === id));
    },

    addMessage(ticketId, message) {
      const ticket = tickets.get(ticketId);
      if (!ticket) {
        throw new Error(`Ticket ${ticketId} not found`);
      }

      const createdAt = new Date().toISOString();
      ticket.messages.push({
        id: createId("MSG"),
        direction: message.direction ?? "internal",
        channel: message.channel ?? "system",
        body: cleanText(message.body),
        author: cleanText(message.author) || "system",
        externalId: cleanText(message.externalId) || null,
        messageType: cleanText(message.messageType) || "text",
        attachments: normalizeAttachments(message.attachments),
        delivery: message.delivery && typeof message.delivery === "object" ? { ...message.delivery } : null,
        createdAt
      });
      ticket.updatedAt = createdAt;
      persist();

      return ticket;
    },

    update(ticketId, input) {
      const ticket = tickets.get(ticketId);
      if (!ticket) {
        throw new Error(`Ticket ${ticketId} not found`);
      }

      if (input.status !== undefined) {
        if (!VALID_STATUSES.has(input.status)) {
          throw new Error(`Invalid ticket status: ${input.status}`);
        }
        if (input.status === "closed" && ticket.status !== "closed") {
          const error = new Error("El ticket sólo puede cerrarse manualmente desde Tickets y con la sesión documentada");
          error.statusCode = 409;
          error.code = "MANUAL_DOCUMENTED_CLOSURE_REQUIRED";
          throw error;
        }
        if (ticket.status !== input.status) {
          ticket.status = input.status;
          ticket.statusHistory = normalizeStatusHistory(ticket.statusHistory);
          ticket.statusHistory.push({ status: input.status, at: new Date().toISOString(), changedBy: cleanText(input.statusChangedBy) || null, reason: cleanText(input.statusReason) || "manual_update" });
          ticket.statusHistory = ticket.statusHistory.slice(-100);
        }
      }
      if (input.priority !== undefined) {
        ticket.priority = normalizePriority(input.priority);
      }
      if (input.customerName !== undefined) {
        ticket.customerName = cleanText(input.customerName) || ticket.customerName;
      }
      if (input.subject !== undefined) {
        ticket.subject = cleanText(input.subject) || ticket.subject;
      }
      if (input.description !== undefined) {
        ticket.description = cleanText(input.description) || ticket.description;
      }
      if (input.customerPhone !== undefined) {
        ticket.customerPhone = cleanText(input.customerPhone) || ticket.customerPhone;
      }
      if (input.contactId !== undefined) ticket.contactId = cleanText(input.contactId) || null;
      if (input.equipmentId !== undefined || input.agentId !== undefined) ticket.equipmentId = cleanText(input.equipmentId ?? input.agentId) || null;
      if (input.intakeStage !== undefined) ticket.intakeStage = cleanText(input.intakeStage) || null;
      ticket.updatedAt = new Date().toISOString();
      persist();
      return ticket;
    },

    updateStatus(ticketId, status) {
      if (!VALID_STATUSES.has(status)) {
        throw new Error(`Invalid ticket status: ${status}`);
      }

      const ticket = tickets.get(ticketId);
      if (!ticket) {
        throw new Error(`Ticket ${ticketId} not found`);
      }

      if (status === "closed" && ticket.status !== "closed") {
        const error = new Error("El ticket sólo puede cerrarse manualmente desde Tickets y con la sesión documentada");
        error.statusCode = 409;
        error.code = "MANUAL_DOCUMENTED_CLOSURE_REQUIRED";
        throw error;
      }
      if (ticket.status !== status) {
        ticket.status = status;
        ticket.updatedAt = new Date().toISOString();
        ticket.statusHistory = normalizeStatusHistory(ticket.statusHistory);
        ticket.statusHistory.push({ status, at: ticket.updatedAt, changedBy: null, reason: "status_update" });
        ticket.statusHistory = ticket.statusHistory.slice(-100);
      }
      persist();
      return ticket;
    },

    closeManually(ticketId, input = {}) {
      const ticket = tickets.get(ticketId);
      if (!ticket) throw new Error(`Ticket ${ticketId} not found`);
      if (ticket.status === "closed") return ticket;
      const documentation = normalizeDocumentation(input.documentation, ticket.documentation);
      const missing = closureMissingFields(documentation);
      if (missing.length) {
        const error = new Error(`Completa la documentación antes de cerrar: ${missing.join(", ")}`);
        error.statusCode = 409;
        error.code = "TICKET_DOCUMENTATION_INCOMPLETE";
        error.details = { missing };
        throw error;
      }
      const now = new Date().toISOString();
      ticket.documentation = { ...documentation, completed: true, completedAt: now, completedBy: cleanText(input.closedBy) || "operator" };
      ticket.status = "closed";
      ticket.closedAt = now;
      ticket.closedBy = cleanText(input.closedBy) || "operator";
      ticket.statusHistory = normalizeStatusHistory(ticket.statusHistory);
      ticket.statusHistory.push({ status: "closed", at: now, changedBy: ticket.closedBy, reason: "documented_manual_closure" });
      ticket.statusHistory = ticket.statusHistory.slice(-100);
      ticket.updatedAt = now;
      persist();
      return ticket;
    }
  };

  function persist() {
    onChange([...tickets.values()]);
  }
}

function normalizePriority(priority) {
  return VALID_PRIORITIES.has(priority) ? priority : "normal";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeStatusHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-100).map((item) => ({
    status: VALID_STATUSES.has(item?.status) ? item.status : "open",
    at: cleanText(item?.at) || null,
    changedBy: cleanText(item?.changedBy) || null,
    reason: cleanText(item?.reason) || null
  }));
}

function normalizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).map((attachment) => ({
    id: cleanText(attachment?.id) || null,
    type: cleanText(attachment?.type) || "file",
    mimeType: cleanText(attachment?.mimeType) || null,
    filename: cleanText(attachment?.filename) || null,
    caption: cleanText(attachment?.caption) || null,
    sha256: cleanText(attachment?.sha256) || null
  }));
}

function normalizeDocumentation(value, previous = null) {
  const source = value && typeof value === "object" ? value : {};
  const base = previous && typeof previous === "object" ? previous : {};
  const evidence = source.sessionEvidence ?? base.sessionEvidence;
  return {
    diagnosis: cleanText(source.diagnosis ?? base.diagnosis).slice(0, 6000),
    actionsPerformed: cleanText(source.actionsPerformed ?? base.actionsPerformed).slice(0, 12000),
    outcome: cleanText(source.outcome ?? base.outcome).slice(0, 6000),
    followUp: cleanText(source.followUp ?? base.followUp).slice(0, 4000),
    sessionEvidence: Array.isArray(evidence) ? evidence.slice(0, 30).map((item) => ({
      sessionId: cleanText(item?.sessionId).slice(0, 100), startedAt: item?.startedAt ?? null, endedAt: item?.endedAt ?? null,
      accessMode: cleanText(item?.accessMode).slice(0, 30), controlAuthorized: Boolean(item?.controlAuthorized),
      screenObserved: Boolean(item?.screenObserved), fisherObservations: Math.max(0, Number(item?.fisherObservations) || 0)
    })) : [],
    completed: Boolean(base.completed), completedAt: base.completedAt ?? null, completedBy: cleanText(base.completedBy) || null
  };
}

function closureMissingFields(documentation) {
  const missing = [];
  if (documentation.diagnosis.length < 10) missing.push("diagnóstico");
  if (documentation.actionsPerformed.length < 10) missing.push("trabajo realizado");
  if (documentation.outcome.length < 10) missing.push("resultado");
  return missing;
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

