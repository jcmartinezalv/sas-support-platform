import fs from "node:fs";

export function buildProductionReadiness({ config, storageStatus, agents = [], preflightReport = null, knowledgeArticles = [], repairOutcomeSummary = [], mobileIdentity = null } = {}) {
  const checks = [];
  const publicUrl = parseUrl(config.publicBaseUrl);
  const onlineAgents = agents.filter((agent) => agent.status === "online");
  const storage = storageStatus ?? {};

  checks.push(check({
    key: "public_base_url",
    tier: "required",
    label: "URL publica",
    status: publicUrl && publicUrl.protocol === "https:" && !isLocalHost(publicUrl.hostname) ? "pass" : "warn",
    message: publicUrl && publicUrl.protocol === "https:" && !isLocalHost(publicUrl.hostname)
      ? "PUBLIC_BASE_URL usa HTTPS y dominio publico."
      : "Configura PUBLIC_BASE_URL con dominio HTTPS publico antes de WhatsApp real.",
    details: { publicBaseUrl: config.publicBaseUrl }
  }));

  const tlsFilesExist = fs.existsSync(config.tlsKeyPath) && fs.existsSync(config.tlsCertPath);
  checks.push(check({
    key: "https_tls",
    tier: "required",
    label: "HTTPS",
    status: config.enableHttps && tlsFilesExist ? "pass" : config.enableHttps ? "warn" : "fail",
    message: config.enableHttps && tlsFilesExist
      ? "HTTPS esta habilitado y los archivos TLS existen."
      : config.enableHttps
        ? "HTTPS esta habilitado, pero falta validar archivos TLS."
        : "HTTPS esta deshabilitado; produccion requiere puerto 443.",
    details: { enableHttps: config.enableHttps, httpsPort: config.httpsPort, tlsKeyPath: config.tlsKeyPath, tlsCertPath: config.tlsCertPath }
  }));

  checks.push(check({
    key: "console_token",
    tier: "required",
    label: "Token consola",
    status: config.consoleSharedToken ? "pass" : "warn",
    message: config.consoleSharedToken
      ? "CONSOLE_SHARED_TOKEN configurado para proteger endpoints internos."
      : "Configura CONSOLE_SHARED_TOKEN antes de exponer consola en produccion.",
    details: { configured: Boolean(config.consoleSharedToken) }
  }));

  checks.push(check({
    key: "agent_secret",
    tier: "required",
    label: "Secreto agente",
    status: config.agentSharedSecret && config.agentSharedSecret !== "change-agent-secret" ? "pass" : "fail",
    message: config.agentSharedSecret && config.agentSharedSecret !== "change-agent-secret"
      ? "AGENT_SHARED_SECRET fue cambiado."
      : "Cambia AGENT_SHARED_SECRET antes de instalar clientes reales."
  }));

  checks.push(check({
    key: "whatsapp_credentials",
    tier: "recommended",
    label: "WhatsApp",
    status: whatsappReady(config) ? "pass" : "warn",
    message: whatsappReady(config)
      ? "Credenciales WhatsApp configuradas."
      : "Faltan credenciales de WhatsApp o WHATSAPP_APP_SECRET para validar la firma de Meta.",
    details: {
      verifyTokenConfigured: Boolean(config.whatsappVerifyToken && config.whatsappVerifyToken !== "change-me"),
      accessTokenConfigured: Boolean(config.whatsappAccessToken),
      phoneNumberIdConfigured: Boolean(config.whatsappPhoneNumberId),
      appSecretConfigured: Boolean(config.whatsappAppSecret)
    }
  }));

  checks.push(check({
    key: "storage",
    tier: "required",
    label: "Base local",
    status: storage.exists && storage.backupCount > 0 ? "pass" : storage.exists ? "warn" : "fail",
    message: storage.exists && storage.backupCount > 0
      ? "Base local y respaldos disponibles."
      : storage.exists
        ? "Base local disponible; crea al menos un respaldo."
        : "No se encontro base local persistida.",
    details: { filePath: storage.filePath, backupDir: storage.backupDir, backupCount: storage.backupCount ?? 0, size: storage.size ?? 0 }
  }));

  checks.push(check({
    key: "agents_online",
    tier: "recommended",
    label: "Agentes",
    status: onlineAgents.length > 0 ? "pass" : "warn",
    message: onlineAgents.length > 0
      ? `${onlineAgents.length} agente(s) online.`
      : "No hay agentes online para pruebas remotas.",
    details: { onlineAgents: onlineAgents.length, totalAgents: agents.length }
  }));

  checks.push(check({
    key: "client_preflight",
    tier: "recommended",
    label: "Preflight cliente",
    status: ["pass", "warn"].includes(preflightReport?.status) ? "pass" : "warn",
    message: preflightReport?.status
      ? `Preflight disponible con estado ${preflightReport.status}.`
      : "Ejecuta test-client-preflight antes de pruebas reales.",
    details: { status: preflightReport?.status ?? null, generatedAt: preflightReport?.generatedAt ?? null }
  }));

  checks.push(check({
    key: "remote_security",
    tier: "required",
    label: "Seguridad remota",
    status: config.remoteSessionTtlMinutes > 0 && config.remoteConsentMaxAttempts > 0 && config.remoteControlMaxAttempts > 0 ? "pass" : "fail",
    message: "TTL e intentos de consentimiento/control configurados.",
    details: {
      remoteSessionTtlMinutes: config.remoteSessionTtlMinutes,
      remoteConsentMaxAttempts: config.remoteConsentMaxAttempts,
      remoteControlMaxAttempts: config.remoteControlMaxAttempts
    }
  }));

  checks.push(check({
    key: "google_ai",
    tier: "optional",
    label: "Google AI",
    status: !config.googleAiEnabled ? "warn" : config.geminiApiKey && config.googleAiRequireReview ? "pass" : "warn",
    message: !config.googleAiEnabled
      ? "Google AI esta deshabilitado; Fisher usa reglas y base local."
      : config.geminiApiKey && config.googleAiRequireReview
        ? "Google AI habilitado con revision humana requerida."
        : "Google AI requiere GEMINI_API_KEY y revision humana activa.",
    details: { enabled: config.googleAiEnabled, mock: config.googleAiMock, requireReview: config.googleAiRequireReview, apiKeyConfigured: Boolean(config.geminiApiKey) }
  }));

  checks.push(check({
    key: "openai",
    tier: "optional",
    label: "OpenAI",
    status: !config.openAiEnabled ? "pass" : config.openAiMock || config.openAiApiKey ? "pass" : "warn",
    message: !config.openAiEnabled
      ? "OpenAI es opcional y esta deshabilitado; Fisher conserva Google AI y conocimiento local."
      : config.openAiMock
        ? "OpenAI habilitado en modo simulado con revision humana."
        : config.openAiApiKey
          ? "OpenAI habilitado con busqueda y revision humana obligatoria."
          : "OpenAI requiere OPENAI_API_KEY para consultas reales.",
    details: { enabled: Boolean(config.openAiEnabled), mock: Boolean(config.openAiMock), requireReview: true, apiKeyConfigured: Boolean(config.openAiApiKey), model: config.openAiModel, webSearch: Boolean(config.openAiWebSearch) }
  }));
  const mobileUserCount = mobileIdentity?.users?.length ?? 0;
  const mobileBootstrapStarted = Boolean(config.mobileBootstrapUsername || config.mobileBootstrapPassword);
  const mobileBootstrapComplete = Boolean(config.mobileBootstrapUsername && config.mobileBootstrapPassword);
  checks.push(check({
    key: "mobile_identity",
    tier: "optional",
    label: "Movilidad Android",
    status: mobileUserCount > 0 ? "pass" : mobileBootstrapStarted && !mobileBootstrapComplete ? "warn" : "pass",
    message: mobileUserCount > 0
      ? `Identidad movil lista con ${mobileUserCount} usuario(s).`
      : mobileBootstrapStarted
        ? "Completa usuario y contraseña bootstrap para activar movilidad."
        : "Movilidad Android opcional aun no activada.",
    details: { userCount: mobileUserCount, deviceCount: mobileIdentity?.devices?.length ?? 0, activeSessionCount: (mobileIdentity?.sessions ?? []).filter((item) => !item.revokedAt).length, bootstrapConfigured: mobileBootstrapComplete, accessTtlMinutes: config.mobileAccessTtlMinutes, refreshTtlDays: config.mobileRefreshTtlDays }
  }));
  const learningStatus = buildLearningStatus({ knowledgeArticles, repairOutcomeSummary });
  checks.push(check({
    key: "fisher_learning",
    tier: "recommended",
    label: "Aprendizaje Fisher",
    status: learningStatus.status,
    message: learningStatus.message,
    details: learningStatus.details
  }));

  const failCount = checks.filter((item) => item.status === "fail").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;
  const status = failCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";
  const percent = Math.round((checks.filter((item) => item.status === "pass").length / checks.length) * 100);
  const tiers = summarizeTiers(checks);
  const required = tiers.required;
  const mvpStatus = required.fail > 0 ? "fail" : required.warn > 0 ? "warn" : "pass";
  const mvpPercent = required.total ? Math.round((required.pass / required.total) * 100) : 100;

  const nextSteps = checks
    .filter((item) => item.status !== "pass")
    .sort((a, b) => stepRank(a) - stepRank(b))
    .map(readinessStep)
    .slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    status,
    percent,
    mvpStatus,
    mvpPercent,
    summary: { pass: checks.length - warnCount - failCount, warn: warnCount, fail: failCount, total: checks.length },
    tiers,
    checks,
    nextActions: nextSteps.map((item) => item.action),
    nextSteps
  };
}

