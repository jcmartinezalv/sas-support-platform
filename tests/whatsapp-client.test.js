import test from "node:test";
import assert from "node:assert/strict";

import {
  createWhatsAppClient,
  normalizeWhatsAppRecipient
} from "../src/whatsapp/whatsapp-client.js";

test("WhatsApp client normalizes the legacy Mexican mobile prefix", () => {
  assert.equal(normalizeWhatsAppRecipient("5218711566642"), "528711566642");
  assert.equal(normalizeWhatsAppRecipient("+52 871 156 6642"), "528711566642");
  assert.equal(normalizeWhatsAppRecipient("+1 555 155 4841"), "15551554841");
});

test("WhatsApp client uses the configured Graph API version", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return { messages: [{ id: "wamid.test" }] };
      }
    };
  };

  try {
    const client = createWhatsAppClient({
      whatsappAccessToken: "secret-token",
      whatsappPhoneNumberId: "phone-id",
      whatsappApiVersion: "v25.0"
    });
    const result = await client.sendText({ to: "5215555555555", body: "Prueba" });

    assert.equal(request.url, "https://graph.facebook.com/v25.0/phone-id/messages");
    assert.equal(request.options.headers.Authorization, "Bearer secret-token");
    assert.equal(JSON.parse(request.options.body).to, "525555555555");
    assert.equal(result.sent, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WhatsApp client falls back to a safe API version", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = url;
    return { ok: true, status: 200, async json() { return {}; } };
  };

  try {
    const client = createWhatsAppClient({
      whatsappAccessToken: "secret-token",
      whatsappPhoneNumberId: "phone-id",
      whatsappApiVersion: "invalid"
    });
    await client.sendText({ to: "5215555555555", body: "Prueba" });
    assert.equal(requestedUrl, "https://graph.facebook.com/v25.0/phone-id/messages");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("WhatsApp client downloads an image only from an approved Meta host", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (String(url).startsWith("https://graph.facebook.com/")) {
      return { ok: true, status: 200, async json() { return { url: "https://lookaside.fbsbx.com/whatsapp/media.bin", mime_type: "image/png", file_size: 4, sha256: "hash" }; } };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png", "content-length": "4" }),
      async arrayBuffer() { return Uint8Array.from([1, 2, 3, 4]).buffer; }
    };
  };
  const client = createWhatsAppClient({ whatsappAccessToken: "token", whatsappApiVersion: "v25.0", whatsappMediaMaxBytes: 10 }, { fetchImpl });
  const image = await client.downloadImage("MEDIA_1");
  assert.equal(image.size, 4);
  assert.equal(image.mimeType, "image/png");
  assert.equal(calls[1].options.headers.Authorization, "Bearer token");
});

test("WhatsApp client rejects unsafe media URLs and oversized images", async () => {
  const unsafe = createWhatsAppClient({ whatsappAccessToken: "token" }, {
    fetchImpl: async () => ({ ok: true, async json() { return { url: "https://evil.example/image.jpg", mime_type: "image/jpeg", file_size: 2 }; } })
  });
  await assert.rejects(() => unsafe.downloadImage("MEDIA_2"), /Unsafe WhatsApp media URL/);

  const oversized = createWhatsAppClient({ whatsappAccessToken: "token", whatsappMediaMaxBytes: 3 }, {
    fetchImpl: async () => ({ ok: true, async json() { return { url: "https://lookaside.fbsbx.com/image.jpg", mime_type: "image/jpeg", file_size: 4 }; } })
  });
  await assert.rejects(() => oversized.downloadImage("MEDIA_3"), /exceeds the allowed size/);
});