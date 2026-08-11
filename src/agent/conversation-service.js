export function createConversationService({ agentService, remoteSessionStore, ticketStore, whatsappClient, contactStore = null, auditStore = null, imageAnalysisService = null, onHumanEscalation = null, resolveClientInstallation = null, config }) {
  const customerIntake = new Map();
  const notifiedEscalations = new Set();
  return {
    async handleWhatsAppMessage(event) {
      if (event.id && ticketStore.hasExternalMessage(event.id)) {
        return { duplicate: true, ticketId: null, from: event.from, diagnosis: commandDiagnosis(null, "duplicate"), whatsappDelivery: { skipped: true, reason: "duplicate" } };
      }

      const knownContact = contactStore?.findByPhone?.(event.from) ?? null;
      const existingTicket = ticketStore.findOpenByPhone(event.from);
      const isNewTicket = !existingTicket;
      const ticket = existingTicket ?? ticketStore.create({
        customerName: knownContact?.name ?? event.profileName,
        customerPhone: event.from,
        subject: event.text.slice(0, 80) || "Solicitud por WhatsApp",
        description: event.text,
        source: "whatsapp",
        priority: "normal",
        status: contactStore ? "intake" : "open",
        intakeStage: contactStore ? "customer_details" : null,
        initialMessage: { externalId: event.id, messageType: event.type, attachments: event.attachments }
      });

      if (existingTicket) {
        ticketStore.addMessage(ticket.id, {
          direction: "inbound", channel: "whatsapp", body: event.text,
          author: event.profileName ?? event.from, externalId: event.id,
          messageType: event.type, attachments: event.attachments
        });
      }

      const intake = await handleCustomerIntake({ event, ticket, contactStore, knownContact, customerIntake, ticketStore, whatsappClient, resolveClientInstallation });
      if (intake) return intake;

      const imageAnalysis = await analyzeEvidence({ event, ticket, imageAnalysisService, ticketStore, auditStore });

      const command = detectConversationCommand(event.text, ticket.status);
      if (command) {
        const commandResult = handleConversationCommand({ command, ticket, remoteSessionStore, ticketStore, config });
        if (commandResult.diagnosis?.shouldEscalate && !notifiedEscalations.has(ticket.id)) {
          notifiedEscalations.add(ticket.id);
          await publishEscalation({
            auditStore, onHumanEscalation, ticket,
            metadata: { status: "escalated", severity: "attention", category: "human_request", recommendation: `El cliente solicitó atención humana para ${ticket.id}.` }
          });
        }
        const delivery = await whatsappClient.sendText({ to: event.from, body: commandResult.reply });
        ticketStore.addMessage(ticket.id, { direction: "outbound", channel: "whatsapp", author: "Fisher", body: commandResult.reply, delivery });
        return { ticketId: ticket.id, from: event.from, command: command.type, diagnosis: commandResult.diagnosis, remoteSessionId: commandResult.session?.id ?? null, whatsappDelivery: delivery };
      }

      if (["waiting_customer", "resolved"].includes(ticket.status)) ticketStore.update(ticket.id, { status: "open" });
      const diagnosticMessage = buildDiagnosticMessage(event.text, imageAnalysis);
      const initialDiagnosis = agentService.diagnose({ ticketId: ticket.id, message: diagnosticMessage });
      const diagnosis = imageAnalysis?.needsHuman ? { ...initialDiagnosis, shouldEscalate: true, nextAction: "human_review" } : initialDiagnosis;
      const priority = derivePriority(diagnosis, event.text, imageAnalysis);
      if (priority !== ticket.priority) ticketStore.update(ticket.id, { priority });
      if (diagnosis.shouldEscalate && !notifiedEscalations.has(ticket.id)) {
        notifiedEscalations.add(ticket.id);
        await publishEscalation({
          auditStore, onHumanEscalation, ticket,
          metadata: { status: "escalated", severity: priority === "urgent" ? "critical" : "attention", category: diagnosis.category, recommendation: `El ticket ${ticket.id} requiere atención humana.` }
        });
      }
      const session = shouldPrepareRemoteSession({ diagnosis, text: event.text })
        ? findReusableRemoteSession(remoteSessionStore, ticket.id) ?? remoteSessionStore.create({ ticketId: ticket.id, requestedBy: "Fisher", customerPhone: event.from })
        : null;
      const reply = buildReply({ ticket, diagnosis, session, config, isNewTicket, hasEvidence: event.attachments?.length > 0, imageAnalysis });
      const delivery = await whatsappClient.sendText({ to: event.from, body: reply });
      ticketStore.addMessage(ticket.id, { direction: "outbound", channel: "whatsapp", author: "Fisher", body: reply, delivery });
      return { ticketId: ticket.id, from: event.from, diagnosis, imageAnalysis, remoteSessionId: session?.id ?? null, whatsappDelivery: delivery };
    }
  };
}

