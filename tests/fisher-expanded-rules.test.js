import test from "node:test";
import assert from "node:assert/strict";
import { createAgentService } from "../src/agent/agent-service.js";
import { createTicketStore } from "../src/tickets/ticket-store.js";

function diagnose(message) {
  return createAgentService({ ticketStore: createTicketStore() }).diagnose({ message });
}

test("Fisher escalates security incidents without automatic repair", () => {
  const result = diagnose("Creo que abri un correo de phishing y tengo malware");
  assert.equal(result.category, "security");
  assert.equal(result.shouldEscalate, true);
  assert.equal(result.nextAction, "human_review");
  assert.equal(result.repairActions.length, 0);
  assert.match(result.recommendedSteps.join(" "), /No borrar archivos/);
});

test("Fisher protects credentials in account access incidents", () => {
  const result = diagnose("Mi cuenta esta bloqueada y no puedo entrar");
  assert.equal(result.category, "account_access");
  assert.match(result.recommendedSteps.join(" "), /Nunca solicitar ni recibir la contraseña/);
});

test("Fisher recognizes performance and software incidents", () => {
  assert.equal(diagnose("Mi computadora esta lenta y congelada").category, "performance");
  assert.equal(diagnose("El programa muestra error al abrir").category, "software");
});
test("Fisher uses central taxonomy fallback for infrastructure categories", () => {
  const vpn = diagnose("Forticlient muestra error y la VPN no conecta");
  const updates = diagnose("Windows Update tiene un reinicio pendiente");
  const directory = diagnose("Una politica GPO de Active Directory no se aplica");
  assert.equal(vpn.category, "vpn");
  assert.equal(vpn.source, "taxonomy");
  assert.equal(updates.category, "windows_update");
  assert.equal(directory.category, "active_directory");
  assert.equal(directory.shouldEscalate, true);
});

