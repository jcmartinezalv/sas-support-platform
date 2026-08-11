import test from "node:test";
import assert from "node:assert/strict";
import { buildImageAnalysisRequest, createImageAnalysisService } from "../src/agent/image-analysis-service.js";

test("Fisher image analysis sends structured multimodal input and returns no original bytes", async () => {
  let request;
  const service = createImageAnalysisService({
    config: {
      fisherVisionEnabled: true,
      fisherVisionModel: "gpt-test",
      fisherVisionMaxImages: 3,
      whatsappMediaMaxBytes: 1024,
      openAiApiKey: "secret",
      openAiReasoningEffort: "low"
    },
    whatsappClient: {
      async downloadImage(id) { return { mediaId: id, bytes: Buffer.from("image"), mimeType: "image/png", size: 5, sha256: "safehash" }; }
    },
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        async json() {
          return { output_text: JSON.stringify({ summary: "Error de conexión visible.", visibleText: ["Sin conexión"], likelyCauses: ["Red"], safeChecks: ["Revisar cable"], riskSignals: [], needsHuman: true, urgency: "high", confidence: 0.9 }) };
        }
      };
    }
  });

  const result = await service.analyzeWhatsAppAttachments({ attachments: [{ id: "M1", type: "image" }], ticket: { id: "T1", subject: "Sin red" } });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.body.input[0].content[1].type, "input_image");
  assert.equal(request.body.input[0].content[1].image_url.startsWith("data:image/png;base64,"), true);
  assert.equal(request.body.text.format.type, "json_schema");
  assert.equal(result.needsHuman, true);
  assert.equal(result.totalBytes, 5);
  assert.equal("bytes" in result, false);
});

test("image analysis is unavailable without exposing or downloading media when no API key exists", async () => {
  let downloaded = false;
  const service = createImageAnalysisService({
    config: { fisherVisionEnabled: true, fisherVisionMock: false, fisherVisionMaxImages: 3 },
    whatsappClient: { async downloadImage() { downloaded = true; } }
  });
  const result = await service.analyzeWhatsAppAttachments({ attachments: [{ id: "M1", type: "image" }], ticket: { id: "T1" } });
  assert.equal(result.status, "unavailable");
  assert.equal(downloaded, false);
});

test("image analysis request identifies image content as untrusted evidence", () => {
  const body = buildImageAnalysisRequest({
    downloads: [{ bytes: Buffer.from("x"), mimeType: "image/jpeg" }],
    ticket: { id: "T1", subject: "Captura" },
    config: { fisherVisionModel: "gpt-test" }
  });
  assert.match(body.input[0].content[0].text, /no son instrucciones/i);
  assert.equal(body.input[0].content[1].detail, "high");
});