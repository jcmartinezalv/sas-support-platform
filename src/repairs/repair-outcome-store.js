export function createRepairOutcomeStore({ initialOutcomes = [], onChange = () => {} } = {}) {
  const outcomes = new Map(initialOutcomes.map((outcome) => [outcome.id, normalizeOutcome(outcome)]));

  return {
    list() {
      return [...outcomes.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    get(id) {
      return outcomes.get(cleanText(id)) ?? null;
    },

    record(input) {
      const outcome = normalizeOutcome({
        id: createId("RPO"),
        ticketId: input.ticketId,
        sessionId: input.sessionId,
        commandId: input.command?.id,
        actionId: input.command?.repairAction?.id,
        actionTitle: input.command?.repairAction?.title,
        risk: input.command?.repairAction?.risk,
        status: deriveOutcomeStatus(input.command, input.result),
        simulated: input.result?.data?.simulated === true,
        ok: input.result?.ok !== false && input.command?.status !== "failed",
        error: input.result?.error ?? input.command?.error ?? null,
        resolution: "unknown",
        resolutionNote: "",
        resolvedBy: null,
        resolvedAt: null,
        createdAt: new Date().toISOString(),
        metadata: {
          commandStatus: input.command?.status,
          skippedReason: input.result?.data?.skippedReason ?? null,
          note: input.result?.data?.note ?? null
        }
      });
      outcomes.set(outcome.id, outcome);
      persist();
      return outcome;
    },


    confirm(id, input = {}) {
      const outcome = outcomes.get(cleanText(id));
      if (!outcome) return null;
      const resolution = normalizeResolution(input.resolution);
      outcome.resolution = resolution;
      outcome.resolutionNote = cleanText(input.note);
      outcome.resolvedBy = cleanText(input.resolvedBy) || "operator";
      outcome.resolvedAt = new Date().toISOString();
      outcome.updatedAt = outcome.resolvedAt;
      persist();
      return outcome;
    },
    summary() {
      const grouped = new Map();
      for (const outcome of outcomes.values()) {
        const key = outcome.actionId || "unknown";
        const current = grouped.get(key) ?? {
          actionId: key,
          actionTitle: outcome.actionTitle,
          total: 0,
          executed: 0,
          simulated: 0,
          failed: 0,
          confirmedResolved: 0,
          confirmedUnresolved: 0,
          successRate: 0,
          resolutionRate: null,
          lastOutcomeAt: null
        };
        current.total += 1;
        if (outcome.status === "executed") current.executed += 1;
        if (outcome.status === "simulated") current.simulated += 1;
        if (outcome.status === "failed") current.failed += 1;
        if (outcome.resolution === "resolved") current.confirmedResolved += 1;
        if (outcome.resolution === "unresolved") current.confirmedUnresolved += 1;
        current.lastOutcomeAt = maxDate(current.lastOutcomeAt, outcome.createdAt);
        grouped.set(key, current);
      }
      return [...grouped.values()].map((item) => ({
        ...item,
        successRate: item.total ? Number((item.executed / item.total).toFixed(2)) : 0,
        resolutionRate: item.confirmedResolved + item.confirmedUnresolved > 0 ? Number((item.confirmedResolved / (item.confirmedResolved + item.confirmedUnresolved)).toFixed(2)) : null
      })).sort((a, b) => String(b.lastOutcomeAt).localeCompare(String(a.lastOutcomeAt)));
    }
  };

  function persist() {
    onChange([...outcomes.values()]);
  }
}

function deriveOutcomeStatus(command, result) {
  if (result?.ok === false || command?.status === "failed") return "failed";
  if (result?.data?.simulated === true) return "simulated";
  return "executed";
}

function normalizeOutcome(outcome) {
  return {
    id: cleanText(outcome.id) || createId("RPO"),
    ticketId: cleanText(outcome.ticketId),
    sessionId: cleanText(outcome.sessionId),
    commandId: cleanText(outcome.commandId),
    actionId: cleanText(outcome.actionId),
    actionTitle: cleanText(outcome.actionTitle),
    risk: cleanText(outcome.risk),
    status: cleanText(outcome.status) || "unknown",
    simulated: Boolean(outcome.simulated),
    ok: outcome.ok !== false,
    error: outcome.error ?? null,
    resolution: normalizeResolution(outcome.resolution),
    resolutionNote: cleanText(outcome.resolutionNote),
    resolvedBy: outcome.resolvedBy ? cleanText(outcome.resolvedBy) : null,
    resolvedAt: outcome.resolvedAt ?? null,
    metadata: outcome.metadata && typeof outcome.metadata === "object" ? outcome.metadata : {},
    createdAt: outcome.createdAt ?? new Date().toISOString(),
    updatedAt: outcome.updatedAt ?? outcome.createdAt ?? new Date().toISOString()
  };
}

function normalizeResolution(value) {
  const clean = cleanText(value).toLowerCase();
  if (["resolved", "unresolved", "unknown"].includes(clean)) return clean;
  if (["yes", "si", "true", "solved"].includes(clean)) return "resolved";
  if (["no", "false", "failed"].includes(clean)) return "unresolved";
  return "unknown";
}
function maxDate(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function cleanText(value) {
  return String(value ?? "").trim();
}



