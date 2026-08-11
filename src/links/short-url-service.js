export function createShortUrlService({ config, fetchImpl = globalThis.fetch } = {}) {
  return {
    async shorten(internalUrl) {
      const destination = validateDestination(internalUrl);
      const requested = normalizeProvider(config?.shortUrlProvider);
      if (requested === "internal") return internalResult(destination, false, []);
      const providers = requested === "auto" ? ["tinyurl", "bitly"] : [requested];
      const attempts = [];
      for (const provider of providers) {
        const token = provider === "tinyurl" ? config?.tinyUrlApiToken : config?.bitlyAccessToken;
        if (!token) { attempts.push({ provider, status: "not_configured" }); continue; }
        try {
          const url = provider === "tinyurl"
            ? await shortenWithTinyUrl(destination, config, fetchImpl)
            : await shortenWithBitly(destination, config, fetchImpl);
          return { url, provider, fallback: false, attempts };
        } catch (error) {
          attempts.push({ provider, status: "failed", error: safeError(error) });
        }
      }
      return internalResult(destination, true, attempts);
    }
  };
}

async function shortenWithTinyUrl(longUrl, config, fetchImpl) {
  const domain = clean(config?.tinyUrlDomain) || "tinyurl.com";
  const response = await fetchImpl("https://api.tinyurl.com/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${config.tinyUrlApiToken}` },
    body: JSON.stringify({ url: longUrl, domain }),
    signal: timeoutSignal(config?.shortUrlTimeoutMs)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`TinyURL HTTP ${response.status}`);
  return validateProviderUrl(payload?.data?.tiny_url, domain);
}

async function shortenWithBitly(longUrl, config, fetchImpl) {
  const domain = clean(config?.bitlyDomain) || "bit.ly";
  const response = await fetchImpl("https://api-ssl.bitly.com/v4/shorten", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${config.bitlyAccessToken}` },
    body: JSON.stringify({ long_url: longUrl, domain }),
    signal: timeoutSignal(config?.shortUrlTimeoutMs)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Bitly HTTP ${response.status}`);
  return validateProviderUrl(payload?.link, domain);
}

function validateDestination(value) {
  const url = new URL(String(value));
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid short URL destination");
  return url.toString();
}
function validateProviderUrl(value, expectedDomain) {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== expectedDomain.toLowerCase()) throw new Error("Unexpected short URL response");
  return url.toString();
}
function timeoutSignal(value) { return AbortSignal.timeout(Number.isInteger(value) ? value : 5000); }
function normalizeProvider(value) { const provider=clean(value).toLowerCase(); return ["internal","tinyurl","bitly","auto"].includes(provider) ? provider : "auto"; }
function internalResult(url, fallback, attempts) { return { url, provider: "internal", fallback, attempts }; }
function safeError(error) { return String(error?.message ?? "Shortener request failed").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 160); }
function clean(value) { return String(value ?? "").trim(); }