async function analyzeEvidence({ event, ticket, imageAnalysisService, ticketStore, auditStore }) {
  if (!imageAnalysisService || !event.attachments?.some((item) => item.type === "image")) return null;
  try {
    const analysis = await imageAnalysisService.analyzeWhatsAppAttachments({ attachments: event.attachments, ticket });
    if (!analysis) return null;
    if (analysis.status === "completed") {
      ticketStore.addMessage(ticket.id, {
        direction: "internal",
        channel: "fisher",
        author: "Fisher Vision",
        body: formatImageAnalysis(analysis),
        messageType: "image_analysis",
        attachments: []
      });
      auditStore?.record?.({
        action: "agent.image_analysis.completed",
        entityType: "ticket",
        entityId: ticket.id,
        metadata: {
          imageCount: analysis.imageCount,
          model: analysis.model,
          urgency: analysis.urgency,
          needsHuman: analysis.needsHuman,
          confidence: analysis.confidence
        }
      });
    }
    return analysis;
  } catch (error) {
    auditStore?.record?.({
      action: "agent.image_analysis.failed",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: { severity: "attention", recommendation: "La imagen requiere revisión manual.", error: String(error?.message ?? error).slice(0, 300) }
    });
    return { status: "unavailable", reason: "image_analysis_failed", imageCount: event.attachments.filter((item) => item.type === "image").length };
  }
}

function formatImageAnalysis(analysis) {
  const lines = [`Análisis visual de Fisher: ${analysis.summary}`];
  if (analysis.visibleText?.length) lines.push(`Texto visible: ${analysis.visibleText.join(" | ")}`);
  if (analysis.likelyCauses?.length) lines.push(`Causas probables: ${analysis.likelyCauses.join(" | ")}`);
  if (analysis.safeChecks?.length) lines.push(`Verificaciones seguras: ${analysis.safeChecks.join(" | ")}`);
  if (analysis.riskSignals?.length) lines.push(`Señales de riesgo: ${analysis.riskSignals.join(" | ")}`);
  lines.push(`Confianza: ${Math.round(Number(analysis.confidence ?? 0) * 100)} % · Revisión humana: ${analysis.needsHuman ? "sí" : "no"}`);
  return lines.join("\n");
}

function buildDiagnosticMessage(text, analysis) {
  if (analysis?.status !== "completed") return text;
  return [
    text,
    `Análisis visual: ${analysis.summary}`,
    `Causas probables: ${analysis.likelyCauses?.join("; ") || "sin causa confirmada"}`,
    `Riesgos: ${analysis.riskSignals?.join("; ") || "sin señales visibles"}`
  ].join("\n");
}

