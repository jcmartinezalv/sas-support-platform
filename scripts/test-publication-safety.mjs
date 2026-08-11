import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const forbiddenRoots = ["certs/", "data/", "dist/", "downloads/", "logs/", "node_modules/", "output/", "runtime/", "tmp/", "updates/"];
const forbiddenNames = new Set([".env", ".env.local", ".env.production", "agent-credential.json", "agent-identity.json", "unattended-policy.json", "install-manifest.json", "post-install-checklist.json"]);
const forbiddenExtensions = new Set([".aab", ".apk", ".cvd", ".dll", ".exe", ".jks", ".key", ".keystore", ".msi", ".msix", ".p12", ".pem", ".pfx", ".sig", ".zip", ".7z"]);

let files;
try {
  files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
} catch (error) {
  console.error("No fue posible enumerar el repositorio Git. Ejecuta git init antes de publicar.");
  process.exit(Number(error.status) || 1);
}

const violations = files.filter((file) => {
  const normalized = file.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const base = path.posix.basename(lower);
  return forbiddenRoots.some((prefix) => lower.startsWith(prefix))
    || lower.startsWith("updates-validation-")
    || forbiddenNames.has(base)
    || forbiddenExtensions.has(path.posix.extname(lower));
});

const required = ["LICENSE", ".env.example", "docs/OPEN-SOURCE-PUBLICATION.md"];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (violations.length || missing.length) {
  if (violations.length) console.error(`Archivos que no pueden publicarse:\n${violations.map((file) => `- ${file}`).join("\n")}`);
  if (missing.length) console.error(`Archivos obligatorios ausentes:\n${missing.map((file) => `- ${file}`).join("\n")}`);
  process.exit(1);
}

console.log(`Publicación segura: ${files.length} archivos candidatos; sin rutas operativas ni binarios prohibidos.`);
