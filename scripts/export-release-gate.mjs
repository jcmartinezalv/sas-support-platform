import fs from "node:fs";
import path from "node:path";
import { buildProductionReadiness } from "../src/production/readiness-service.js";
import { buildProductionOperations } from "../src/production/operation-report-service.js";
import { buildReleaseGate } from "../src/production/release-gate-service.js";

const root = process.cwd();
const outputDir = path.join(root, "output");
const config = readProductionConfig(root);
const storageStatus = readStorageStatus(root);
const readiness = buildProductionReadiness({ config, storageStatus, agents: [], preflightReport: readOptionalJson(path.join(root, "output", "client-preflight-report.json")), knowledgeArticles: [], repairOutcomeSummary: [] });
const operations = buildProductionOperations({ projectRoot: root });
const releaseGate = buildReleaseGate({ readiness, operations });

fs.mkdirSync(outputDir, { recursive: true });
const reportJson = JSON.stringify(releaseGate, null, 2);
const reportMarkdown = renderMarkdown(releaseGate);
const history = updateHistory({ outputDir, releaseGate });
const historyMarkdown = renderHistoryMarkdown(history);
fs.writeFileSync(path.join(outputDir, "release-gate-report.json"), reportJson);
fs.writeFileSync(path.join(outputDir, "release-gate-report.md"), reportMarkdown);
fs.writeFileSync(path.join(outputDir, "semaforo-produccion-report.json"), reportJson);
fs.writeFileSync(path.join(outputDir, "semaforo-produccion-report.md"), reportMarkdown);
fs.writeFileSync(path.join(outputDir, "semaforo-produccion-history.json"), JSON.stringify(history, null, 2));
fs.writeFileSync(path.join(outputDir, "semaforo-produccion-history.md"), historyMarkdown);

console.log(`Decision: ${releaseGate.label}`);
console.log(`Reporte JSON: ${path.join(outputDir, "semaforo-produccion-report.json")}`);
console.log(`Reporte Markdown: ${path.join(outputDir, "semaforo-produccion-report.md")}`);
console.log(`Historial: ${path.join(outputDir, "semaforo-produccion-history.md")}`);

function readProductionConfig(root) {
  const env = readEnvFile(path.join(root, ".env.production"));
  return {
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "http://localhost:3000",
    enableHttps: env.ENABLE_HTTPS === "true",
    httpsPort: Number(env.HTTPS_PORT ?? 443),
    tlsKeyPath: path.resolve(root, env.TLS_KEY_PATH ?? "certs/server.key"),
    tlsCertPath: path.resolve(root, env.TLS_CERT_PATH ?? "certs/server.crt"),
    consoleSharedToken: env.CONSOLE_SHARED_TOKEN ?? "",
    agentSharedSecret: env.AGENT_SHARED_SECRET ?? "change-agent-secret",
    whatsappVerifyToken: env.WHATSAPP_VERIFY_TOKEN ?? "change-me",
    whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN ?? "",
    whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    whatsappAppSecret: env.WHATSAPP_APP_SECRET ?? "",
    remoteSessionTtlMinutes: Number(env.REMOTE_SESSION_TTL_MINUTES ?? 30),
    remoteConsentMaxAttempts: Number(env.REMOTE_CONSENT_MAX_ATTEMPTS ?? 5),
    remoteControlMaxAttempts: Number(env.REMOTE_CONTROL_MAX_ATTEMPTS ?? 5),
    googleAiEnabled: env.GOOGLE_AI_ENABLED === "true",
    googleAiMock: env.GOOGLE_AI_MOCK === "true",
    googleAiRequireReview: env.GOOGLE_AI_REQUIRE_REVIEW !== "false",
    geminiApiKey: env.GEMINI_API_KEY ?? ""
  };
}

function readEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^"|"$/g, "");
  }
  return values;
}

function readStorageStatus(root) {
  const filePath = path.join(root, "data", "sas-db.json");
  const backupDir = path.join(root, "data", "backups");
  return {
    exists: fs.existsSync(filePath),
    filePath,
    backupDir,
    backupCount: fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((name) => name.endsWith(".json")).length : 0,
    size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
  };
}

function readOptionalJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function renderMarkdown(gate) {
  const lines = [
    "# Semaforo de produccion SAS",
    "",
    `Generado: ${gate.generatedAt}`,
    `Decision: ${gate.label}`,
    `Produccion permitida: ${(gate.productionAllowed ?? gate.mvpAllowed) ? "Si" : "No"}`,
    `Bloqueos: ${gate.summary.blockers}`,
    `Avisos: ${gate.summary.warnings}`,
    "",
    "## Acciones principales",
    ""
  ];
  if (!gate.nextActions?.length) {
    lines.push("- Sin acciones inmediatas.");
  } else {
    for (const item of gate.nextActions) {
      lines.push(`- ${item.severity} | ${item.source} | ${item.owner} | ${item.label}: ${item.action}`);
      if (item.command) lines.push(`  Comando sugerido: ${item.command}`);
    }
  }
  return `${lines.join("\n")}\n`;
}



function updateHistory({ outputDir, releaseGate }) {
  const historyPath = path.join(outputDir, "semaforo-produccion-history.json");
  const existing = readHistory(historyPath);
  const entry = {
    generatedAt: releaseGate.generatedAt,
    decision: releaseGate.decision,
    label: releaseGate.label,
    productionAllowed: releaseGate.productionAllowed ?? releaseGate.mvpAllowed,
    blockers: releaseGate.summary?.blockers ?? 0,
    warnings: releaseGate.summary?.warnings ?? 0,
    topActions: (releaseGate.nextActions ?? []).slice(0, 3).map((item) => ({
      label: item.label,
      source: item.source,
      severity: item.severity,
      owner: item.owner,
      action: item.action
    }))
  };
  const history = [entry, ...existing.filter((item) => item.generatedAt !== entry.generatedAt)].slice(0, 30);
  return history;
}

function readHistory(historyPath) {
  try {
    if (!fs.existsSync(historyPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8").replace(/^\uFEFF/, ""));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderHistoryMarkdown(history) {
  const lines = ["# Historial del semaforo de produccion SAS", ""];
  if (history.length === 0) {
    lines.push("Sin entradas registradas.");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of history) {
    lines.push(`## ${entry.generatedAt} - ${entry.label}`);
    lines.push(`- Produccion permitida: ${entry.productionAllowed ? "Si" : "No"}`);
    lines.push(`- Bloqueos: ${entry.blockers}`);
    lines.push(`- Avisos: ${entry.warnings}`);
    if (entry.topActions?.length) {
      lines.push("- Acciones:");
      for (const action of entry.topActions) {
        lines.push(`  - ${action.severity} | ${action.owner} | ${action.label}: ${action.action}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
