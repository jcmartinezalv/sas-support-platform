const installationCode = location.pathname.split("/").pop().toUpperCase();
const statusEl = document.querySelector("#installLinkStatus");
const codeEl = document.querySelector("#installationCode");
const openEl = document.querySelector("#openInstalledClient");
const downloadEl = document.querySelector("#downloadClientInstaller");
const resultEl = document.querySelector("#installPageResult");
let statusTimer = null;

document.querySelector("#copyInstallationCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(installationCode);
    resultEl.textContent = "Código copiado.";
  } catch {
    resultEl.textContent = "Selecciona el código y cópialo manualmente.";
  }
});

openEl.addEventListener("click", (event) => {
  if (openEl.getAttribute("aria-disabled") === "true") return event.preventDefault();
  resultEl.textContent = "Buscando SAS Cliente en este equipo… Acepta Abrir SAS Cliente si el navegador lo solicita.";
  window.location.href = `sas-client://enroll/${encodeURIComponent(installationCode)}`;
  startStatusPolling();
});

load();

async function load() {
  codeEl.textContent = installationCode;
  try {
    const body = await fetchEnrollment();
    renderEnrollment(body);
  } catch (error) {
    showUnavailable(error.message);
  }
}

async function fetchEnrollment() {
  const response = await fetch(`/api/client-installations/code/${encodeURIComponent(installationCode)}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Esta liga ya no está disponible.");
  return body;
}

function renderEnrollment(body) {
  if (body.enrollment?.status === "used") {
    clearInterval(statusTimer);
    const equipment = body.equipment?.hostname || "este equipo";
    statusEl.textContent = `Equipo detectado y vinculado: ${equipment}.`;
    statusEl.className = "safety-banner safe success";
    resultEl.textContent = "Listo. Regresa a WhatsApp y describe el problema; Fisher creará el ticket con este equipo asignado.";
    openEl.classList.add("disabled"); openEl.setAttribute("aria-disabled", "true"); openEl.removeAttribute("href");
    downloadEl.classList.add("disabled"); downloadEl.setAttribute("aria-disabled", "true"); downloadEl.removeAttribute("href");
    return;
  }
  if (body.enrollment?.status !== "pending") throw new Error("La liga venció o ya no puede utilizarse.");
  const expires = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(body.enrollment.expiresAt));
  statusEl.textContent = `Liga válida hasta ${expires}. Solo puede vincular un equipo.`;
  statusEl.className = "safety-banner safe";
  openEl.href = `sas-client://enroll/${encodeURIComponent(installationCode)}`;
  openEl.classList.remove("disabled"); openEl.removeAttribute("aria-disabled");
  downloadEl.href = body.downloadUrl;
  downloadEl.classList.remove("disabled"); downloadEl.removeAttribute("aria-disabled");
}

function startStatusPolling() {
  clearInterval(statusTimer);
  let attempts = 0;
  statusTimer = setInterval(async () => {
    attempts += 1;
    try { renderEnrollment(await fetchEnrollment()); } catch (error) { showUnavailable(error.message); }
    if (attempts >= 45) clearInterval(statusTimer);
  }, 2000);
}

function showUnavailable(message) {
  statusEl.textContent = message;
  statusEl.className = "safety-banner danger";
  openEl.removeAttribute("href"); openEl.classList.add("disabled"); openEl.setAttribute("aria-disabled", "true");
  downloadEl.removeAttribute("href"); downloadEl.classList.add("disabled"); downloadEl.setAttribute("aria-disabled", "true");
}