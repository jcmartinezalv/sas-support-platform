import crypto from "node:crypto";

export function createTurnIceServers(config, subject = "sas") {
  const stunServers = (config.webrtcStunUrls ?? []).map((urls) => ({ urls }));
  const turnUrls = normalizeTurnUrls(config.webrtcTurnUrls ?? config.webrtcTurnUrl);
  if (!turnUrls.length) return stunServers;
  const credentials = createTurnCredentials(config, subject);
  return [...stunServers, { urls: turnUrls, ...credentials }];
}

export function createNativeTurnIceServers(config, subject = "sas") {
  const stunServers = [...(config.webrtcStunUrls ?? [])];
  const turnUrls = normalizeTurnUrls(config.webrtcTurnUrls ?? config.webrtcTurnUrl);
  if (!turnUrls.length) return stunServers;
  const credentials = createTurnCredentials(config, subject);
  if (!credentials.username || !credentials.credential) return [...stunServers, ...turnUrls];
  return [...stunServers, ...turnUrls.map((url) => addCredentialsToTurnUrl(url, credentials))];
}

export function turnIsConfigured(config) {
  const urls = normalizeTurnUrls(config.webrtcTurnUrls ?? config.webrtcTurnUrl);
  return urls.length > 0 && Boolean(config.webrtcTurnSecret || (config.webrtcTurnUsername && config.webrtcTurnCredential));
}

export function createTurnCredentials(config, subject = "sas") {
  const secret = String(config.webrtcTurnSecret ?? "").trim();
  if (secret) {
    const ttl = Math.max(60, Math.min(86400, Number(config.webrtcTurnCredentialTtlSeconds ?? 600)));
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const safeSubject = String(subject ?? "sas").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "sas";
    const username = `${expiresAt}:${safeSubject}`;
    return { username, credential: crypto.createHmac("sha1", secret).update(username).digest("base64") };
  }
  const username = String(config.webrtcTurnUsername ?? "").trim();
  const credential = String(config.webrtcTurnCredential ?? "");
  return { ...(username ? { username } : {}), ...(credential ? { credential } : {}) };
}

function normalizeTurnUrls(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(list.map((item) => String(item).trim()).filter((item) => /^turns?:/i.test(item)))];
}

function addCredentialsToTurnUrl(url, credentials) {
  const separator = url.indexOf(":");
  const scheme = separator >= 0 ? url.slice(0, separator + 1) : "turn:";
  const address = separator >= 0 ? url.slice(separator + 1).replace(/^\/\//, "") : url;
  return `${scheme}${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.credential)}@${address}`;
}