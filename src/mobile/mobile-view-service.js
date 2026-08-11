export function buildMobileDashboard({ tickets = [], sessions = [], agents = [], articles = [], now = () => new Date() } = {}) {
  const openTickets = tickets.filter((item) => !["resolved", "closed"].includes(item.status));
  return {
    generatedAt: now().toISOString(),
    counts: {
      openTickets: openTickets.length,
      urgentTickets: openTickets.filter((item) => item.priority === "urgent").length,
      activeRemoteSessions: sessions.filter((item) => !["closed", "expired", "consent_rejected"].includes(item.status)).length,
      onlineAgents: agents.filter((item) => item.status === "online").length,
      pendingKnowledge: articles.filter((item) => item.status === "pending_review").length
    },
    tickets: openTickets.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 10).map(mobileTicket)
  };
}

export function buildMobileActivity({ events = [], limit = 30, offset = 0 } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const prefixes = ["agent.", "google_ai.", "openai.", "ai.", "repair.", "knowledge.", "mobile."];
  return events.filter((item) => prefixes.some((prefix) => item.action.startsWith(prefix))).slice(safeOffset, safeOffset + safeLimit).map((item) => ({
    id: item.id, action: item.action, actorId: item.actorId, actorRole: item.actorRole,
    entityType: item.entityType, entityId: item.entityId, createdAt: item.createdAt,
    metadata: {
      category: item.metadata?.category ?? null, status: item.metadata?.status ?? null,
      provider: item.metadata?.provider ?? null, model: item.metadata?.model ?? null,
      recommendation: item.metadata?.recommendation ?? null,
      providerCount: item.metadata?.providerCount ?? null,
      categoryAgreement: item.metadata?.categoryAgreement ?? null
    }
  }));
}

export function mobileTicket(item) {
  return { id: item.id, subject: item.subject, customerName: item.customerName, status: item.status, priority: item.priority, source: item.source, updatedAt: item.updatedAt };
}

