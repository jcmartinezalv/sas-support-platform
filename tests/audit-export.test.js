import test from "node:test";
import assert from "node:assert/strict";
import { exportAuditEvents } from "../src/audit/audit-export.js";

const events = [
  {
    id: "AUD-1",
    createdAt: "2026-07-03T10:00:00.000Z",
    actorId: "admin",
    actorRole: "admin",
    action: "remote.start",
    entityType: "remote_session",
    entityId: "RS-1",
    metadata: { joinCode: "ABC123", note: "valor, con coma" }
  }
];

test("exports audit events as json attachment payload", () => {
  const exported = exportAuditEvents(events, { format: "json" });
  const parsed = JSON.parse(exported.body);

  assert.equal(exported.format, "json");
  assert.equal(exported.contentType, "application/json; charset=utf-8");
  assert.match(exported.filename, /^sas-audit-.*\.json$/);
  assert.equal(parsed.events[0].id, "AUD-1");
});

test("exports audit events as escaped csv", () => {
  const exported = exportAuditEvents(events, { format: "csv" });

  assert.equal(exported.format, "csv");
  assert.equal(exported.contentType, "text/csv; charset=utf-8");
  assert.match(exported.filename, /^sas-audit-.*\.csv$/);
  assert.match(exported.body, /^id,createdAt,actorId,actorRole,action,entityType,entityId,metadata/);
  assert.match(exported.body, /"\{""joinCode"":""ABC123"",""note"":""valor, con coma""\}"/);
});
