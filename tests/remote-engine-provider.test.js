import test from "node:test";
import assert from "node:assert/strict";
import { buildHopToDeskLaunch, findHopToDeskExecutable, findRustDeskExecutable, inspectRemoteEngine, normalizeRemoteEngine } from "../client/remote-engine-provider.js";

test("remote engine defaults safely to SAS", () => {
  assert.equal(normalizeRemoteEngine("unknown"), "sas");
  const status = inspectRemoteEngine({ preferred: "auto", env: {}, exists: () => false });
  assert.equal(status.selected, "sas");
  assert.equal(status.hopToDesk.installed, false);
});

test("HopToDesk is detected as an isolated optional provider", () => {
  const expected = "C:\\Program Files\\HopToDesk\\HopToDesk.exe";
  const found = findHopToDeskExecutable({ env: { ProgramFiles: "C:\\Program Files" }, exists: (candidate) => candidate === expected });
  assert.equal(found, expected);
  const status = inspectRemoteEngine({ preferred: "auto", configuredPath: expected, env: {}, exists: (candidate) => candidate === expected });
  assert.equal(status.selected, "hoptodesk");
  assert.equal(status.hopToDesk.integrationMode, "isolated_external_provider");
  assert.equal(status.hopToDesk.capabilities.fileTransfer, true);
});

test("launcher validates IDs and never places a password in arguments", () => {
  const executablePath = "C:\\HopToDesk\\HopToDesk.exe";
  const launch = buildHopToDeskLaunch({ executablePath, mode: "files", remoteId: "123456789", exists: () => true });
  assert.deepEqual(launch.args, ["--connect", "hoptodesk://filetransfer/123456789"]);
  assert.throws(() => buildHopToDeskLaunch({ executablePath, remoteId: "bad/id", exists: () => true }), /no es válido/);
});

test("RustDesk is detected only as an isolated diagnostic reference", () => {
  const expected = "C:\\Program Files\\RustDesk\\RustDesk.exe";
  const found = findRustDeskExecutable({ env: { ProgramFiles: "C:\\Program Files" }, exists: (candidate) => candidate === expected });
  assert.equal(found, expected);
  const status = inspectRemoteEngine({ preferred: "sas", configuredRustDeskPath: expected, env: {}, exists: (candidate) => candidate === expected });
  assert.equal(status.selected, "sas");
  assert.equal(status.rustDesk.installed, true);
  assert.equal(status.rustDesk.integrationMode, "isolated_diagnostic_reference");
  assert.equal(status.rustDesk.launchManagedBySas, false);
});
