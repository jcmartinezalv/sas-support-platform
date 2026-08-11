import crypto from "node:crypto";

const DEFAULT_PREFERENCES = { urgentTickets: true, fisherCritical: true, knowledgeReview: true };

export function createMobileNotificationStore({ initialNotifications = [], initialPreferences = [], onChange = () => {}, now = () => new Date() } = {}) {
  const notifications = new Map(initialNotifications.map((item) => [item.id, { ...item }]));
  const preferences = new Map(initialPreferences.map((item) => [item.userId, { ...DEFAULT_PREFERENCES, ...item }]));

  return {
    sync({ userId, tickets = [], articles = [], events = [] }) {
      const settings = this.getPreferences(userId);
      if (settings.urgentTickets) for (const ticket of tickets.filter((item) => item.priority === "urgent" && !["resolved", "closed"].includes(item.status))) {
        addOnce({ userId, sourceKey: `urgent:${ticket.id}:${ticket.updatedAt}`, type: "urgent_ticket", severity: "critical", title: `Ticket urgente ${ticket.id}`, message: ticket.subject || "Ticket urgente sin asunto", entityId: ticket.id });
      }
      if (settings.knowledgeReview) for (const article of articles.filter((item) => item.status === "pending_review" && Number(item.reviewScore ?? 0) >= 80)) {
        addOnce({ userId, sourceKey: `knowledge:${article.id}:${article.updatedAt ?? article.createdAt}`, type: "knowledge_review", severity: "attention", title: "Conocimiento listo para revisar", message: article.title || article.id, entityId: article.id });
      }
      if (settings.fisherCritical) for (const event of events.filter(isCriticalFisherEvent)) {
        addOnce({ userId, sourceKey: `event:${event.id}`, type: "fisher_critical", severity: "critical", title: "Fisher requiere atención", message: safeEventMessage(event), entityId: event.entityId ?? null });
      }
      persist();
      return this.list(userId);
    },
    list(userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
      return [...notifications.values()].filter((item) => item.userId === userId && (!unreadOnly || !item.readAt)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + Math.min(100, Math.max(1, Number(limit) || 50))).map(publicNotification);
    },
    markRead(userId, notificationId) {
      const item = notifications.get(notificationId);
      if (!item || item.userId !== userId) return null;
      item.readAt ??= now().toISOString(); persist(); return publicNotification(item);
    },
    markAllRead(userId) {
      const readAt = now().toISOString(); let count = 0;
      for (const item of notifications.values()) if (item.userId === userId && !item.readAt) { item.readAt = readAt; count += 1; }
      persist(); return count;
    },
    getPreferences(userId) { return { ...DEFAULT_PREFERENCES, ...(preferences.get(userId) ?? {}), userId }; },
    updatePreferences(userId, input = {}) {
      const current = this.getPreferences(userId);
      for (const key of Object.keys(DEFAULT_PREFERENCES)) if (typeof input[key] === "boolean") current[key] = input[key];
      preferences.set(userId, current); persist(); return { ...current };
    },
    snapshot() { return { notifications: [...notifications.values()], preferences: [...preferences.values()] }; }
  };

  function addOnce(input) {
    if ([...notifications.values()].some((item) => item.userId === input.userId && item.sourceKey === input.sourceKey)) return;
    const createdAt = now().toISOString();
    const id = `MNO-${crypto.randomUUID()}`;
    notifications.set(id, { id, ...input, createdAt, readAt: null });
  }
  function persist() { onChange({ notifications: [...notifications.values()], preferences: [...preferences.values()] }); }
}

function isCriticalFisherEvent(event) {
  if (!String(event.action ?? "").startsWith("agent.")) return false;
  return event.metadata?.severity === "critical" || event.metadata?.category === "security" || event.metadata?.status === "escalated";
}
function safeEventMessage(event) { return event.metadata?.recommendation || `Evento ${event.action} en ${event.entityId ?? "sistema"}`; }
function publicNotification(item) { const { sourceKey, userId, ...safe } = item; return safe; }

