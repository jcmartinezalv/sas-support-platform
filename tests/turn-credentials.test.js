import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createNativeTurnIceServers, createTurnCredentials, createTurnIceServers, turnIsConfigured } from "../src/remote/turn-credentials.js";

const base = {
  webrtcStunUrls: ["stun:stun.example.test:3478"],
  webrtcTurnUrls: ["turn:turn.example.test:3478?transport=udp", "turns:turn.example.test:5349?transport=tcp"],
  webrtcTurnSecret: "test-secret",
  webrtcTurnCredentialTtlSeconds: 600,
  webrtcTurnUsername: "",
  webrtcTurnCredential: ""
};

test("TURN REST credentials are temporary and HMAC authenticated", () => {
  const result = createTurnCredentials(base, "agent-01");
  const expiresAt = Number(result.username.split(":")[0]);
  assert.ok(expiresAt > Math.floor(Date.now() / 1000));
  assert.match(result.username, /:agent-01$/);
  assert.equal(result.credential, crypto.createHmac("sha1", base.webrtcTurnSecret).update(result.username).digest("base64"));
});

test("browser and native ICE receive all TURN routes without exposing the shared secret", () => {
  const browser = createTurnIceServers(base, "session-01");
  assert.equal(browser.length, 2);
  assert.deepEqual(browser[1].urls, base.webrtcTurnUrls);
  assert.ok(browser[1].credential);
  assert.doesNotMatch(JSON.stringify(browser), /test-secret/);
  const native = createNativeTurnIceServers(base, "agent-01");
  assert.equal(native.length, 3);
  assert.match(native[1], /^turn:[^@]+@turn\.example\.test/);
  assert.match(native[2], /^turns:[^@]+@turn\.example\.test/);
});

test("TURN is reported configured only with routes and authentication", () => {
  assert.equal(turnIsConfigured(base), true);
  assert.equal(turnIsConfigured({ ...base, webrtcTurnSecret: "", webrtcTurnUrls: [] }), false);
  assert.equal(turnIsConfigured({ ...base, webrtcTurnSecret: "", webrtcTurnUsername: "sas", webrtcTurnCredential: "secret" }), true);
});