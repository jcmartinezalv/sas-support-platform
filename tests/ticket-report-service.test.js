import test from "node:test";
import assert from "node:assert/strict";
import { buildTicketReport, exportTicketReportCsv, normalizeTicketReportFilters } from "../src/reports/ticket-report-service.js";

const now = new Date("2026-07-29T18:00:00.000Z");

function ticket(overrides = {}) {
  return {
    id: "TCK-1",
    customerName: "Ana",
    customerPhone: "5215551234567",
    createdAt: "2026-07-28T10:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
    closedAt: null,
    closedBy: null,
    status: "open",
    priority: "normal",
    source: "whatsapp",
    equipmentId: "PC-1",
    messages: [],
    documentation: {},
    ...overrides
  };
}

test("ticket report separates created, closed and current backlog cohorts", () => {
  const report = buildTicketReport({
    now,
    filters: { from: "2026-07-01", to: "2026-07-29" },
    tickets: [
      ticket(),
      ticket({
        id: "TCK-2",
        createdAt: "2026-07-28T08:00:00.000Z",
        closedAt: "2026-07-28T16:00:00.000Z",
        status: "closed",
        closedBy: "TECH-1",
        documentation: { completed: true, diagnosis: "Diagnóstico válido", actionsPerformed: "Acciones realizadas", outcome: "Problema resuelto" },
        messages: [{ direction: "outbound", createdAt: "2026-07-28T08:20:00.000Z" }]
      })
    ]
  });
  assert.equal(report.summary.created, 2);
  assert.equal(report.summary.closed, 1);
  assert.equal(report.summary.activeBacklog, 1);
  assert.equal(report.summary.medianResolutionHours, 8);
  assert.equal(report.summary.medianFirstResponseMinutes, 20);
  assert.equal(report.summary.documentationRate, 100);
  assert.deepEqual(report.coverage, {
    resolutionMeasured: 1,
    resolutionEligible: 1,
    firstResponseMeasured: 1,
    firstResponseEligible: 2,
    documentationComplete: 1,
    documentationEligible: 1
  });
});

test("ticket report never fabricates missing duration data", () => {
  const report = buildTicketReport({
    now,
    filters: { from: "2026-07-01", to: "2026-07-29" },
    tickets: [ticket({ status: "closed", closedAt: null })]
  });
  assert.equal(report.summary.medianResolutionHours, null);
  assert.equal(report.summary.resolutionTargetRate, null);
  assert.equal(report.coverage.resolutionMeasured, 0);
});

test("filters are bounded to one year and CSV masks WhatsApp", () => {
  const filters = normalizeTicketReportFilters({ from: "2020-01-01", to: "2026-07-29", status: "bad" }, now);
  assert.equal(filters.from, "2025-07-29");
  assert.equal(filters.status, "all");
  const report = buildTicketReport({ now, filters: { from: "2026-07-01", to: "2026-07-29" }, tickets: [ticket()] });
  const csv = exportTicketReportCsv(report);
  assert.match(csv, /Resolución \(h\)/);
  assert.match(csv, /\*+4567/);
  assert.doesNotMatch(csv, /5215551234567/);
});
