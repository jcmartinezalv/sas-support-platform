import { attachRepairDecisions } from "./repair-decision-engine.js";
import { suggestRepairActions } from "../repairs/repair-catalog.js";
import { findSupportCategory } from "./support-taxonomy.js";
const KNOWLEDGE_RULES = [
  {
    category: "internet",
    keywords: ["internet", "wifi", "red", "conexion", "conexión", "lento"],
    confidence: 0.72,
    steps: [
      "Confirmar si el problema ocurre en un solo equipo o en todos.",
      "Verificar que el modem y el router tengan energia y luces estables.",
      "Pedir al cliente reiniciar router y equipo antes de escalar.",
      "Si continua, solicitar autorizacion para soporte remoto."
    ]
  },
  {
    category: "remote_support",
    keywords: ["teamviewer", "anydesk", "remoto", "conectate", "conéctate", "control", "ayudame", "ayúdame"],
    confidence: 0.81,
    steps: [
      "Confirmar que el cliente autoriza una sesion remota.",
      "Crear codigo unico de sesion.",
      "Esperar consentimiento del cliente antes de cualquier accion.",
      "Registrar inicio, cierre y tecnico responsable."
    ],
    nextAction: "request_remote_support"
  },
  {
    category: "printer",
    keywords: ["impresora", "imprimir", "toner", "tóner", "papel", "scanner", "escanner"],
    confidence: 0.68,
    steps: [
      "Confirmar modelo de impresora y equipo afectado.",
      "Validar si la impresora aparece en linea.",
      "Revisar cola de impresion y reiniciar servicio si aplica.",
      "Si requiere controlador, escalar a soporte remoto."
    ]
  },
  {
    category: "email",
    keywords: ["correo", "mail", "outlook", "smtp", "imap", "contraseña"],
    confidence: 0.7,
    steps: [
      "Confirmar cuenta afectada y mensaje de error.",
      "Validar acceso desde webmail.",
      "Revisar configuracion de cliente de correo.",
      "Nunca pedir contraseñas por WhatsApp; usar cambio seguro o sesion asistida."
    ]
  },
  {
    category: "performance",
    keywords: ["lento", "lenta", "trabado", "trabada", "congelado", "congelada", "memoria", "disco lleno", "se tarda"],
    confidence: 0.71,
    steps: [
      "Confirmar desde cuando ocurre y si afecta a uno o varios programas.",
      "Revisar espacio libre, memoria y procesos con mayor consumo.",
      "Reiniciar el equipo si hay trabajo guardado y el cliente lo autoriza.",
      "Antes de limpiar archivos, solicitar consentimiento y mostrar el alcance."
    ]
  },
  {
    category: "software",
    keywords: ["programa", "aplicacion", "error al abrir", "no inicia", "se cierra", "actualizacion"],
    confidence: 0.7,
    steps: [
      "Confirmar nombre y version del programa y copiar el mensaje de error.",
      "Validar si el problema afecta a otros usuarios o solo a este equipo.",
      "Revisar actualizaciones y requisitos sin desinstalar automaticamente.",
      "Escalar a soporte remoto si requiere cambios en el equipo."
    ]
  },
  {
    category: "account_access",
    keywords: ["no puedo entrar", "cuenta bloqueada", "olvide mi contraseña", "acceso denegado", "iniciar sesion"],
    confidence: 0.76,
    steps: [
      "Confirmar el servicio y la identidad por el procedimiento autorizado.",
      "Nunca solicitar ni recibir la contraseña actual por WhatsApp.",
      "Usar el flujo oficial de recuperacion o cambio de contraseña.",
      "Escalar a un tecnico si la cuenta sigue bloqueada."
    ]
  },
  {
    category: "security",
    keywords: ["virus", "malware", "ransomware", "hackeado", "phishing", "correo sospechoso", "robo de cuenta"],
    confidence: 0.9,
    shouldEscalate: true,
    nextAction: "human_review",
    steps: [
      "Desconectar el equipo de la red si hay actividad sospechosa activa.",
      "No borrar archivos, pagar rescates ni ejecutar herramientas sin autorizacion.",
      "Registrar mensaje, hora, equipo y evidencia disponible.",
      "Escalar inmediatamente al responsable de seguridad."
    ]
  }
];

