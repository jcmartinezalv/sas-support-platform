import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { signManifest } from "../src/updates/update-service.js";

const args = parseArgs(process.argv.slice(2));
if (!args.package) throw new Error("Usa --package <archivo.zip>");
const packagePath = path.resolve(args.package);
if (!fs.existsSync(packagePath)) throw new Error(`No existe el paquete: ${packagePath}`);
const channel = String(args.channel || "testing").toLowerCase();
if (!["stable", "testing", "client"].includes(channel)) throw new Error("Canal invalido");
const version = String(args.version || JSON.parse(fs.readFileSync("package.json", "utf8")).version);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Version invalida");
validatePackage(packagePath, version);

const outputRoot = path.resolve(args.output || "updates");
const channelRoot = path.join(outputRoot, channel);
fs.mkdirSync(channelRoot, { recursive: true });
const filename = `sas-update-${version}.zip`;
const publishedPackage = path.join(channelRoot, filename);
fs.copyFileSync(packagePath, publishedPackage);
const bytes = fs.statSync(publishedPackage).size;
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(publishedPackage)).digest("hex").toUpperCase();
const notes = String(args.notes || "Actualizacion SAS verificada.").split("|").map(v => v.trim()).filter(Boolean);
const manifest = { schemaVersion: 1, product: "SAS Support Platform", channel, version, publishedAt: new Date().toISOString(), minimumVersion: args.minimum || null, requiresRestart: true, notes, package: { url: `${channel}/${filename}`, sha256, size: bytes } };
if (args["private-key"]) { const key = fs.readFileSync(path.resolve(args["private-key"]), "utf8"); manifest.signature = { algorithm: "ed25519", value: signManifest(manifest, key) }; }
fs.writeFileSync(path.join(channelRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ channel, version, manifestPath: path.join(channelRoot, "manifest.json"), packagePath: publishedPackage, sha256, size: bytes, signed: Boolean(manifest.signature), validation: "passed" }, null, 2));

