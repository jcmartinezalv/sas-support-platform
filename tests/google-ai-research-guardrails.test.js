import test from "node:test";
import assert from "node:assert/strict";
import { classifySourceTrust, rankResearchProposal } from "../src/agent/google-ai-research-service.js";

test("Google research source trust distinguishes official and secondary domains", () => {
  const trust = classifySourceTrust([
    { uri: "https://learn.microsoft.com/windows/" },
    { uri: "https://support.google.com/a/" },
    { uri: "https://example.net/post" },
    { uri: "not-a-url" }
  ]);
  assert.deepEqual(trust, { official: 2, secondary: 1, invalid: 1, total: 3 });
});

test("Google research always requires review and rewards official cited procedures", () => {
  const ranked = rankResearchProposal({
    title: "Corregir sincronizacion OneDrive",
    keywords: ["onedrive", "sincronizacion", "windows"],
    resolutionSteps: ["Confirmar version.", "Revisar estado.", "Aplicar ajuste documentado.", "Validar sincronizacion."],
    rollbackSteps: ["Restaurar la configuracion anterior."],
    riskNotes: ["Puede interrumpir sincronizacion."],
    adminRequired: true,
    citations: [{ uri: "https://learn.microsoft.com/onedrive/" }]
  });
  assert.equal(ranked.approvalRequired, true);
  assert.equal(ranked.sourceTrust.official, 1);
  assert.ok(ranked.reviewSignals.includes("fuente oficial"));
  assert.ok(!ranked.reviewSignals.includes("sin reversión documentada"));
});

test("Google research penalizes risky changes without rollback", () => {
  const ranked = rankResearchProposal({
    title: "Modificar servicio Windows",
    keywords: ["windows", "servicio", "cambio"],
    resolutionSteps: ["Modificar servicio.", "Reiniciar equipo.", "Validar.", "Documentar."],
    rollbackSteps: [],
    riskNotes: [],
    adminRequired: true,
    citations: [{ uri: "https://random-blog.example/fix" }]
  });
  assert.ok(ranked.reviewSignals.includes("sin reversión documentada"));
  assert.ok(ranked.reviewSignals.includes("fuentes secundarias"));
  assert.equal(ranked.approvalRequired, true);
});
