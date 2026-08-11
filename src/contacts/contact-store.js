export function createContactStore({ initialContacts = [], onChange = () => {} } = {}) {
  const contacts = new Map(initialContacts.map((contact) => [contact.id, { ...contact }]));
  return {
    list(query = "") {
      const needle = normalize(query);
      return [...contacts.values()]
        .filter((contact) => !needle || [contact.name, contact.company, contact.phone, contact.email, contact.address].some((value) => normalize(value).includes(needle)))
        .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
    },
    create(input = {}) {
      const name = clean(input.name);
      if (!name) throw contactError("El nombre del cliente es obligatorio", 400);
      const company = clean(input.company);
      const phone = clean(input.phone);
      const email = validateEmail(input.email);
      assertUnique({ name, company, phone, email });
      const now = new Date().toISOString();
      const contact = { id: `CNT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name, company, companyId: clean(input.companyId), phone, email, address: clean(input.address), notes: clean(input.notes), createdAt: now, updatedAt: now };
      contacts.set(contact.id, contact); persist(); return contact;
    },
    update(id, input = {}) {
      const contact = contacts.get(id); if (!contact) return null;
      const candidate = { ...contact };
      for (const key of ["name", "company", "companyId", "phone", "address", "notes"]) if (input[key] !== undefined) candidate[key] = clean(input[key]);
      if (input.email !== undefined) candidate.email = validateEmail(input.email);
      if (!candidate.name) throw contactError("El nombre del cliente es obligatorio", 400);
      assertUnique(candidate, id);
      Object.assign(contact, candidate, { updatedAt: new Date().toISOString() }); persist(); return contact;
    },
    get(id) { return contacts.get(id) ?? null; },
    findByPhone(phone) {
      const key = normalizePhone(phone);
      return key ? [...contacts.values()].find((contact) => normalizePhone(contact.phone) === key) ?? null : null;
    }
  };

  function assertUnique(candidate, excludedId = null) {
    const phoneKey = normalizePhone(candidate.phone);
    const emailKey = normalizeEmail(candidate.email);
    const identity = `${normalize(candidate.name)}|${normalize(candidate.company)}`;
    const duplicate = [...contacts.values()].find((contact) => contact.id !== excludedId && ((phoneKey && normalizePhone(contact.phone) === phoneKey) || (emailKey && normalizeEmail(contact.email) === emailKey) || `${normalize(contact.name)}|${normalize(contact.company)}` === identity));
    if (duplicate) throw contactError(`Ya existe una ficha para ${duplicate.name}`, 409);
  }
  function persist() { onChange([...contacts.values()]); }
}
function validateEmail(value) { const raw = clean(value); if (!raw) return ""; const email = normalizeEmail(raw); if (!email) throw contactError("El correo electrónico no es válido", 400); return email; }
function normalizeEmail(value) { const email = clean(value).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ""; }
function normalizePhone(value) { return String(value ?? "").replace(/\D/g, ""); }
function normalize(value) { return String(value ?? "").trim().toLocaleLowerCase("es-MX"); }
function clean(value) { return String(value ?? "").trim().slice(0, 500); }
function contactError(message, statusCode) { const error = new Error(message); error.statusCode = statusCode; return error; }
