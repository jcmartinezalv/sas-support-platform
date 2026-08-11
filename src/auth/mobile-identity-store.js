import crypto from "node:crypto";

const ALLOWED_ROLES = new Set(["admin", "supervisor", "technician", "viewer"]);

export function createMobileIdentityStore({ initialUsers = [], initialDevices = [], initialSessions = [], initialRecoveryTokens = [], onChange = () => {}, accessTtlMinutes = 15, refreshTtlDays = 30, maxFailedAttempts = 5, lockMinutes = 15, now = () => new Date() } = {}) {
  const users = new Map(initialUsers.map((item) => [item.id, { ...item }]));
  const devices = new Map(initialDevices.map((item) => [item.id, { ...item }]));
  const sessions = new Map(initialSessions.map((item) => [item.id, { ...item, accessTokenHistory: Array.isArray(item.accessTokenHistory) ? item.accessTokenHistory.filter((entry) => entry?.hash && entry?.expiresAt).slice(-3) : [] }]));
  const recoveryTokens = new Map(initialRecoveryTokens.map((item) => [item.tokenHash, { userId: item.userId, expiresAt: item.expiresAt, usedAt: item.usedAt ?? null }]));

  return {
    hasUsers: () => users.size > 0,
    bootstrapUser(input) {
      if (users.size > 0) throw authError("Mobile users already exist", 409);
      return createUser({ ...input, mustChangePassword: false });
    },
    createUser,
    login({ username, password, deviceId, deviceName = "Android", platform = "android", fcmToken = null }) {
      pruneExpired();
      const user = [...users.values()].find((item) => item.usernameNormalized === normalizeUsername(username) && item.status === "active");
      if (user?.lockedUntil && new Date(user.lockedUntil).getTime() > now().getTime()) throw authError("Mobile account temporarily locked", 429, { lockedUntil: user.lockedUntil });
      if (user?.lockedUntil) { user.lockedUntil = null; user.failedLoginAttempts = 0; }
      if (!user || !verifyPassword(password, user.password)) {
        if (user) recordFailedLogin(user);
        throw authError("Invalid mobile credentials", 401, { attemptsRemaining: user ? Math.max(0, maxFailedAttempts - Number(user.failedLoginAttempts ?? 0)) : null });
      }
      user.failedLoginAttempts = 0; user.lockedUntil = null; user.lastLoginAt = now().toISOString();
      const device = upsertDevice({ userId: user.id, deviceId, deviceName, platform, fcmToken });
      return createSession(user, device);
    },
    refresh({ refreshToken, deviceId }) {
      pruneExpired();
      const tokenHash = hashToken(refreshToken);
      const current = [...sessions.values()].find((item) => item.refreshTokenHash === tokenHash && !item.revokedAt);
      if (!current || isExpired(current.refreshExpiresAt, now())) throw authError("Invalid or expired refresh token", 401);
      if (current.deviceId !== clean(deviceId)) throw authError("Refresh token does not belong to this device", 401);
      const user = users.get(current.userId);
      const device = devices.get(current.deviceId);
      if (!user || user.status !== "active" || !device || device.revokedAt) throw authError("Mobile session revoked", 401);
      return renewSession(current, user, device, refreshToken);
    },
    actorFromRequest(req) {
      const bearer = readBearer(req);
      if (!bearer) return null;
      const tokenHash = hashToken(bearer);
      const session = findSessionByAccessToken(tokenHash);
      if (!session || isExpired(session.accessExpiresAt, now())) return null;
      const user = users.get(session.userId);
      const device = devices.get(session.deviceId);
      if (!user || user.status !== "active" || !device || device.revokedAt) return null;
      session.lastUsedAt = now().toISOString();
      return { id: user.id, role: user.role, displayName: user.displayName, mobileAuthenticated: true, mobileSessionId: session.id, mobileDeviceId: device.id, clientPlatform: device.platform, mustChangePassword: Boolean(user.mustChangePassword), consoleTokenValid: true };
    },
    logout({ accessToken }) {
      const tokenHash = hashToken(accessToken);
      const session = findSessionByAccessToken(tokenHash);
      if (!session) return false;
      session.revokedAt = now().toISOString();
      session.revokeReason = "logout";
      persist();
      return true;
    },
    revokeDevice({ userId, deviceId, reason = "manual" }) {
      const device = devices.get(clean(deviceId));
      if (!device || device.userId !== userId) return false;
      device.revokedAt = now().toISOString();
      device.revokeReason = reason;
      for (const session of sessions.values()) {
        if (session.deviceId === device.id && !session.revokedAt) { session.revokedAt = device.revokedAt; session.revokeReason = "device_revoked"; }
      }
      persist();
      return true;
    },
    updatePushToken({ userId, deviceId, fcmToken }) {
      const device = devices.get(clean(deviceId));
      if (!device || device.userId !== userId || device.revokedAt) throw authError("Mobile device not found", 404);
      device.fcmToken = clean(fcmToken) || null;
      device.updatedAt = now().toISOString();
      persist();
      return publicDevice(device);
    },
    listUsers() { return [...users.values()].map(publicUser).sort((a, b) => a.username.localeCompare(b.username)); },
    updateUser({ userId, displayName, role, status, phoneE164 }) {
      const user = users.get(clean(userId));
      if (!user) throw authError("Mobile user not found", 404);
      if (role !== undefined) {
        if (!ALLOWED_ROLES.has(role)) throw authError("Invalid mobile role", 400);
        user.role = role;
      }
      if (status !== undefined) {
        if (!["active", "disabled"].includes(status)) throw authError("Invalid mobile user status", 400);
        user.status = status;
        if (status === "disabled") revokeUserAccess(user.id, "user_disabled");
        if (status === "active") for (const device of devices.values()) if (device.userId === user.id && device.revokeReason === "user_disabled") { device.revokedAt = null; device.revokeReason = null; }
      }
      if (displayName !== undefined) user.displayName = clean(displayName) || user.username;
      if (phoneE164 !== undefined) user.phoneE164 = normalizePhone(phoneE164);
      user.updatedAt = now().toISOString();
      persist();
      return publicUser(user);
    },
    resetPassword({ userId, password }) {
      const user = users.get(clean(userId));
      if (!user) throw authError("Mobile user not found", 404);
      if (String(password ?? "").length < 12) throw authError("Mobile password must have at least 12 characters", 400);
      user.password = hashPassword(password);
      user.mustChangePassword = true; user.failedLoginAttempts = 0; user.lockedUntil = null;
      user.updatedAt = now().toISOString();
      revokeUserAccess(user.id, "password_reset");
      persist();
      return publicUser(user);
    },
    changePassword({ accessToken, currentPassword, newPassword }) {
      if (String(newPassword ?? "").length < 12) throw authError("Mobile password must have at least 12 characters", 400);
      if (String(newPassword) === String(currentPassword ?? "")) throw authError("New password must be different", 400);
      const tokenHash = hashToken(accessToken);
      const session = findSessionByAccessToken(tokenHash);
      const user = session ? users.get(session.userId) : null;
      if (!session || !user || !verifyPassword(currentPassword, user.password)) throw authError("Current password is invalid", 401);
      user.password = hashPassword(newPassword); user.mustChangePassword = false; user.failedLoginAttempts = 0; user.lockedUntil = null; user.updatedAt = now().toISOString();
      revokeUserAccess(user.id, "password_changed");
      persist();
      return { user: publicUser(user), sessionsRevoked: true };
    },
    requestPasswordReset({ phoneE164 }) {
      pruneRecoveryTokens();
      const phone = normalizePhone(phoneE164);
      const user = [...users.values()].find((item) => item.phoneE164 === phone && item.status === "active");
      if (!user) return { accepted: true, token: null, expiresAt: null };
      const token = randomToken();
      const expiresAt = addMinutes(now(), 15).toISOString();
      recoveryTokens.set(hashToken(token), { userId: user.id, expiresAt, usedAt: null });
      persist();
      return { accepted: true, token, expiresAt, userId: user.id };
    },
    consumePasswordReset({ token, password }) {
      pruneRecoveryTokens();
      const entry = recoveryTokens.get(hashToken(token));
      if (!entry || entry.usedAt || isExpired(entry.expiresAt, now())) throw authError("Invalid or expired recovery link", 400);
      if (String(password ?? "").length < 12) throw authError("Mobile password must have at least 12 characters", 400);
      const user = users.get(entry.userId);
      if (!user || user.status !== "active") throw authError("Invalid or expired recovery link", 400);
      user.password = hashPassword(password); user.mustChangePassword = false; user.failedLoginAttempts = 0; user.lockedUntil = null; user.updatedAt = now().toISOString();
      entry.usedAt = now().toISOString(); revokeUserAccess(user.id, "whatsapp_password_recovery"); persist();
      return { user: publicUser(user), sessionsRevoked: true };
    },
    listDevices(userId) { return [...devices.values()].filter((item) => item.userId === userId).map(publicDevice); },
    snapshot() { return { users: [...users.values()], devices: [...devices.values()], sessions: [...sessions.values()], recoveryTokens: serializeRecoveryTokens() }; }
  };

  function createUser(input) {
    const username = clean(input.username);
    const password = String(input.password ?? "");
    if (username.length < 3) throw authError("Mobile username must have at least 3 characters", 400);
    if (password.length < 12) throw authError("Mobile password must have at least 12 characters", 400);
    if ([...users.values()].some((item) => item.usernameNormalized === normalizeUsername(username))) throw authError("Mobile username already exists", 409);
    const role = ALLOWED_ROLES.has(input.role) ? input.role : "viewer";
    const phoneE164 = normalizePhone(input.phoneE164);
    const timestamp = now().toISOString();
    const user = { id: createId("MUSR"), username, usernameNormalized: normalizeUsername(username), displayName: clean(input.displayName) || username, phoneE164, role, status: "active", mustChangePassword: input.mustChangePassword !== false, failedLoginAttempts: 0, lockedUntil: null, password: hashPassword(password), createdAt: timestamp, updatedAt: timestamp };
    users.set(user.id, user);
    persist();
    return publicUser(user);
  }

  function upsertDevice({ userId, deviceId, deviceName, platform, fcmToken }) {
    const id = clean(deviceId);
    if (!id || id.length < 8) throw authError("A stable mobile deviceId is required", 400);
    const timestamp = now().toISOString();
    const current = devices.get(id);
    if (current && current.userId !== userId) throw authError("Device is registered to another user", 409);
    const device = { ...(current ?? {}), id, userId, name: clean(deviceName) || "Android", platform: clean(platform) || "android", fcmToken: clean(fcmToken) || current?.fcmToken || null, revokedAt: null, revokeReason: null, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp, lastLoginAt: timestamp };
    devices.set(id, device);
    return device;
  }

  function createSession(user, device) {
    const timestamp = now();
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const session = { id: createId("MSES"), userId: user.id, deviceId: device.id, accessTokenHash: hashToken(accessToken), refreshTokenHash: hashToken(refreshToken), accessExpiresAt: addMinutes(timestamp, accessTtlMinutes).toISOString(), refreshExpiresAt: addDays(timestamp, refreshTtlDays).toISOString(), createdAt: timestamp.toISOString(), lastUsedAt: timestamp.toISOString(), revokedAt: null, revokeReason: null };
    sessions.set(session.id, session);
    persist();
    return { accessToken, refreshToken, tokenType: "Bearer", accessExpiresAt: session.accessExpiresAt, refreshExpiresAt: session.refreshExpiresAt, user: publicUser(user), device: publicDevice(device) };
  }

  function renewSession(session, user, device, refreshToken) {
    const timestamp = now();
    const accessToken = randomToken();
    const history = Array.isArray(session.accessTokenHistory)
      ? session.accessTokenHistory.filter((entry) => entry?.hash && !isExpired(entry.expiresAt, timestamp)).slice(-2)
      : [];
    if (session.accessTokenHash) history.push({ hash: session.accessTokenHash, expiresAt: addMinutes(timestamp, 2).toISOString() });
    session.accessTokenHistory = history.slice(-3);
    session.accessTokenHash = hashToken(accessToken);
    session.accessExpiresAt = addMinutes(timestamp, accessTtlMinutes).toISOString();
    session.lastUsedAt = timestamp.toISOString();
    session.updatedAt = timestamp.toISOString();
    persist();
    return { accessToken, refreshToken: String(refreshToken), tokenType: "Bearer", accessExpiresAt: session.accessExpiresAt, refreshExpiresAt: session.refreshExpiresAt, user: publicUser(user), device: publicDevice(device) };
  }

  function findSessionByAccessToken(tokenHash) {
    const timestamp = now();
    return [...sessions.values()].find((session) => {
      if (session.revokedAt) return false;
      if (session.accessTokenHash === tokenHash && !isExpired(session.accessExpiresAt, timestamp)) return true;
      return Array.isArray(session.accessTokenHistory) && session.accessTokenHistory.some((entry) => entry?.hash === tokenHash && !isExpired(entry.expiresAt, timestamp));
    }) ?? null;
  }

  function recordFailedLogin(user) {
    user.failedLoginAttempts = Number(user.failedLoginAttempts ?? 0) + 1;
    if (user.failedLoginAttempts >= maxFailedAttempts) { user.lockedUntil = addMinutes(now(), lockMinutes).toISOString(); user.failedLoginAttempts = maxFailedAttempts; }
    user.updatedAt = now().toISOString(); persist();
  }
  function revokeUserAccess(userId, reason) {
    const revokedAt = now().toISOString();
    for (const session of sessions.values()) if (session.userId === userId && !session.revokedAt) { session.revokedAt = revokedAt; session.revokeReason = reason; }
    for (const device of devices.values()) if (device.userId === userId && !device.revokedAt) { device.revokedAt = revokedAt; device.revokeReason = reason; }
  }
  function pruneRecoveryTokens() { for (const [key, entry] of recoveryTokens) if (entry.usedAt || isExpired(entry.expiresAt, now())) recoveryTokens.delete(key); }
  function pruneExpired() {
    const current = now();
    let changed = false;
    for (const [id, session] of sessions) {
      if (isExpired(session.refreshExpiresAt, current)) { sessions.delete(id); changed = true; continue; }
      const history = Array.isArray(session.accessTokenHistory) ? session.accessTokenHistory.filter((entry) => entry?.hash && !isExpired(entry.expiresAt, current)).slice(-3) : [];
      if (history.length !== (session.accessTokenHistory?.length ?? 0)) { session.accessTokenHistory = history; changed = true; }
    }
    if (changed) persist();
  }

  function serializeRecoveryTokens() { return [...recoveryTokens.entries()].map(([tokenHash, entry]) => ({ tokenHash, ...entry })); }
  function persist() { onChange({ users: [...users.values()], devices: [...devices.values()], sessions: [...sessions.values()], recoveryTokens: serializeRecoveryTokens() }); }
}

