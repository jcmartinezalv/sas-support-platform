import fs from "node:fs";
import path from "node:path";
const DECISION_LABELS = {
  ready: "Verde - listo para produccion",
  ready_with_warnings: "Amarillo - listo con avisos",
  blocked: "Rojo - bloqueado"
};

export function buildReleaseGate({ readiness = null, operations = null, now = new Date() } = {}) {
  const blockers = [];
  const warnings = [];

  collectReadinessSignals({ readiness, blockers, warnings });
  collectOperationSignals({ operations, blockers, warnings });

  const decision = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "ready_with_warnings" : "ready";
  return {
    generatedAt: now.toISOString(),
    decision,
    label: DECISION_LABELS[decision],
    productionAllowed: decision !== "blocked",
    mvpAllowed: decision !== "blocked",
    summary: {
      blockers: blockers.length,
      warnings: warnings.length,
      readiness: readiness?.mvpStatus ?? readiness?.status ?? "missing",
      operations: operations?.status ?? "missing"
    },
    blockers,
    warnings,
    nextActions: buildGateActions({ blockers, warnings })
  };
}

function collectReadinessSignals({ readiness, blockers, warnings }) {
  if (!readiness) {
    blockers.push(gateItem({ source: "Preparacion", label: "Readiness no disponible", message: "No se pudo evaluar preparacion de produccion.", owner: "Administrador SAS", command: "Revisar /api/admin/readiness" }));
    return;
  }

  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  for (const check of checks) {
    if (check.tier === "required" && check.status === "fail") {
      blockers.push(gateItem({ source: "Preparacion", label: check.label, message: check.message, owner: ownerForReadiness(check.key), command: commandForReadiness(check.key) }));
    } else if (check.tier === "required" && check.status === "warn") {
      warnings.push(gateItem({ source: "Preparacion", label: check.label, message: check.message, owner: ownerForReadiness(check.key), command: commandForReadiness(check.key), severity: "Media" }));
    }
  }
}

function collectOperationSignals({ operations, blockers, warnings }) {
  if (!operations) {
    warnings.push(gateItem({ source: "Operacion", label: "Operacion no disponible", message: "No se encontro reporte operativo consolidado.", owner: "Tecnico", command: "npm run ops:report", severity: "Media" }));
    return;
  }

  const reports = Array.isArray(operations.reports) ? operations.reports : [];
  for (const report of reports) {
    if (report.required && report.status === "fail") {
      blockers.push(gateItem({ source: "Operacion", label: report.label, message: report.nextAction ?? report.summary, owner: ownerForOperation(report.key), command: commandForOperation(report) }));
    } else if (report.status !== "pass") {
      warnings.push(gateItem({ source: "Operacion", label: report.label, message: report.nextAction ?? report.summary, owner: ownerForOperation(report.key), command: commandForOperation(report), severity: report.required ? "Media" : "Baja" }));
    }
  }
}

function buildGateActions({ blockers, warnings }) {
  return [...blockers, ...warnings]
    .sort((a, b) => gateRank(a) - gateRank(b))
    .slice(0, 6)
    .map((item) => ({
      label: item.label,
      source: item.source,
      severity: item.severity,
      owner: item.owner,
      command: item.command,
      action: item.message
    }));
}

function gateItem({ source, label, message, owner, command = null, severity = "Alta" }) {
  return { source, label, message: message ?? "Revisar pendiente.", owner, command, severity };
}

function gateRank(item) {
  const severityRank = { Alta: 0, Media: 1, Baja: 2 }[item.severity] ?? 3;
  const sourceRank = item.source === "Preparacion" ? 0 : 1;
  return severityRank * 10 + sourceRank;
}

function ownerForReadiness(key) {
  const owners = {
    public_base_url: "Administrador SAS",
    https_tls: "Administrador SAS",
    console_token: "Administrador SAS",
    agent_secret: "Administrador SAS",
    storage: "Tecnico",
    remote_security: "Administrador SAS"
  };
  return owners[key] ?? "Tecnico";
}

function commandForReadiness(key) {
  const commands = {
    public_base_url: ".\\scripts\\prepare-production-config.ps1 -PublicBaseUrl https://setinfo.sytes.net",
    https_tls: ".\\scripts\\request-letsencrypt-elevated.ps1",
    console_token: ".\\scripts\\prepare-production-config.ps1 -PublicBaseUrl https://setinfo.sytes.net",
    agent_secret: ".\\scripts\\prepare-production-config.ps1 -PublicBaseUrl https://setinfo.sytes.net",
    storage: "Crear respaldo desde Registro",
    remote_security: "Revisar .env.production"
  };
  return commands[key] ?? null;
}

function ownerForOperation(key) {
  const owners = {
    smoke: "Tecnico",
    monitor: "Tecnico",
    task: "Administrador Windows",
    domain: "Redes",
    config: "Administrador SAS",
    manifest: "Administrador SAS",
    checklist: "Administrador SAS"
  };
  return owners[key] ?? "Tecnico";
}

function commandForOperation(report) {
  const key = report?.key;
  const commands = {
    smoke: ".\\scripts\\test-production-smoke.ps1 -BaseUrl https://setinfo.sytes.net",
    monitor: ".\\scripts\\monitor-production.ps1 -RemoteOnly -BaseUrl https://setinfo.sytes.net -HostName setinfo.sytes.net",
    task: ".\\scripts\\verify-production-task-elevated.ps1",
    domain: ".\\scripts\\test-domain-readiness.ps1 -RemoteOnly -Domain setinfo.sytes.net",
    config: report?.freshness?.status === "stale"
      ? ".\\scripts\\prepare-production-config.ps1 -RefreshReportOnly"
      : ".\\scripts\\prepare-production-config.ps1 -PublicBaseUrl https://setinfo.sytes.net",
    manifest: ".\\scripts\\export-remote-install-evidence.ps1",
    checklist: ".\\scripts\\export-remote-install-evidence.ps1"
  };
  return commands[key] ?? null;
}


export function readProductionTrafficLightHistory({ projectRoot = process.cwd(), limit = 10 } = {}) {
  const historyPath = path.join(projectRoot, "output", "semaforo-produccion-history.json");
  try {
    if (!fs.existsSync(historyPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8").replace(/^\uFEFF/, ""));
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}