async function publishEscalation({ auditStore, onHumanEscalation, ticket, metadata }) {
  const event = auditStore?.record?.({ action: "agent.escalated", entityType: "ticket", entityId: ticket.id, metadata });
  if (!onHumanEscalation) return event;
  try {
    await onHumanEscalation({ ticket, event, metadata });
  } catch (error) {
    auditStore?.record?.({
      action: "agent.escalation_notification.failed",
      entityType: "ticket",
      entityId: ticket.id,
      metadata: { error: String(error?.message ?? error).slice(0, 300) }
    });
  }
  return event;
}
async function handleCustomerIntake({ event, ticket, contactStore, knownContact, customerIntake, ticketStore, whatsappClient, resolveClientInstallation }) {
  if (!contactStore) return null;
  const complete = (profile) => Boolean(profile?.name && profile?.company && profile?.email);
  if (ticket.status !== "intake" && complete(knownContact)) return null;

  const phone = String(event.from ?? "").replace(/\D/g, "");
  let contact = knownContact;
  if (!complete(contact)) {
    const current = customerIntake.get(phone) ?? {
      name: knownContact?.name ?? "",
      company: knownContact?.company ?? "",
      email: knownContact?.email ?? ""
    };
    const parsed = parseCustomerProfile(event.text);
    Object.assign(current, Object.fromEntries(Object.entries(parsed).filter(([, value]) => value)));
    customerIntake.set(phone, current);
    const missing = ["name", "company", "email"].filter((field) => !current[field]);
    if (missing.length) {
      const labels = { name: "Nombre", company: "Empresa", email: "Correo" };
      const lines = [
        "Hola. Soy Fisher, asistente de soporte de SAS.",
        "Primero necesito crear o completar tu ficha de atención. Todavía no se ha generado un ticket.",
        "Responde en un solo mensaje con:"
      ];
      if (missing.includes("name")) lines.push("Nombre: tu nombre completo");
      if (missing.includes("company")) lines.push("Empresa: donde trabajas");
      if (missing.includes("email")) lines.push("Correo: tu correo electrónico");
      lines.push(`Datos pendientes: ${missing.map((field) => labels[field]).join(", ")}.`);
      ticketStore.update(ticket.id, { status: "intake", intakeStage: "customer_details" });
      return sendIntakeReply({ ticket, event, reply: lines.join("\n"), whatsappClient, ticketStore, stage: "customer_details" });
    }
    contact = knownContact
      ? contactStore.update(knownContact.id, { ...current, phone: event.from })
      : contactStore.create({ ...current, phone: event.from, notes: "Alta automática desde conversación de WhatsApp con Fisher." });
    customerIntake.delete(phone);
    ticketStore.update(ticket.id, { customerName: contact.name, contactId: contact.id, status: "intake", intakeStage: "client_check" });
  } else if (!ticket.contactId) {
    ticketStore.update(ticket.id, { customerName: contact.name, contactId: contact.id });
  }

  if (ticket.intakeStage === "problem_details") {
    const problem = String(event.text ?? "").trim() || (event.attachments?.length ? "Evidencia enviada por el cliente" : "Solicitud de soporte");
    ticketStore.update(ticket.id, { status: "open", intakeStage: null, subject: problem.slice(0, 80), description: problem });
    return null;
  }

  const client = resolveClientInstallation ? await resolveClientInstallation(ticketStore.get(ticket.id)) : { installed: true, agent: null };
  if (!client.installed) {
    ticketStore.update(ticket.id, { status: "intake", intakeStage: "client_installation" });
    const reply = [
      `Gracias, ${contact.name}. Tu ficha quedó vinculada a la Agenda de SAS.`,
      "Ahora valida el equipo donde necesitas ayuda instalando SAS Cliente desde esta liga:",
      client.installationUrl,
      `Código temporal: ${client.enrollment?.shortCode ?? ""}`,
      "Cuando termine la instalación, vuelve a WhatsApp. Fisher comprobará el equipo antes de pedirte el problema.",
      "Instalar SAS no autoriza acceso remoto; tú controlarás cada permiso."
    ].join("\n");
    return sendIntakeReply({ ticket, event, reply, whatsappClient, ticketStore, stage: "client_installation", contact });
  }

  ticketStore.update(ticket.id, { equipmentId: client.agent?.machineId ?? ticket.equipmentId, status: "intake", intakeStage: "problem_details" });
  const evidenceText = event.attachments?.length
    ? "Guardé el archivo recibido, pero envía ahora una descripción para crear el ticket correctamente."
    : "Ahora describe el problema con el mayor detalle posible o envía una fotografía/captura para analizarla.";
  return sendIntakeReply({
    ticket,
    event,
    reply: `Gracias, ${contact.name}. Tu ficha quedó vinculada a la Agenda de SAS y SAS Cliente está vinculado${client.agent?.hostname ? ` al equipo ${client.agent.hostname}` : ""}.\n${evidenceText}\nEl ticket se creará después de recibir el problema.`,
    whatsappClient,
    ticketStore,
    stage: "problem_details",
    contact
  });
}

