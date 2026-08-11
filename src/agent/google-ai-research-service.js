import { sanitizeResearchInput, sanitizedTicket } from "./research-privacy.js";
export function createGoogleAiResearchService({ config }) {
  return {
    async researchTicket({ ticket, operatorPrompt = "" }) {
      const sanitized = sanitizeResearchInput({ ticket, operatorPrompt });
      const safeTicket = sanitizedTicket(ticket, sanitized);
      if (!config.googleAiEnabled) {
        const error = new Error("Google AI research is disabled. Set GOOGLE_AI_ENABLED=true and GEMINI_API_KEY to enable it.");
        error.statusCode = 409;
        throw error;
      }

      if (config.googleAiMock) {
        return { ...mockResearch(safeTicket, sanitized.operatorPrompt, config), privacy: { sanitized: true, redactionCount: sanitized.redactionCount } };
      }

      if (!config.geminiApiKey) {
        const error = new Error("GEMINI_API_KEY is required for Google AI research.");
        error.statusCode = 409;
        throw error;
      }

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.googleAiModel)}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.geminiApiKey
        },
        body: JSON.stringify(buildRequest(safeTicket, sanitized.operatorPrompt))
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload?.error?.message ?? `Google AI request failed with HTTP ${response.status}`);
        error.statusCode = 502;
        throw error;
      }

      return { ...normalizeResearchResponse(payload, safeTicket, config), privacy: { sanitized: true, redactionCount: sanitized.redactionCount } };
    }
  };
}

function buildRequest(ticket, operatorPrompt) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "Actua como analista senior de soporte tecnico para una mesa de ayuda empresarial.",
              "Investiga con Google Search grounding y devuelve SOLO JSON valido, sin markdown.",
              "No inventes comandos destructivos. No pidas contrasenas. Marca pasos que requieran privilegios de administrador.",
              "El JSON debe tener: title, category, keywords, prerequisites, diagnosticChecks, resolutionSteps, rollbackSteps, riskNotes, adminRequired, serviceImpact, researchSummary.",
              "Prioriza documentacion oficial del fabricante. Separa diagnostico de cambios. Incluye siempre reversión cuando propongas modificar configuracion.",
              `Ticket: ${ticket.id}`,
              `Asunto: ${ticket.subject}`,
              `Descripcion: ${ticket.description}`,
              `Notas del operador: ${operatorPrompt || "sin notas adicionales"}`
            ].join("\n")
          }
        ]
      }
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.0,
      responseMimeType: "application/json"
    }
  };
}

function normalizeResearchResponse(payload, ticket, config) {
  const candidate = payload.candidates?.[0] ?? {};
  const text = candidate.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "{}";
  const parsed = parseJsonObject(text);
  const citations = extractCitations(candidate.groundingMetadata);
  const proposal = {
    title: cleanText(parsed.title) || `Investigacion Google AI: ${ticket.subject}`,
    category: cleanText(parsed.category) || "general",
    keywords: normalizeStringArray(parsed.keywords).slice(0, 12),
    prerequisites: normalizeStringArray(parsed.prerequisites).slice(0, 8),
    diagnosticChecks: normalizeStringArray(parsed.diagnosticChecks).slice(0, 10),
    resolutionSteps: normalizeStringArray(parsed.resolutionSteps).slice(0, 12),
    rollbackSteps: normalizeStringArray(parsed.rollbackSteps).slice(0, 8),
    riskNotes: normalizeStringArray(parsed.riskNotes).slice(0, 8),
    adminRequired: Boolean(parsed.adminRequired),
    serviceImpact: cleanText(parsed.serviceImpact) || "Sin impacto declarado; requiere revision.",
    researchSummary: cleanText(parsed.researchSummary) || "Investigacion generada con Google AI.",
    citations,
    provider: "google_ai_gemini",
    model: config.googleAiModel,
    status: "pending_review"
  };
  return { ...proposal, ...rankResearchProposal(proposal) };
}

function mockResearch(ticket, operatorPrompt, config) {
  const proposal = {
    title: `Investigacion Google AI: ${ticket.subject}`,
    category: inferCategory(`${ticket.subject} ${ticket.description}`),
    keywords: extractSimpleKeywords(`${ticket.subject} ${ticket.description} ${operatorPrompt}`),
    prerequisites: ["Identificar producto, version y sistema operativo."],
    diagnosticChecks: ["Capturar mensaje exacto y validar alcance sin cambios."],
    resolutionSteps: [
      "Confirmar version del software afectado y mensaje exacto de error.",
      "Revisar documentacion oficial o notas del fabricante antes de modificar configuracion.",
      "Aplicar cambios no destructivos y registrar evidencia antes/despues.",
      "Escalar a tecnico humano si se requiere credencial, licencia, MFA o acceso administrativo."
    ],
    riskNotes: [
      "Propuesta generada en modo simulacion; requiere validacion tecnica.",
      "No guardar contrasenas, tokens ni datos sensibles en la base de conocimiento."
    ],
    adminRequired: false,
    serviceImpact: "Sin impacto en modo simulacion.",
    researchSummary: "Propuesta simulada para validar el flujo de investigacion con revision humana.",
    citations: [
      { title: "Google AI mock research", uri: "https://ai.google.dev/gemini-api/docs/google-search" }
    ],
    provider: "google_ai_gemini_mock",
    model: config.googleAiModel,
    status: "pending_review"
  };
  return { ...proposal, ...rankResearchProposal(proposal) };
}

