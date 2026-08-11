export function createCompanyStore({ initialCompanies = [], onChange = () => {} } = {}) {
  const companies = new Map(initialCompanies.map((item) => [item.id, normalizeRecord(item)]).filter(([id]) => id));

  return {
    list(query = "") {
      const needle = normalize(query);
      return [...companies.values()]
        .filter((item) => !needle || [item.legalName, item.rfc, item.externalKey, item.phone, item.email, item.address].some((value) => normalize(value).includes(needle)))
        .sort((left, right) => left.legalName.localeCompare(right.legalName, "es-MX"));
    },
    get(id) {
      return companies.get(clean(id)) ?? null;
    },
    importMany(records = [], metadata = {}) {
      const result = { created: 0, updated: 0, skipped: 0, total: records.length, companies: [] };
      for (const input of records) {
        const candidate = normalizeRecord({
          ...input,
          source: "aspel_sae",
          sourceDatabase: metadata.sourceDatabase ?? input.sourceDatabase,
          importedAt: new Date().toISOString()
        });
        if (!candidate.legalName) {
          result.skipped += 1;
          continue;
        }
        const existing = findExisting(candidate);
        if (existing) {
          Object.assign(existing, { ...candidate, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() });
          result.updated += 1;
          result.companies.push(existing);
        } else {
          const now = new Date().toISOString();
          const company = { ...candidate, id: createId(), createdAt: now, updatedAt: now };
          companies.set(company.id, company);
          result.created += 1;
          result.companies.push(company);
        }
      }
      if (result.created || result.updated) onChange([...companies.values()]);
      return result;
    }
  };

  function findExisting(candidate) {
    const rfc = normalize(candidate.rfc);
    const sourceKey = `${normalize(candidate.sourceDatabase)}|${normalize(candidate.externalKey)}`;
    return [...companies.values()].find((item) =>
      (rfc && normalize(item.rfc) === rfc) ||
      (candidate.externalKey && `${normalize(item.sourceDatabase)}|${normalize(item.externalKey)}` === sourceKey) ||
      normalize(item.legalName) === normalize(candidate.legalName)
    ) ?? null;
  }
}

function normalizeRecord(input = {}) {
  return {
    id: clean(input.id),
    legalName: clean(input.legalName ?? input.name),
    rfc: clean(input.rfc).toUpperCase(),
    externalKey: clean(input.externalKey ?? input.key),
    phone: clean(input.phone),
    email: clean(input.email).toLowerCase(),
    address: clean(input.address),
    status: clean(input.status),
    source: clean(input.source) || "manual",
    sourceTable: clean(input.sourceTable),
    sourceDatabase: clean(input.sourceDatabase),
    importedAt: input.importedAt ?? null,
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null
  };
}

function createId() {
  return `CMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function normalize(value) {
  return clean(value).toLocaleLowerCase("es-MX").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 1000);
}
