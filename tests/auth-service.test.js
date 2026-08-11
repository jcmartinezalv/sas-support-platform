import test from "node:test";
import assert from "node:assert/strict";
import { createAuthService } from "../src/auth/auth-service.js";

function req(headers = {}) {
  return { headers };
}

test("auth service allows local console without configured token", () => {
  const auth = createAuthService();
  const actor = auth.actorFromRequest(req({ "x-sas-role": "admin", "x-sas-actor": "tester" }));

  assert.equal(actor.role, "admin");
  assert.doesNotThrow(() => auth.require(actor, "audit:read"));
});

test("auth service rejects protected console calls without token", () => {
  const auth = createAuthService({ consoleToken: "secret-console" });
  const actor = auth.actorFromRequest(req({ "x-sas-role": "admin" }));

  assert.equal(actor.consoleTokenValid, false);
  assert.throws(() => auth.require(actor, "audit:read"), (error) => {
    assert.match(error.message, /Console token required/);
    assert.equal(error.statusCode, 401);
    assert.equal(error.authFailure.reason, "console_token_required");
    assert.equal(error.authFailure.permission, "audit:read");
    return true;
  });
});

test("auth service accepts configured console token", () => {
  const auth = createAuthService({ consoleToken: "secret-console" });
  const actor = auth.actorFromRequest(req({ "x-sas-role": "admin", "x-sas-console-token": "secret-console" }));

  assert.equal(actor.consoleTokenValid, true);
  assert.doesNotThrow(() => auth.require(actor, "audit:read"));
});

test("auth service accepts bearer console token", () => {
  const auth = createAuthService({ consoleToken: "secret-console" });
  const actor = auth.actorFromRequest(req({ "x-sas-role": "admin", authorization: "Bearer secret-console" }));

  assert.equal(actor.consoleTokenValid, true);
  assert.doesNotThrow(() => auth.require(actor, "audit:read"));
});

test("auth service marks permission denial for audit", () => {
  const auth = createAuthService();
  const actor = auth.actorFromRequest(req({ "x-sas-role": "viewer", "x-sas-actor": "viewer-1" }));

  assert.throws(() => auth.require(actor, "audit:read"), (error) => {
    assert.match(error.message, /Permission denied/);
    assert.equal(error.statusCode, 403);
    assert.equal(error.authFailure.reason, "permission_denied");
    assert.equal(error.authFailure.permission, "audit:read");
    assert.equal(error.authFailure.actorId, "viewer-1");
    return true;
  });
});


test("only administrators and supervisors can authorize unattended support", () => {
  const auth = createAuthService();
  for (const role of ["admin", "supervisor"]) {
    const actor = auth.actorFromRequest(req({ "x-sas-role": role }));
    assert.doesNotThrow(() => auth.require(actor, "remote:unattended"));
  }
  for (const role of ["technician", "viewer"]) {
    const actor = auth.actorFromRequest(req({ "x-sas-role": role }));
    assert.throws(() => auth.require(actor, "remote:unattended"), (error) => error.statusCode === 403);
  }
});