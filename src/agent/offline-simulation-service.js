import { createAgentService } from "./agent-service.js";
import { createConversationService } from "./conversation-service.js";
import { createRemoteSessionStore } from "../remote/remote-session-store.js";
import { createTicketStore } from "../tickets/ticket-store.js";

export const DEFAULT_OFFLINE_SCENARIOS = [
  { id: "internet", text: "Mi internet esta lento y no puedo navegar", expectedCategory: "internet", expectedRemote: false },
  { id: "email", text: "Outlook no abre y no puedo consultar mi correo", expectedCategory: "email", expectedRemote: false },
  { id: "printer", text: "La impresora no imprime y la cola esta detenida", expectedCategory: "printer", expectedRemote: false },
  { id: "performance", text: "Mi computadora esta lenta y se queda congelada", expectedCategory: "performance", expectedRemote: false },
  { id: "software", text: "Un programa muestra error al abrir y se cierra", expectedCategory: "software", expectedRemote: false },
  { id: "account", text: "Mi cuenta esta bloqueada y no puedo entrar", expectedCategory: "account_access", expectedRemote: false },
  { id: "security", text: "Recibi un correo sospechoso y creo que es phishing", expectedCategory: "security", expectedRemote: false, expectedEscalation: true },
  { id: "remote", text: "Necesito soporte remoto para que revisen mi equipo", expectedCategory: "remote_support", expectedRemote: true }
];

export async function runOfflineSimulations({ scenarios = DEFAULT_OFFLINE_SCENARIOS, publicBaseUrl = "https://sas.local.test" } = {}) {
  const results = [];
  for (const [index, scenario] of scenarios.entries()) {
    const deliveries = [];
    const ticketStore = createTicketStore();
    const remoteSessionStore = createRemoteSessionStore({ security: { ttlMinutes: 60 } });
    const agentService = createAgentService({ ticketStore });
    const conversationService = createConversationService({ agentService, remoteSessionStore, ticketStore, whatsappClient: { async sendText(message) { deliveries.push(message); return { ok: true, skipped: true }; } }, config: { publicBaseUrl } });
    const event = { from: `521555900${String(index).padStart(4, "0")}`, profileName: `Simulacion ${scenario.id}`, text: scenario.text };
    try {
      const response = await conversationService.handleWhatsAppMessage(event);
      const ticket = ticketStore.get(response.ticketId);
      const session = response.remoteSessionId ? remoteSessionStore.get(response.remoteSessionId) : null;
      const checks = [
        check("ticket_created", Boolean(ticket), "Se creó el ticket"),
        check("category", response.diagnosis?.category === scenario.expectedCategory, `Categoria ${response.diagnosis?.category ?? "sin dato"}`),
        check("reply", deliveries.length === 1 && Boolean(deliveries[0]?.body), "Fisher genero respuesta"),
        check("remote_session", Boolean(session) === Boolean(scenario.expectedRemote), scenario.expectedRemote ? "Sesion remota creada" : "No se creo remoto innecesario"),
        check("escalation", scenario.expectedEscalation == null || response.diagnosis?.shouldEscalate === scenario.expectedEscalation, scenario.expectedEscalation ? "Escalamiento humano obligatorio" : "Escalamiento esperado")
      ];
      let lifecycle = null;
      if (scenario.expectedRemote && session) {
        const statusResult = await conversationService.handleWhatsAppMessage({ ...event, text: "estado de mi ticket" });
        const statusReply = deliveries.at(-1)?.body ?? "";
        const linkResult = await conversationService.handleWhatsAppMessage({ ...event, text: "mandame el enlace remoto" });
        const cancelResult = await conversationService.handleWhatsAppMessage({ ...event, text: "cancelar soporte remoto" });
        const afterCancelTicket = ticketStore.get(ticket.id);
        const afterCancelSession = remoteSessionStore.get(session.id);
        const ticketStatusAfterCancel = afterCancelTicket?.status;
        const sessionStatusAfterCancel = afterCancelSession?.status;
        const closeResult = await conversationService.handleWhatsAppMessage({ ...event, text: "cerrar ticket" });
        const ticketStatusAfterResolve = ticketStore.get(ticket.id)?.status;
        const confirmResult = await conversationService.handleWhatsAppMessage({ ...event, text: "confirmar cierre" });
        const afterCloseTicket = ticketStore.get(ticket.id);
        checks.push(
          check("status_command", statusResult.command === "status" && /Esperando consentimiento/.test(statusReply), "Estado amigable disponible"),
          check("remote_link_reused", linkResult.remoteSessionId === session.id && remoteSessionStore.list().length === 1, "Enlace reutilizado sin duplicar sesion"),
          check("remote_cancel_safe", cancelResult.command === "cancel_remote" && sessionStatusAfterCancel === "closed" && ticketStatusAfterCancel === "waiting_customer", "Remoto cerrado y ticket conservado"),
          check("ticket_close", closeResult.command === "resolve" && ticketStatusAfterResolve === "resolved" && confirmResult.command === "confirm_close" && afterCloseTicket?.status === "resolved", "Solicitud de cierre registrada sin cerrar el ticket automáticamente")
        );
        lifecycle = { statusCommand: statusResult.command, reusedSessionId: linkResult.remoteSessionId, cancelCommand: cancelResult.command, sessionAfterCancel: sessionStatusAfterCancel, ticketAfterCancel: ticketStatusAfterCancel, closeCommand: closeResult.command, ticketAfterResolve: ticketStatusAfterResolve, confirmCommand: confirmResult.command, ticketAfterClose: afterCloseTicket?.status };
      }
      results.push(buildResult(scenario, checks, { ticketId: ticket?.id, remoteSessionId: session?.id ?? null, diagnosis: response.diagnosis, reply: deliveries[0]?.body ?? null, lifecycle }));
    } catch (error) {
      results.push(buildResult(scenario, [check("execution", false, error.message)], { error: error.message }));
    }
  }
  const pass = results.filter((item) => item.status === "pass").length;
  const fail = results.length - pass;
  return { generatedAt: new Date().toISOString(), mode: "offline_in_memory", summary: { status: fail ? "fail" : "pass", pass, fail, total: results.length, percent: Math.round(pass / Math.max(1, results.length) * 100) }, results, nextActions: fail ? results.filter((item) => item.status === "fail").map((item) => `Revisar escenario ${item.id}: ${item.failedChecks.join(", ")}`) : ["Escenarios Fisher listos; repetir auditoria E2E cuando haya acceso al servidor y equipos reales."] };
}

function check(id, passed, detail) { return { id, status: passed ? "pass" : "fail", detail }; }
function buildResult(scenario, checks, artifacts) {
  const failedChecks = checks.filter((item) => item.status === "fail").map((item) => item.id);
  return { id: scenario.id, input: scenario.text, expectedCategory: scenario.expectedCategory, status: failedChecks.length ? "fail" : "pass", checks, failedChecks, artifacts };
}




