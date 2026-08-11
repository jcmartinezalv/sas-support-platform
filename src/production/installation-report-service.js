import fs from "node:fs";
import path from "node:path";

export function buildInstallationReports({ projectRoot = process.cwd(), serverInstallPath = projectRoot, clientInstallPath = process.env.SAS_CLIENT_INSTALL_PATH ?? "C:\\SAS\\Client" } = {}) {
  const installations = [
    readInstallation({ role: "server", label: "Servidor SAS", installPath: serverInstallPath }),
    readInstallation({ role: "client", label: "Cliente Windows", installPath: clientInstallPath })
  ];
  const available = installations.filter((item) => item.exists);
  const summary = available.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, { pass: 0, warn: 0, fail: 0, missing: installations.length - available.length });

  return {
    generatedAt: new Date().toISOString(),
    summary,
    installations
  };
}

function readInstallation({ role, label, installPath }) {
  const manifestPath = path.join(installPath, "install-manifest.json");
  const checklistPath = path.join(installPath, "post-install-checklist.json");
  const manifest = readJsonFile(manifestPath);
  const checklist = readJsonFile(checklistPath);
  const checks = Array.isArray(checklist?.Checks) ? checklist.Checks : Array.isArray(checklist?.checks) ? checklist.checks : [];
  const checkSummary = summarizeChecks(checks);
  const exists = Boolean(manifest || checklist);
  const status = exists ? statusFromSummary(checkSummary) : "missing";

  return {
    role,
    label,
    exists,
    status,
    installPath,
    manifestPath,
    checklistPath,
    product: manifest?.Product ?? manifest?.product ?? label,
    installedAt: manifest?.InstalledAtUtc ?? manifest?.installedAtUtc ?? null,
    checklistGeneratedAt: checklist?.GeneratedAtUtc ?? checklist?.generatedAtUtc ?? null,
    unsignedRestrictedProduction: Boolean(manifest?.UnsignedRestrictedProduction ?? checklist?.UnsignedRestrictedProduction ?? false),
    consoleTokenConfigured: Boolean(manifest?.ConsoleTokenConfigured ?? false),
    generatedSecrets: manifest?.GeneratedSecrets ?? checklist?.GeneratedSecrets ?? [],
    checkSummary,
    checks: checks.map(normalizeCheck).slice(0, 12),
    nextSteps: checklist?.NextSteps ?? checklist?.nextSteps ?? []
  };
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { readError: error.message };
  }
}

function normalizeCheck(check) {
  return {
    name: check.Name ?? check.name ?? "check",
    status: String(check.Status ?? check.status ?? "warn").toLowerCase(),
    message: check.Message ?? check.message ?? "Sin detalle"
  };
}

function summarizeChecks(checks) {
  const summary = { pass: 0, warn: 0, fail: 0, total: checks.length };
  for (const check of checks.map(normalizeCheck)) {
    if (check.status === "pass") summary.pass += 1;
    else if (check.status === "fail") summary.fail += 1;
    else summary.warn += 1;
  }
  return summary;
}

function statusFromSummary(summary) {
  if (summary.fail > 0) return "fail";
  if (summary.warn > 0 || summary.total === 0) return "warn";
  return "pass";
}
