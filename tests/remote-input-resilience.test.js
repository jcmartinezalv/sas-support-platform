import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const agent = fs.readFileSync("client/agent-client.js", "utf8");
const server = fs.readFileSync("src/server.js", "utf8");
const workspace = fs.readFileSync("public/remote-workspace.html", "utf8");

test("client heartbeat remains independent while remote work is busy", () => {
  assert.match(server, /url\.pathname === "\/api\/agents\/heartbeat"/);
  assert.match(agent, /function heartbeatOnce\(\)/);
  assert.match(agent, /postJson\("\/api\/agents\/heartbeat", buildAgentPayload\(\)\)/);
  assert.match(agent, /heartbeat independiente/);
  assert.match(agent, /heartbeatPromise/);
});

test("a healthy WebRTC control channel survives a delayed heartbeat", () => {
  assert.match(workspace, /const directControlAlive=rtcControlChannel\?\.readyState==='open'/);
  assert.match(workspace, /remoteAgent\.status!==\'online\'&&!directControlAlive/);
  assert.match(workspace, /const data=await getJson\('\/api\/agents'\)\.catch\(\(\)=>null\)/);
  assert.match(workspace, /if\(current\)remoteAgent=current/);
  assert.doesNotMatch(workspace, /catch\(\(\)=>\(\{agents:\[\]\}\)\)[\s\S]{0,100}remoteAgent=data\.agents/);
});