export function createAgentService({ ticketStore, knowledgeBaseStore = null }) {
  return {
    diagnose(input) {
      const message = cleanText(input.message);
      const ticket = input.ticketId ? ticketStore.get(input.ticketId) : null;
      const query = message || ticket?.description || "";
      const learnedArticle = knowledgeBaseStore?.findBest(query, 2);
      const pendingArticle = learnedArticle ? null : knowledgeBaseStore?.findBestPending(query, { minimumMatchScore: 2, minimumReviewScore: 75 });
      const matchedRule = learnedArticle ? null : findRule(message);
      const taxonomyMatch = learnedArticle || matchedRule ? null : findSupportCategory(message);
      const shouldEscalate = learnedArticle ? false : (matchedRule?.shouldEscalate ?? taxonomyMatch?.shouldEscalate ?? (!matchedRule && !taxonomyMatch));
      const nextAction = learnedArticle
        ? "send_guided_steps"
        : pendingArticle ? "review_ai_proposal" : matchedRule?.nextAction ?? taxonomyMatch?.nextAction ?? (shouldEscalate ? "human_review" : "send_guided_steps");
      const suggestedRepairActions = suggestRepairActions({
        category: learnedArticle?.category ?? matchedRule?.category ?? taxonomyMatch?.id ?? pendingArticle?.category,
        message: query
      });

      const diagnosis = {
        ticketId: input.ticketId ?? null,
        ticketStatus: ticket?.status ?? null,
        category: learnedArticle?.category ?? matchedRule?.category ?? taxonomyMatch?.id ?? pendingArticle?.category ?? "general",
        confidence: learnedArticle ? confidenceFromScore(learnedArticle.score) : matchedRule?.confidence ?? taxonomyMatch?.confidence ?? pendingConfidence(pendingArticle) ?? 0.42,
        shouldEscalate: pendingArticle ? true : shouldEscalate,
        recommendedSteps: learnedArticle?.resolutionSteps ?? matchedRule?.steps ?? taxonomyMatch?.safeChecks ?? pendingReviewSteps(pendingArticle) ?? [
          "Pedir descripcion del problema, equipo afectado y urgencia.",
          "Solicitar captura o mensaje de error si existe.",
          "Escalar a operador humano si hay perdida de servicio o datos."
        ],
        nextAction,
        source: learnedArticle ? "knowledge_base" : pendingArticle ? "pending_review_ranked" : taxonomyMatch ? "taxonomy" : "rules",
        articleId: learnedArticle?.id ?? null,
        articleTitle: learnedArticle?.title ?? null,
        pendingReviewCandidate: pendingArticle ? summarizePendingArticle(pendingArticle) : null,
        repairActions: []
      };


      diagnosis.repairActions = attachRepairDecisions(suggestedRepairActions, {
        confidence: diagnosis.confidence,
        source: diagnosis.source,
        shouldEscalate: diagnosis.shouldEscalate,
        hasCustomerConsent: input.remoteSession?.consent?.decision === "approved",
        hasAssignedAgent: Boolean(input.remoteSession?.agentId)
      });
      if (ticket) {
        const source = diagnosis.articleId ? ` articulo ${diagnosis.articleId}` : diagnosis.pendingReviewCandidate ? ` propuesta pendiente ${diagnosis.pendingReviewCandidate.articleId}` : " reglas base";
        ticketStore.addMessage(ticket.id, {
          direction: "internal",
          channel: "agent",
          author: "Fisher",
          body: `Diagnostico ${diagnosis.category} con confianza ${diagnosis.confidence}. Accion: ${diagnosis.nextAction}. Fuente:${source}.`
        });
      }

      return diagnosis;
    }
  };
}

function pendingReviewSteps(article) {
  if (!article) return null;
  return [
    `Revisar propuesta pendiente ${article.id} con ranking ${article.reviewScore}/100.`,
    "Validar citas, riesgos y pasos antes de aprobar.",
    "Si la propuesta es correcta, aprobar articulo en Conocimiento para que Fisher la use automaticamente."
  ];
}

function summarizePendingArticle(article) {
  return {
    articleId: article.id,
    title: article.title,
    category: article.category,
    reviewScore: article.reviewScore,
    reviewRecommendation: article.reviewRecommendation,
    reviewSignals: article.reviewSignals,
    citations: article.citations,
    resolutionSteps: article.resolutionSteps
  };
}

function pendingConfidence(article) {
  if (!article) return null;
  return Math.min(0.74, Math.max(0.52, Number((article.reviewScore / 100 * 0.74).toFixed(2))));
}

function confidenceFromScore(score) {
  return Math.min(0.92, Math.max(0.76, Number((0.72 + score * 0.03).toFixed(2))));
}

function findRule(message) {
  const normalized = normalize(message);
  return KNOWLEDGE_RULES
    .map((rule) => ({
      rule,
      matchCount: rule.keywords.filter((keyword) => normalized.includes(normalize(keyword))).length
    }))
    .filter((item) => item.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount
      || Number(Boolean(b.rule.shouldEscalate)) - Number(Boolean(a.rule.shouldEscalate))
      || b.rule.confidence - a.rule.confidence)[0]?.rule ?? null;
}

function normalize(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function cleanText(value) {
  return String(value ?? "").trim();
}









