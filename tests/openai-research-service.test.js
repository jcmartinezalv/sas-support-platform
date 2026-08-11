import test from "node:test";
import assert from "node:assert/strict";
import { buildOpenAiRequest, createOpenAiResearchService, sanitizeResearchInput } from "../src/agent/openai-research-service.js";

const ticket = { id: "TCK-OPENAI", subject: "VPN no conecta", description: "Usuario juan@example.com telefono +52 55 1234 5678 token=abc123" };
const config = { openAiEnabled: true, openAiMock: true, openAiApiKey: "", openAiModel: "gpt-5.6-terra", openAiWebSearch: true, openAiReasoningEffort: "low" };

test("OpenAI research sanitizes personal data and secrets", () => {
  const value = sanitizeResearchInput({ ticket, operatorPrompt: "password=secreto correo admin@example.com" });
  assert.doesNotMatch(JSON.stringify(value), /juan@example|1234 5678|abc123|secreto|admin@example/);
  assert.ok(value.redactionCount >= 5);
  assert.match(value.description, /\[EMAIL\]/);
  assert.match(value.description, /\[PHONE\]/);
  assert.match(value.description, /\[REDACTED\]/);
});

test("OpenAI Responses request uses web search and strict structured output", () => {
  const sanitized = sanitizeResearchInput({ ticket });
  const request = buildOpenAiRequest(sanitized, config);
  assert.equal(request.model, "gpt-5.6-terra");
  assert.deepEqual(request.tools, [{ type: "web_search" }]);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.ok(request.text.format.schema.required.includes("rollbackSteps"));
});

test("OpenAI mock research always produces a reviewed pending proposal", async () => {
  const service = createOpenAiResearchService({ config });
  const proposal = await service.researchTicket({ ticket, operatorPrompt: "revisar sin cambios" });
  assert.equal(proposal.provider, "openai_responses_mock");
  assert.equal(proposal.status, "pending_review");
  assert.equal(proposal.approvalRequired, true);
  assert.equal(proposal.privacy.sanitized, true);
  assert.ok(proposal.rollbackSteps.length > 0);
});

test("OpenAI research refuses real calls without API key", async () => {
  const service = createOpenAiResearchService({ config: { ...config, openAiMock: false } });
  await assert.rejects(() => service.researchTicket({ ticket }), /OPENAI_API_KEY/);
});
