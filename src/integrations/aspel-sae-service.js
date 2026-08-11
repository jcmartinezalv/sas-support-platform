import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createAspelSaeService({ companyStore, extractor = extractWithPowerShell, projectRoot = process.cwd() } = {}) {
  if (!companyStore) throw new Error("Aspel SAE requiere el catálogo de empresas");

  return {
    async preview(input = {}) {
      const request = validateRequest(input);
      const extracted = await extractor({ ...request, projectRoot });
      const clients = normalizeClients(extracted.clients);
      return {
        databasePath: extracted.databasePath ?? request.databasePath,
        databaseName: path.basename(extracted.databasePath ?? request.databasePath),
        engine: extracted.engine ?? "Firebird",
        tableNames: extracted.tableNames ?? [],
        detected: clients.length,
        clients: clients.slice(0, 100)
      };
    },

    async importClients(input = {}) {
      const request = validateRequest(input);
      const extracted = await extractor({ ...request, projectRoot });
      const clients = normalizeClients(extracted.clients);
      const result = companyStore.importMany(clients, { sourceDatabase: extracted.databasePath ?? request.databasePath });
      return {
        ...result,
        databasePath: extracted.databasePath ?? request.databasePath,
        databaseName: path.basename(extracted.databasePath ?? request.databasePath),
        tableNames: extracted.tableNames ?? []
      };
    }
  };
}

async function extractWithPowerShell({ databasePath, username, password, isqlPath, projectRoot }) {
  if (process.platform !== "win32") throw aspelError("La extracción directa de Aspel SAE requiere Windows", 501);
  const scriptPath = path.join(projectRoot, "scripts", "read-aspel-sae-clients.ps1");
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-DatabasePath", databasePath, "-Username", username];
  if (isqlPath) args.push("-IsqlPath", isqlPath);
  try {
    const { stdout } = await execFileAsync("powershell.exe", args, {
      env: { ...process.env, SAS_ASPEL_PASSWORD: password },
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true
    });
    return JSON.parse(stripBomAndNoise(stdout));
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || "").trim();
    throw aspelError(detail || "No fue posible consultar Aspel SAE", 422);
  }
}

function validateRequest(input) {
  const databasePath = clean(input.databasePath, 2000);
  const username = clean(input.username || "SYSDBA", 100);
  const password = String(input.password ?? "");
  const isqlPath = clean(input.isqlPath, 2000);
  if (!databasePath) throw aspelError("Indica la ruta de la base de datos de Aspel SAE", 400);
  if (!/\.(fdb|gdb)$/i.test(databasePath)) throw aspelError("La base de Aspel SAE debe ser un archivo .FDB o .GDB", 400);
  if (!password) throw aspelError("Escribe la contraseña de lectura de Firebird", 400);
  return { databasePath, username, password, isqlPath };
}

function normalizeClients(records) {
  if (!Array.isArray(records)) return [];
  return records.map((item) => ({
    externalKey: clean(item.externalKey, 100),
    legalName: clean(item.legalName, 500),
    rfc: clean(item.rfc, 50).toUpperCase(),
    phone: clean(item.phone, 100),
    email: clean(item.email, 300).toLowerCase(),
    address: clean(item.address, 1000),
    status: clean(item.status, 100),
    sourceTable: clean(item.sourceTable, 100)
  })).filter((item) => item.legalName);
}

function stripBomAndNoise(value) {
  const text = String(value ?? "").replace(/^\uFEFF/, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("El extractor de Aspel SAE no devolvió datos JSON");
  return text.slice(start, end + 1);
}

function clean(value, limit = 500) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, limit);
}
function aspelError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