async function sendIntakeReply({ ticket, event, reply, whatsappClient, ticketStore, stage, contact = null }) {
  const delivery = await whatsappClient.sendText({ to: event.from, body: reply });
  ticketStore.addMessage(ticket.id, { direction: "outbound", channel: "whatsapp", author: "Fisher", body: reply, delivery });
  return { ticketId: ticket.id, from: event.from, intake: true, intakeStage: stage, contact, diagnosis: commandDiagnosis(ticket.id, `intake_${stage}`), remoteSessionId: null, whatsappDelivery: delivery };
}
function parseCustomerProfile(text) {
  const value = String(text ?? "");
  const read = (pattern) => value.match(pattern)?.[1]?.trim().slice(0, 200) ?? "";
  const email = read(/(?:correo|email|e-mail)\s*[:=-]\s*([^\s,;]+@[^\s,;]+\.[^\s,;]+)/i)
    || (value.match(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/)?.[0] ?? "");
  return {
    name: read(/(?:^|\n)\s*nombre(?:\s+completo)?\s*[:=-]\s*([^\n;]+)/i),
    company: read(/(?:^|\n)\s*(?:empresa|compañ[ií]a|organización)\s*[:=-]\s*([^\n;]+)/i),
    email: email.toLowerCase()
  };
}
function shouldPrepareRemoteSession({ diagnosis, text }) {
  return (diagnosis.shouldEscalate && diagnosis.category !== "security")
    || diagnosis.nextAction === "request_remote_support"
    || diagnosis.category === "remote_support"
    || /remoto|anydesk|teamviewer|control|conect/i.test(text ?? "");
}
function buildReply({ ticket, diagnosis, session, config, isNewTicket, hasEvidence, imageAnalysis = null }) {
  const lines = [isNewTicket
    ? `Hola. Soy Fisher, asistente de soporte de SAS. Abrí el ticket ${ticket.id} y te acompanare hasta resolverlo.`
    : `Gracias, agregue la informacion al ticket ${ticket.id}.`];
  if (hasEvidence) lines.push("La imagen, audio o documento quedó registrado como evidencia para el técnico.");
  if (imageAnalysis?.status === "completed") {
    lines.push(`Fisher analizó la imagen: ${imageAnalysis.summary}`);
    if (imageAnalysis.safeChecks?.length) {
      lines.push("Verificaciones seguras sugeridas por la imagen:");
      imageAnalysis.safeChecks.slice(0, 3).forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    }
  } else if (imageAnalysis?.status === "unavailable") {
    lines.push("La imagen quedó disponible para el técnico; el análisis visual automático no estaba disponible.");
  }
  lines.push(describeDiagnosis(diagnosis));
  const clientSteps = clientSafeSteps(diagnosis);
  if (clientSteps.length) {
    lines.push("Prueba lo siguiente:");
    clientSteps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }
  if (session) {
    lines.push(`Prepare soporte remoto seguro con el codigo ${session.joinCode}.`);
    lines.push(`Centro de control de tu soporte: ${config.publicBaseUrl}/remote/consent/${session.joinCode}`);
    lines.push("Desde esa liga puedes revisar el estado, autorizar o rechazar el acceso y finalizar la sesión en cualquier momento. En la computadora afectada abre SAS Cliente y escribe este código.");
  }
  if (diagnosis.shouldEscalate) lines.push("El ticket requiere revisión de un tecnico; ya quedo marcado con prioridad.");
  lines.push(isNewTicket ? 'Puedes escribir "estado", "hablar con tecnico" o "ayuda".' : "Cuentame que ocurrio despues de probarlo.");
  return lines.join("\n");
}

