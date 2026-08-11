import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const HOP_CAPABILITIES = Object.freeze({ screen: true, keyboard: true, pointer: true, clipboard: true, fileTransfer: true, unattended: true, elevatedDesktop: true, recording: true });
const RUSTDESK_REFERENCE_CAPABILITIES = Object.freeze({ screen: true, keyboard: true, pointer: true, clipboard: true, fileTransfer: true, unattended: true, elevatedDesktop: true });

export function normalizeRemoteEngine(value) {
  const engine = String(value ?? "sas").trim().toLowerCase();
  return ["sas", "hoptodesk", "auto"].includes(engine) ? engine : "sas";
}

export function findHopToDeskExecutable({ configuredPath = "", env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [configuredPath, env.SAS_HOPTODESK_PATH, env.ProgramFiles && path.join(env.ProgramFiles, "HopToDesk", "HopToDesk.exe"), env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "HopToDesk", "HopToDesk.exe"), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "HopToDesk", "HopToDesk.exe")].filter(Boolean).map((item) => path.resolve(String(item)));
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

export function findRustDeskExecutable({ configuredPath = "", env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [configuredPath, env.SAS_RUSTDESK_PATH, env.ProgramFiles && path.join(env.ProgramFiles, "RustDesk", "RustDesk.exe"), env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "RustDesk", "RustDesk.exe"), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "RustDesk", "RustDesk.exe")].filter(Boolean).map((item) => path.resolve(String(item)));
  return candidates.find((candidate) => exists(candidate)) ?? null;
}

export function inspectRemoteEngine({ preferred = "sas", configuredPath = "", configuredRustDeskPath = "", env = process.env, exists = fs.existsSync } = {}) {
  const preference = normalizeRemoteEngine(preferred);
  const executablePath = findHopToDeskExecutable({ configuredPath, env, exists });
  const rustDeskExecutablePath = findRustDeskExecutable({ configuredPath: configuredRustDeskPath, env, exists });
  const installed = Boolean(executablePath);
  const selected = preference === "hoptodesk" ? (installed ? "hoptodesk" : "unavailable") : preference === "auto" && installed ? "hoptodesk" : "sas";
  return {
    preference,
    selected,
    sasAvailable: true,
    hopToDesk: { installed, executablePath, capabilities: HOP_CAPABILITIES, integrationMode: "isolated_external_provider", licenseBoundary: "AGPL process kept separate from SAS" },
    rustDesk: { installed: Boolean(rustDeskExecutablePath), executablePath: rustDeskExecutablePath, capabilities: RUSTDESK_REFERENCE_CAPABILITIES, integrationMode: "isolated_diagnostic_reference", launchManagedBySas: false, licenseBoundary: "AGPL process kept separate from SAS" }
  };
}

export function buildHopToDeskLaunch({ executablePath, mode = "desktop", remoteId = "", exists = fs.existsSync } = {}) {
  if (!executablePath || !exists(executablePath)) throw statusError(503, "HopToDesk no está instalado o su ruta no es válida");
  const id = String(remoteId).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(id)) throw statusError(400, "El ID remoto de HopToDesk no es válido");
  if (!["desktop", "files"].includes(mode)) throw statusError(400, "La función solicitada de HopToDesk no es válida");
  const target = mode === "files" ? `hoptodesk://filetransfer/${encodeURIComponent(id)}` : id;
  return { executablePath, args: ["--connect", target], mode, remoteId: id };
}

export function launchHopToDesk(options = {}) {
  const request = buildHopToDeskLaunch(options);
  return new Promise((resolve, reject) => {
    const child = spawn(request.executablePath, request.args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", (cause) => reject(statusError(503, `Windows no pudo iniciar HopToDesk: ${cause.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve({ started: true, provider: "hoptodesk", mode: request.mode, remoteId: request.remoteId, processId: child.pid ?? null });
    });
  });
}

function statusError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
