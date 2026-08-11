export function filterAuditEvents(events = [], filter = "all") {
  const normalized = String(filter ?? "all").toLowerCase();
  if (normalized === "security") {
    return events.filter((event) => event.action === "auth.denied");
  }
  if (normalized === "remote") {
    return events.filter((event) => String(event.action ?? "").startsWith("remote."));
  }
  if (normalized === "tickets") {
    return events.filter((event) => {
      const action = String(event.action ?? "");
      return action.startsWith("ticket.") || action.startsWith("whatsapp.");
    });
  }
  return [...events];
}

export function normalizeAuditFilter(filter = "all") {
  const normalized = String(filter ?? "all").toLowerCase();
  return ["all", "security", "remote", "tickets"].includes(normalized) ? normalized : "all";
}