function hashPassword(password) { const salt = crypto.randomBytes(16); const derived = crypto.scryptSync(String(password), salt, 64); return { algorithm: "scrypt", salt: salt.toString("base64"), hash: derived.toString("base64") }; }
function verifyPassword(password, stored) { if (stored?.algorithm !== "scrypt") return false; const expected = Buffer.from(stored.hash, "base64"); const actual = crypto.scryptSync(String(password), Buffer.from(stored.salt, "base64"), expected.length); return expected.length === actual.length && crypto.timingSafeEqual(expected, actual); }
function hashToken(token) { return crypto.createHash("sha256").update(String(token ?? "")).digest("hex"); }
function randomToken() { return crypto.randomBytes(32).toString("base64url"); }
function readBearer(req) { const value = String(req?.headers?.authorization ?? "").trim(); return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : ""; }
function publicUser(user) { return { id: user.id, username: user.username, displayName: user.displayName, phoneE164: user.phoneE164 ?? null, role: user.role, status: user.status, mustChangePassword: Boolean(user.mustChangePassword), lockedUntil: user.lockedUntil ?? null }; }
function publicDevice(device) { return { id: device.id, name: device.name, platform: device.platform, hasPushToken: Boolean(device.fcmToken), revokedAt: device.revokedAt, revokeReason: device.revokeReason, lastLoginAt: device.lastLoginAt, updatedAt: device.updatedAt }; }
function normalizeUsername(value) { return clean(value).toLowerCase(); }
function clean(value) { return String(value ?? "").trim(); }
function createId(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`.toUpperCase(); }
function addMinutes(date, minutes) { return new Date(date.getTime() + Number(minutes) * 60_000); }
function addDays(date, days) { return new Date(date.getTime() + Number(days) * 86_400_000); }
function isExpired(value, current) { return !value || new Date(value).getTime() <= current.getTime(); }
function authError(message, statusCode, details = null) { const error = new Error(message); error.statusCode = statusCode; error.details = details; return error; }





function normalizePhone(value) { const phone = clean(value).replace(/[^0-9+]/g, ""); if (!phone) return null; if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw authError("El teléfono debe usar formato internacional E.164", 400); return phone; }

