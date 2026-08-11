import fs from "node:fs";
import path from "node:path";
import { buildProductionOperations } from "../src/production/operation-report-service.js";

const root = process.cwd();
const outputDir = path.join(root, "output");
const jsonPath = path.join(outputDir, "production-operations-report.json");
const mdPath = path.join(outputDir, "production-operations-report.md");

fs.mkdirSync(outputDir, { recursive: true });
const operations = buildProductionOperations({ projectRoot: root });
fs.writeFileSync(jsonPath, JSON.stringify(operations, null, 2));
fs.writeFileSync(mdPath, renderMarkdown(operations));

console.log(`Reporte JSON: ${jsonPath}`);
console.log(`Reporte Markdown: ${mdPath}`);
console.log(`Estado: ${operations.status} (${operations.summary.pass}/${operations.summary.total} listos)`);

function renderMarkdown(operations) {
  const summary = operations.summary ?? {};
  const lines = [
    "# Reporte de operacion productiva SAS",
    "",
    `Generado: ${operations.generatedAt}`,
    `Estado: ${labelStatus(operations.status)}`,
    `Reportes listos: ${summary.pass ?? 0}/${summary.total ?? 0}`,
    `Requeridos pendientes: ${summary.requiredPending ?? 0}`,
    "",
    "## Siguientes acciones",
    ""
  ];

  const actions = operations.nextActions ?? [];
  if (actions.length === 0) {
    lines.push("- Sin acciones inmediatas.");
  } else {
    for (const action of actions) {
      lines.push(`- ${action.label}: ${action.action}`);
    }
  }

  lines.push("", "## Plan de accion", "");
  const plan = operations.actionPlan ?? [];
  if (plan.length === 0) {
    lines.push("- Sin pendientes operativos.");
  } else {
    for (const item of plan) {
      lines.push(`- ${item.severity} | ${item.owner} | ${item.label}: ${item.action}`);
      if (item.command) lines.push(`  Comando sugerido: ${item.command}`);
    }
  }

  lines.push("", "## Reportes", "");
  for (const report of operations.reports ?? []) {
    lines.push(`### ${report.label}`);
    lines.push(`- Estado: ${labelStatus(report.status)}`);
    lines.push(`- Tipo: ${report.required ? "Requerido" : "Opcional"}`);
    lines.push(`- Fecha: ${report.generatedAt ?? "Sin fecha"}`);
    lines.push(`- Vigencia: ${report.freshness?.label ?? "Sin dato"}`);
    lines.push(`- Resumen: ${report.summary ?? "Sin resumen"}`);
    lines.push(`- Siguiente accion: ${report.nextAction ?? "Sin accion inmediata"}`);
    lines.push(`- Archivo: ${report.path}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function labelStatus(status) {
  const labels = { pass: "Correcto", warn: "Aviso", fail: "Error", missing: "Pendiente" };
  return labels[String(status ?? "warn").toLowerCase()] ?? String(status ?? "Sin dato");
}

