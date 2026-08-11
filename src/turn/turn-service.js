import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(process.cwd());
const executable = process.env.SAS_TURN_EXECUTABLE ?? path.join(root, "tools", "coturn", "turnserver.exe");
const configPath = process.env.SAS_TURN_CONFIG_PATH ?? path.join(root, "turn", "turnserver.conf");
function publicHostFromEnvironment() {
  const configured = String(process.env.SAS_TURN_PUBLIC_HOST ?? "").trim();
  if (configured) return configured;
  try {
    return new URL(String(process.env.PUBLIC_BASE_URL ?? "")).hostname;
  } catch {
    return "";
  }
}

const publicHost = publicHostFromEnvironment();
const externalIpMode = String(
  process.env.SAS_TURN_EXTERNAL_IP_MODE ?? (publicHost ? "auto" : "manual")
).toLowerCase();
const configuredPrivateIp = String(process.env.SAS_TURN_PRIVATE_IP ?? "").trim();
const refreshSeconds = Math.max(15, Math.min(3600, Number(process.env.SAS_TURN_IP_REFRESH_SECONDS ?? 60) || 60));
const statusPath = path.join(path.dirname(configPath), "ip-monitor.json");
if (!fs.existsSync(executable)) throw new Error(`Falta el motor coturn: ${executable}`);
if (!fs.existsSync(configPath)) throw new Error(`Falta la configuración TURN: ${configPath}`);

let child = null;
let restarting = false;
let stopping = false;
let refreshRunning = false;

function writeStatus(status, details = {}) {
  const payload = { status, mode: externalIpMode, publicHost, checkedAt: new Date().toISOString(), ...details };
  try {
    const temporary = statusPath + "." + process.pid + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2));
    fs.renameSync(temporary, statusPath);
  } catch (error) { console.error("[SAS TURN] no se pudo guardar el monitor IP: " + error.message); }
}

function discoverPrivateIp() {
  if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(configuredPrivateIp)) return configuredPrivateIp;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(address.address)) return address.address;
    }
  }
  return "";
}

function readExternalMapping() {
  const match = fs.readFileSync(configPath, "utf8").match(/^external-ip=(.+)$/m);
  return match ? match[1].trim() : "";
}

function writeExternalMapping(mapping) {
  const source = fs.readFileSync(configPath, "utf8");
  const updated = /^external-ip=.*$/m.test(source) ? source.replace(/^external-ip=.*$/m, `external-ip=${mapping}`) : source.trimEnd() + `\nexternal-ip=${mapping}\n`;
  const temporary = configPath + "." + process.pid + ".tmp";
  fs.writeFileSync(temporary, updated, "utf8");
  fs.renameSync(temporary, configPath);
}

function launchTurn() {
  child = spawn(executable, ["-c", path.basename(configPath)], { cwd: path.dirname(configPath), windowsHide: true, stdio: "inherit" });
  child.once("error", (error) => { console.error("[SAS TURN] " + error.message); process.exitCode = 1; });
  child.once("exit", (code, signal) => {
    child = null;
    if (stopping) return;
    if (restarting) { restarting = false; launchTurn(); return; }
    if (signal) console.error(`[SAS TURN] coturn terminó por señal ${signal}`);
    process.exit(code ?? 1);
  });
}

function restartTurn(reason) {
  if (!child || restarting || stopping) return;
  restarting = true;
  console.log("[SAS TURN] reiniciando coturn: " + reason);
  child.kill("SIGTERM");
  const current = child;
  setTimeout(() => { if (restarting && child === current) { try { current.kill("SIGKILL"); } catch {} } }, 5000).unref();
}

async function refreshExternalIp() {
  if (refreshRunning || stopping || externalIpMode !== "auto" || !publicHost) return;
  refreshRunning = true;
  try {
    const addresses = [...new Set(await dns.resolve4(publicHost))].filter((value) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)).sort();
    if (!addresses.length) throw new Error("DNS no devolvió una dirección IPv4");
    const current = readExternalMapping();
    const currentPublic = current.split("/")[0];
    const publicIp = addresses.includes(currentPublic) ? currentPublic : addresses[0];
    const privateIp = discoverPrivateIp();
    const mapping = privateIp && privateIp !== publicIp ? publicIp + "/" + privateIp : publicIp;
    if (mapping !== current) {
      writeExternalMapping(mapping);
      writeStatus("changed", { previousMapping: current || null, externalIp: mapping, publicIp, privateIp: privateIp || null, changedAt: new Date().toISOString() });
      restartTurn(`la IP pública cambió de ${current || "sin configurar"} a ${mapping}`);
    } else {
      writeStatus("ok", { externalIp: mapping, publicIp, privateIp: privateIp || null, changed: false });
    }
  } catch (error) {
    writeStatus("warning", { externalIp: readExternalMapping() || null, error: error.message, preservedCurrentConfiguration: true });
    console.error("[SAS TURN] no se pudo comprobar la IP pública; se conserva la configuración activa: " + error.message);
  } finally { refreshRunning = false; }
}

launchTurn();
refreshExternalIp();
setInterval(refreshExternalIp, refreshSeconds * 1000).unref();
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; if (child && !child.killed) child.kill(signal); else process.exit(0); });
