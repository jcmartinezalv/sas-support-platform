const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set(["open", "waiting_customer", "in_progress", "resolved"]);
const VALID_STATUSES = new Set(["all", "open", "waiting_customer", "in_progress", "resolved", "closed"]);
const VALID_PRIORITIES = new Set(["all", "low", "normal", "high", "urgent"]);

export function normalizeTicketReportFilters(input = {}, now = new Date()) {
  const today = startOfUtcDay(now);
  const defaultFrom = new Date(today.getTime() - 29 * DAY_MS);
  const from = parseDay(input.from, defaultFrom);
  const to = parseDay(input.to, today);
  const orderedFrom = from <= to ? from : to;
  const orderedTo = from <= to ? to : from;
  const limitedFrom = new Date(Math.max(orderedFrom.getTime(), orderedTo.getTime() - 365 * DAY_MS));
  return {
    from: dayKey(limitedFrom),
    to: dayKey(orderedTo),
    status: VALID_STATUSES.has(input.status) ? input.status : "all",
    priority: VALID_PRIORITIES.has(input.priority) ? input.priority : "all",
    source: cleanFilter(input.source),
    equipmentId: cleanFilter(input.equipmentId),
    technicianId: cleanFilter(input.technicianId),
    firstResponseTargetMinutes: clampNumber(input.firstResponseTargetMinutes, 30, 5, 1440),
    resolutionTargetHours: clampNumber(input.resolutionTargetHours, 8, 1, 720)
  };
}

export function buildTicketReport({
  tickets = [],
  sessions = [],
  agents = [],
  contacts = [],
  technicians = [],
  filters = {},
  now = new Date()
} = {}) {
  const normalized = normalizeTicketReportFilters(filters, now);
  const fromMs = Date.parse(`${normalized.from}T00:00:00.000Z`);
  const toExclusiveMs = Date.parse(`${normalized.to}T00:00:00.000Z`) + DAY_MS;
  const agentById = new Map(agents.map((agent) => [agent.machineId ?? agent.id, agent]));
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const technicianById = new Map(technicians.map((item) => [item.id, item]));
  const dimensionTickets = tickets.filter((ticket) => matchesDimensions(ticket, normalized));
  const createdTickets = dimensionTickets.filter((ticket) => isWithin(ticket.createdAt, fromMs, toExclusiveMs));
  const closedTickets = dimensionTickets.filter((ticket) => ticket.status === "closed" && isWithin(ticket.closedAt, fromMs, toExclusiveMs));
  const activeTickets = dimensionTickets.filter((ticket) => ACTIVE_STATUSES.has(ticket.status));
  const resolutionValues = closedTickets.map(resolutionHours).filter(Number.isFinite);
  const firstResponseValues = createdTickets.map(firstResponseMinutes).filter(Number.isFinite);
  const selectedIds = new Set([...createdTickets, ...closedTickets].map((ticket) => ticket.id));
  const selectedSessions = sessions.filter((session) => selectedIds.has(session.ticketId));
  const completedSessionDurations = selectedSessions.map(sessionDurationMinutes).filter(Number.isFinite);
  const documentedClosed = closedTickets.filter(hasCompleteDocumentation);
  const createdOrClosedIds = new Set([...createdTickets, ...closedTickets].map((ticket) => ticket.id));
  const reportTickets = dimensionTickets.filter((ticket) => createdOrClosedIds.has(ticket.id) || ACTIVE_STATUSES.has(ticket.status));

  return {
    generatedAt: now.toISOString(),
    filters: normalized,
    definitions: {
      created: "Tickets cuya fecha de creación está dentro del periodo seleccionado.",
      closed: "Tickets cerrados manualmente cuya fecha de cierre está dentro del periodo seleccionado.",
      resolution: "Tiempo entre creación y cierre manual documentado. No se estima cuando falta una fecha.",
      firstResponse: "Tiempo desde la creación hasta el primer mensaje saliente registrado.",
      backlog: "Tickets actualmente abiertos, en progreso, esperando cliente o resueltos pendientes de cierre.",
      targets: `Objetivos internos configurables: primera respuesta ≤ ${normalized.firstResponseTargetMinutes} min y resolución ≤ ${normalized.resolutionTargetHours} h.`
    },
    summary: {
      created: createdTickets.length,
      closed: closedTickets.length,
      activeBacklog: activeTickets.length,
      medianResolutionHours: rounded(percentile(resolutionValues, 0.5), 1),
      p90ResolutionHours: rounded(percentile(resolutionValues, 0.9), 1),
      medianFirstResponseMinutes: rounded(percentile(firstResponseValues, 0.5), 0),
      firstResponseTargetRate: rate(firstResponseValues.filter((value) => value <= normalized.firstResponseTargetMinutes).length, firstResponseValues.length),
      resolutionTargetRate: rate(resolutionValues.filter((value) => value <= normalized.resolutionTargetHours).length, resolutionValues.length),
      documentationRate: rate(documentedClosed.length, closedTickets.length)
    },
    coverage: {
      resolutionMeasured: resolutionValues.length,
      resolutionEligible: closedTickets.length,
      firstResponseMeasured: firstResponseValues.length,
      firstResponseEligible: createdTickets.length,
      documentationComplete: documentedClosed.length,
      documentationEligible: closedTickets.length
    },
    trend: buildTrend(createdTickets, closedTickets, normalized.from, normalized.to),
    distributions: {
      status: countBy(createdTickets, (ticket) => ticket.status || "unknown"),
      priority: countBy(createdTickets, (ticket) => ticket.priority || "normal"),
      source: countBy(createdTickets, (ticket) => ticket.source || "manual"),
      equipment: topGroups(createdTickets, (ticket) => {
        const agent = agentById.get(ticket.equipmentId);
        return { key: ticket.equipmentId || "unassigned", label: agent?.hostname || (ticket.equipmentId ? ticket.equipmentId : "Sin equipo") };
      }),
      technician: topGroups(closedTickets, (ticket) => {
        const technician = technicianById.get(ticket.closedBy);
        return { key: ticket.closedBy || "unknown", label: technician?.displayName || technician?.username || ticket.closedBy || "Sin identificar" };
      })
    },
    backlog: {
      ageBuckets: buildAgeBuckets(activeTickets, now),
      oldest: activeTickets
        .map((ticket) => reportRow(ticket, { agentById, contactById, now }))
        .sort((left, right) => right.ageHours - left.ageHours)
        .slice(0, 20)
    },
    remote: {
      sessions: selectedSessions.length,
      completed: completedSessionDurations.length,
      medianDurationMinutes: rounded(percentile(completedSessionDurations, 0.5), 0),
      p90DurationMinutes: rounded(percentile(completedSessionDurations, 0.9), 0),
      unattendedRate: rate(selectedSessions.filter((session) => session.accessMode === "unattended").length, selectedSessions.length),
      controlAuthorizedRate: rate(selectedSessions.filter((session) => session.controlConsent?.decision === "approved").length, selectedSessions.length),
      fisherObservations: selectedSessions.reduce((total, session) => total + fisherObservationCount(session), 0),
      fisherReviews: selectedSessions.reduce((total, session) => total + (session.fisherObservation?.reviews?.length ?? 0), 0)
    },
    details: reportTickets
      .map((ticket) => reportRow(ticket, { agentById, contactById, now }))
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
      .slice(0, 500),
    options: {
      sources: uniqueOptions(tickets, "source"),
      equipment: [...agentById.values()].map((agent) => ({ value: agent.machineId ?? agent.id, label: agent.hostname || agent.machineId || agent.id })).sort(sortByLabel),
      technicians: [...technicianById.values()].map((item) => ({ value: item.id, label: item.displayName || item.username || item.id })).sort(sortByLabel)
    }
  };
}