function validatePackage(zipPath, expectedVersion) {
  let listing;
  try { listing = execFileSync("tar", ["-tf", zipPath], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }); }
  catch (error) { throw new Error(`No se pudo leer el ZIP: ${error.message}`); }
  const entries = listing.split(/\r?\n/).map(value => value.replaceAll("\\", "/")).filter(Boolean);
  const required = [
    "package.json", "src/server.js", "src/agents/agent-store.js", "src/contacts/contact-store.js", "src/agent/image-analysis-service.js", "src/mobile/technician-notification-service.js", "src/remote/remote-session-store.js",
    "client/agent-client.js", "client/adaptive-screen-controller.js", "client/webrtc-runtime/package.json", "client/webrtc-runtime/node_modules/node-datachannel/build/Release/node_datachannel.node", "public/app.js", "public/remote-workspace.html",
    "scripts/update-server-deployment.ps1", "scripts/install-sas-services.ps1", "scripts/install-sas-turn-service.ps1", "scripts/stop-client-components.ps1", "scripts/apply-client-update.ps1", "scripts/show-client-update-progress.ps1", "src/remote/turn-credentials.js", "src/turn/turn-service.js",
    "tools/sas-service-host/SasServiceHost.exe", "tools/sas-dxgi-capture/bin/Release/SasDxgiCapture.exe", "tools/sas-admin-console/SasAdminConsole.exe", "tools/coturn/turnserver.exe", "vendor/remote-engines/rustdesk-1.4.9-x86_64.msi", "downloads/SAS-Cliente-Setup.exe", "downloads/SAS-Cliente-Setup.exe.manifest.json", "downloads/SAS-Cliente-Setup.exe.sha256.txt"
  ];
  const missing = required.filter(file => !entries.includes(file));
  if (missing.length) throw new Error(`Paquete inválido: faltan ${missing.join(", ")}`);
  const unsafe = entries.filter(file => file.startsWith("/") || file.split("/").includes(".."));
  if (unsafe.length) throw new Error(`Paquete inválido: rutas inseguras: ${unsafe.slice(0, 5).join(", ")}`);
  const forbidden = entries.filter(file => /(^|\/)(src|public|scripts|client|certs)\/(src|public|scripts|client|certs)\//i.test(file));
  if (forbidden.length) throw new Error(`Paquete inválido: rutas duplicadas: ${forbidden.slice(0, 5).join(", ")}`);
  const packageJson = execFileSync("tar", ["-xOf", zipPath, "package.json"], { encoding: "utf8" }).replace(/^\uFEFF/, "");
  const packageInfo = JSON.parse(packageJson);
  if (String(packageInfo.version) !== expectedVersion) throw new Error(`Versión inconsistente: package.json=${packageInfo.version}, esperada=${expectedVersion}`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sas-package-check-"));
  try {
    execFileSync("tar", ["-xf", zipPath, "-C", temp], { stdio: "ignore" });
    const releaseManifestPath = path.join(temp, "release-manifest.json");
    if (!fs.existsSync(releaseManifestPath)) throw new Error("Paquete inválido: falta release-manifest.json");
    const releaseManifest = JSON.parse(fs.readFileSync(releaseManifestPath, "utf8").replace(/^\uFEFF/, ""));
    const internalVersion = String(releaseManifest.Version ?? releaseManifest.version ?? "");
    if (internalVersion !== expectedVersion) throw new Error(`Versión interna inconsistente: ${internalVersion || "ausente"}`);
    const manifestFiles = releaseManifest.Files ?? releaseManifest.files;
    if (!Array.isArray(manifestFiles) || !manifestFiles.length) throw new Error("El manifiesto interno no contiene archivos");
    if (Number(releaseManifest.FileCount ?? releaseManifest.fileCount) !== manifestFiles.length) throw new Error("Conteo interno de archivos inconsistente");
    for (const entry of manifestFiles) {
      const relative = String(entry.Path ?? entry.path ?? "").replaceAll("\\", "/");
      if (!relative || relative.startsWith("/") || relative.split("/").includes("..")) throw new Error(`Ruta interna insegura: ${relative}`);
      const candidate = path.resolve(temp, ...relative.split("/"));
      if (!candidate.startsWith(path.resolve(temp) + path.sep) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error(`Archivo interno faltante: ${relative}`);
      const expectedHash = String(entry.Sha256 ?? entry.sha256 ?? "").toUpperCase();
      const actualHash = crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex").toUpperCase();
      if (expectedHash !== actualHash) throw new Error(`Hash interno incorrecto: ${relative}`);
      if (Number(entry.Size ?? entry.size) !== fs.statSync(candidate).size) throw new Error(`Tamaño interno incorrecto: ${relative}`);
    }
    for (const file of ["src/server.js", "client/agent-client.js", "public/app.js", "src/agent/image-analysis-service.js", "src/mobile/technician-notification-service.js", "src/remote/remote-session-store.js", "src/remote/turn-credentials.js", "src/turn/turn-service.js"]) {
      execFileSync(process.execPath, ["--check", path.join(temp, ...file.split("/"))], { stdio: "pipe" });
    }
    validateRelativeImports(path.join(temp, "src", "server.js"), temp, new Set());
    const clientInstallerPath = path.join(temp, "downloads", "SAS-Cliente-Setup.exe");
    const clientInstallerManifest = JSON.parse(fs.readFileSync(clientInstallerPath + ".manifest.json", "utf8").replace(/^\uFEFF/, ""));
    const clientInstallerHash = crypto.createHash("sha256").update(fs.readFileSync(clientInstallerPath)).digest("hex").toUpperCase();
    const clientInstallerSidecar = fs.readFileSync(clientInstallerPath + ".sha256.txt", "ascii");
    if (String(clientInstallerManifest.version) !== expectedVersion || clientInstallerManifest.compiler !== "NSIS" || Number(clientInstallerManifest.size) !== fs.statSync(clientInstallerPath).size || String(clientInstallerManifest.sha256).toUpperCase() !== clientInstallerHash || !clientInstallerSidecar.toUpperCase().includes(clientInstallerHash)) throw new Error("Instalador de SAS Cliente desalineado con el release");
    const server = fs.readFileSync(path.join(temp, "src", "server.js"), "utf8");
    if (!server.includes('transport: "webrtc_datachannel_with_https_fallback"') || !server.includes("signalingConfigured: true") || !server.includes("realtimeReady: config.webrtcEnabled") || !server.includes("dataChannel: true")) {
      throw new Error("El servidor debe declarar WebRTC DataChannel operativo con respaldo HTTPS");
    }
    const agentStoreSource = fs.readFileSync(path.join(temp, "src", "agents", "agent-store.js"), "utf8");
    const agentSource = fs.readFileSync(path.join(temp, "client", "agent-client.js"), "utf8");
    const workspaceSource = fs.readFileSync(path.join(temp, "public", "remote-workspace.html"), "utf8");
    for (const marker of ["webrtcSignaling", "webrtcDataChannel", "webrtcEngine", "privilegedDesktopBroker", "persistentNativeHelpers", "directPointerWebRtc", "capturedCursor"]) if (!agentStoreSource.includes(marker)) throw new Error(`El paquete pierde capacidad del agente: ${marker}`);
    for (const marker of ["negotiationId", "enableIceTcp", "sendWebRtcFrame", "bufferedAmount() > 160 * 1024", "latestHttpsFrameAtBySession", "handleWebRtcControlMessage", "sas-control", "executeInputHelper(args)", "requestNativeHelper", "persistentCapture", "sas_pointer_move", "elevatedDesktopRequested", "SAS Interactive Desktop Broker", "SAS_DXGI_CAPTURE_HELPER_PATH", "capture_dxgi", "captureFallbackReason"]) if (!agentSource.includes(marker)) throw new Error(`Cliente WebRTC incompleto: ${marker}`);
    for (const marker of ["rtcPendingLocalCandidates", "entry.received!==total", "URL.createObjectURL", "icecandidateerror", "createDataChannel('sas-control'", "rtcControlChannel.send", "sendEvent('mouse_button'", "action:'down'", "action:'up'", "remotePointerCoordinates", "remoteOperatorPointer"]) if (!workspaceSource.includes(marker)) throw new Error(`Receptor WebRTC incompleto: ${marker}`);
    const desktopBroker = fs.readFileSync(path.join(temp, "tools", "sas-secure-attention-broker", "Program.cs"), "utf8");
    for (const marker of ["operation==\"INPUT_USER\"", "WTSQueryUserToken", "RunInActiveUserSession", "create_interactive_worker"]) if (!desktopBroker.includes(marker)) throw new Error(`Broker interactivo incompleto: ${marker}`);
    const turnCredentials = fs.readFileSync(path.join(temp, "src", "remote", "turn-credentials.js"), "utf8");
    const turnInstaller = fs.readFileSync(path.join(temp, "scripts", "install-sas-turn-service.ps1"), "utf8");
    for (const marker of ["createHmac(\"sha1\"", "webrtcTurnCredentialTtlSeconds", "createNativeTurnIceServers"]) if (!turnCredentials.includes(marker)) throw new Error(`Credenciales TURN incompletas: ${marker}`);
    for (const marker of ["SAS Support TURN", "use-auth-secret", "static-auth-secret", "New-NetFirewallRule", "S-1-5-18", "S-1-5-32-544"]) if (!turnInstaller.includes(marker)) throw new Error(`Instalador TURN incompleto: ${marker}`);
    if (/NT AUTHORITY\\SYSTEM|BUILTIN\\Administrators/.test(turnInstaller)) throw new Error("El instalador TURN usa nombres de identidades dependientes del idioma de Windows");
    const clientCleanup = fs.readFileSync(path.join(temp, "scripts", "stop-client-components.ps1"), "utf8");
    for (const marker of ["SAS Client ClamAV Definitions", "Disable-ScheduledTask -TaskName $clamTaskName", "Test-ExclusiveWrite", "No fue posible liberar ClamAV antes de actualizar", "RestoreOnly"]) {
      if (!clientCleanup.includes(marker)) throw new Error(`Actualizador de SAS Cliente incompleto: falta ${marker}`);
    }
    const clientUpdateWorker = fs.readFileSync(path.join(temp, "scripts", "apply-client-update.ps1"), "utf8");
    for (const marker of ["Restore-PreviousClientStartup", "Enable-ScheduledTask -TaskName \"SAS Client ClamAV Definitions\""]) {
      if (!clientUpdateWorker.includes(marker)) throw new Error(`Recuperación de SAS Cliente incompleta: falta ${marker}`);
    }
    const updater = fs.readFileSync(path.join(temp, "scripts", "update-server-deployment.ps1"), "utf8");
    for (const marker of ["Wait-SasHealth", "Restore-Backup", "RolledBack", "Assert-Deployment", "Copy-CertificateTree"]) {
      if (!updater.includes(marker)) throw new Error(`Actualizador incompleto: falta ${marker}`);
    }
    const installServices = fs.readFileSync(path.join(temp, "scripts", "install-sas-services.ps1"), "utf8");
    for (const script of ["sas-client-tray.ps1", "show-client-update-progress.ps1", "show-support-consent.ps1", "install-client.ps1", "start-client.ps1"]) {
      const scriptBytes = fs.readFileSync(path.join(temp, "scripts", script));
      if (scriptBytes[0] !== 0xef || scriptBytes[1] !== 0xbb || scriptBytes[2] !== 0xbf) {
        throw new Error(`Codificación incompatible con Windows PowerShell 5.1: ${script} debe usar UTF-8 con BOM`);
      }
    }
    if (installServices.includes("sc.exe delete")) throw new Error("El instalador aún elimina el servicio durante una actualización");
    for (const script of ["update-server-deployment.ps1", "install-sas-services.ps1", "install-sas-turn-service.ps1", "stop-client-components.ps1", "apply-client-update.ps1", "show-client-update-progress.ps1", "install-client.ps1"]) {
      const file = path.join(temp, "scripts", script).replaceAll("'", "''");
      const command = `$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{$_.Message};exit 1}`;
      execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { stdio: "pipe" });
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function validateRelativeImports(file, root, visited) {
  const normalized = path.resolve(file);
  if (visited.has(normalized)) return;
  visited.add(normalized);
  if (!fs.existsSync(normalized)) throw new Error(`Módulo faltante: ${path.relative(root, normalized)}`);
  const source = fs.readFileSync(normalized, "utf8");
  const imports = [...source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g)].map(match => match[1]);
  for (const relative of imports) {
    const target = path.resolve(path.dirname(normalized), relative);
    const candidate = path.extname(target) ? target : `${target}.js`;
    if (!candidate.startsWith(path.resolve(root) + path.sep)) throw new Error(`Importación fuera del paquete: ${relative}`);
    validateRelativeImports(candidate, root, visited);
  }
}
function parseArgs(values) { const out = {}; for (let i = 0; i < values.length; i++) if (values[i].startsWith("--")) { const key = values[i].slice(2); out[key] = values[i + 1] && !values[i + 1].startsWith("--") ? values[++i] : true; } return out; }





