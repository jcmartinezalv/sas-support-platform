import test from "node:test";
import assert from "node:assert/strict";
import { createMobileIdentityStore } from "../src/auth/mobile-identity-store.js";

const request = (token) => ({ headers: { authorization: `Bearer ${token}` } });

test("new managed mobile users must change their temporary password", () => {
  const store = createMobileIdentityStore();
  store.bootstrapUser({ username: "admin", password: "admin-password-123", role: "admin" });
  const user = store.createUser({ username: "tecnico", password: "temporary-pass-123", role: "technician" });
  const login = store.login({ username: "tecnico", password: "temporary-pass-123", deviceId: "android-temp-001" });
  assert.equal(user.mustChangePassword, true);
  assert.equal(login.user.mustChangePassword, true);
  assert.equal(store.actorFromRequest(request(login.accessToken)).mustChangePassword, true);
});

test("changing a temporary password clears the requirement and revokes the current session", () => {
  const store = createMobileIdentityStore();
  store.bootstrapUser({ username: "admin", password: "admin-password-123", role: "admin" });
  store.createUser({ username: "tecnico", password: "temporary-pass-123", role: "technician" });
  const login = store.login({ username: "tecnico", password: "temporary-pass-123", deviceId: "android-temp-002" });
  const changed = store.changePassword({ accessToken: login.accessToken, currentPassword: "temporary-pass-123", newPassword: "definitive-pass-456" });
  assert.equal(changed.user.mustChangePassword, false);
  assert.equal(store.actorFromRequest(request(login.accessToken)), null);
  const next = store.login({ username: "tecnico", password: "definitive-pass-456", deviceId: "android-temp-002" });
  assert.equal(next.user.mustChangePassword, false);
});

test("mobile account locks temporarily after repeated failed passwords", () => {
  let current = new Date("2026-07-12T12:00:00Z");
  const store = createMobileIdentityStore({ now: () => current, maxFailedAttempts: 3, lockMinutes: 10 });
  store.bootstrapUser({ username: "admin", password: "admin-password-123", role: "admin" });
  for (let attempt = 0; attempt < 3; attempt += 1) assert.throws(() => store.login({ username: "admin", password: "wrong-password", deviceId: "android-lock-001" }), /Invalid/);
  assert.throws(() => store.login({ username: "admin", password: "admin-password-123", deviceId: "android-lock-001" }), (error) => error.statusCode === 429);
  current = new Date("2026-07-12T12:11:00Z");
  assert.doesNotThrow(() => store.login({ username: "admin", password: "admin-password-123", deviceId: "android-lock-001" }));
});

test("password recovery links survive a store restart", () => {
  let snapshot;
  const first = createMobileIdentityStore({ onChange: (value) => { snapshot = value; } });
  first.bootstrapUser({ username: "recovery-user", password: "initial-password-123", phoneE164: "+5215551234567", role: "viewer" });
  const requested = first.requestPasswordReset({ phoneE164: "+5215551234567" });
  assert.ok(requested.token);
  assert.equal(snapshot.recoveryTokens.length, 1);

  const restored = createMobileIdentityStore({
    initialUsers: snapshot.users,
    initialDevices: snapshot.devices,
    initialSessions: snapshot.sessions,
    initialRecoveryTokens: snapshot.recoveryTokens
  });
  const consumed = restored.consumePasswordReset({ token: requested.token, password: "replacement-password-456" });
  assert.equal(consumed.sessionsRevoked, true);
});
