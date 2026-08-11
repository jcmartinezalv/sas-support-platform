import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";

function createApprovedActiveSession() {
  const store = createRemoteSessionStore({ security: { ttlMinutes: 60 } });
  const session = store.create({ ticketId: "TCK-SCREEN", requestedBy: "test", customerPhone: "5215550000000" });
  store.assignAgent(session.id, "agent-1");
  store.approveConsent(session.joinCode, { decidedBy: "customer" });
  store.start(session.id, "operator");
  return { store, session: store.get(session.id) };
}

test("low latency screen share queues lightweight frames and records latency", async () => {
  const { store, session } = createApprovedActiveSession();

  const started = store.startScreenShare(session.id, "operator", {
    intervalSeconds: 1,
    quality: 45,
    maxWidth: 960,
    profile: "lowLatency"
  });

  assert.equal(started.screenShare.enabled, true);
  assert.equal(started.screenShare.intervalSeconds, 1);
  assert.equal(started.screenShare.quality, 45);
  assert.equal(started.screenShare.maxWidth, 960);
  assert.equal(started.screenShare.profile, "lowLatency");

  const pending = store.pendingForAgent("agent-1");
  const queuedSession = pending.find((item) => item.id === session.id);
  const command = queuedSession.commands.find((item) => item.purpose === "screen_share");

  assert.equal(command.type, "screenshot_preview");
  assert.deepEqual(command.captureOptions, { quality: 45, maxWidth: 960, monitorIndex: 0, nativeResolution: false });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const { session: completed } = store.completeCommand(session.id, command.id, {
    ok: true,
    data: {
      mimeType: "image/jpeg",
      imageBase64: "ZmFrZS1mcmFtZQ==",
      width: 960,
      height: 540,
      capturedAt: new Date().toISOString()
    }
  });

  assert.equal(completed.screenShare.lastFrame.width, 960);
  assert.equal(completed.screenShare.lastFrameAt, completed.updatedAt);
  assert.equal(typeof completed.screenShare.lastFrameLatencyMs, "number");
  assert.ok(completed.screenShare.lastFrameLatencyMs >= 0);
});
test("screen share keeps explicit low latency profile", async () => {
  const store = createRemoteSessionStore({ persist: () => {} });
  const session = store.create({ ticketId: "TCK-PROFILE", requestedBy: "operator", agentId: "agent-1" });
  store.approveConsent(session.joinCode, { decidedBy: "customer" });
  store.start(session.id, "operator");

  const started = store.startScreenShare(session.id, "operator", {
    intervalSeconds: 1,
    quality: 45,
    maxWidth: 960,
    profile: "lowLatency"
  });

  assert.equal(started.screenShare.profile, "lowLatency");
  assert.equal(started.screenShare.intervalSeconds, 1);
  assert.equal(started.screenShare.quality, 45);
  assert.equal(started.screenShare.maxWidth, 960);
});

test("file transfers preserve chunk metadata and release uploaded payloads", () => {
  const { store, session } = createApprovedActiveSession();
  const upload = store.queueCommand(session.id, {
    type: "file_upload_chunk",
    fileTransfer: { transferId: "transfer_1", name: "evidencia.bin", index: 2, total: 4, dataBase64: "ZmFrZQ==" }
  });
  assert.equal(upload.fileTransfer.transferId, "transfer_1");
  assert.equal(upload.fileTransfer.index, 2);
  assert.equal(upload.fileTransfer.total, 4);
  store.completeCommand(session.id, upload.id, { ok: true, data: { complete: false } });
  assert.equal(store.get(session.id).commands.find((item) => item.id === upload.id).fileTransfer.dataBase64, null);

  const download = store.queueCommand(session.id, {
    type: "file_download_chunk",
    fileTransfer: { path: "inbound/evidencia.bin", offset: 1048576, maxBytes: 1048576 }
  });
  assert.equal(download.fileTransfer.path, "inbound/evidencia.bin");
  assert.equal(download.fileTransfer.offset, 1048576);
});

test("screen share preserves monitor and native resolution for the agent", () => {
  const { store, session } = createApprovedActiveSession();
  store.startScreenShare(session.id, "operator", { intervalSeconds: 0.5, quality: 70, maxWidth: 2560, monitorIndex: 2, nativeResolution: true, profile: "lowLatency" });
  const queued = store.pendingForAgent("agent-1").find((item) => item.id === session.id).commands.find((item) => item.purpose === "screen_share");
  assert.equal(store.get(session.id).screenShare.monitorIndex, 2);
  assert.equal(store.get(session.id).screenShare.nativeResolution, true);
  assert.deepEqual(queued.captureOptions, { quality: 70, maxWidth: 2560, monitorIndex: 2, nativeResolution: true });
});

test("remote file manager preserves an absolute Windows path and upload destination", () => {
  const { store, session } = createApprovedActiveSession();
  const listing = store.queueCommand(session.id, { type: "file_list", fileTransfer: { path: "C:\\Users\\Cliente\\Documents" } });
  assert.equal(listing.fileTransfer.path, "C:/Users/Cliente/Documents");
  const upload = store.queueCommand(session.id, { type: "file_upload_chunk", fileTransfer: { transferId: "files_1", name: "reporte.txt", targetDirectory: "D:\\Soporte", index: 0, total: 1, dataBase64: "dGVzdA==" } });
  assert.equal(upload.fileTransfer.targetDirectory, "D:/Soporte");
});
test("direct frame push updates the live frame without persisting a command result", () => {
  const { store, session } = createApprovedActiveSession();
  store.startScreenShare(session.id, "operator", { intervalSeconds: 0.25, quality: 50, maxWidth: 1440, profile: "lowLatency" });
  const published = store.publishScreenFrame(session.id, "agent-1", { mimeType: "image/jpeg", imageBase64: "ZnJhbWU=", width: 1440, height: 810, capturedAt: new Date().toISOString() });
  assert.equal(published.frame.width, 1440);
  assert.equal(store.get(session.id).screenShare.lastFrame.imageBase64, "ZnJhbWU=");
  const pending = store.pendingForAgent("agent-1").find((item) => item.id === session.id);
  assert.equal(pending.screenShare.lastFrame, null);
  assert.equal(pending.commands.some((item) => item.purpose === "screen_share"), false);
});