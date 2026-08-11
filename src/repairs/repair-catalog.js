const REPAIR_ACTIONS = [
  {
    id: "flush_dns",
    title: "Limpiar cache DNS",
    category: "network",
    risk: "low",
    requiresCustomerConsent: true,
    requiresControlConsent: false,
    command: "ipconfig",
    args: ["/flushdns"],
    keywords: ["dns", "internet", "navegacion", "pagina", "conexion"],
    summary: "Limpia la cache DNS local para resolver errores de navegacion o nombres de dominio.",
    expectedImpact: "No reinicia el equipo ni cambia configuracion permanente."
  },
  {
    id: "renew_ip",
    title: "Renovar direccion IP",
    category: "network",
    risk: "medium",
    requiresCustomerConsent: true,
    requiresControlConsent: false,
    command: "ipconfig",
    args: ["/renew"],
    keywords: ["ip", "dhcp", "internet", "red", "conexion"],
    summary: "Solicita una nueva concesion DHCP para recuperar conectividad de red.",
    expectedImpact: "Puede cortar la red por unos segundos mientras se renueva la direccion."
  },
  {
    id: "restart_print_spooler",
    title: "Reiniciar cola de impresion",
    category: "printer",
    risk: "medium",
    requiresCustomerConsent: true,
    requiresControlConsent: false,
    powershell: "Restart-Service -Name Spooler -Force",
    keywords: ["impresora", "imprimir", "spooler", "cola", "papel"],
    summary: "Reinicia el servicio de cola de impresion cuando los trabajos quedan atorados.",
    expectedImpact: "Puede cancelar trabajos de impresion pendientes."
  },
  {
    id: "clear_temp_files",
    title: "Limpiar temporales del usuario",
    category: "performance",
    risk: "medium",
    requiresCustomerConsent: true,
    requiresControlConsent: false,
    powershell: "Get-ChildItem -Path $env:TEMP -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue",
    keywords: ["lento", "espacio", "temporal", "cache", "disco"],
    summary: "Elimina archivos temporales del perfil actual para liberar espacio basico.",
    expectedImpact: "No toca documentos del usuario, pero puede cerrar archivos temporales en uso."
  }
];

const RISK_ORDER = { low: 1, medium: 2, high: 3 };

export function listRepairActions() {
  return REPAIR_ACTIONS.map(publicRepairAction);
}

export function getRepairAction(actionId) {
  const cleanId = cleanText(actionId).toLowerCase();
  const action = REPAIR_ACTIONS.find((item) => item.id === cleanId);
  return action ? publicRepairAction(action) : null;
}

export function suggestRepairActions({ category, message, limit = 3 } = {}) {
  const normalizedCategory = cleanText(category).toLowerCase();
  const normalizedMessage = normalize(message);
  return REPAIR_ACTIONS
    .map((action) => ({ action, score: scoreAction(action, normalizedCategory, normalizedMessage) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || RISK_ORDER[a.action.risk] - RISK_ORDER[b.action.risk])
    .slice(0, limit)
    .map((item) => ({ ...publicRepairAction(item.action), matchScore: item.score }));
}

export function assertRepairActionAllowed(actionId, { maxRisk = "medium" } = {}) {
  const action = getRepairAction(actionId);
  if (!action) {
    const error = new Error(`Repair action not found: ${actionId}`);
    error.statusCode = 404;
    throw error;
  }

  if (riskValue(action.risk) > riskValue(maxRisk)) {
    const error = new Error(`Repair action risk ${action.risk} exceeds allowed risk ${maxRisk}`);
    error.statusCode = 403;
    throw error;
  }

  return action;
}

function scoreAction(action, category, message) {
  let score = 0;
  if (category && action.category === category) score += 5;
  for (const keyword of action.keywords) {
    if (message.includes(normalize(keyword))) score += 2;
  }
  return score;
}

function publicRepairAction(action) {
  return {
    id: action.id,
    title: action.title,
    category: action.category,
    risk: action.risk,
    requiresCustomerConsent: action.requiresCustomerConsent,
    requiresControlConsent: action.requiresControlConsent,
    summary: action.summary,
    expectedImpact: action.expectedImpact,
    command: action.command ?? null,
    args: action.args ?? null,
    powershell: action.powershell ?? null
  };
}

function riskValue(value) {
  return RISK_ORDER[String(value ?? "").toLowerCase()] ?? 99;
}

function normalize(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function cleanText(value) {
  return String(value ?? "").trim();
}
