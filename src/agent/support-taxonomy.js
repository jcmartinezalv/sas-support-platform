const CATEGORIES = [
  category("internet", "Red", ["internet", "sin conexion", "navegar", "conexion intermitente", "proveedor"], 0.72),
  category("wifi", "Red", ["wifi", "inalambrico", "senal debil", "no aparece la red", "se desconecta"], 0.73),
  category("dns_dhcp", "Red", ["dns", "dhcp", "direccion ip", "no resuelve", "ip duplicada"], 0.75),
  category("vpn", "Red", ["vpn", "forticlient", "globalprotect", "tunnel", "tunel"], 0.76),
  category("firewall_proxy", "Red", ["firewall", "proxy", "puerto bloqueado", "sitio bloqueado", "regla de red"], 0.72),
  category("email", "Colaboracion", ["correo", "outlook", "smtp", "imap", "buzon"], 0.72),
  category("microsoft_365", "Colaboracion", ["teams", "onedrive", "sharepoint", "office 365", "microsoft 365", "licencia office"], 0.74),
  category("printer", "Perifericos", ["impresora", "imprimir", "toner", "cola de impresion", "spooler"], 0.7),
  category("scanner", "Perifericos", ["scanner", "escaner", "digitalizar", "twain", "wia"], 0.69),
  category("performance", "Windows", ["lento", "lenta", "congelado", "congelada", "memoria alta", "cpu alta"], 0.72),
  category("storage", "Windows", ["disco lleno", "sin espacio", "disco duro", "ssd", "unidad no aparece"], 0.72),
  category("windows_update", "Windows", ["windows update", "actualizacion de windows", "actualizacion atorada", "error de actualizacion", "reinicio pendiente"], 0.74),
  category("windows_startup", "Windows", ["no arranca", "no inicia windows", "pantalla azul", "bsod", "reparacion de inicio"], 0.78, { shouldEscalate: true }),
  category("user_profile", "Windows", ["perfil temporal", "perfil de usuario", "escritorio vacio", "sesion temporal", "perfil dañado"], 0.73),
  category("software", "Aplicaciones", ["programa", "aplicacion", "error al abrir", "se cierra", "no inicia"], 0.7),
  category("browser", "Aplicaciones", ["chrome", "edge", "firefox", "navegador", "pagina no abre"], 0.71),
  category("certificates", "Seguridad", ["certificado", "ssl", "tls", "certificado vencido", "conexion no privada"], 0.77),
  category("account_access", "Identidad", ["cuenta bloqueada", "no puedo entrar", "olvide mi contraseña", "iniciar sesion", "mfa"], 0.77),
  category("permissions", "Identidad", ["acceso denegado", "sin permisos", "carpeta compartida", "permiso de administrador", "unidad compartida"], 0.73),
  category("security", "Seguridad", ["virus", "malware", "ransomware", "phishing", "hackeado", "correo sospechoso"], 0.91, { critical: true, shouldEscalate: true, nextAction: "human_review" }),
  category("backup", "Continuidad", ["respaldo", "backup", "restaurar archivos", "copia de seguridad", "recuperar informacion"], 0.74, { shouldEscalate: true }),
  category("active_directory", "Servidores", ["active directory", "dominio windows", "controlador de dominio", "politica de grupo", "gpo"], 0.8, { shouldEscalate: true }),
  category("server_services", "Servidores", ["servicio detenido", "servidor caido", "iis", "servicio windows", "servidor de archivos"], 0.78, { shouldEscalate: true }),
  category("hardware", "Hardware", ["no enciende", "bateria", "temperatura", "ram", "usb", "ruido de disco"], 0.73, { shouldEscalate: true }),
  category("remote_support", "Soporte", ["soporte remoto", "anydesk", "teamviewer", "conectate", "control remoto"], 0.82, { nextAction: "request_remote_support" })
];

export const SUPPORT_TAXONOMY = Object.freeze(CATEGORIES.map((item) => Object.freeze(item)));

export function findSupportCategory(message) {
  const normalized = normalize(message);
  const matches = SUPPORT_TAXONOMY.map((item) => {
    const matchedKeywords = item.keywords.filter((keyword) => normalized.includes(normalize(keyword)));
    return { ...item, matchedKeywords, matchCount: matchedKeywords.length };
  }).filter((item) => item.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount || Number(b.critical) - Number(a.critical) || b.confidence - a.confidence);
  return matches[0] ?? null;
}

export function getSupportCategory(id) {
  return SUPPORT_TAXONOMY.find((item) => item.id === String(id ?? "").trim()) ?? null;
}

function category(id, family, keywords, confidence, options = {}) {
  return {
    id,
    family,
    keywords,
    confidence,
    critical: Boolean(options.critical),
    shouldEscalate: Boolean(options.shouldEscalate),
    nextAction: options.nextAction ?? null,
    safeChecks: safeChecks(id, family)
  };
}

function safeChecks(id, family) {
  if (id === "security") return ["Aislar el equipo si existe actividad sospechosa activa.", "Conservar evidencia y escalar al responsable de seguridad."];
  if (id === "account_access") return ["Verificar identidad por el procedimiento autorizado.", "Usar recuperacion oficial sin solicitar contraseñas por WhatsApp."];
  if (id === "remote_support") return ["Explicar el alcance y generar un codigo unico.", "Esperar consentimiento verificable antes de cualquier acceso."];
  return [`Confirmar equipo, version, alcance y mensaje exacto del problema de ${family.toLowerCase()}.`, "Realizar primero comprobaciones de solo lectura y guardar evidencia.", "Solicitar autorizacion antes de cambios, reinicios o acciones administrativas.", "Escalar si existe riesgo de perdida de datos o interrupcion del servicio."];
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

