import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parseWhatsAppWebhook, verifyWhatsAppSignature } from "../src/whatsapp/whatsapp-webhook.js";

test("WhatsApp webhook validates Meta HMAC signature", () => {
  const raw = JSON.stringify({ object: "whatsapp_business_account" });
  const secret = "app-secret";
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyWhatsAppSignature(raw, signature, secret), true);
  assert.equal(verifyWhatsAppSignature(raw + "x", signature, secret), false);
  assert.equal(verifyWhatsAppSignature(raw, "sha256=bad", secret), false);
});

test("WhatsApp media is parsed as ticket evidence", () => {
  const events = parseWhatsAppWebhook({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: "5215551002000", profile: { name: "Cliente" } }],
    messages: [{ id: "wamid.image", from: "5215551002000", timestamp: "1", type: "image", image: { id: "media-1", mime_type: "image/jpeg", sha256: "abc", caption: "Error en pantalla" } }]
  } }] }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].text, "Error en pantalla");
  assert.deepEqual(events[0].attachments[0], { id: "media-1", type: "image", mimeType: "image/jpeg", filename: null, caption: "Error en pantalla", sha256: "abc" });
});
