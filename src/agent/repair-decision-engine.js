const RISK_WEIGHT = { low: 1, medium: 2, high: 3 };

export function evaluateRepairActionDecision(action, context = {}) {
  const confidence = Number(context.confidence ?? 0);
  const source = String(context.source ?? "rules");
  const shouldEscalate = Boolean(context.shouldEscalate);
  const hasCustomerConsent = context.hasCustomerConsent === true;
  const hasAssignedAgent = context.hasAssignedAgent === true;
  const risk = String(action?.risk ?? "high").toLowerCase();

  if (!action?.id) {
    return decision("blocked", "Accion de reparacion no identificada.", { canQueue: false, canAutoExecute: false });
  }

  if (shouldEscalate || source === "pending_review_ranked") {
    return decision("human_review", "Fisher necesita revision humana antes de aplicar esta propuesta.", { canQueue: false, canAutoExecute: false });
  }

  if (riskValue(risk) >= riskValue("high")) {
    return decision("human_review", "Accion de alto riesgo; requiere tecnico responsable y aprobacion manual.", { canQueue: false, canAutoExecute: false });
  }

  if (action.requiresControlConsent) {
    return decision("customer_control_required", "Requiere permiso de control remoto del cliente antes de ejecutarse.", { canQueue: false, canAutoExecute: false });
  }

  if (!hasCustomerConsent || !hasAssignedAgent) {
    return decision("remote_consent_required", "Primero se necesita sesion remota autorizada y equipo asignado.", { canQueue: false, canAutoExecute: false });
  }

  if (risk === "low" && confidence >= 0.72) {
    return decision("auto_allowed", "Fisher puede ejecutar esta reparacion de bajo riesgo con consentimiento remoto activo.", { canQueue: true, canAutoExecute: true });
  }

  if (risk === "medium") {
    return decision("technician_approval_required", "Requiere aprobacion del tecnico por posible impacto temporal en el usuario.", { canQueue: true, canAutoExecute: false });
  }

  return decision("suggest_only", "Fisher puede sugerir la accion, pero no ejecutarla automaticamente con la confianza actual.", { canQueue: true, canAutoExecute: false });
}

export function attachRepairDecisions(actions, context = {}) {
  return (actions ?? []).map((action) => ({
    ...action,
    decision: evaluateRepairActionDecision(action, context)
  }));
}

function decision(mode, reason, flags) {
  return {
    mode,
    reason,
    canQueue: Boolean(flags.canQueue),
    canAutoExecute: Boolean(flags.canAutoExecute)
  };
}

function riskValue(value) {
  return RISK_WEIGHT[String(value ?? "").toLowerCase()] ?? 99;
}
