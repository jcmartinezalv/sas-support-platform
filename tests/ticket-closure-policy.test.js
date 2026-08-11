import assert from "node:assert/strict";
import test from "node:test";
import { createTicketStore } from "../src/tickets/ticket-store.js";

test("ticket closure requires the dedicated documented manual flow", () => {
  const store = createTicketStore();
  const ticket = store.create({ customerName: "Cliente", description: "Problema de prueba", status: "closed" });
  assert.equal(ticket.status, "open");
  assert.throws(() => store.update(ticket.id, { status: "closed" }), (error) => error.code === "MANUAL_DOCUMENTED_CLOSURE_REQUIRED");
  assert.throws(() => store.updateStatus(ticket.id, "closed"), (error) => error.code === "MANUAL_DOCUMENTED_CLOSURE_REQUIRED");
  assert.throws(() => store.closeManually(ticket.id, { documentation: { diagnosis: "corto" } }), (error) => error.code === "TICKET_DOCUMENTATION_INCOMPLETE" && error.details.missing.length === 3);
  const closed = store.closeManually(ticket.id, { closedBy: "TECH-1", documentation: {
    diagnosis: "Se confirmó una falla reproducible de conectividad.",
    actionsPerformed: "Se validó la red y se corrigió la configuración afectada.",
    outcome: "La conexión quedó estable y fue comprobada con el usuario.",
    followUp: "Revisar nuevamente en 24 horas.",
    sessionEvidence: [{ sessionId: "RMT-1", screenObserved: true, fisherObservations: 2 }]
  }});
  assert.equal(closed.status, "closed");
  assert.equal(closed.closedBy, "TECH-1");
  assert.equal(closed.documentation.completed, true);
  assert.equal(closed.documentation.sessionEvidence[0].fisherObservations, 2);
});
