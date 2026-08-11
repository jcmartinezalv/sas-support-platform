import test from "node:test";
import assert from "node:assert/strict";
import { buildConsensus, createResearchConsensusService } from "../src/agent/research-consensus-service.js";

function proposal(provider, category = "vpn", overrides = {}) {
  return { provider, model: `${provider}-model`, category, keywords: ["vpn", "conexion"], prerequisites: ["Version"], diagnosticChecks: ["Capturar error"], rollbackSteps: ["Revertir"], riskNotes: ["Revisar"], citations: [{ uri: `https://${provider}.example/doc`, title: "Doc" }], reviewScore: 82, reviewRecommendation: "recommended_for_approval", adminRequired: false, serviceImpact: "Bajo", ...overrides };
}

test("AI consensus recognizes category agreement without merging execution steps", () => {
  const result = buildConsensus({ google: proposal("google"), openai: proposal("openai") }, {}, { subject: "VPN" });
  assert.equal(result.comparison.categoryAgreement, true);
  assert.equal(result.comparison.recommendation, "review_consensus");
  assert.equal(result.status, "pending_review");
  assert.equal(result.approvalRequired, true);
  assert.equal(result.resolutionSteps.length, 1);
  assert.match(result.resolutionSteps[0], /Revisar las propuestas/);
});

test("AI consensus penalizes provider category disagreement", () => {
  const result = buildConsensus({ google: proposal("google", "vpn"), openai: proposal("openai", "firewall_proxy") });
  assert.equal(result.comparison.categoryAgreement, false);
  assert.equal(result.comparison.recommendation, "resolve_provider_disagreement");
  assert.ok(result.reviewScore <= 57);
  assert.match(result.riskNotes.at(-1), /Desacuerdo de categoria/);
});

test("AI consensus keeps partial results when one provider fails", async () => {
  const service = createResearchConsensusService({ googleAiResearchService: { researchTicket: async () => proposal("google") }, openAiResearchService: { researchTicket: async () => { throw new Error("no key"); } } });
  const result = await service.researchTicket({ ticket: { subject: "VPN" } });
  assert.equal(result.comparison.providerCount, 1);
  assert.equal(result.comparison.recommendation, "review_single_provider");
  assert.equal(result.comparison.errors.openai, "no key");
});
