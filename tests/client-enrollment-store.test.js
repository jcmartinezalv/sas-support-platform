import test from "node:test";
import assert from "node:assert/strict";
import { createClientEnrollmentStore } from "../src/installations/client-enrollment-store.js";

test("client enrollment is hashed, temporary and single use", () => {
  let persisted=[]; const store=createClientEnrollmentStore({onChange:(items)=>persisted=items,ttlMinutes:60});
  const created=store.create({ticketId:"TCK-1",customerPhone:"521555",createdBy:"tech"});
  assert.ok(created.token); assert.match(created.shortCode,/^[A-HJ-NP-Z2-9]{8}$/); assert.equal(store.inspect(created.token).status,"pending"); assert.equal(store.inspect(created.shortCode).status,"pending"); assert.equal(store.inspect(created.shortCode.toLowerCase()).status,"pending");
  assert.equal(persisted[0].token,undefined); assert.notEqual(persisted[0].tokenHash,created.token);
  assert.equal(store.consume(created.shortCode,"agent-1").status,"used");
  assert.equal(store.inspect(created.token).agentId,"agent-1");
  assert.equal(store.inspect("invalid"),null);
});
