import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("tools/sas-admin-console/SasAdminConsole.cs", "utf8");

test("SAS Administrador exposes friendly diagnostics and a Codex handoff", () => {
  assert.match(source, /Problemas y soluciones/);
  assert.match(source, /Consultar a Codex/);
  assert.match(source, /Preparar consulta/);
  assert.match(source, /Guardar respuesta/);
  assert.match(source, /DiagnoseOutput/);
  assert.match(source, /causa probable, comprobaciones, corrección recomendada, riesgo, reversión/);
});

test("Codex handoff redacts secrets and stores a local diagnostic record", () => {
  assert.match(source, /SECRETO OCULTO/);
  assert.match(source, /Bearer \[OCULTO\]/);
  assert.match(source, /PRIVATE KEY/);
  assert.match(source, /logs\\codex-requests/);
  assert.match(source, /por seguridad no se envía automáticamente/);
});

test("administrator process runner has timeouts and classifies common failures", () => {
  for (const marker of ["ERR_MODULE_NOT_FOUND", "EADDRINUSE", "ACCESS_DENIED", "CONNECTION_REFUSED", "TLS_ERROR", "CERT_RECURSION"]) assert.equal(source.includes(marker), true);
  assert.match(source, /WaitForExit\(timeoutMs\)/);
  assert.match(source, /La operación excedió el tiempo máximo/);
});
test("updater defers the running administrator executable without failing the server update", () => {
  const updater = fs.readFileSync("scripts/update-server-deployment.ps1", "utf8");
  assert.match(updater, /SasAdminConsole\.exe/);
  assert.match(updater, /Start-PendingAdminConsoleReplacement/);
  assert.match(updater, /replace-admin-console\.ps1/);
  assert.match(updater, /se reemplazará automáticamente al cerrar/);
});
test("SAS Administrador monitors and configures the local TURN service", () => {
  assert.match(source, /SAS Support TURN/);
  assert.match(source, /Configurar TURN/);
  assert.match(source, /install-sas-turn-service\.ps1/);
  assert.match(source, /TURN_ENGINE_MISSING/);
});

test("SAS Administrador ignores stale server errors after a healthy update", () => {
  assert.match(source, /LastWriteTimeUtc<DateTime\.UtcNow\.AddMinutes\(-20\)/);
  assert.match(source, /RecentTimestampedLog/);
  assert.match(source, /DateTimeOffset\.TryParse/);
  assert.match(source, /errores de los últimos 20 minutos/);
});

test("TURN requests UAC only for the privileged installation and preserves diagnostics", () => {
  assert.match(source, /RunElevatedScript/);
  assert.match(source, /Verb="runas"/);
  assert.match(source, /Esperando autorización de Windows/);
  assert.match(source, /sas-elevated-/);
  assert.match(source, /La autorización de Windows fue cancelada\. No se realizó ningún cambio\./);
});

test("TURN protects credentials with language-independent Windows SIDs", () => {
  const installer = fs.readFileSync("scripts/install-sas-turn-service.ps1", "utf8");
  assert.match(installer, /S-1-5-18/);
  assert.match(installer, /S-1-5-32-544/);
  assert.match(installer, /SecurityIdentifier/);
  assert.doesNotMatch(installer, /NT AUTHORITY\\SYSTEM|BUILTIN\\Administrators/);
});
test("SAS Administrador identifies files locked by TURN during an update", () => {
  assert.match(source, /FILE_LOCKED/);
  assert.match(source, /utilizado en otro proceso/);
  assert.match(source, /detiene Server y TURN/);
});
