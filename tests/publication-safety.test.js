import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("public repository gate excludes secrets, operational data and generated binaries", () => {
  const ignore = fs.readFileSync(".gitignore", "utf8");
  const gate = fs.readFileSync("scripts/test-publication-safety.mjs", "utf8");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(pkg.license, "AGPL-3.0-only");
  assert.equal(pkg.scripts["audit:publication"], "node scripts/test-publication-safety.mjs");
  for (const pattern of [".env.*", "agent-identity.json", "certs/", "data/", "dist/", "updates/", "*.exe", "*.dll", "*.zip", "tools/clamav/*", "tools/coturn/*"]) assert.match(ignore, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(gate, /forbiddenRoots/);
  assert.match(gate, /forbiddenExtensions/);
  assert.match(gate, /OPEN-SOURCE-PUBLICATION/);
});
