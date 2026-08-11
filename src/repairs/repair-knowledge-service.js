import { getRepairAction } from "./repair-catalog.js";

export function createRepairKnowledgeService({ repairOutcomeStore, knowledgeBaseStore, auditStore = null } = {}) {
  return {
    buildProposals({ minConfirmed = 2, minResolutionRate = 0.75 } = {}) {
      const summaries = repairOutcomeStore.summary();
      const existing = knowledgeBaseStore.list();
      return summaries
        .filter((summary) => Number(summary.confirmedResolved ?? 0) >= minConfirmed)
        .filter((summary) => Number(summary.resolutionRate ?? 0) >= minResolutionRate)
        .filter((summary) => !hasExistingRepairArticle(existing, summary.actionId))
        .map((summary) => buildProposal(summary));
    },

    createPendingArticles({ actor, minConfirmed = 2, minResolutionRate = 0.75 } = {}) {
      const proposals = this.buildProposals({ minConfirmed, minResolutionRate });
      const articles = proposals.map((proposal) => knowledgeBaseStore.create({
        ...proposal.article,
        status: "pending_review"
      }, actor?.id ?? "Fisher"));

      for (const article of articles) {
        auditStore?.record({
          actorId: actor?.id,
          actorRole: actor?.role,
          action: "repair.knowledge_proposal",
          entityType: "knowledge",
          entityId: article.id,
          metadata: {
            actionId: article.repairActionId,
            reviewScore: article.reviewScore,
            status: article.status
          }
        });
      }

      return { proposals, articles };
    }
  };
}

function buildProposal(summary) {
  const action = getRepairAction(summary.actionId) ?? {};
  const title = `Reparacion confirmada: ${action.title || summary.actionTitle || summary.actionId}`;
  const category = action.category || inferCategory(summary.actionId);
  const confirmedTotal = Number(summary.confirmedResolved ?? 0) + Number(summary.confirmedUnresolved ?? 0);
  const resolutionRate = Number(summary.resolutionRate ?? 0);
  const reviewScore = Math.min(96, Math.max(70, Math.round(72 + resolutionRate * 18 + Math.min(6, confirmedTotal))));

  return {
    actionId: summary.actionId,
    article: {
      title,
      category,
      keywords: [summary.actionId, category, ...(action.keywords ?? [])].filter(Boolean),
      resolutionSteps: [
        `Validar que el problema corresponde a ${category}.`,
        `Confirmar consentimiento remoto antes de ejecutar ${action.title || summary.actionId}.`,
        `Ejecutar la reparacion ${action.title || summary.actionId} desde el plan Fisher.`,
        "Confirmar con el cliente si el problema quedo resuelto y registrar retroalimentacion."
      ],
      provider: "sas_repair_learning",
      model: "repair-outcomes",
      repairActionId: summary.actionId,
      researchSummary: `Propuesta generada por Fisher a partir de ${summary.confirmedResolved} confirmacion(es) positivas y tasa de resolucion ${Math.round(resolutionRate * 100)}% en reparaciones reales.`,
      riskNotes: [action.expectedImpact || "Revisar impacto operativo antes de aprobar."],
      citations: [],
      reviewScore,
      reviewRecommendation: reviewScore >= 85 ? "approve_candidate" : "review_required",
      reviewSignals: [
        `confirmedResolved:${summary.confirmedResolved}`,
        `confirmedUnresolved:${summary.confirmedUnresolved}`,
        `resolutionRate:${resolutionRate}`,
        `actionId:${summary.actionId}`
      ]
    }
  };
}

function hasExistingRepairArticle(articles, actionId) {
  return articles.some((article) => article.repairActionId === actionId && ["pending_review", "approved"].includes(article.status));
}

function inferCategory(actionId) {
  if (String(actionId).includes("dns") || String(actionId).includes("ip")) return "network";
  if (String(actionId).includes("spooler") || String(actionId).includes("print")) return "printer";
  return "general";
}
