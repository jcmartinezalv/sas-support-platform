import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REMOTE_CAPABILITIES = Object.freeze({
  screen: true,
  keyboard: true,
  pointer: true,
  clipboard: true,
  fileTransfer: true,
  unattended: true,
  elevatedDesktop: true,
  recording: true
});

const EXTERNAL_PROVIDERS = new Set(["rustdesk", "hoptodesk"]);

export function normalizeRemoteEngine(value) {
  const engine = String(value ?? "sas").trim().toLowerCase();
  return ["sas", "rustdesk", "hoptodesk", "auto"].includes(engine) ? engine : "sas";
}

export function findHopToDeskExecutable({ configuredPath = "", env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [
    configuredPath,
    env.SAS_HOPTODESK_PATH,
    env.ProgramFiles && path.join(env.ProgramFiles, "HopToDesk", "HopToDesk.exe"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "HopToDesk", "HopToDesk.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "HopToDesk", "HopToDesk.exe")
  ];
  return firstExistingPath(candidates, exists);
}

export function findRustDeskExecutable({ configuredPath = "", env = process.env, exists = fs.existsSync } = {}) {
  const candidates = [
    configuredPath,
    env.SAS_RUSTDESK_PATH,
    env.ProgramFiles && path.join(env.ProgramFiles, "RustDesk", "RustDesk.exe"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "RustDesk", "RustDesk.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "RustDesk", "RustDesk.exe")
  ];
  return firstExistingPath(candidates, exists);
}

export function inspectRemoteEngine({ preferred = "sas", configuredPath = "", configuredRustDeskPath = "", env = process.env, exists = fs.existsSync } = {}) {
  const preference = normalizeRemoteEngine(preferred);
  const hopToDeskExecutable = findHopToDeskExecutable({ configuredPath, env, exists });
  const rustDeskExecutable = findRustDeskExecutable({ configuredPath: configuredRustDeskPath, env, exists });
  const hopToDesk = externalProviderStatus({
    provider: "hoptodesk",
    installed: Boolean(hopToDeskExecutable),
    executablePath: hopToDeskExecutable,
    sourceRepository: "https://gitlab.com/hoptodesk/hoptodesk",
    pinnedVersion: "1.45.9"
  });
  const rustDesk = externalProviderStatus({
    provider: "rustdesk",
    installed: Boolean(rustDeskExecutable),
    executablePath: rustDeskExecutable,
    sourceRepository: "https://github.com/rustdesk/rustdesk",
    pinnedVersion: "1.4.9"
  });

  return {
    preference,
    selected: selectRemoteEngine(preference, { rustDesk, hopToDesk }),
    sasAvailable: true,
    rustDesk,
    hopToDesk
  };
}

export function buildRemoteEngineLaunch({ provider, executablePath, mode = "desktop", remoteId = "", exists = fs.existsSync } = {}) {
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  if (!EXTERNAL_PROVIDERS.has(normalizedProvider)) throw statusError(400, "El proveedor remoto no es válido");
  if (!executablePath || !exists(executablePath)) throw statusError(503, `${providerLabel(normalizedProvider)} no está instalado o su ruta no es válida`);

  const id = String(remoteId).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(id)) throw statusError(400, `El ID remoto de ${providerLabel(normalizedProvider)} no es válido`);
  if (!["desktop", "files"].includes(mode)) throw statusError(400, "La función solicitada del motor remoto no es válida");

  const operation = mode === "files" ? "--file-transfer" : "--connect";
  return { provider: normalizedProvider, executablePath, args: [operation, id], mode, remoteId: id };
}

export function buildHopToDeskLaunch(options = {}) {
  return buildRemoteEngineLaunch({ ...options, provider: "hoptodesk" });
}

export function buildRustDeskLaunch(options = {}) {
  return buildRemoteEngineLaunch({ ...options, provider: "rustdesk" });
}

export function launchRemoteEngine(options = {}) {
  const request = buildRemoteEngineLaunch(options);
  return new Promise((resolve, reject) => {
    const child = spawn(request.executablePath, request.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.once("error", (cause) => reject(statusError(503, `Windows no pudo iniciar ${providerLabel(request.provider)}: ${cause.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve({
        started: true,
        provider: request.provider,
        mode: request.mode,
        remoteId: request.remoteId,
        processId: child.pid ?? null
      });
    });
  });
}

export function launchHopToDesk(options = {}) {
  return launchRemoteEngine({ ...options, provider: "hoptodesk" });
}

export function launchRustDesk(options = {}) {
  return launchRemoteEngine({ ...options, provider: "rustdesk" });
}

export async function readRemoteEngineIdentity({ provider, executablePath, exists = fs.existsSync, run = execFileAsync } = {}) {
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  if (!EXTERNAL_PROVIDERS.has(normalizedProvider)) throw statusError(400, "El proveedor remoto no es válido");
  if (!executablePath || !exists(executablePath)) throw statusError(503, `${providerLabel(normalizedProvider)} no está instalado o su ruta no es válida`);

  const result = await run(executablePath, ["--get-id"], {
    windowsHide: true,
    timeout: 7000,
    maxBuffer: 64 * 1024
  });
  const localId = String(result?.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[A-Za-z0-9][A-Za-z0-9_.-]{2,63}$/.test(line));
  if (!localId) throw statusError(503, `${providerLabel(normalizedProvider)} no devolvió un ID local válido`);

  return { provider: normalizedProvider, localId, observedAt: new Date().toISOString() };
}

function firstExistingPath(candidates, exists) {
  const normalized = candidates.filter(Boolean).map((item) => path.resolve(String(item)));
  return normalized.find((candidate) => exists(candidate)) ?? null;
}

function externalProviderStatus({ provider, installed, executablePath, sourceRepository, pinnedVersion }) {
  return {
    installed,
    executablePath,
    capabilities: REMOTE_CAPABILITIES,
    integrationMode: "isolated_external_provider",
    launchManagedBySas: true,
    commandLineSecretsAllowed: false,
    provider,
    sourceRepository,
    pinnedVersion,
    license: "AGPL-3.0"
  };
}

function selectRemoteEngine(preference, { rustDesk, hopToDesk }) {
  if (preference === "sas") return "sas";
  if (preference === "rustdesk") return rustDesk.installed ? "rustdesk" : "unavailable";
  if (preference === "hoptodesk") return hopToDesk.installed ? "hoptodesk" : "unavailable";
  if (rustDesk.installed) return "rustdesk";
  if (hopToDesk.installed) return "hoptodesk";
  return "sas";
}

function providerLabel(provider) {
  return provider === "rustdesk" ? "RustDesk" : "HopToDesk";
}

function statusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
