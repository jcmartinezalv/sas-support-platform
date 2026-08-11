const INITIAL_ARTICLES = [
  {
    title: "Internet lento o intermitente",
    category: "internet",
    keywords: ["internet", "wifi", "red", "lento", "conexion"],
    resolutionSteps: [
      "Confirmar alcance: un equipo, varios equipos o toda la oficina.",
      "Verificar energia y estado de luces del modem/router.",
      "Pedir reinicio controlado de router y equipo.",
      "Si persiste, abrir sesion remota o escalar a proveedor ISP."
    ]
  },
  {
    title: "Solicitud de soporte remoto",
    category: "remote_support",
    keywords: ["remoto", "anydesk", "teamviewer", "control"],
    resolutionSteps: [
      "Explicar al cliente el alcance de la sesion.",
      "Generar codigo unico de acceso.",
      "Esperar consentimiento verificable.",
      "Registrar hora de inicio, tecnico y acciones realizadas."
    ]
  },
  {
    title: "Correo no sincroniza en Outlook",
    category: "email",
    keywords: ["correo", "outlook", "imap", "smtp"],
    resolutionSteps: [
      "Validar acceso desde webmail.",
      "Revisar mensaje de error y estado de licencia.",
      "Verificar configuracion IMAP/SMTP o Exchange.",
      "No solicitar contrasenas por WhatsApp."
    ]
  }
];

export function createKnowledgeBaseStore({ initialArticles = [], onChange = () => {} } = {}) {
  const seedArticles = initialArticles.length > 0 ? initialArticles : INITIAL_ARTICLES.map((article) => buildArticle(article, "seed"));
  const articles = new Map(seedArticles.map((article) => [article.id, article]));

  if (initialArticles.length === 0) {
    persist();
  }

  return {
    list() {
      return [...articles.values()];
    },

    search(query, options = {}) {
      const source = options.includePending ? articles.values() : approvedArticles(articles.values());
      return rankArticles(source, query)
        .filter((match) => match.score > 0)
        .map(({ article, score, matchedKeywords }) => ({ ...article, score, matchedKeywords }));
    },

    findBest(query, minimumScore = 2) {
      const [best] = rankArticles(approvedArticles(articles.values()), query);
      if (!best || best.score < minimumScore) {
        return null;
      }
      return { ...best.article, score: best.score, matchedKeywords: best.matchedKeywords };
    },

    findBestPending(query, { minimumMatchScore = 2, minimumReviewScore = 75 } = {}) {
      const [best] = rankArticles(pendingArticles(articles.values()), query);
      if (!best || best.score < minimumMatchScore || Number(best.article.reviewScore ?? 0) < minimumReviewScore) {
        return null;
      }
      return { ...best.article, score: best.score, matchedKeywords: best.matchedKeywords };
    },



    reviewMetrics() {
      const items = [...articles.values()].filter((article) => Number(article.reviewScore ?? 0) > 0);
      const byStatus = items.reduce((acc, article) => {
        acc[article.status] = (acc[article.status] ?? 0) + 1;
        return acc;
      }, {});
      const scores = items.map((article) => Number(article.reviewScore ?? 0));
      const averageScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
      const approvedScores = items.filter((article) => article.status === "approved").map((article) => Number(article.reviewScore ?? 0));
      const rejectedScores = items.filter((article) => article.status === "rejected").map((article) => Number(article.reviewScore ?? 0));
      return {
        total: items.length,
        pending: byStatus.pending_review ?? 0,
        approved: byStatus.approved ?? 0,
        rejected: byStatus.rejected ?? 0,
        averageScore,
        averageApprovedScore: average(approvedScores),
        averageRejectedScore: average(rejectedScores),
        observation: "reviewScore* en evaluacion"
      };
    },
    reviewQueue({ status = "pending_review" } = {}) {
      return [...articles.values()]
        .filter((article) => article.status === status)
        .sort((left, right) => Number(right.reviewScore ?? 0) - Number(left.reviewScore ?? 0) || String(right.updatedAt).localeCompare(String(left.updatedAt)));
    },
    create(input, actorId) {
      const article = buildArticle(input, actorId);
      articles.set(article.id, article);
      persist();
      return article;
    },

    update(articleId, input) {
      const current = articles.get(articleId);
      if (!current) {
        return null;
      }
      const article = buildArticle({ ...current, ...input, id: current.id, createdAt: current.createdAt, createdBy: current.createdBy }, current.createdBy);
      article.updatedAt = new Date().toISOString();
      articles.set(article.id, article);
      persist();
      return article;
    }
  };

  function persist() {
    onChange([...articles.values()]);
  }
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}
function rankArticles(articleList, query) {
  const normalizedQuery = normalize(query);
  const tokens = tokenize(normalizedQuery);
  if (!normalizedQuery) {
    return [...articleList].map((article) => ({ article, score: 0, matchedKeywords: [] }));
  }

  return [...articleList]
    .map((article) => {
      const articleText = normalize(`${article.title} ${article.category} ${(article.keywords ?? []).join(" ")} ${(article.resolutionSteps ?? []).join(" ")}`);
      const matchedKeywords = (article.keywords ?? []).filter((keyword) => normalizedQuery.includes(normalize(keyword)) || normalize(keyword).includes(normalizedQuery));
      let score = matchedKeywords.length * 4;

      if (normalize(article.title).includes(normalizedQuery)) score += 5;
      if (normalize(article.category).includes(normalizedQuery)) score += 3;

      for (const token of tokens) {
        if (token.length < 3) continue;
        if (articleText.includes(token)) score += 1;
      }

      return { article, score, matchedKeywords };
    })
    .sort((left, right) => right.score - left.score || String(right.article.updatedAt).localeCompare(String(left.article.updatedAt)));
}

