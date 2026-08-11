import test from "node:test";
import assert from "node:assert/strict";
import { filterAuditEvents, normalizeAuditFilter } from "../src/audit/audit-filter.js";

const events = [
  { action: "auth.denied" },
  { action: "remote.start" },
  { action: "remote.command.result" },
  { action: "ticket.create" },
  { action: "whatsapp.message" },
  { action: "server.boot" }
];

test("filters security audit events", () => {
  assert.deepEqual(filterAuditEvents(events, "security").map((event) => event.action), ["auth.denied"]);
});

test("filters remote audit events", () => {
  assert.deepEqual(filterAuditEvents(events, "remote").map((event) => event.action), ["remote.start", "remote.command.result"]);
});

test("filters ticket and whatsapp audit events", () => {
  assert.deepEqual(filterAuditEvents(events, "tickets").map((event) => event.action), ["ticket.create", "whatsapp.message"]);
});

test("normalizes unknown audit filter to all", () => {
  assert.equal(normalizeAuditFilter("remote"), "remote");
  assert.equal(normalizeAuditFilter("unknown"), "all");
});
