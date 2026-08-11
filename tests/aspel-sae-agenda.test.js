import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCompanyStore } from "../src/contacts/company-store.js";
import { createContactStore } from "../src/contacts/contact-store.js";
import { createAspelSaeService } from "../src/integrations/aspel-sae-service.js";
import { createJsonDatabase } from "../src/storage/json-database.js";

test("Aspel SAE imports legal names and updates duplicates by RFC", async () => {
  const companyStore = createCompanyStore();
  const extractor = async () => ({
    databasePath: "C:\\Aspel\\SAE90EMPRE01.FDB",
    tableNames: ["CLIE01"],
    clients: [
      { externalKey: "1", legalName: "Comercializadora Álamo, S.A. de C.V.", rfc: "CAA010101AAA", phone: "5551002000" },
      { externalKey: "2", legalName: "Servicios del Centro", rfc: "SCE020202BBB" }
    ]
  });
  const service = createAspelSaeService({ companyStore, extractor });
  const preview = await service.preview({ databasePath: "C:\\Aspel\\SAE90EMPRE01.FDB", username: "SYSDBA", password: "secret" });
  assert.equal(preview.detected, 2);
  const first = await service.importClients({ databasePath: "C:\\Aspel\\SAE90EMPRE01.FDB", username: "SYSDBA", password: "secret" });
  assert.equal(first.created, 2);
  const second = await service.importClients({ databasePath: "C:\\Aspel\\SAE90EMPRE01.FDB", username: "SYSDBA", password: "secret" });
  assert.equal(second.created, 0);
  assert.equal(second.updated, 2);
  assert.equal(companyStore.list("alamo").length, 1);
});

test("Agenda assigns an imported company without losing contact data", () => {
  const companyStore = createCompanyStore();
  const imported = companyStore.importMany([{ legalName: "Empresa Uno", rfc: "EUN010101AAA", externalKey: "10" }], { sourceDatabase: "SAE.FDB" }).companies[0];
  const contactStore = createContactStore();
  const contact = contactStore.create({ name: "Ana López", phone: "52551002000", email: "ana@example.com" });
  const assigned = contactStore.update(contact.id, { companyId: imported.id, company: imported.legalName });
  assert.equal(assigned.companyId, imported.id);
  assert.equal(assigned.company, "Empresa Uno");
  assert.equal(assigned.phone, "52551002000");
});

test("JSON database preserves Agenda contacts and imported companies after restart", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sas-aspel-db-"));
  const filePath = path.join(root, "sas-db.json");
  const backupDir = path.join(root, "backups");
  const db = createJsonDatabase({ filePath, backupDir });
  db.replace({ ...db.data(), contacts: [{ id: "CNT-1", name: "Ana" }], companies: [{ id: "CMP-1", legalName: "Empresa Uno" }] });
  const reloaded = createJsonDatabase({ filePath, backupDir }).data();
  assert.equal(reloaded.contacts[0].name, "Ana");
  assert.equal(reloaded.companies[0].legalName, "Empresa Uno");
  fs.rmSync(root, { recursive: true, force: true });
});

test("Agenda UI exposes read-only Aspel import and manual company assignment", () => {
  const html = fs.readFileSync(path.resolve("public/index.html"), "utf8");
  const app = fs.readFileSync(path.resolve("public/app.js"), "utf8");
  const script = fs.readFileSync(path.resolve("scripts/read-aspel-sae-clients.ps1"), "utf8");
  assert.match(html, /Importar empresas desde Aspel SAE/);
  assert.match(html, /assignContactCompany/);
  assert.match(app, /\/api\/companies\/aspel\/preview/);
  assert.match(app, /\/api\/companies\/aspel\/import/);
  assert.match(app, /\/company`, \{ method: "PATCH"/);
  assert.match(script, /RDB`\$RELATIONS/);
  assert.match(script, /WHERE \$nameField IS NOT NULL/);
  assert.doesNotMatch(script, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
});
