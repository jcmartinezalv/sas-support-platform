import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8").replace(/^\uFEFF/, "");
const agent = read("client", "agent-client.js");

test("la bandeja sigue siendo operable sin conexión y no bloquea el hilo visual", () => {
  const tray = read("scripts", "sas-client-tray.ps1");
  for (const marker of ["Reintentar conexión", "Diagnóstico de conexión", "$menu.Add_Opening", "$openItem.Enabled = $true", "$supportItem.Enabled = $true", "Invoke-Local \"/status\" \"GET\" $null 2"]) {
    assert.ok(tray.includes(marker), marker);
  }
  for (const marker of ["El reporte completo ya se copió al portapapeles.", "Credencial: ", "Identidad coherente:", "Servidor /health:", "Puerto local 37655:", "Tarea del agente:"]) {
    assert.ok(tray.includes(marker), marker);
  }
  assert.equal((tray.match(/Invoke-Local \"\/update\/status\"/g) || []).length, 1, "la consulta remota de actualización debe ejecutarse solo al hacer clic");
  assert.doesNotMatch(tray, /\$timerTicks/);
  assert.match(tray, /Request-AgentTaskRecovery/);
  assert.match(tray, /Start-ScheduledTask -TaskName "SAS Support Client Agent"/);
  assert.match(tray, /localAgentFailures -lt 2/);
});

test("el agente expone reconexión local y conserva el error verificable", () => {
  const agent = read("client", "agent-client.js");
  assert.match(agent, /req\.method === "POST" && url\.pathname === "\/reconnect"/);
  assert.match(agent, /await register\(\);[\s\S]*await pollOnce\(\);/);
  assert.match(agent, /recordConnectionError\(error\)/);
  assert.match(agent, /statusCode: Number\(lastConnectionError/);
});

test("el agente invalida solicitudes dormidas y se registra de nuevo al reanudar Windows", () => {
  const agent = read("client", "agent-client.js");
  assert.match(agent, /requestTimeoutMs/);
  assert.match(agent, /resumeGapMs/);
  assert.match(agent, /recoverConnectionAfterResume/);
  assert.match(agent, /abortActiveServerRequests\("system_resume"\)/);
  assert.match(agent, /await refreshInputBridgeStatus\(\);\s*await refreshRemoteEngineIdentities\(\);\s*await register\(\);/);
  assert.match(agent, /statusMatchesActiveSession/);
  assert.match(agent, /native_input_revision_stale/);
  assert.match(agent, /requiredInputHelperRevision/);
  assert.match(agent, /await register\(\);[\s\S]*await pollOnce\(\);/);
  assert.match(agent, /fetchServer\(new URL\(path, config\.serverUrl\)/);
});

test("la bandeja reemplaza un helper antiguo y publica su revisión y ruta", () => {
  const tray = read("scripts", "sas-client-tray.ps1");
  assert.match(tray, /input-v9-pointer-recovery/);
  assert.match(tray, /ExpectedHelperPath/);
  assert.match(tray, /helperRevision = \$script:lastInputHelperRevision/);
  assert.match(tray, /helperPath = \$script:lastInputHelperPath/);
  assert.match(tray, /Stop-Process -Id \$helperProcessId -Force/);
  assert.match(agent, /repairStaleInputDesktopHelper/);
  assert.match(agent, /helper de entrada obsoleto retirado/);
  assert.match(agent, /repairing_interactive_desktop_pipe/);
  assert.match(agent, /SAS_STALE_INPUT_PID/);
  assert.match(agent, /SAS_NATIVE_INPUT_ROOT/);
  assert.match(agent, /allowStaleRevision: revisionStale/);
  assert.match(agent, /revisionStale: true/);
});

test("los scripts interactivos usan UTF-8 con BOM para Windows PowerShell 5.1", () => {
  for (const script of ["sas-client-tray.ps1", "show-support-consent.ps1", "install-client.ps1", "start-client.ps1"]) {
    const bytes = fs.readFileSync(path.join(root, "scripts", script));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], script);
  }
  const builder = read("scripts", "build-windows11-final-installer.ps1");
  assert.match(builder, /UTF8Encoding\(\$true\)/);
  assert.match(builder, /Get-ChildItem -LiteralPath \$outDir -Recurse -File -Filter "\*\.ps1"/);
});

test("la actualización conserva la URL válida del servidor ya configurada", () => {
  const installer = read("scripts", "install-client.ps1");
  assert.match(installer, /existingClientEnvPath/);
  assert.match(installer, /Read-EnvValue \$existingClientEnvPath "SAS_SERVER_URL"/);
  assert.match(installer, /Host -notin @\("localhost", "127\.0\.0\.1"\)/);
});
