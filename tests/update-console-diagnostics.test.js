import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("update console exposes testing channel and updater failure details", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  assert.match(app, /id="updateChannel"/);
  assert.match(app, /value="testing"/);
  assert.match(app, /state\.updateChannel\?\?state\.updates\?\.channel/);
  assert.match(app, /last\.error/);
  assert.match(app, /Detalle del actualizador/);
  assert.match(app, /last\.checks/);
  assert.match(app, /applying: "Aplicando actualización"/);
});

test("staged updater returns a failing exit code after recording an error", () => {
  const script = fs.readFileSync(path.join(process.cwd(), "scripts", "apply-staged-update.ps1"), "utf8");
  assert.match(script, /catch\s*\{\s*\$exitCode\s*=\s*1/i);
  assert.match(script, /Write-Result\s+"fail"/);
  assert.match(script, /exit\s+\$exitCode/i);
});
