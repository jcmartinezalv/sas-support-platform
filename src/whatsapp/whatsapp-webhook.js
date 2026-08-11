import crypto from "node:crypto";

export function verifyWhatsAppWebhook(searchParams, verifyToken) {
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return challenge;
  }

  return null;
}

export function parseWhatsAppWebhook(payload) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const events = [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change.value ?? {};
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];

      for (const message of messages) {
        const contact = contacts.find((item) => item.wa_id === message.from);
        const text = extractMessageText(message);
        const attachments = extractAttachments(message);

        if (!message.from || !text) {
          continue;
        }

        events.push({
          id: message.id,
          from: message.from,
          profileName: contact?.profile?.name ?? "Cliente WhatsApp",
          type: message.type,
          text,
          attachments,
          timestamp: message.timestamp
        });
      }
    }
  }

  return events;
}

export function verifyWhatsAppSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;
  const received = Buffer.from(signatureHeader.slice(7), "hex");
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function extractMessageText(message) {
  if (message.type === "text") {
    return String(message.text?.body ?? "").trim();
  }

  if (message.type === "button") {
    return String(message.button?.text ?? "").trim();
  }

  if (message.type === "interactive") {
    return String(
      message.interactive?.button_reply?.title ??
      message.interactive?.list_reply?.title ??
      ""
    ).trim();
  }

  const caption = message[message.type]?.caption;
  return String(caption ?? `[Mensaje ${message.type ?? "desconocido"} recibido como evidencia]`).trim();
}

function extractAttachments(message) {
  const type = String(message.type ?? "");
  if (!["image", "audio", "video", "document", "sticker"].includes(type)) return [];
  const media = message[type] ?? {};
  return [{
    id: media.id ?? null,
    type,
    mimeType: media.mime_type ?? null,
    filename: media.filename ?? null,
    caption: media.caption ?? null,
    sha256: media.sha256 ?? null
  }];
}
