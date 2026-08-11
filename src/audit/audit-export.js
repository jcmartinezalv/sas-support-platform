export function exportAuditEvents(events, { format = "json" } = {}) {
  const normalizedFormat = String(format ?? "json").toLowerCase();
  if (normalizedFormat === "csv") {
    return {
      format: "csv",
      contentType: "text/csv; charset=utf-8",
      filename: buildFilename("csv"),
      body: toCsv(events)
    };
  }

  return {
    format: "json",
    contentType: "application/json; charset=utf-8",
    filename: buildFilename("json"),
    body: JSON.stringify({ exportedAt: new Date().toISOString(), events }, null, 2)
  };
}

function toCsv(events) {
  const columns = ["id", "createdAt", "actorId", "actorRole", "action", "entityType", "entityId", "metadata"];
  const rows = events.map((event) => columns.map((column) => {
    const value = column === "metadata" ? JSON.stringify(event.metadata ?? {}) : event[column] ?? "";
    return csvCell(value);
  }).join(","));
  return `${columns.join(",")}\r\n${rows.join("\r\n")}\r\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildFilename(extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `sas-audit-${stamp}.${extension}`;
}