function describeDiagnosis(diagnosis) {
  const labels = {
    email: "El problema parece estar relacionado con el correo electronico.",
    performance: "El equipo presenta senales de lentitud o falta de recursos.",
    software: "El problema parece estar relacionado con una aplicacion.",
    account_access: "El ticket parece relacionado con acceso o credenciales.",
    security: "Detecte un posible riesgo de seguridad. Evita compartir contrasenas o codigos.",
    remote_support: "Entiendo que necesitas asistencia remota.",
    general: "Necesito un poco mas de informacion para precisar la causa."
  };
  return labels[diagnosis.category] ?? "Ya estoy analizando el problema con la informacion disponible.";
}

function clientSafeSteps(diagnosis) {
  if (diagnosis.category === "remote_support") return [];
  return (diagnosis.recommendedSteps ?? []).filter((step) => !/escalar|crear codigo|consentimiento|registrar|tecnico/i.test(step)).slice(0, 3);
}

function derivePriority(diagnosis, text, imageAnalysis = null) {
  const normalized = normalizeText(text);
  if (imageAnalysis?.urgency === "urgent" || imageAnalysis?.riskSignals?.length) return "urgent";
  if (imageAnalysis?.urgency === "high" || imageAnalysis?.needsHuman) return "high";
  if (diagnosis.category === "security" || /ransomware|hackeo|robo de cuenta|datos expuestos|virus/.test(normalized)) return "urgent";
  if (diagnosis.shouldEscalate || /servidor caido|sin servicio|todos los equipos/.test(normalized)) return "high";
  return "normal";
}