function check(input) {
  const tier = input.tier ?? "recommended";
  return {
    key: input.key,
    label: input.label,
    status: input.status,
    tier,
    blocking: tier === "required" && input.status === "fail",
    message: input.message,
    details: input.details ?? {}
  };
}

function summarizeTiers(checks) {
  const summary = {
    required: emptyTierSummary(),
    recommended: emptyTierSummary(),
    optional: emptyTierSummary()
  };
  for (const item of checks) {
    const tier = summary[item.tier] ? item.tier : "recommended";
    summary[tier].total += 1;
    summary[tier][item.status] += 1;
  }
  return summary;
}

function emptyTierSummary() {
  return { pass: 0, warn: 0, fail: 0, total: 0 };
}

function stepRank(item) {
  const tierRank = { required: 0, recommended: 1, optional: 2 }[item.tier] ?? 1;
  const statusRank = { fail: 0, warn: 1, pass: 2 }[item.status] ?? 1;
  return tierRank * 10 + statusRank;
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(String(hostname).toLowerCase());
}

function whatsappReady(config) {
  return Boolean(
    config.whatsappVerifyToken &&
    config.whatsappVerifyToken !== "change-me" &&
    config.whatsappAccessToken &&
    config.whatsappPhoneNumberId &&
    config.whatsappAppSecret
  );
}


