import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORT_TAXONOMY, findSupportCategory, getSupportCategory } from "../src/agent/support-taxonomy.js";

test("support taxonomy contains 25 unique operational categories", () => {
  assert.equal(SUPPORT_TAXONOMY.length, 25);
  assert.equal(new Set(SUPPORT_TAXONOMY.map((item) => item.id)).size, 25);
  assert.ok(SUPPORT_TAXONOMY.every((item) => item.family && item.keywords.length >= 5 && item.safeChecks.length >= 2));
});

test("support taxonomy prioritizes critical security signals", () => {
  const match = findSupportCategory("Recibi un correo sospechoso de phishing y temo robo de cuenta");
  assert.equal(match.id, "security");
  assert.equal(match.critical, true);
  assert.equal(match.shouldEscalate, true);
});

test("support taxonomy recognizes infrastructure and endpoint incidents", () => {
  assert.equal(findSupportCategory("La VPN de Forticlient no conecta").id, "vpn");
  assert.equal(findSupportCategory("Windows Update muestra error de actualizacion").id, "windows_update");
  assert.equal(findSupportCategory("Una GPO no se aplica en Active Directory").id, "active_directory");
  assert.equal(getSupportCategory("certificates").family, "Seguridad");
});
