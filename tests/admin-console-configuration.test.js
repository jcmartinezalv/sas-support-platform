import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const admin = fs.readFileSync("tools/sas-admin-console/SasAdminConsole.cs", "utf8");
const dialog = fs.readFileSync("tools/sas-admin-console/ServerConfigurationDialog.cs", "utf8");
const builder = fs.readFileSync("tools/sas-admin-console/build-admin-console.ps1", "utf8");
const turnInstaller = fs.readFileSync("scripts/install-sas-turn-service.ps1", "utf8");

test("SAS Administrador includes a general server configuration window", () => {
  assert.match(admin, /Configuración/);
  assert.match(admin, /OpenServerConfiguration/);
  assert.match(builder, /ServerConfigurationDialog.cs/);
  for (const section of ["Red y HTTPS", "TURN y WebRTC", "Tiempos", "Actualizaciones"]) assert.match(dialog, new RegExp(section));
  for (const key of ["PUBLIC_BASE_URL", "HTTP_PORT", "HTTPS_PORT", "SAS_TURN_PUBLIC_HOST", "SAS_TURN_LISTENING_PORT", "SAS_TURN_TLS_PORT", "WEBRTC_UDP_MIN_PORT", "WEBRTC_UDP_MAX_PORT", "AGENT_HEARTBEAT_SECONDS", "REMOTE_SESSION_TTL_MINUTES", "UPDATE_CHANNEL"]) assert.match(dialog, new RegExp(key));
});

test("configuration editor hides secrets and preserves unrelated environment values", () => {
  for (const secret of ["OPENAI_API_KEY", "WHATSAPP_ACCESS_TOKEN", "WEBRTC_TURN_SECRET", "AGENT_SHARED_SECRET", "CONSOLE_SHARED_TOKEN"]) assert.doesNotMatch(dialog, new RegExp(secret));
  assert.match(dialog, /originalLines/);
  assert.equal(dialog.includes("else output.Add(line)"), true);
  assert.match(dialog, /config-backups/);
  assert.match(dialog, /File.Replace/);
  assert.equal(admin.includes("configuration.BackupPath"), true);
  assert.match(admin, /Configuración anterior restaurada/);
});

test("configuration validates DNS, URLs, ports, ranges, times, and TLS files", () => {
  assert.match(dialog, /Validar DNS/);
  assert.equal(dialog.includes("Dns.GetHostAddresses"), true);
  assert.match(dialog, /TryHttpUri/);
  assert.equal(dialog.includes("Distinct().Count()!=4"), true);
  assert.match(dialog, /El rango relay no puede/);
  assert.match(dialog, /ConfiguredFileExists/);
  assert.match(dialog, /saltos de línea/);
  assert.match(dialog, /Debe permanecer habilitado al menos HTTP o HTTPS/);
  assert.match(dialog, /rutas de datos y respaldos no pueden quedar vacías/);
});

test("TURN installer consumes and persists administrator port settings", () => {
  assert.equal(turnInstaller.includes("PSBoundParameters.ContainsKey('ListeningPort')"), true);
  assert.match(turnInstaller, /Read-ConfiguredInt 'SAS_TURN_LISTENING_PORT'/);
  assert.match(turnInstaller, /Read-ConfiguredInt 'SAS_TURN_TLS_PORT'/);
  assert.match(turnInstaller, /Read-ConfiguredInt 'WEBRTC_UDP_MIN_PORT'/);
  assert.match(turnInstaller, /Read-ConfiguredInt 'WEBRTC_UDP_MAX_PORT'/);
  assert.match(turnInstaller, /Set-EnvValue "SAS_TURN_LISTENING_PORT"/);
  assert.match(turnInstaller, /Set-EnvValue "SAS_TURN_TLS_PORT"/);
  assert.match(turnInstaller, /SAS_TURN_IP_REFRESH_SECONDS/);
});
