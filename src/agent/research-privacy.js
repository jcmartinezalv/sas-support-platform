export function sanitizeResearchInput({ ticket, operatorPrompt = "" }) {
  const source = {
    ticketId: String(ticket?.id ?? "sin-ticket"),
    subject: String(ticket?.subject ?? ""),
    description: String(ticket?.description ?? ""),
    operatorPrompt: String(operatorPrompt ?? "")
  };
  let redactionCount = 0;
  const redact = (value) => String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, () => { redactionCount += 1; return "[EMAIL]"; })
    .replace(/(?:\+?\d[\s().-]*){10,15}/g, () => { redactionCount += 1; return "[PHONE]"; })
    .replace(/\b(password|contrasena|contraseña|token|api[_ -]?key|secret|clave)\s*[:=]\s*\S+/gi, (_match, label) => { redactionCount += 1; return `${label}=[REDACTED]`; });
  return {
    ticketId: source.ticketId,
    subject: redact(source.subject),
    description: redact(source.description),
    operatorPrompt: redact(source.operatorPrompt),
    redactionCount
  };
}

export function sanitizedTicket(ticket, sanitized) {
  return {
    id: sanitized.ticketId,
    subject: sanitized.subject,
    description: sanitized.description,
    source: ticket?.source ?? null,
    priority: ticket?.priority ?? null
  };
}
