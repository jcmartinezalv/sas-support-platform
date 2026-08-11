import crypto from "node:crypto";

export function createDeploymentCampaignStore({ initialCampaigns = [], onChange = () => {}, defaultTtlDays = 30 } = {}) {
  const campaigns = new Map(initialCampaigns.map((item) => [item.id, normalizeRecord(item)]));
  return {
    list() { refreshExpirations(); return [...campaigns.values()].map(publicRecord).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); },
    create({ name, company, maxDevices = 100, expiresAt, createdBy } = {}) {
      const cleanName = clean(name), cleanCompany = clean(company);
      if (cleanName.length < 3) throw campaignError("Escribe un nombre para la campaña", 400);
      if (cleanCompany.length < 2) throw campaignError("Escribe la empresa o ubicación", 400);
      const limit = Math.max(1, Math.min(10000, Number(maxDevices) || 100));
      const now = new Date(), expiry = expiresAt ? new Date(expiresAt) : new Date(now.getTime() + defaultTtlDays * 86400000);
      if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= now.getTime()) throw campaignError("La vigencia debe terminar en el futuro", 400);
      const token = crypto.randomBytes(32).toString("base64url");
      const record = normalizeRecord({ id: createId("DPL"), name: cleanName, company: cleanCompany, tokenHash: hash(token), tokenHint: token.slice(-6), status: "active", maxDevices: limit, devices: [], createdBy: clean(createdBy) || "system", createdAt: now.toISOString(), expiresAt: expiry.toISOString(), revokedAt: null });
      campaigns.set(record.id, record); persist(); return { ...publicRecord(record), token };
    },
    authorize(token, machineId) {
      refreshExpirations();
      const record = findByToken(token);
      if (!record) throw campaignError("Perfil de implementación no reconocido", 403);
      if (record.status !== "active") throw campaignError("La campaña está " + (record.status === "revoked" ? "revocada" : "vencida"), 410);
      const id = clean(machineId);
      if (!id) throw campaignError("Falta la identidad del equipo", 400);
      let device = record.devices.find((item) => item.machineId === id);
      if (!device && record.devices.length >= record.maxDevices) throw campaignError("La campaña alcanzó su límite de equipos", 409);
      if (!device) { device = { machineId: id, enrolledAt: new Date().toISOString() }; record.devices.push(device); persist(); }
      return publicRecord(record);
    },
    revoke(id) {
      const record = campaigns.get(clean(id)); if (!record) return null;
      if (record.status !== "revoked") { record.status = "revoked"; record.revokedAt = new Date().toISOString(); persist(); }
      return publicRecord(record);
    }
  };
  function findByToken(token) {
    const received = Buffer.from(hash(clean(token)), "hex");
    return [...campaigns.values()].find((item) => { if (!item.tokenHash) return false; const expected = Buffer.from(item.tokenHash, "hex"); return received.length === expected.length && crypto.timingSafeEqual(received, expected); }) ?? null;
  }
  function refreshExpirations() { let changed = false; for (const record of campaigns.values()) if (record.status === "active" && Date.parse(record.expiresAt) <= Date.now()) { record.status = "expired"; changed = true; } if (changed) persist(); }
  function persist() { onChange([...campaigns.values()]); }
}
function normalizeRecord(item = {}) {
  return { id: clean(item.id), name: clean(item.name), company: clean(item.company), tokenHash: clean(item.tokenHash), tokenHint: clean(item.tokenHint), status: ["active", "expired", "revoked"].includes(item.status) ? item.status : "active", maxDevices: Math.max(1, Number(item.maxDevices) || 100), devices: Array.isArray(item.devices) ? item.devices.map((device) => ({ machineId: clean(device.machineId), enrolledAt: device.enrolledAt ?? null })).filter((device) => device.machineId) : [], createdBy: clean(item.createdBy) || "system", createdAt: item.createdAt ?? new Date().toISOString(), expiresAt: item.expiresAt ?? new Date(Date.now() + 30 * 86400000).toISOString(), revokedAt: item.revokedAt ?? null };
}
function publicRecord(item) { return { id: item.id, name: item.name, company: item.company, tokenHint: item.tokenHint, status: item.status, maxDevices: item.maxDevices, enrolledDevices: item.devices.length, devices: item.devices.map((device) => ({ ...device })), createdBy: item.createdBy, createdAt: item.createdAt, expiresAt: item.expiresAt, revokedAt: item.revokedAt }; }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function clean(value) { return String(value ?? "").trim().slice(0, 500); }
function createId(prefix) { return prefix + "-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase(); }
function campaignError(message, statusCode) { const error = new Error(message); error.statusCode = statusCode; return error; }