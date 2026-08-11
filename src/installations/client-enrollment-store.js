import crypto from "node:crypto";

export function createClientEnrollmentStore({ initialEnrollments = [], onChange = () => {}, ttlMinutes = 60 } = {}) {
  const records = new Map(initialEnrollments.map((item) => [item.id, item]));
  return {
    list() { return [...records.values()].map(publicRecord); },
    create({ ticketId, customerPhone, createdBy }) {
      const token = crypto.randomBytes(24).toString("base64url");
      const now = new Date();
      const record = { id: createId("ENR"), ticketId: clean(ticketId), customerPhone: clean(customerPhone), createdBy: clean(createdBy) || "system", tokenHash: hash(token), shortCode: createUniqueShortCode(records), status: "pending", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMinutes * 60000).toISOString(), usedAt: null, agentId: null };
      records.set(record.id, record); persist();
      return { ...publicRecord(record), token };
    },
    inspect(token) { const record = findToken(token); if (!record) return null; expire(record); return publicRecord(record); },
    consume(token, agentId) { const record = findToken(token); if (!record) return null; expire(record); if (record.status !== "pending") return publicRecord(record); record.status = "used"; record.usedAt = new Date().toISOString(); record.agentId = clean(agentId); persist(); return publicRecord(record); }
  };
  function findToken(token) {
    const credential = clean(token);
    if (!credential) return null;
    const shortCode = normalizeShortCode(credential);
    const value = hash(credential);
    return [...records.values()].find((item) => item.tokenHash === value || (item.shortCode && normalizeShortCode(item.shortCode) === shortCode)) ?? null;
  }
  function expire(record) { if (record.status === "pending" && new Date(record.expiresAt).getTime() <= Date.now()) { record.status = "expired"; persist(); } }
  function persist() { onChange([...records.values()]); }
}
function publicRecord(item) { return { id: item.id, ticketId: item.ticketId, customerPhone: item.customerPhone, shortCode: item.shortCode ?? null, status: item.status, createdBy: item.createdBy, createdAt: item.createdAt, expiresAt: item.expiresAt, usedAt: item.usedAt, agentId: item.agentId }; }
function createUniqueShortCode(records) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from(crypto.randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join(""); }
  while ([...records.values()].some((item) => item.shortCode === code));
  return code;
}
function normalizeShortCode(value) { return clean(value).replace(/[\s-]/g, "").toUpperCase(); }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function clean(value) { return String(value ?? "").trim(); }
function createId(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`.toUpperCase(); }
