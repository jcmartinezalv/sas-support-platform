import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("guided test closes only the remote session and preserves ticket for manual closure", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "server.js"), "utf8");
  const closeBlock = source.match(/if \(session\.status !== "closed"\) \{[\s\S]*?return guidedAutoResult\("close"[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(closeBlock, /remoteSessionStore\.close\(session\.id, actor\.id\)/);
  assert.match(closeBlock, /status: "in_progress"/);
  assert.doesNotMatch(closeBlock, /status: "closed"/);
  assert.match(closeBlock, /permanece abierto/);
});
