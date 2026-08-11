export function createMobileFisherService({ ticketStore, knowledgeBaseStore, auditStore, dashboardProvider }) {
  return {
    ask({ message, actor }) {
      const text = String(message ?? "").trim();
      if (!text) return response("help", "Escribe que deseas revisar: tickets urgentes, un ticket, propuestas pendientes o actividad de Fisher.");
      const normalized = normalize(text);
      const ticketId = text.match(/\bTCK-[A-Z0-9-]+\b/i)?.[0]?.toUpperCase();
      if (ticketId) {
        const ticket = ticketStore.get(ticketId);
        if (!ticket) return response("ticket_not_found", `No encontre el ticket ${ticketId}.`, { ticketId });
        return response("ticket_summary", `${ticket.id}: ${ticket.subject}. Estado ${label(ticket.status)}, prioridad ${label(ticket.priority)}. Ultima actualizacion ${ticket.updatedAt}.`, { ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, priority: ticket.priority, updatedAt: ticket.updatedAt } }, ["Abrir ticket", "Agregar nota"]);
      }
      if (/urgente|casos|pendiente|atencion/.test(normalized) && !/solucion|propuesta|conocimiento/.test(normalized)) {
        const dashboard = dashboardProvider();
        return response("ticket_overview", `Hay ${dashboard.counts.openTickets} ticket(s) abierto(s) y ${dashboard.counts.urgentTickets} urgente(s).`, { counts: dashboard.counts, tickets: dashboard.tickets.slice(0, 5) }, dashboard.counts.urgentTickets ? ["Ver urgentes"] : ["Ver tickets abiertos"]);
      }
      if (/solucion|propuesta|conocimiento|aprobar/.test(normalized)) {
        const pending = knowledgeBaseStore.list().filter((item) => item.status === "pending_review").sort((a, b) => Number(b.reviewScore ?? 0) - Number(a.reviewScore ?? 0));
        return response("knowledge_review", `Hay ${pending.length} propuesta(s) pendiente(s) de revision.`, { proposals: pending.slice(0, 5).map((item) => ({ id: item.id, title: item.title, provider: item.provider, reviewScore: item.reviewScore, recommendation: item.reviewRecommendation })) }, pending.length ? ["Revisar propuestas"] : []);
      }
      if (/actividad|fisher|hizo|realizo/.test(normalized)) {
        const events = auditStore.list(0).filter((item) => /^(agent|google_ai|openai|ai|repair|knowledge)\./.test(item.action)).slice(0, 5);
        return response("fisher_activity", events.length ? `Fisher tiene ${events.length} actividad(es) reciente(s) para mostrar.` : "No hay actividad reciente de Fisher.", { events: events.map((item) => ({ id: item.id, action: item.action, entityId: item.entityId, createdAt: item.createdAt })) }, events.length ? ["Ver actividad completa"] : []);
      }
      return response("help", "Puedo resumir tickets urgentes, buscar un ticket TCK, mostrar propuestas pendientes o explicar la actividad reciente de Fisher.", {}, ["Tickets urgentes", "Propuestas pendientes", "Actividad de Fisher"]);
    }
  };
}

function response(type, text, data = {}, suggestedActions = []) { return { type, text, data, suggestedActions, generatedAt: new Date().toISOString(), readOnly: true }; }
function normalize(value) { return String(value).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""); }
function label(value) { return ({ open: "abierto", waiting_customer: "esperando cliente", in_progress: "en revision", resolved: "resuelto", closed: "cerrado", urgent: "urgente", high: "alta", normal: "normal", low: "baja" })[value] ?? String(value); }