function readinessStep(item) {
  const fallback = {
    title: item.label,
    action: item.message,
    owner: item.status === "fail" ? "Administrador" : "Tecnico",
    priority: item.status === "fail" ? "Alta" : "Media"
  };

  const steps = {
    public_base_url: {
      title: "Publicar dominio HTTPS",
      action: "Configurar PUBLIC_BASE_URL con el dominio final, por ejemplo https://soporte.tuempresa.com.",
      owner: "Administrador",
      priority: "Alta"
    },
    https_tls: {
      title: "Activar HTTPS 443",
      action: "Generar o instalar certificado TLS y activar ENABLE_HTTPS para operar por el puerto 443.",
      owner: "Administrador",
      priority: item.status === "fail" ? "Alta" : "Media"
    },
    console_token: {
      title: "Proteger consola",
      action: "Definir CONSOLE_SHARED_TOKEN antes de exponer la consola fuera de la red local.",
      owner: "Administrador",
      priority: "Media"
    },
    agent_secret: {
      title: "Cambiar secreto de agentes",
      action: "Definir AGENT_SHARED_SECRET propio y reinstalar clientes con ese mismo secreto.",
      owner: "Administrador",
      priority: "Alta"
    },
    whatsapp_credentials: {
      title: "Conectar WhatsApp real",
      action: "Configurar verify token, access token, phone number id y app secret de Meta WhatsApp.",
      owner: "Administrador",
      priority: "Media"
    },
    storage: {
      title: "Respaldar base local",
      action: "Crear un respaldo desde Registro antes de iniciar pruebas con clientes reales.",
      owner: "Tecnico",
      priority: item.status === "fail" ? "Alta" : "Media"
    },
    agents_online: {
      title: "Conectar agente Windows",
      action: "Iniciar el cliente SAS en al menos un equipo Windows y confirmar que aparezca online.",
      owner: "Tecnico",
      priority: "Media"
    },
    client_preflight: {
      title: "Ejecutar preflight cliente",
      action: "Correr scripts\\test-client-preflight.ps1 en el equipo Windows antes de probar acceso remoto.",
      owner: "Tecnico",
      priority: "Media"
    },
    remote_security: {
      title: "Revisar seguridad remota",
      action: "Confirmar TTL e intentos maximos de consentimiento y control remoto.",
      owner: "Administrador",
      priority: "Alta"
    },
    google_ai: {
      title: "Preparar Fisher IA",
      action: "Activar Google AI solo con GEMINI_API_KEY y revision humana obligatoria.",
      owner: "Supervisor",
      priority: "Media"
    },
    fisher_learning: {
      title: "Alimentar aprendizaje Fisher",
      action: "Confirmar resultados de reparaciones y aprobar propuestas revisadas en Soluciones.",
      owner: "Supervisor",
      priority: "Media"
    }
  };

  return { ...fallback, ...(steps[item.key] ?? {}) };
}

