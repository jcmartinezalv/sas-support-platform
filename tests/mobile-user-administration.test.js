import test from "node:test";
import assert from "node:assert/strict";
import { createMobileIdentityStore } from "../src/auth/mobile-identity-store.js";

test("mobile administrators can list and update users without exposing password hashes", () => {
  const store = createMobileIdentityStore();
  const user = store.bootstrapUser({ username: "admin", password: "long-password-123", role: "admin" });
  store.createUser({ username: "tecnico", password: "another-long-123", role: "viewer" });
  assert.equal(store.listUsers().length, 2);
  assert.equal(store.listUsers()[0].password, undefined);
  assert.equal(store.updateUser({ userId: user.id, displayName: "Administrador", role: "supervisor" }).role, "supervisor");
});

test("disabling a mobile user immediately revokes active sessions and devices", () => {
  const store = createMobileIdentityStore();
  const user = store.bootstrapUser({ username: "admin", password: "long-password-123", role: "admin" });
  const login = store.login({ username: "admin", password: "long-password-123", deviceId: "device-12345" });
  store.updateUser({ userId: user.id, status: "disabled" });
  assert.equal(store.actorFromRequest({ headers: { authorization: `Bearer ${login.accessToken}` } }), null);
  assert.ok(store.snapshot().devices[0].revokedAt);
});

test("password reset revokes old access and accepts only the new password", () => {
  const store = createMobileIdentityStore();
  const user = store.bootstrapUser({ username: "admin", password: "long-password-123", role: "admin" });
  const login = store.login({ username: "admin", password: "long-password-123", deviceId: "device-12345" });
  store.resetPassword({ userId: user.id, password: "new-long-password-456" });
  assert.equal(store.actorFromRequest({ headers: { authorization: `Bearer ${login.accessToken}` } }), null);
  assert.throws(() => store.login({ username: "admin", password: "long-password-123", deviceId: "device-12345" }), /Invalid/);
  assert.doesNotThrow(() => store.login({ username: "admin", password: "new-long-password-456", deviceId: "device-67890" }));
});
