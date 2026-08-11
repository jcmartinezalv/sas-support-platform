import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createDeploymentCampaignStore } from "../src/installations/deployment-campaign-store.js";

test("deployment campaign enrolls bounded individual machines without exposing its token", () => {
  let persisted = [];
  const store = createDeploymentCampaignStore({ onChange: (items) => persisted = items });
  const created = store.create({ name: "Sucursal Norte", company: "Contoso", maxDevices: 2, createdBy: "admin" });
  assert.ok(created.token.length >= 40);
  assert.equal(store.list()[0].token, undefined);
  assert.equal(store.authorize(created.token, "PC-001").enrolledDevices, 1);
  assert.equal(store.authorize(created.token, "PC-001").enrolledDevices, 1);
  assert.equal(store.authorize(created.token, "PC-002").enrolledDevices, 2);
  assert.throws(() => store.authorize(created.token, "PC-003"), /límite/);
  assert.ok(persisted[0].tokenHash);
  assert.equal(JSON.stringify(persisted).includes(created.token), false);
});

test("revoking a deployment campaign blocks only new enrollment authorization", () => {
  const store = createDeploymentCampaignStore();
  const created = store.create({ name: "Implementación general", company: "Fabrikam", maxDevices: 10 });
  store.authorize(created.token, "PC-A");
  assert.equal(store.revoke(created.id).status, "revoked");
  assert.throws(() => store.authorize(created.token, "PC-B"), /revocada/);
});

test("mass installer and installed client retain association fallback", () => {
  const root = new URL("..", import.meta.url);
  const installer = fs.readFileSync(new URL("installer/windows11/SAS-Cliente.nsi", root), "utf8");
  const script = fs.readFileSync(new URL("scripts/install-client.ps1", root), "utf8");
  const client = fs.readFileSync(new URL("client/agent-client.js", root), "utf8");
  const server = fs.readFileSync(new URL("src/server.js", root), "utf8");
  assert.match(installer, /DEPLOYMENTFILE=/);
  assert.match(installer, /\.sasdeploy/);
  assert.match(script, /SAS Cliente Deployment/);
  assert.match(client, /deploy-enroll/);
  assert.match(client, /associate-enrollment/);
  assert.match(server, /deployment\.campaign_revoked/);
  assert.match(server, /client\.mass_enrolled/);
});