export function rankResearchProposal(proposal) {
  const signals = [];
  let score = 35;

  const sourceTrust = classifySourceTrust(proposal.citations ?? []);
  const citationCount = proposal.citations?.length ?? 0;
  if (citationCount >= 3) {
    score += 24;
    signals.push("3+ citas");
  } else if (citationCount > 0) {
    score += 12;
    signals.push("citas presentes");
  } else {
    score -= 20;
    signals.push("sin citas");
  }

  const stepCount = proposal.resolutionSteps?.length ?? 0;
  if (stepCount >= 4 && stepCount <= 8) {
    score += 20;
    signals.push("pasos operativos claros");
  } else if (stepCount > 0) {
    score += 8;
    signals.push("pasos incompletos");
  } else {
    score -= 25;
    signals.push("sin pasos");
  }

  const keywordCount = proposal.keywords?.length ?? 0;
  if (keywordCount >= 3) {
    score += 10;
    signals.push("palabras clave suficientes");
  }

  const riskText = normalizeForRisk(`${proposal.title} ${(proposal.resolutionSteps ?? []).join(" ")}`);
  if (/password|contrasena|token privado|secret|private key|formatear|borrar|delete|factory reset/.test(riskText)) {
    score -= 35;
    signals.push("requiere revision por riesgo alto");
  }

  if ((proposal.riskNotes?.length ?? 0) > 0) {
    score += 6;
    signals.push("incluye notas de riesgo");
  }

  if (sourceTrust.official > 0) {
    score += 10;
    signals.push("fuente oficial");
  } else if (citationCount > 0) {
    score -= 8;
    signals.push("fuentes secundarias");
  }

  const requiresRollback = proposal.adminRequired || /reiniciar|modificar|eliminar|borrar|desinstalar|registro|firewall|servicio/.test(riskText);
  if (requiresRollback && !(proposal.rollbackSteps?.length > 0)) {
    score -= 25;
    signals.push("sin reversión documentada");
  }

  const reviewScore = Math.max(0, Math.min(100, score));
  const reviewRecommendation = reviewScore >= 80 ? "recommended_for_approval" : reviewScore >= 60 ? "needs_review" : "high_risk_review";
  return { reviewScore, reviewRecommendation, reviewSignals: signals, sourceTrust, approvalRequired: true };
}

export function classifySourceTrust(citations) {
  const officialDomains = ["microsoft.com", "google.com", "apple.com", "cisco.com", "fortinet.com", "hp.com", "brother.com", "dell.com", "lenovo.com", "cisa.gov", "nist.gov", "openai.com"];
  let official = 0;
  let secondary = 0;
  let invalid = 0;
  for (const citation of citations ?? []) {
    try {
      const hostname = new URL(citation.uri).hostname.toLowerCase();
      if (officialDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) official += 1;
      else secondary += 1;
    } catch {
      invalid += 1;
    }
  }
  return { official, secondary, invalid, total: official + secondary };
}
function parseJsonObject(value) {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value ?? "").match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function extractCitations(metadata) {
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  return chunks
    .map((chunk) => ({
      title: cleanText(chunk.web?.title),
      uri: cleanText(chunk.web?.uri)
    }))
    .filter((item) => item.uri)
    .filter((item, index, list) => list.findIndex((other) => other.uri === item.uri) === index)
    .slice(0, 8);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean);
  }
  return String(value ?? "")
    .split(/\r?\n|\s*;\s*/)
    .map((item) => item.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean);
}

function extractSimpleKeywords(value) {
  const stopWords = new Set(["para", "como", "con", "del", "las", "los", "una", "uno", "por", "que", "este", "esta", "ticket", "soporte", "cliente"]);
  return normalizeForRisk(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token))
    .filter((token, index, list) => list.indexOf(token) === index)
    .slice(0, 10);
}

function inferCategory(value) {
  const normalized = normalizeForRisk(value);
  if (/correo|outlook|smtp|imap|mail/.test(normalized)) return "email";
  if (/internet|wifi|red|conexion/.test(normalized)) return "internet";
  if (/impresora|imprimir|toner|scanner/.test(normalized)) return "printer";
  if (/remoto|anydesk|teamviewer|control/.test(normalized)) return "remote_support";
  if (/vpn|forticlient|mfa|token/.test(normalized)) return "vpn";
  return "general";
}

function normalizeForRisk(value) {
  return cleanText(value).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function cleanText(value) {
  return String(value ?? "").trim();
}