export function exportTicketReportCsv(report) {
  const columns = [
    ["ticketId", "Ticket"], ["createdAt", "Creado"], ["closedAt", "Cerrado"], ["status", "Estado"],
    ["priority", "Prioridad"], ["source", "Canal"], ["customerName", "Cliente"], ["company", "Empresa"],
    ["whatsapp", "WhatsApp"], ["equipment", "Equipo"], ["resolutionHours", "Resolución (h)"],
    ["firstResponseMinutes", "Primera respuesta (min)"], ["ageHours", "Antigüedad (h)"], ["closedBy", "Cerrado por"],
    ["documentationComplete", "Documentación completa"]
  ];
  const rows = [columns.map(([, label]) => label), ...report.details.map((row) => columns.map(([key]) => csvValue(row[key])))];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function matchesDimensions(ticket, filters) {
  return (filters.status === "all" || ticket.status === filters.status)
    && (filters.priority === "all" || ticket.priority === filters.priority)
    && (filters.source === "all" || (ticket.source || "manual") === filters.source)
    && (filters.equipmentId === "all" || (ticket.equipmentId || "unassigned") === filters.equipmentId)
    && (filters.technicianId === "all" || (ticket.closedBy || "unknown") === filters.technicianId);
}

function buildTrend(createdTickets, closedTickets, from, to) {
  const created = countMap(createdTickets, (ticket) => dayKey(new Date(ticket.createdAt)));
  const closed = countMap(closedTickets, (ticket) => dayKey(new Date(ticket.closedAt)));
  const rows = [];
  for (let cursor = Date.parse(`${from}T00:00:00.000Z`), end = Date.parse(`${to}T00:00:00.000Z`); cursor <= end; cursor += DAY_MS) {
    const date = dayKey(new Date(cursor));
    rows.push({ date, created: created.get(date) ?? 0, closed: closed.get(date) ?? 0 });
  }
  return rows;
}

function buildAgeBuckets(tickets, now) {
  const buckets = [
    { key: "under_4h", label: "Menos de 4 h", min: 0, max: 4, count: 0 },
    { key: "4_to_24h", label: "4 a 24 h", min: 4, max: 24, count: 0 },
    { key: "1_to_3d", label: "1 a 3 días", min: 24, max: 72, count: 0 },
    { key: "3_to_7d", label: "3 a 7 días", min: 72, max: 168, count: 0 },
    { key: "over_7d", label: "Más de 7 días", min: 168, max: Infinity, count: 0 }
  ];
  for (const ticket of tickets) {
    const age = durationHours(ticket.createdAt, now);
    const bucket = buckets.find((item) => age >= item.min && age < item.max);
    if (bucket) bucket.count += 1;
  }
  return buckets.map(({ min, max, ...item }) => item);
}

function reportRow(ticket, { agentById, contactById, now }) {
  const contact = contactById.get(ticket.contactId);
  const agent = agentById.get(ticket.equipmentId);
  return {
    ticketId: ticket.id,
    createdAt: ticket.createdAt ?? null,
    closedAt: ticket.closedAt ?? null,
    status: ticket.status ?? "unknown",
    priority: ticket.priority ?? "normal",
    source: ticket.source ?? "manual",
    customerName: ticket.customerName ?? "",
    company: contact?.company ?? "",
    whatsapp: maskPhone(ticket.customerPhone),
    equipment: agent?.hostname || ticket.equipmentId || "Sin equipo",
    resolutionHours: rounded(resolutionHours(ticket), 1),
    firstResponseMinutes: rounded(firstResponseMinutes(ticket), 0),
    ageHours: rounded(durationHours(ticket.createdAt, ticket.closedAt || now), 1),
    closedBy: ticket.closedBy ?? "",
    documentationComplete: hasCompleteDocumentation(ticket)
  };
}

function resolutionHours(ticket) {
  return durationHours(ticket.createdAt, ticket.closedAt);
}

function firstResponseMinutes(ticket) {
  const created = Date.parse(ticket.createdAt);
  if (!Number.isFinite(created)) return null;
  const first = (ticket.messages ?? [])
    .filter((message) => message.direction === "outbound" && Number.isFinite(Date.parse(message.createdAt)))
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))[0];
  return first ? Math.max(0, (Date.parse(first.createdAt) - created) / 60000) : null;
}

