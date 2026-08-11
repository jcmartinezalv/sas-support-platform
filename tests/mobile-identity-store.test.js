import test from "node:test";
import assert from "node:assert/strict";
import { createMobileIdentityStore } from "../src/auth/mobile-identity-store.js";

function request(token) { return { headers: { authorization: `Bearer ${token}` } }; }
function harness() { let persisted = null; const store = createMobileIdentityStore({ onChange: (state) => persisted = state }); return { store, persisted: () => persisted }; }

test("mobile identity bootstraps user and stores derived password", () => {
  const { store, persisted } = harness();
  const user = store.bootstrapUser({ username: "admin.mobile", password: "UnaClaveSegura-2026", displayName: "Admin Movil", role: "admin" });
  assert.equal(user.role, "admin");
  assert.equal(store.hasUsers(), true);
  assert.equal(persisted().users[0].password.algorithm, "scrypt");
  assert.notEqual(persisted().users[0].password.hash, "UnaClaveSegura-2026");
  assert.throws(() => store.bootstrapUser({ username: "otro", password: "OtraClaveSegura-2026" }), /already exist/);
});

test("mobile identity issues hashed device-bound tokens and authenticates actor", () => {
  const { store, persisted } = harness();
  store.bootstrapUser({ username: "tecnico", password: "TecnicoSeguro-2026", role: "technician" });
  const login = store.login({ username: "tecnico", password: "TecnicoSeguro-2026", deviceId: "android-device-0001", deviceName: "Pixel" });
  assert.equal(login.tokenType, "Bearer");
  assert.equal(login.device.id, "android-device-0001");
  assert.ok(!JSON.stringify(persisted().sessions).includes(login.accessToken));
  const actor = store.actorFromRequest(request(login.accessToken));
  assert.equal(actor.role, "technician");
  assert.equal(actor.mobileAuthenticated, true);
});

test("mobile refresh survives retries and briefly preserves requests already in flight", () => {
  let current = new Date("2026-07-28T12:00:00.000Z");
  const store = createMobileIdentityStore({ now: () => new Date(current) });
  store.bootstrapUser({ username: "supervisor", password: "Supervisor-2026-Seguro", role: "supervisor" });
  const login = store.login({ username: "supervisor", password: "Supervisor-2026-Seguro", deviceId: "android-device-0002" });
  assert.throws(() => store.refresh({ refreshToken: login.refreshToken, deviceId: "android-device-wrong" }), /does not belong/);
  const first = store.refresh({ refreshToken: login.refreshToken, deviceId: "android-device-0002" });
  assert.notEqual(first.accessToken, login.accessToken);
  assert.equal(first.refreshToken, login.refreshToken);
  assert.equal(store.actorFromRequest(request(login.accessToken)).role, "supervisor");
  const retry = store.refresh({ refreshToken: login.refreshToken, deviceId: "android-device-0002" });
  assert.notEqual(retry.accessToken, first.accessToken);
  assert.equal(retry.refreshToken, login.refreshToken);
  assert.equal(store.actorFromRequest(request(retry.accessToken)).role, "supervisor");
  current = new Date(current.getTime() + 3 * 60_000);
  assert.equal(store.actorFromRequest(request(login.accessToken)), null);
});
test("mobile device revocation closes all access", () => {
  const { store } = harness();
  const user = store.bootstrapUser({ username: "viewer", password: "Viewer-Seguro-2026", role: "viewer" });
  const login = store.login({ username: "viewer", password: "Viewer-Seguro-2026", deviceId: "android-device-0003" });
  assert.equal(store.revokeDevice({ userId: user.id, deviceId: "android-device-0003", reason: "lost" }), true);
  assert.equal(store.actorFromRequest(request(login.accessToken)), null);
  assert.equal(store.listDevices(user.id)[0].revokeReason, "lost");
});