function buildArticle(input, actorId) {
  const now = new Date().toISOString();
  const title = cleanText(input.title) || "Articulo sin titulo";
  const keywords = Array.isArray(input.keywords) ? input.keywords.map(cleanText).filter(Boolean) : [];
  return {
    id: input.id ?? createId("KB"),
    title,
    category: cleanText(input.category) || "general",
    keywords: keywords.length > 0 ? [...new Set(keywords)] : extractKeywords(`${title} ${input.category ?? ""}`),
    prerequisites: Array.isArray(input.prerequisites) ? input.prerequisites.map(cleanText).filter(Boolean) : [],
    diagnosticChecks: Array.isArray(input.diagnosticChecks) ? input.diagnosticChecks.map(cleanText).filter(Boolean) : [],
    resolutionSteps: Array.isArray(input.resolutionSteps) ? input.resolutionSteps.map(cleanText).filter(Boolean) : [],
    rollbackSteps: Array.isArray(input.rollbackSteps) ? input.rollbackSteps.map(cleanText).filter(Boolean) : [],
    status: cleanText(input.status) || "approved",
    createdBy: input.createdBy ?? actorId,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    sourceTicketId: cleanText(input.sourceTicketId) || null,
    repairActionId: cleanText(input.repairActionId) || null,
    provider: cleanText(input.provider) || null,
    model: cleanText(input.model) || null,
    researchSummary: cleanText(input.researchSummary) || null,
    riskNotes: Array.isArray(input.riskNotes) ? input.riskNotes.map(cleanText).filter(Boolean) : [],
    adminRequired: Boolean(input.adminRequired),
    serviceImpact: cleanText(input.serviceImpact) || null,
    sourceTrust: input.sourceTrust && typeof input.sourceTrust === "object" ? { ...input.sourceTrust } : null,
    approvalRequired: input.approvalRequired !== false,
    providerComparison: input.providerComparison && typeof input.providerComparison === "object" ? { ...input.providerComparison } : null,
    privacy: input.privacy && typeof input.privacy === "object" ? { ...input.privacy } : null,
    citations: Array.isArray(input.citations) ? input.citations.map(normalizeCitation).filter((citation) => citation.uri) : [],
    reviewScore: Number(input.reviewScore ?? 0),
    reviewRecommendation: cleanText(input.reviewRecommendation) || null,
    reviewSignals: Array.isArray(input.reviewSignals) ? input.reviewSignals.map(cleanText).filter(Boolean) : [],
    reviewedBy: cleanText(input.reviewedBy) || null,
    reviewedAt: cleanText(input.reviewedAt) || null,
    reviewNote: cleanText(input.reviewNote) || null
  };
}

function approvedArticles(articleList) {
  return [...articleList].filter((article) => article.status === "approved");
}

function pendingArticles(articleList) {
  return [...articleList].filter((article) => article.status === "pending_review");
}

function normalizeCitation(input) {
  return {
    title: cleanText(input?.title),
    uri: cleanText(input?.uri)
  };
}

export function extractKeywords(value, limit = 8) {
  const stopWords = new Set(["para", "como", "con", "del", "las", "los", "una", "uno", "por", "que", "este", "esta", "ticket", "soporte", "cliente"]);
  return tokenize(normalize(value))
    .filter((token) => token.length >= 4 && !stopWords.has(token))
    .filter((token, index, list) => list.indexOf(token) === index)
    .slice(0, limit);
}

function tokenize(value) {
  return normalize(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function normalize(value) {
  return cleanText(value).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}