function sessionDurationMinutes(session) {
  const value = durationHours(session.startedAt, session.endedAt);
  return Number.isFinite(value) ? value * 60 : null;
}

function durationHours(start, end) {
  const startMs = Date.parse(start);
  const endMs = end instanceof Date ? end.getTime() : Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return (endMs - startMs) / 3600000;
}

function fisherObservationCount(session) {
  return session.fisherObservation?.observations?.length
    ?? session.fisherObservation?.analyses?.length
    ?? 0;
}

function hasCompleteDocumentation(ticket) {
  const documentation = ticket.documentation;
  return Boolean(documentation?.completed
    && String(documentation.diagnosis ?? "").trim().length >= 10
    && String(documentation.actionsPerformed ?? "").trim().length >= 10
    && String(documentation.outcome ?? "").trim().length >= 10);
}

function countBy(items, selector) {
  return [...countMap(items, selector).entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function topGroups(items, selector) {
  const groups = new Map();
  for (const item of items) {
    const group = selector(item);
    const current = groups.get(group.key) ?? { ...group, count: 0 };
    current.count += 1;
    groups.set(group.key, current);
  }
  return [...groups.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)).slice(0, 12);
}

function countMap(items, selector) {
  const result = new Map();
  for (const item of items) {
    const key = selector(item);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

function uniqueOptions(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))]
    .sort()
    .map((value) => ({ value, label: value }));
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function rate(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function rounded(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isWithin(value, fromMs, toExclusiveMs) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= fromMs && parsed < toExclusiveMs;
}

function parseDay(value, fallback) {
  const raw = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function startOfUtcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(value) {
  return value.toISOString().slice(0, 10);
}

function cleanFilter(value) {
  const text = String(value ?? "").trim();
  return text || "all";
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function maskPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length <= 4 ? digits : `${"*".repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`;
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function sortByLabel(left, right) {
  return left.label.localeCompare(right.label, "es");
}