function buildLearningStatus({ knowledgeArticles = [], repairOutcomeSummary = [], mobileIdentity = null } = {}) {
  const articles = Array.isArray(knowledgeArticles) ? knowledgeArticles : [];
  const outcomes = Array.isArray(repairOutcomeSummary) ? repairOutcomeSummary : [];
  const approvedArticles = articles.filter((article) => article.status === "approved").length;
  const pendingReview = articles.filter((article) => article.status === "pending_review").length;
  const confirmedResolved = outcomes.reduce((sum, item) => sum + Number(item.confirmedResolved ?? 0), 0);
  const confirmedUnresolved = outcomes.reduce((sum, item) => sum + Number(item.confirmedUnresolved ?? 0), 0);
  const confirmedTotal = confirmedResolved + confirmedUnresolved;
  const learnedRepairActions = outcomes.filter((item) => Number(item.confirmedResolved ?? 0) >= 2 && Number(item.resolutionRate ?? 0) >= 0.75).length;

  if (approvedArticles > 0 && confirmedTotal > 0) {
    return {
      status: "pass",
      message: "Fisher tiene conocimiento aprobado y reparaciones confirmadas para ajustar decisiones.",
      details: { approvedArticles, pendingReview, confirmedResolved, confirmedUnresolved, learnedRepairActions }
    };
  }

  if (approvedArticles > 0 || pendingReview > 0 || confirmedTotal > 0) {
    return {
      status: "warn",
      message: "Fisher ya tiene senales de aprendizaje, pero falta aprobar propuestas o confirmar mas reparaciones.",
      details: { approvedArticles, pendingReview, confirmedResolved, confirmedUnresolved, learnedRepairActions }
    };
  }

  return {
    status: "warn",
    message: "Fisher aun no tiene reparaciones confirmadas ni propuestas revisadas para aprendizaje productivo.",
    details: { approvedArticles, pendingReview, confirmedResolved, confirmedUnresolved, learnedRepairActions }
  };
}





