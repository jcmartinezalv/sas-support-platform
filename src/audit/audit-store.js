export function createAuditStore({ initialEvents = [], onChange = () => {}, maxEvents = 5000 } = {}) {
  const limit = Math.max(100, Math.min(50000, Number(maxEvents) || 5000));
  const events = [...initialEvents].slice(0, limit);

  return {
    record(event) {
      const entry = {
        id: createId("AUD"),
        actorId: event.actorId ?? "system",
        actorRole: event.actorRole ?? "system",
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        metadata: event.metadata ?? {},
        createdAt: new Date().toISOString()
      };

      events.unshift(entry);
      if (events.length > limit) events.length = limit;
      onChange(events);
      return entry;
    },

    list(limit = 100) {
      const parsedLimit = Number(limit);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        return [...events];
      }
      return events.slice(0, parsedLimit);
    }
  };
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

