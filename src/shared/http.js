export async function readJsonBody(req) {
  const raw = await readRawBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export async function readRawBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function createJsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

export function sendJson(res, statusCode, payload) {
  return createJsonResponse(res, statusCode, payload);
}
