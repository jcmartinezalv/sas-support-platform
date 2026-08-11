import fs from "node:fs";
import path from "node:path";

const REPORTS = [
  {
    key: "smoke",
    label: "Prueba de produccion",
    relativePath: ["output", "production-smoke-report.json"],
    required: true,
    summary: (data) => `${data.summary?.pass ?? data.pass ?? 0} correctas, ${data.summary?.fail ?? data.fail ?? 0} errores`
  },
  {
    key: "monitor",
    label: "Monitor local",
    relativePath: ["output", "production-monitor-report.json"],
    required: true,
    summary: (data) => data.message ?? data.summary ?? `Estado ${data.status ?? "sin detalle"}`
  },
  {
    key: "task",
    label: "Tarea programada",
    relativePath: ["output", "production-task-verification.json"],
    required: false,
    summary: (data) => data.summary ?? `${data.checks?.length ?? 0} verificaciones registradas`
  },
  {
    key: "domain",
    label: "Dominio y puertos",
    relativePath: ["output", "domain-readiness-report.json"],
    required: false,
    summary: (data) => data.summary ?? `Dominio ${data.domain ?? data.host ?? "sin dominio"}`
  },
  {
    key: "config",
    label: "Configuracion produccion",
    relativePath: ["output", "production-config-report.json"],
    required: true,
    summary: (data) => data.summary ?? `${data.publicBaseUrl ?? data.PUBLIC_BASE_URL ?? "URL pendiente"}`
  },
  {
    key: "manifest",
    label: "Manifest instalacion",
    relativePath: ["install-manifest.json"],
    alternativePaths: [["output", "remote-install-evidence.json"]],
    required: true,
    summary: (data) => data.installedVersion
      ? `SERVER actualizado ${data.installedVersion}`
      : `${data.Product ?? data.product ?? "SAS"} instalado ${data.InstalledAtUtc ?? data.installedAtUtc ?? "sin fecha"}`
  },
  {
    key: "checklist",
    label: "Checklist post-instalacion",
    relativePath: ["post-install-checklist.json"],
    alternativePaths: [["output", "remote-install-evidence.json"]],
    required: true,
    summary: (data) => summarizeChecklist(data)
  }
];

export function buildProductionOperations({ projectRoot = process.cwd(), now = new Date() } = {}) {
  const reports = REPORTS.map((definition) => readReport({ definition, projectRoot, now }));
  const summary = summarizeReports(reports);
  return {
    generatedAt: new Date().toISOString(),
    status: overallStatus(reports, summary),
    summary,
    reports,
    nextActions: buildNextActions(reports),
    actionPlan: buildActionPlan(reports)
  };
}

function readReport({ definition, projectRoot, now }) {
  const candidates = [definition.relativePath, ...(definition.alternativePaths ?? [])]
    .map((relativePath) => {
      const reportPath = path.join(projectRoot, ...relativePath);
      return { reportPath, data: readJsonFile(reportPath) };
    });
  const selected = selectBestCandidate(candidates);
  const reportPath = selected.reportPath;
  const data = selected.data;
  if (!data.exists) {
    return {
      key: definition.key,
      label: definition.label,
      required: definition.required,
      status: definition.required ? "fail" : "missing",
      generatedAt: null,
      path: reportPath,
      summary: definition.required ? "Reporte requerido no encontrado" : "Reporte opcional pendiente",
      nextAction: definition.required ? "Ejecutar el script correspondiente y guardar el reporte." : "Generar cuando se haga la siguiente prueba real."
    };
  }

  if (data.error) {
    return {
      key: definition.key,
      label: definition.label,
      required: definition.required,
      status: definition.required ? "fail" : "warn",
      generatedAt: null,
      path: reportPath,
      summary: `No se pudo leer: ${data.error}`,
      nextAction: "Revisar formato JSON del reporte."
    };
  }

  const status = normalizeStatus(data.value.status ?? data.value.Status ?? inferStatus(data.value));
  const generatedAt = findGeneratedAt(data.value);
  const freshness = calculateFreshness({ generatedAt, required: definition.required, now });
  const effectiveStatus = freshness.status === "stale" && status === "pass" ? "warn" : status;
  return {
    key: definition.key,
    label: definition.label,
    required: definition.required,
    status: effectiveStatus,
    generatedAt,
    freshness,
    path: reportPath,
    summary: safeSummary(definition, data.value),
    nextAction: effectiveStatus === "pass" ? "Sin accion inmediata." : freshness.status === "stale" ? "Actualizar este reporte antes de tomarlo como evidencia vigente." : findNextAction(data.value)
  };
}

function selectBestCandidate(candidates) {
  const readable = candidates.filter((candidate) => candidate.data.exists && !candidate.data.error);
  if (readable.length === 0) return candidates.find((candidate) => candidate.data.exists) ?? candidates[0];
  return readable.sort((left, right) => candidateTime(right) - candidateTime(left))[0];
}

function candidateTime(candidate) {
  const generatedAt = findGeneratedAt(candidate.data.value);
  const parsed = generatedAt ? new Date(generatedAt).getTime() : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function overallStatus(reports, summary) {
  if (reports.some((report) => report.required && report.status === "fail")) return "fail";
  if (summary.warn > 0 || summary.fail > 0 || summary.missing > 0 || summary.requiredPending > 0) return "warn";
  return "pass";
}
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { exists: false };
    const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return { exists: true, value: JSON.parse(content) };
  } catch (error) {
    return { exists: true, error: error.message };
  }
}

