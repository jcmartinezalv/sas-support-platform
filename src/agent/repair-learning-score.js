export function scoreRepairActionFromOutcomes(action, stats = null) {
  if (!stats || Number(stats.total ?? 0) === 0) {
    return {
      adjustment: 0,
      effectiveScore: Number(action.matchScore ?? 0),
      confidenceSignal: "no_history",
      reason: "Sin historial operativo suficiente."
    };
  }

  const executed = Number(stats.executed ?? 0);
  const failed = Number(stats.failed ?? 0);
  const simulated = Number(stats.simulated ?? 0);
  const confirmedResolved = Number(stats.confirmedResolved ?? 0);
  const confirmedUnresolved = Number(stats.confirmedUnresolved ?? 0);
  const confirmedAttempts = confirmedResolved + confirmedUnresolved;
  const realAttempts = executed + failed;
  const baseScore = Number(action.matchScore ?? 0);

  if (confirmedAttempts >= 2) {
    const resolutionRate = confirmedResolved / confirmedAttempts;
    if (resolutionRate >= 0.75) {
      const adjustment = 4 + Math.min(2, Math.floor(confirmedAttempts / 3));
      return {
        adjustment,
        effectiveScore: Math.max(0, baseScore + adjustment),
        confidenceSignal: "confirmed_promote",
        reason: "Tecnicos confirmaron que esta reparacion resuelve tickets similares.",
        realAttempts,
        confirmedAttempts,
        simulated
      };
    }
    if (resolutionRate <= 0.35) {
      return {
        adjustment: -5,
        effectiveScore: Math.max(0, baseScore - 5),
        confidenceSignal: "confirmed_degrade",
        reason: "Tecnicos confirmaron que esta reparacion no resolvió tickets similares.",
        realAttempts,
        confirmedAttempts,
        simulated
      };
    }
  }

  if (realAttempts === 0) {
    return {
      adjustment: 0,
      effectiveScore: baseScore,
      confidenceSignal: "simulation_only",
      reason: "Solo existen simulaciones; no se ajusta confianza real."
    };
  }

  const successRate = executed / realAttempts;
  const volumeBonus = Math.min(2, Math.floor(realAttempts / 3));
  let adjustment = 0;
  let confidenceSignal = "neutral";
  let reason = "Historial equilibrado.";

  if (realAttempts >= 2 && successRate >= 0.75) {
    adjustment = 2 + volumeBonus;
    confidenceSignal = "promote";
    reason = "Buen historial real; Fisher prioriza esta accion.";
  } else if (realAttempts >= 2 && successRate <= 0.35) {
    adjustment = -3;
    confidenceSignal = "degrade";
    reason = "Fallas frecuentes; Fisher reduce prioridad.";
  } else if (failed >= 2 && executed === 0) {
    adjustment = -4;
    confidenceSignal = "avoid";
    reason = "La accion ha fallado repetidamente; requiere revision.";
  }

  return {
    adjustment,
    effectiveScore: Math.max(0, baseScore + adjustment),
    confidenceSignal,
    reason,
    realAttempts,
    simulated
  };
}

export function applyOutcomeLearning(actions) {
  return [...(actions ?? [])]
    .map((action) => ({
      ...action,
      learningAdjustment: scoreRepairActionFromOutcomes(action, action.outcomeStats)
    }))
    .sort((a, b) => {
      const scoreDelta = Number(b.learningAdjustment?.effectiveScore ?? b.matchScore ?? 0) - Number(a.learningAdjustment?.effectiveScore ?? a.matchScore ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return String(a.id).localeCompare(String(b.id));
    });
}

