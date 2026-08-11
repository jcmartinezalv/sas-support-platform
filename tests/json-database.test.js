import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJsonDatabase } from "../src/storage/json-database.js";

test("json database exposes storage status and collection counts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sas-db-test-"));
  const filePath = path.join(root, "sas-db.json");
  const backupDir = path.join(root, "backups");
  const db = createJsonDatabase({ filePath, backupDir, backupEveryWrites: 5 });

  db.replace({
    tickets: [{ id: "ticket-1" }],
    remoteSessions: [{ id: "session-1" }],
    agents: [{ id: "agent-1" }],
    auditEvents: [{ id: "audit-1" }],
    knowledgeArticles: [{ id: "article-1" }],
    repairOutcomes: [{ id: "outcome-1" }]
  });

  const status = db.status();

  assert.equal(status.exists, true);
  assert.equal(status.filePath, path.resolve(filePath));
  assert.equal(status.backupDir, path.resolve(backupDir));
  assert.equal(status.collections.tickets, 1);
  assert.equal(status.collections.remoteSessions, 1);
  assert.equal(status.collections.agents, 1);
  assert.equal(status.collections.auditEvents, 1);
  assert.equal(status.collections.knowledgeArticles, 1);
  assert.equal(status.collections.repairOutcomes, 1);
  assert.ok(status.size > 0);
  assert.ok(status.updatedAt);
});

test("json database creates and reports manual backups", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sas-db-backup-test-"));
  const filePath = path.join(root, "sas-db.json");
  const backupDir = path.join(root, "backups");
  const db = createJsonDatabase({ filePath, backupDir, backupEveryWrites: 20 });

  db.replace({ tickets: [{ id: "ticket-1" }] });
  const backupPath = db.backup();
  const status = db.status();

  assert.ok(backupPath);
  assert.equal(fs.existsSync(backupPath), true);
  assert.equal(status.backupCount, 1);
  assert.equal(status.latestBackup.path, backupPath);
  assert.equal(status.lastBackupPath, backupPath);
});

