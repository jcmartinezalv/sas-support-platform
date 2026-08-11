import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("bundled WebRTC runtime negotiates a binary SAS data channel", () => {
  const runtime = path.join(process.cwd(), "client", "webrtc-runtime", "node_modules", "node-datachannel", "package.json");
  assert.equal(fs.existsSync(runtime), true, "node-datachannel must be included in SAS Cliente");
  const result = spawnSync(process.execPath, [path.join(process.cwd(), "tests", "webrtc-runtime-probe.mjs")], { encoding: "utf8", timeout: 12000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /WEBRTC_LOCAL_OK/);
});

test("WebRTC transport retains HTTPS fallback and validates signaling", () => {
  const workspace = fs.readFileSync(path.join(process.cwd(), "public", "remote-workspace.html"), "utf8");
  const agent = fs.readFileSync(path.join(process.cwd(), "client", "agent-client.js"), "utf8");
  const server = fs.readFileSync(path.join(process.cwd(), "src", "server.js"), "utf8");
  for (const marker of ["createDataChannel('sas-screen'", "createDataChannel('sas-control'", "rtcControlChannel.send", "sas_pointer_move", "remotePointerCoordinates", "receiveRtcPacket", "sas_video_feedback", "rtcIncompleteFrames", "adaptiveMode", "lastRtcFrameAt<2500", "respaldo HTTPS"]) assert.match(workspace, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const marker of ["node-datachannel", "sendWebRtcFrame", "handleWebRtcControlMessage", "sas_control_event", "sas_pointer_move", "requestNativeHelper", "persistentCapture", "SASF", "security_status", "latestHttpsFrameAtBySession", "datachannel_backpressure", "adaptiveScreenPlan", "viewerFeedback", "screenTelemetry"]) assert.match(agent, new RegExp(marker));
  assert.match(server, /webrtc_datachannel_with_https_fallback/);
  assert.match(workspace, /rtcPendingLocalCandidates/);
  assert.match(workspace, /entry\.received!==total/);
  assert.match(workspace, /URL\.createObjectURL/);
  assert.doesNotMatch(workspace, /entry\.chunks\.some/);
  const scriptStart = workspace.lastIndexOf("<script>") + 8;
  const scriptEnd = workspace.indexOf("</script>", scriptStart);
  assert.doesNotThrow(() => new Function(workspace.slice(scriptStart, scriptEnd)));
  assert.match(server, /candidate.*slice\(0, 4096\)/s);
  assert.match(server, /sdp.*slice\(0, 200000\)/s);
});
test("WebRTC frame assembler waits for every unordered chunk", () => {
  const workspace = fs.readFileSync(path.join(process.cwd(), "public", "remote-workspace.html"), "utf8");
  const source = workspace.match(/function receiveRtcPacket\(value\)\{.*?(?=function setTransportStatus)/s)?.[0];
  assert.ok(source, "receiveRtcPacket must be present");
  const factory = new Function(`let rtcLatestFrameId=0;const rtcFrames=new Map();let captured=null;function renderRtcFrame(metadata,image){captured={metadata,image};}${source};return {receiveRtcPacket,getCaptured:()=>captured};`);
  const runtime = factory();
  function packet(index, payload, metadata = null) {
    const meta = metadata ? Buffer.from(JSON.stringify(metadata)) : Buffer.alloc(0);
    const result = Buffer.alloc(16 + meta.length + payload.length);
    result.write("SASF", 0, 4, "ascii"); result.writeUInt32BE(7, 4); result.writeUInt16BE(index, 8); result.writeUInt16BE(2, 10); result.writeUInt32BE(meta.length, 12); meta.copy(result, 16); payload.copy(result, 16 + meta.length);
    return result;
  }
  runtime.receiveRtcPacket(packet(1, Buffer.from("world")));
  assert.equal(runtime.getCaptured(), null);
  runtime.receiveRtcPacket(packet(0, Buffer.from("hello "), { mimeType: "image/jpeg", capturedAt: "2026-07-28T00:00:00.000Z" }));
  const captured = runtime.getCaptured();
  assert.ok(captured);
  assert.equal(Buffer.from(captured.image).toString(), "hello world");
});

test("WebRTC frame assembler preserves interleaved unordered frames", () => {
  const workspace = fs.readFileSync(path.join(process.cwd(), "public", "remote-workspace.html"), "utf8");
  const source = workspace.match(/function receiveRtcPacket\(value\)\{.*?(?=function setTransportStatus)/s)?.[0];
  const factory = new Function(`let rtcLatestFrameId=0;const rtcFrames=new Map();const captured=[];function renderRtcFrame(metadata,image){captured.push({metadata,image});}${source};return {receiveRtcPacket,getCaptured:()=>captured};`);
  const runtime = factory();
  function packet(id, index, payload, metadata = null) {
    const meta = metadata ? Buffer.from(JSON.stringify(metadata)) : Buffer.alloc(0);
    const result = Buffer.alloc(16 + meta.length + payload.length);
    result.write("SASF", 0, 4, "ascii"); result.writeUInt32BE(id, 4); result.writeUInt16BE(index, 8); result.writeUInt16BE(2, 10); result.writeUInt32BE(meta.length, 12); meta.copy(result, 16); payload.copy(result, 16 + meta.length);
    return result;
  }
  runtime.receiveRtcPacket(packet(7, 0, Buffer.from("old "), { sequence: 7 }));
  runtime.receiveRtcPacket(packet(8, 0, Buffer.from("new "), { sequence: 8 }));
  runtime.receiveRtcPacket(packet(7, 1, Buffer.from("frame")));
  runtime.receiveRtcPacket(packet(8, 1, Buffer.from("frame")));
  assert.deepEqual(runtime.getCaptured().map(item => item.metadata.sequence), [7, 8]);
  assert.equal(Buffer.from(runtime.getCaptured()[1].image).toString(), "new frame");
});
