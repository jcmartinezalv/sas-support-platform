const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function normalizeWhatsAppRecipient(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^521\d{10}$/.test(digits)) return `52${digits.slice(3)}`;
  return digits;
}

export function createWhatsAppClient(config, { fetchImpl = globalThis.fetch } = {}) {
  const graphApiVersion = /^v\d+\.\d+$/.test(config.whatsappApiVersion ?? "")
    ? config.whatsappApiVersion
    : "v25.0";

  function requireCredentials() {
    if (!config.whatsappAccessToken) throw clientError("WhatsApp access token is not configured", 503);
  }

  return {
    async sendText({ to, body }) {
      if (!config.whatsappAccessToken || !config.whatsappPhoneNumberId) {
        return { sent: false, skipped: true, reason: "WhatsApp credentials are not configured" };
      }
      const response = await fetchImpl(
        `https://graph.facebook.com/${graphApiVersion}/${config.whatsappPhoneNumberId}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${config.whatsappAccessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: normalizeWhatsAppRecipient(to),
            type: "text",
            text: { preview_url: false, body }
          })
        }
      );
      const payload = await response.json().catch(() => ({}));
      return { sent: response.ok, status: response.status, payload };
    },

    async downloadImage(mediaId, { maxBytes = config.whatsappMediaMaxBytes ?? 10 * 1024 * 1024 } = {}) {
      requireCredentials();
      const id = String(mediaId ?? "").trim();
      if (!/^[A-Za-z0-9._-]{1,256}$/.test(id)) throw clientError("Invalid WhatsApp media id", 400);

      const metadataResponse = await fetchImpl(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${config.whatsappAccessToken}` }
      });
      const metadata = await metadataResponse.json().catch(() => ({}));
      if (!metadataResponse.ok || !metadata.url) throw clientError("WhatsApp media metadata could not be obtained", 502);
      assertSafeMediaUrl(metadata.url);
      assertImageMimeType(metadata.mime_type);
      if (Number(metadata.file_size ?? 0) > maxBytes) throw clientError("WhatsApp image exceeds the allowed size", 413);

      const mediaResponse = await fetchImpl(metadata.url, { headers: { Authorization: `Bearer ${config.whatsappAccessToken}` } });
      if (!mediaResponse.ok) throw clientError("WhatsApp image could not be downloaded", 502);
      const mimeType = String(mediaResponse.headers?.get?.("content-type") ?? metadata.mime_type ?? "").split(";", 1)[0].trim().toLowerCase();
      assertImageMimeType(mimeType);
      const contentLength = Number(mediaResponse.headers?.get?.("content-length") ?? 0);
      if (contentLength > maxBytes) throw clientError("WhatsApp image exceeds the allowed size", 413);
      const bytes = Buffer.from(await mediaResponse.arrayBuffer());
      if (bytes.length > maxBytes) throw clientError("WhatsApp image exceeds the allowed size", 413);
      return { mediaId: id, bytes, mimeType, size: bytes.length, sha256: metadata.sha256 ?? null };
    }
  };
}

function assertImageMimeType(value) {
  if (!IMAGE_MIME_TYPES.has(String(value ?? "").split(";", 1)[0].trim().toLowerCase())) {
    throw clientError("Unsupported WhatsApp image type", 415);
  }
}

function assertSafeMediaUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw clientError("Invalid WhatsApp media URL", 502); }
  const host = url.hostname.toLowerCase();
  const allowed = host === "graph.facebook.com" || host === "lookaside.fbsbx.com"
    || host.endsWith(".facebook.com") || host.endsWith(".fbcdn.net") || host.endsWith(".fbsbx.com");
  if (url.protocol !== "https:" || !allowed || url.username || url.password) throw clientError("Unsafe WhatsApp media URL", 502);
}

function clientError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}