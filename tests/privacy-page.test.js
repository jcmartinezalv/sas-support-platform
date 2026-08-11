import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("privacy page documents WhatsApp, remote consent and data deletion", () => {
  const html = fs.readFileSync(path.join(root, "public", "privacy.html"), "utf8");
  assert.match(html, /Política de privacidad de Fisher SAS/);
  assert.match(html, /WhatsApp Business Platform/);
  assert.match(html, /autorización específica por sesión/);
  assert.match(html, /Acceso, corrección y eliminación de datos/);
  assert.match(html, /id="eliminacion"/);
  assert.match(html, /soporte@setinfo.com.mx/);
});

test("server exposes privacy and data deletion routes", () => {
  const source = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");
  assert.ok(source.includes('"/privacy"'));
  assert.ok(source.includes('"/data-deletion"'));
  assert.ok(source.includes('serveStatic(res, "privacy.html")'));
});