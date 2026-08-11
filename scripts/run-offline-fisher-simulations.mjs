import fs from "node:fs";
import path from "node:path";
import { runOfflineSimulations } from "../src/agent/offline-simulation-service.js";

const report = await runOfflineSimulations();
const outDir = path.resolve("output", "reports");
fs.mkdirSync(outDir, { recursive: true });
const jsonPath = path.join(outDir, "offline-fisher-simulations.json");
const mdPath = path.join(outDir, "offline-fisher-simulations.md");
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
const rows = report.results.map((item) => `| ${item.status.toUpperCase()} | ${item.id} | ${item.artifacts.diagnosis?.category ?? "-"} | ${item.failedChecks.join(", ") || "OK"} |`).join("\n");
fs.writeFileSync(mdPath, `# SAS - Simulaciones offline de Fisher\n\nFecha: ${report.generatedAt}\nModo: memoria local, sin WhatsApp ni equipos reales\nEstado: ${report.summary.status}\nAvance: ${report.summary.percent}%\n\n| Estado | Escenario | Categoria Fisher | Resultado |\n|---|---|---|---|\n${rows}\n\n## Siguientes acciones\n\n${report.nextActions.map((item) => `- ${item}`).join("\n")}\n`, "utf8");
console.log(JSON.stringify({ ...report, files: { jsonPath, mdPath } }, null, 2));
process.exitCode = report.summary.status === "pass" ? 0 : 1;