function handleConversationCommand({ command, ticket, remoteSessionStore, ticketStore, config }) {
  if (command.type === "help") {
    return {
      reply: buildHelpReply(ticket),
      diagnosis: commandDiagnosis(ticket.id, command.type)
    };
  }

  if (command.type === "status") {
    const session = findReusableRemoteSession(remoteSessionStore, ticket.id);
    return {
      reply: buildStatusReply({ ticket, session, config }),
      diagnosis: commandDiagnosis(ticket.id, command.type),
      session
    };
  }

  if (command.type === "remote_link") {
    const session = findReusableRemoteSession(remoteSessionStore, ticket.id) ?? remoteSessionStore.create({
      ticketId: ticket.id,
      requestedBy: "Fisher",
      customerPhone: ticket.customerPhone
    });
    return {
      reply: buildRemoteLinkReply({ ticket, session, config }),
      diagnosis: commandDiagnosis(ticket.id, command.type),
      session
    };
  }


  if (command.type === "cancel_remote") {
    const closedSessions = closeOpenRemoteSessions(remoteSessionStore, ticket.id);
    const updatedTicket = ticketStore.update(ticket.id, { status: "waiting_customer" });
    const lines = [
      `Listo. Cancele el soporte remoto del ticket ${updatedTicket.id}.`
    ];
    if (closedSessions.length > 0) {
      lines.push(`Cerre ${closedSessions.length} sesion(es) remota(s) abierta(s).`);
    } else {
      lines.push("No habia sesiones remotas abiertas para cerrar.");
    }
    lines.push("El ticket sigue abierto. Puedes escribir 'enlace remoto' si quieres iniciar una nueva sesion o 'cerrar ticket' si el ticket ya quedó resuelto.");
    return {
      reply: lines.join("\n"),
      diagnosis: commandDiagnosis(ticket.id, command.type)
    };
  }
  if (command.type === "human") {
    const updatedTicket = ticketStore.update(ticket.id, { status: "in_progress" });
    return {
      reply: [
        `Listo. Marque el ticket ${updatedTicket.id} para revision de un tecnico humano.`,
        "Mientras tanto, puedes enviarme mas detalles, capturas o escribir 'enlace remoto' si autorizas una sesion segura."
      ].join("\n"),
      diagnosis: commandDiagnosis(ticket.id, command.type)
    };
  }

  if (command.type === "resolve") {
    ticketStore.update(ticket.id, { status: "resolved" });
    return { reply: `Me alegra saberlo. Marqué el ticket ${ticket.id} como resuelto, pero aun no lo cerrare. Confirma el cierre. Responde "confirmar cierre" o "continuar soporte".`, diagnosis: commandDiagnosis(ticket.id, command.type) };
  }

  if (command.type === "continue") {
    ticketStore.update(ticket.id, { status: "in_progress" });
    return { reply: `De acuerdo, el ticket ${ticket.id} seguirá abierto. Cuentame que continua fallando.`, diagnosis: commandDiagnosis(ticket.id, command.type) };
  }

  if (command.type === "confirm_close" || command.type === "close") {
    ticketStore.addMessage(ticket.id, { direction: "internal", channel: "closure_request", author: "Fisher", body: "El cliente solicitó el cierre. El ticket permanece abierto hasta que un técnico documente la sesión y lo cierre desde Tickets." });
    return {
      reply: `Registré tu solicitud de cierre para el ticket ${ticket.id}. El ticket seguirá abierto hasta que el técnico documente la sesión y lo cierre manualmente desde Tickets; no necesitas crear otro ticket.`,
      diagnosis: commandDiagnosis(ticket.id, command.type)
    };
  }

  return {
    reply: buildHelpReply(ticket),
    diagnosis: commandDiagnosis(ticket.id, "unknown")
  };
}

function buildHelpReply(ticket) {
  return [
    `Soy Fisher, agente tecnico de SAS. Tu ticket activo es ${ticket.id}.`,
    "Puedes escribir:",
    "- estado: ver avance del ticket y sesion remota.",
    "- enlace remoto: recibir o recuperar la liga segura de consentimiento.",
    "- cancelar remoto: cerrar la sesion remota sin cerrar el ticket.",
    "- hablar con tecnico: solicitar atencion humana.",
    "- cerrar ticket: solicitar al técnico el cierre documentado.",
    "Tambien puedes describir el problema con tus palabras para que haga un diagnostico."
  ].join("\n");
}

function buildStatusReply({ ticket, session, config }) {
  const lines = [
    `Ticket ${ticket.id}`,
    `Estado: ${labelTicketStatus(ticket.status)}`,
    `Prioridad: ${labelTicketPriority(ticket.priority)}`,
    `Actualizado: ${formatConversationDate(ticket.updatedAt)}`
  ];

  if (session) {
    lines.push(`Sesion remota: ${labelRemoteStatus(session.status)}`);
    lines.push(`Codigo: ${session.joinCode}`);
    lines.push(`Liga: ${config.publicBaseUrl}/remote/consent/${session.joinCode}`);
  } else {
    lines.push("Sesion remota: sin sesion abierta. Escribe 'enlace remoto' si deseas iniciar una.");
  }

  return lines.join("\n");
}

function buildRemoteLinkReply({ ticket, session, config }) {
  return [
    `Ticket ${ticket.id}: soporte remoto seguro listo.`,
    `Codigo: ${session.joinCode}`,
    `Liga: ${config.publicBaseUrl}/remote/consent/${session.joinCode}`,
    "En la computadora afectada, abre SAS Agent y escribe este codigo para vincular el equipo.",
    "Primero debes aprobar el consentimiento. Puedes detener la sesion desde esa pantalla en cualquier momento."
  ].join("\n");
}


