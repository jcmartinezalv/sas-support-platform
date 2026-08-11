import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("console exposes a Reportes y Dashboard workspace with operational filters", () => {
  assert.match(html, /data-view="reports"/);
  assert.match(html, /id="view-reports"/);
  assert.match(html, /Reportes y Dashboard/);
  for (const id of ["reportFrom", "reportTo", "reportStatus", "reportPriority", "reportSource", "reportEquipment", "reportTechnician", "exportTicketReport"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("dashboard renders KPIs, trends, backlog, remote activity and drill-down", () => {
  for (const marker of ["function renderReports", "function renderTrendChart", "function renderReportBacklog", "function renderRemoteReportMetrics", "function renderReportDetails"]) {
    assert.match(app, new RegExp(marker));
  }
  assert.match(styles, /\.report-kpis/);
  assert.match(styles, /\.report-dashboard-grid/);
  assert.match(styles, /\.report-table/);
});

test("server protects report and CSV endpoints with ticket read permission", () => {
  assert.match(server, /\/api\/reports\/tickets/);
  assert.match(server, /authService\.require\(actor, "ticket:read"\)/);
  assert.match(server, /text\/csv; charset=utf-8/);
});
