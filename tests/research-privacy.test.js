import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeResearchInput, sanitizedTicket } from "../src/agent/research-privacy.js";
import { createGoogleAiResearchService } from "../src/agent/google-ai-research-service.js";

test("shared research privacy sanitizes both provider inputs", () => {
  const ticket = { id: "TCK-P", subject: "Cuenta ana@example.com", description: "Llamar +52 55 2222 3333 token=xyz" };
  const value = sanitizeResearchInput({ ticket, operatorPrompt: "password=hola" });
  assert.equal(value.redactionCount, 4);
  assert.doesNotMatch(JSON.stringify(value), /ana@example|2222 3333|xyz|hola/);
  const safe = sanitizedTicket(ticket, value);
  assert.deepEqual(Object.keys(safe), ["id", "subject", "description", "source", "priority"]);
});

test("Google AI mock research reports shared privacy redactions", async () => {
  const service = createGoogleAiResearchService({ config: { googleAiEnabled: true, googleAiMock: true, googleAiModel: "gemini-mock", googleAiRequireReview: true } });
  const proposal = await service.researchTicket({ ticket: { id: "TCK-G", subject: "VPN", description: "correo a@example.com token=abc" } });
  assert.equal(proposal.status, "pending_review");
  assert.equal(proposal.privacy.sanitized, true);
  assert.equal(proposal.privacy.redactionCount, 2);
  assert.doesNotMatch(proposal.title, /a@example|abc/);
});