function labelTicketStatus(value) {
  return ({
    open: "Abierto",
    waiting_customer: "Esperando respuesta del cliente",
    in_progress: "En revision por tecnico",
    resolved: "Resuelto",
    closed: "Cerrado"
  })[value] ?? String(value ?? "Sin estado");
}

function labelTicketPriority(value) {
  return ({ low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" })[value] ?? String(value ?? "Normal");
}

function labelRemoteStatus(value) {
  return ({
    pending_customer_consent: "Esperando consentimiento",
    authorized_waiting_agent: "Autorizado, esperando equipo",
    authorized_waiting_agent_assignment: "Autorizado, falta asignar equipo",
    active: "Activa",
    closed: "Cerrada",
    consent_rejected: "Rechazada",
    expired: "Expirada",
    consent_locked: "Bloqueada por intentos",
    control_locked: "Control bloqueado"
  })[value] ?? String(value ?? "Sin sesion");
}

function formatConversationDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("es-MX");
}
function commandDiagnosis(ticketId, commandType) {
  return {
    ticketId,
    category: `conversation_command:${commandType}`,
    confidence: 1,
    recommendedSteps: [],
    nextAction: "conversation_command",
    shouldEscalate: commandType === "human"
  };
}

export function detectConversationCommand(text, ticketStatus = "open") {
  const normalized = normalizeText(text);
  if (/^(ayuda|menu|opciones|comandos|que puedes hacer|como funciona)[?.! ]*$/.test(normalized) || /^(muestra|ensena|dime).*(menu|comandos|opciones)/.test(normalized)) return { type: "help" };
  if (/\b(estado|estatus|status|seguimiento|avance)( del| de)? (mi |el )?(ticket|caso)?\b/.test(normalized) || /^(estado|estatus|status|seguimiento|avance)$/.test(normalized)) return { type: "status" };
  if (/(enlace|liga|link|codigo).*(remoto|sesion|soporte)|remoto.*(enlace|liga|link|codigo)|mandame.*(enlace|liga|link)/.test(normalized)) return { type: "remote_link" };
  if (/(cancelar|cancela|detener|deten|finalizar|terminar).*(remoto|sesion|conexion|soporte remoto)|\b(no quiero remoto|cancelar remoto|detener remoto)\b/.test(normalized)) return { type: "cancel_remote" };
  if (/(hablar|pasame|quiero|necesito).*(tecnico|humano|asesor|operador|persona)|\b(tecnico humano|asesor humano|operador)\b/.test(normalized)) return { type: "human" };
  if (/confirm(ar|o)? (el )?cierre|si[, ]+cierra(lo)?|^confirmo$/.test(normalized)) return { type: "confirm_close" };
  if (/continuar soporte|seguir (con el )?(caso|soporte)|no (quedo|funciono)|aun falla|todavia falla/.test(normalized)) return { type: "continue" };
  if (/\b(ya quedo|resuelto|solucionado|ya funciona)\b|gracias.*quedo/.test(normalized)) return { type: "resolve" };
  if (/(cerrar|cierra|finalizar|terminar).*(ticket|caso)/.test(normalized)) return ticketStatus === "resolved" ? { type: "confirm_close" } : { type: "resolve" };
  return null;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function closeOpenRemoteSessions(remoteSessionStore, ticketId) {
  const sessions = getOpenRemoteSessions(remoteSessionStore, ticketId);
  for (const session of sessions) {
    remoteSessionStore.close(session.id, "Fisher");
  }
  return sessions;
}

function getOpenRemoteSessions(remoteSessionStore, ticketId) {
  return [...remoteSessionStore.list()].filter((session) => {
    return session.ticketId === ticketId && !["closed", "consent_rejected"].includes(session.status);
  });
}

function findReusableRemoteSession(remoteSessionStore, ticketId) {
  return getOpenRemoteSessions(remoteSessionStore, ticketId).reverse()[0] ?? null;
}