function summarizeReports(reports) {
  return reports.reduce((acc, report) => {
    if (report.status === "pass") acc.pass += 1;
    else if (report.status === "fail") acc.fail += 1;
    else if (report.status === "missing") acc.missing += 1;
    else acc.warn += 1;
    acc.total += 1;
    if (report.required && report.status !== "pass") acc.requiredPending += 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0, missing: 0, total: 0, requiredPending: 0 });
}

function buildActionPlan(reports) {
  return reports
    .filter((report) => report.status !== "pass")
    .map((report) => ({
      id: `ops-${report.key}`,
      label: report.label,
      status: report.status,
      severity: actionSeverity(report),
      owner: actionOwner(report),
      command: actionCommand(report),
      action: report.nextAction,
      required: report.required
    }))
    .sort((a, b) => actionRank(a) - actionRank(b));
}

function actionSeverity(report) {
  if (report.required && report.status === "fail") return "Alta";
  if (report.required || report.status === "fail") return "Media";
  return "Baja";
}

function actionOwner(report) {
  const owners = {
    smoke: "Tecnico",
    monitor: "Tecnico",
    task: "Administrador Windows",
    domain: "Redes",
    config: "Administrador SAS",
    manifest: "Administrador SAS",
    checklist: "Administrador SAS"
  };
  return owners[report.key] ?? "Tecnico";
}

function actionCommand(report) {
  const commands = {
    smoke: ".\\scripts\\test-production-smoke.ps1 -BaseUrl https://setinfo.sytes.net",
    monitor: ".\\scripts\\monitor-production.ps1 -RemoteOnly -BaseUrl https://setinfo.sytes.net -HostName setinfo.sytes.net",
    task: ".\\scripts\\verify-production-task-elevated.ps1",
    domain: ".\\scripts\\test-domain-readiness.ps1 -RemoteOnly -Domain setinfo.sytes.net",
    config: report.freshness?.status === "stale"
      ? ".\\scripts\\prepare-production-config.ps1 -RefreshReportOnly"
      : ".\\scripts\\prepare-production-config.ps1 -PublicBaseUrl https://setinfo.sytes.net",
    manifest: ".\\scripts\\export-remote-install-evidence.ps1",
    checklist: ".\\scripts\\export-remote-install-evidence.ps1"
  };
  return commands[report.key] ?? null;
}

function actionRank(action) {
  const severity = { Alta: 0, Media: 1, Baja: 2 }[action.severity] ?? 3;
  return severity * 10 + (action.required ? 0 : 1);
}
function buildNextActions(reports) {
  return reports
    .filter((report) => report.status !== "pass")
    .sort((a, b) => Number(b.required) - Number(a.required))
    .slice(0, 4)
    .map((report) => ({
      label: report.label,
      status: report.status,
      action: report.nextAction
    }));
}

function inferStatus(data) {
  const summary = data.summary ?? data.Summary ?? {};
  if ((summary.fail ?? summary.Fail ?? data.fail ?? data.Fail ?? 0) > 0) return "fail";
  if ((summary.warn ?? summary.Warn ?? data.warn ?? data.Warn ?? 0) > 0) return "warn";
  const checks = Array.isArray(data.checks) ? data.checks : Array.isArray(data.Checks) ? data.Checks : [];
  if (checks.some((check) => normalizeStatus(check.status ?? check.Status) === "fail")) return "fail";
  if (checks.some((check) => normalizeStatus(check.status ?? check.Status) === "warn")) return "warn";
  return "pass";
}

function normalizeStatus(status) {
  const value = String(status ?? "warn").toLowerCase();
  if (["ok", "success", "healthy", "completed"].includes(value)) return "pass";
  if (["error", "failed", "unhealthy"].includes(value)) return "fail";
  if (["missing", "not_found"].includes(value)) return "missing";
  return ["pass", "warn", "fail"].includes(value) ? value : "warn";
}

function findGeneratedAt(data) {
  return data.generatedAt ?? data.GeneratedAtUtc ?? data.generatedAtUtc ?? data.InstalledAtUtc ?? data.installedAtUtc ?? data.timestamp ?? data.Timestamp ?? data.createdAt ?? null;
}

function safeSummary(definition, data) {
  try {
    return String(definition.summary(data) ?? "Reporte disponible");
  } catch {
    return "Reporte disponible";
  }
}

function calculateFreshness({ generatedAt, required, now }) {
  if (!generatedAt) return { status: "unknown", ageHours: null, label: "Sin fecha" };
  const parsed = new Date(generatedAt);
  if (Number.isNaN(parsed.getTime())) return { status: "unknown", ageHours: null, label: "Fecha invalida" };
  const ageHours = Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 36_000) / 100);
  const staleAfterHours = required ? 48 : 168;
  const status = ageHours > staleAfterHours ? "stale" : "fresh";
  return { status, ageHours, staleAfterHours, label: status === "stale" ? "Reporte viejo" : "Reciente" };
}

function findNextAction(data) {
  const next = data.nextAction ?? data.nextStep ?? data.NextAction ?? data.NextStep;
  if (next) return String(next);
  const steps = data.nextActions ?? data.nextSteps ?? data.NextActions ?? data.NextSteps;
  if (Array.isArray(steps) && steps.length > 0) {
    const first = steps[0];
    return typeof first === "string" ? first : String(first.action ?? first.message ?? first.title ?? "Revisar pendiente.");
  }
  return "Revisar el reporte y corregir avisos antes de produccion.";
}

function summarizeChecklist(data) {
  const checks = Array.isArray(data.Checks) ? data.Checks : Array.isArray(data.checks) ? data.checks : [];
  const summary = checks.reduce((acc, check) => {
    const status = normalizeStatus(check.Status ?? check.status);
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0 });
  return `${summary.pass} correctas, ${summary.warn} avisos, ${summary.fail} errores`;
}







