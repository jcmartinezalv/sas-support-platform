import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHopToDeskLaunch,
  buildRemoteEngineLaunch,
  buildRustDeskLaunch,
  findHopToDeskExecutable,
  findRustDeskExecutable,
  inspectRemoteEngine,
  normalizeRemoteEngine
} from "../client/remote-engine-provider.js";

test("remote engine defaults safely to SAS", () => {
  assert.equal(normalizeRemoteEngine("unknown"), "sas");
  assert.equal(normalizeRemoteEngine("RustDesk"), "rustdesk");
  const status = inspectRemoteEngine({ preferred: "auto", env: {}, exists: () => false });
  assert.equal(status.selected, "sas");
  assert.equal(status.hopToDesk.installed, false);
  assert.equal(status.rustDesk.installed, false);
});

test("auto prefers RustDesk and falls back to HopToDesk", () => {
  const rustDesk = "C:\\Program Files\\RustDesk\\RustDesk.exe";
  const hopToDesk = "C:\\Program Files\\HopToDesk\\HopToDesk.exe";
  const both = inspectRemoteEngine({
    preferred: "auto",
    configuredPath: hopToDesk,
    configuredRustDeskPath: rustDesk,
    env: {},
    exists: () => true
  });
  assert.equal(both.selected, "rustdesk");
  const hopOnly = inspectRemoteEngine({
    preferred: "auto",
    configuredPath: hopToDesk,
    configuredRustDeskPath: rustDesk,
    env: {},
    exists: (candidate) => candidate === hopToDesk
  });
  assert.equal(hopOnly.selected, "hoptodesk");
});

test("HopToDesk is detected as an isolated optional provider", () => {
  const expected = "C:\\Program Files\\HopToDesk\\HopToDesk.exe";
  const found = findHopToDeskExecutable({ env: { ProgramFiles: "C:\\Program Files" }, exists: (candidate) => candidate === expected });
  assert.equal(found, expected);
  const status = inspectRemoteEngine({ preferred: "hoptodesk", configuredPath: expected, env: {}, exists: (candidate) => candidate === expected });
  assert.equal(status.selected, "hoptodesk");
  assert.equal(status.hopToDesk.integrationMode, "isolated_external_provider");
  assert.equal(status.hopToDesk.launchManagedBySas, true);
  assert.equal(status.hopToDesk.capabilities.fileTransfer, true);
});

test("RustDesk is a launchable isolated provider", () => {
  const expected = "C:\\Program Files\\RustDesk\\RustDesk.exe";
  const found = findRustDeskExecutable({ env: { ProgramFiles: "C:\\Program Files" }, exists: (candidate) => candidate === expected });
  assert.equal(found, expected);
  const status = inspectRemoteEngine({ preferred: "rustdesk", configuredRustDeskPath: expected, env: {}, exists: (candidate) => candidate === expected });
  assert.equal(status.selected, "rustdesk");
  assert.equal(status.rustDesk.integrationMode, "isolated_external_provider");
  assert.equal(status.rustDesk.launchManagedBySas, true);
  assert.equal(status.rustDesk.pinnedVersion, "1.4.9");
  assert.equal(status.rustDesk.license, "AGPL-3.0");
});

test("launchers use the upstream connect and file-transfer commands", () => {
  const rustDesk = buildRustDeskLaunch({ executablePath: "C:\\RustDesk\\RustDesk.exe", mode: "desktop", remoteId: "123456789", exists: () => true });
  assert.deepEqual(rustDesk.args, ["--connect", "123456789"]);
  const hopToDesk = buildHopToDeskLaunch({ executablePath: "C:\\HopToDesk\\HopToDesk.exe", mode: "files", remoteId: "ABC-123", exists: () => true });
  assert.deepEqual(hopToDesk.args, ["--file-transfer", "ABC-123"]);
});

test("launcher rejects invalid providers, IDs, modes and passwords in arguments", () => {
  const executablePath = "C:\\RustDesk\\RustDesk.exe";
  assert.throws(() => buildRemoteEngineLaunch({ provider: "unknown", executablePath, remoteId: "123", exists: () => true }), /proveedor remoto/);
  assert.throws(() => buildRustDeskLaunch({ executablePath, remoteId: "bad/id", exists: () => true }), /no es válido/);
  assert.throws(() => buildRustDeskLaunch({ executablePath, remoteId: "123", mode: "shell", exists: () => true }), /función solicitada/);
  const launch = buildRustDeskLaunch({ executablePath, remoteId: "123456789", exists: () => true });
  assert.equal(launch.args.includes("--password"), false);
});
