import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const script = fs.readFileSync(path.resolve("scripts/publish-update-to-server.ps1"), "utf8");

test("server publication verifies the package before exposing the manifest", () => {
  assert.match(script, /Get-FileHash[\s\S]+temporaryPackage/);
  assert.match(script, /Move-Item[^\r\n]+targetPackage[\s\S]+Copy-Item[^\r\n]+manifestPath[\s\S]+Move-Item[^\r\n]+targetManifest/);
  assert.match(script, /publicManifestUrl[\s\S]+Invoke-WebRequest/);
});

test("server publication refuses traversal and immutable package replacement", () => {
  assert.match(script, /expectedRelativeUrl/);
  assert.match(script, /no se sobrescribira un paquete inmutable/);
  assert.match(script, /DestinationRoot[\s\S]+recurso compartido/);
  assert.match(script, /isUncShare/);
});