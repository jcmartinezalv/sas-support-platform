import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (...parts) => fs.readFileSync(path.resolve(...parts), "utf8");

test("server refuses a client installer whose manifest, size or hash do not match", () => {
  const source = read("src", "server.js");
  assert.match(source, /function readClientInstallerMetadata\(\)/);
  assert.match(source, /canonicalPath = path\.resolve\(projectRoot, "downloads", "SAS-Cliente-Setup\.exe"\)/);
  assert.match(source, /readClientInstallerCandidateMetadata/);
  assert.match(source, /manifest\.compiler !== "NSIS"/);
  assert.match(source, /Number\(manifest\.size\) !== stat\.size/);
  assert.match(source, /declaredHash !== actualHash/);
  assert.match(source, /version: installer\.version/);
  assert.match(source, /"X-SAS-SHA256": metadata\.sha256/);
});

test("release build blocks parallel packaging and rejects a stale client manifest", () => {
  const builder = read("scripts", "build-windows11-final-installer.ps1");
  const validator = read("scripts", "test-windows11-final-package.ps1");
  assert.match(builder, /Global\\SASReleaseBuild/);
  assert.match(builder, /clientInstallerManifest\.version/);
  assert.match(builder, /clientInstallerManifest\.sha256/);
  assert.match(builder, /clientInstallerSidecarPath/);
  assert.match(builder, /Copy-Item -LiteralPath \$clientInstallerSidecarPath/);
  assert.match(validator, /embedded_client_alignment/);
  assert.match(validator, /nsis_archive_integrity/);
  assert.match(validator, /7-Zip\\7z\.exe/);
  const updater = read("scripts", "update-server-deployment.ps1");
  const publisher = read("scripts", "publish-update-channel.mjs");
  assert.match(updater, /downloads\\SAS-Cliente-Setup\.exe/);
  assert.match(updater, /clientManifest\.sha256/);
  assert.match(publisher, /downloads\/SAS-Cliente-Setup\.exe\.manifest\.json/);
});
