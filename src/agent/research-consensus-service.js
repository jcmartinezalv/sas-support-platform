export function createResearchConsensusService({ googleAiResearchService, openAiResearchService }) {
  return {
    async researchTicket(input) {
      const [googleResult, openAiResult] = await Promise.allSettled([
        googleAiResearchService.researchTicket(input),
        openAiResearchService.researchTicket(input)
      ]);
      const proposals = {
        google: googleResult.status === "fulfilled" ? googleResult.value : null,
        openai: openAiResult.status === "fulfilled" ? openAiResult.value : null
      };
      const errors = {
        google: googleResult.status === "rejected" ? googleResult.reason?.message ?? "Google AI failed" : null,
        openai: openAiResult.status === "rejected" ? openAiResult.reason?.message ?? "OpenAI failed" : null
      };
      if (!proposals.google && !proposals.openai) {
        const error = new Error(`No AI provider completed research. Google: ${errors.google}; OpenAI: ${errors.openai}`);
        error.statusCode = 502;
        throw error;
      }
      return buildConsensus(proposals, errors, input.ticket);
    }
  };
}

export function buildConsensus(proposals, errors = {}, ticket = {}) {
  const available = Object.entries(proposals).filter(([, proposal]) => proposal);
  const google = proposals.google;
  const openai = proposals.openai;
  const categoryAgreement = Boolean(google && openai && normalize(google.category) === normalize(openai.category));
  const sharedKeywords = google && openai ? intersect(google.keywords, openai.keywords) : [];
  const citationDomains = unique(available.flatMap(([, proposal]) => (proposal.citations ?? []).map((citation) => domain(citation.uri)).filter(Boolean)));
  const highRisk = available.some(([, proposal]) => proposal.adminRequired || Number(proposal.reviewScore ?? 0) < 60 || proposal.reviewRecommendation === "high_risk_review");
  const providerCount = available.length;
  const recommendation = providerCount < 2 ? "review_single_provider" : !categoryAgreement ? "resolve_provider_disagreement" : highRisk ? "review_high_risk" : "review_consensus";
  const reviewScore = Math.max(0, Math.min(...available.map(([, proposal]) => Number(proposal.reviewScore ?? 0))) - (providerCount < 2 ? 15 : categoryAgreement ? 0 : 25));
  const categories = Object.fromEntries(available.map(([provider, proposal]) => [provider, proposal.category]));
  const providerModels = Object.fromEntries(available.map(([provider, proposal]) => [provider, proposal.model]));
  const riskNotes = unique([
    ...available.flatMap(([provider, proposal]) => (proposal.riskNotes ?? []).map((note) => `${provider}: ${note}`)),
    ...(providerCount < 2 ? ["Solo un proveedor respondio; no existe consenso."] : []),
    ...(!categoryAgreement && providerCount === 2 ? [`Desacuerdo de categoria: Google=${google.category}, OpenAI=${openai.category}.`] : [])
  ]);
  return {
    title: `Comparacion IA: ${ticket.subject ?? ticket.id ?? "ticket"}`,
    category: categoryAgreement ? google.category : available[0][1].category ?? "general",
    keywords: sharedKeywords.length ? sharedKeywords : unique(available.flatMap(([, proposal]) => proposal.keywords ?? [])).slice(0, 12),
    prerequisites: unique(available.flatMap(([, proposal]) => proposal.prerequisites ?? [])).slice(0, 10),
    diagnosticChecks: unique(available.flatMap(([, proposal]) => proposal.diagnosticChecks ?? [])).slice(0, 12),
    resolutionSteps: ["Revisar las propuestas de ambos proveedores y resolver cualquier diferencia antes de aplicar cambios."],
    rollbackSteps: unique(available.flatMap(([, proposal]) => proposal.rollbackSteps ?? [])).slice(0, 10),
    riskNotes,
    adminRequired: available.some(([, proposal]) => Boolean(proposal.adminRequired)),
    serviceImpact: unique(available.map(([, proposal]) => proposal.serviceImpact).filter(Boolean)).join(" | ") || "Requiere revision.",
    researchSummary: `Comparacion de ${providerCount} proveedor(es). Recomendacion: ${recommendation}.`,
    citations: uniqueCitations(available.flatMap(([, proposal]) => proposal.citations ?? [])),
    provider: "ai_consensus",
    model: Object.values(providerModels).filter(Boolean).join(" + "),
    status: "pending_review",
    reviewScore,
    reviewRecommendation: recommendation,
    reviewSignals: [providerCount === 2 ? "dos proveedores" : "proveedor parcial", categoryAgreement ? "categoria coincidente" : "categoria no coincidente", highRisk ? "riesgo elevado" : "sin riesgo elevado detectado"],
    approvalRequired: true,
    comparison: { providerCount, categoryAgreement, categories, providerModels, sharedKeywords, citationDomains, highRisk, recommendation, errors }
  };
}

function intersect(left = [], right = []) { const values = new Set(right.map(normalize)); return unique(left.filter((item) => values.has(normalize(item)))); }
function unique(values) { return [...new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean))]; }
function uniqueCitations(citations) { return citations.filter((item) => item?.uri).filter((item, index, list) => list.findIndex((other) => other.uri === item.uri) === index).slice(0, 12); }
function domain(uri) { try { return new URL(uri).hostname.toLowerCase(); } catch { return null; } }
function normalize(value) { return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""); }
