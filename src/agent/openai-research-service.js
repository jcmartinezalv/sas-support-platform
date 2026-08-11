import { rankResearchProposal } from "./google-ai-research-service.js";
import { findSupportCategory } from "./support-taxonomy.js";
import { sanitizeResearchInput } from "./research-privacy.js";
export { sanitizeResearchInput } from "./research-privacy.js";

export function createOpenAiResearchService({ config, fetchImpl = globalThis.fetch }) {
  return {
    async researchTicket({ ticket, operatorPrompt = "" }) {
      if (!config.openAiEnabled) throw serviceError("OpenAI research is disabled. Set OPENAI_ENABLED=true.", 409);
      const sanitized = sanitizeResearchInput({ ticket, operatorPrompt });
      if (config.openAiMock) return mockResearch(ticket, sanitized, config);
      if (!config.openAiApiKey) throw serviceError("OPENAI_API_KEY is required for OpenAI research.", 409);

      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openAiApiKey}` },
        body: JSON.stringify(buildOpenAiRequest(sanitized, config))
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw serviceError(payload?.error?.message ?? `OpenAI request failed with HTTP ${response.status}`, 502);
      return normalizeOpenAiResponse(payload, ticket, sanitized, config);
    }
  };
}

export function buildOpenAiRequest(sanitized, config) {
  const schema = researchSchema();
  return {
    model: config.openAiModel,
    reasoning: { effort: config.openAiReasoningEffort ?? "low" },
    tools: config.openAiWebSearch ? [{ type: "web_search" }] : [],
    input: [
      "Actua como analista senior de soporte tecnico empresarial.",
      "Investiga solo lo necesario y prioriza documentacion oficial del fabricante.",
      "No solicites secretos, no inventes comandos destructivos y no ejecutes acciones.",
      "Separa diagnostico, resolucion y reversion. Todo resultado requiere revision humana.",
      `Ticket: ${sanitized.ticketId}`,
      `Asunto: ${sanitized.subject}`,
      `Descripcion: ${sanitized.description}`,
      `Notas: ${sanitized.operatorPrompt || "sin notas adicionales"}`
    ].join("\n"),
    text: { format: { type: "json_schema", name: "sas_research_proposal", strict: true, schema } }
  };
}

function normalizeOpenAiResponse(payload, ticket, sanitized, config) {
  const parsed = parseJsonObject(extractOutputText(payload));
  const citations = extractOpenAiCitations(payload);
  const proposal = {
    title: cleanText(parsed.title) || `Investigacion OpenAI: ${ticket.subject}`,
    category: cleanText(parsed.category) || findSupportCategory(`${ticket.subject} ${ticket.description}`)?.id || "general",
    keywords: strings(parsed.keywords, 12),
    prerequisites: strings(parsed.prerequisites, 8),
    diagnosticChecks: strings(parsed.diagnosticChecks, 10),
    resolutionSteps: strings(parsed.resolutionSteps, 12),
    rollbackSteps: strings(parsed.rollbackSteps, 8),
    riskNotes: strings(parsed.riskNotes, 8),
    adminRequired: Boolean(parsed.adminRequired),
    serviceImpact: cleanText(parsed.serviceImpact) || "Sin impacto declarado; requiere revision.",
    researchSummary: cleanText(parsed.researchSummary) || "Investigacion generada con OpenAI.",
    citations,
    provider: "openai_responses",
    model: config.openAiModel,
    status: "pending_review",
    privacy: { redactionCount: sanitized.redactionCount, sanitized: true }
  };
  return { ...proposal, ...rankResearchProposal(proposal) };
}

function mockResearch(ticket, sanitized, config) {
  const taxonomy = findSupportCategory(`${sanitized.subject} ${sanitized.description}`);
  const proposal = {
    title: `Investigacion OpenAI: ${sanitized.subject || ticket.id}`,
    category: taxonomy?.id ?? "general",
    keywords: taxonomy?.matchedKeywords?.length ? taxonomy.matchedKeywords : ["soporte", "diagnostico", "revision"],
    prerequisites: ["Confirmar producto, version, sistema operativo y alcance."],
    diagnosticChecks: taxonomy?.safeChecks?.slice(0, 2) ?? ["Capturar mensaje exacto sin modificar el equipo."],
    resolutionSteps: ["Consultar documentacion oficial aplicable.", "Aplicar primero comprobaciones no destructivas.", "Registrar evidencia antes y despues.", "Escalar si existe riesgo o se requieren privilegios."],
    rollbackSteps: ["Restaurar la configuracion respaldada y validar el estado anterior."],
    riskNotes: ["Resultado simulado; requiere validacion tecnica.", "No contiene ni conserva secretos del ticket."],
    adminRequired: false,
    serviceImpact: "Sin impacto en modo simulacion.",
    researchSummary: "Propuesta OpenAI simulada para validar proveedor, privacidad y revision humana.",
    citations: [{ title: "OpenAI API documentation", uri: "https://developers.openai.com/api/docs/models" }],
    provider: "openai_responses_mock",
    model: config.openAiModel,
    status: "pending_review",
    privacy: { redactionCount: sanitized.redactionCount, sanitized: true }
  };
  return { ...proposal, ...rankResearchProposal(proposal) };
}

function researchSchema() {
  const stringArray = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" }, category: { type: "string" }, keywords: stringArray,
      prerequisites: stringArray, diagnosticChecks: stringArray, resolutionSteps: stringArray,
      rollbackSteps: stringArray, riskNotes: stringArray, adminRequired: { type: "boolean" },
      serviceImpact: { type: "string" }, researchSummary: { type: "string" }
    },
    required: ["title", "category", "keywords", "prerequisites", "diagnosticChecks", "resolutionSteps", "rollbackSteps", "riskNotes", "adminRequired", "serviceImpact", "researchSummary"]
  };
}

function extractOutputText(payload) {
  if (payload?.output_text) return payload.output_text;
  return (payload?.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n");
}

function extractOpenAiCitations(payload) {
  return (payload?.output ?? []).flatMap((item) => item.content ?? []).flatMap((content) => content.annotations ?? [])
    .filter((item) => item.type === "url_citation" && item.url)
    .map((item) => ({ title: cleanText(item.title) || item.url, uri: item.url }))
    .filter((item, index, list) => list.findIndex((other) => other.uri === item.uri) === index).slice(0, 8);
}

function strings(value, limit) { return Array.isArray(value) ? value.map(cleanText).filter(Boolean).slice(0, limit) : []; }
function parseJsonObject(value) { try { return JSON.parse(value); } catch { return {}; } }
function cleanText(value) { return String(value ?? "").trim(); }
function serviceError(message, statusCode) { const error = new Error(message); error.statusCode = statusCode; return error; }

