import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("admin console defaults to stable and compares semantic versions", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "tools", "sas-admin-console", "SasAdminConsole.cs"), "utf8");
  assert.match(source, /channel\.SelectedIndex=0/);
  assert.match(source, /OrderByDescending\(x=>ParseVersion\(VersionFromZip\(x\)\)\)/);
  assert.match(source, /no se permite regresar/);
  assert.match(source, /ValidatePackage/);
  assert.match(source, /SHA-256/);
  assert.match(source, /http:\/\/127\.0\.0\.1\/health/);
  assert.doesNotMatch(source, /admin-stage.*Directory\.CreateDirectory\(stage\)/s);
});

test("publication gate validates imports, rollback and service binaries", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts", "publish-update-channel.mjs"), "utf8");
  assert.match(source, /validateRelativeImports/);
  assert.equal(source.includes("src/agent/image-analysis-service.js"), true);
  assert.equal(source.includes("src/mobile/technician-notification-service.js"), true);
  assert.match(source, /SasServiceHost\.exe/);
  assert.match(source, /SasAdminConsole\.exe/);
  assert.match(source, /Wait-SasHealth/);
  assert.match(source, /Restore-Backup/);
  assert.match(source, /releaseManifest\.Version/);
  assert.match(source, /Hash interno incorrecto/);
});

test("remote workspace has a usable three-part layout and executable client script", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "remote-workspace.html"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "public", "styles.css"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
  assert.match(styles, /body\.remote-workspace\s*\{/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(300px, 360px\)/);
  assert.match(html, /\/frame\?after=/);
  assert.match(html, /startWebRtcTransport/);
  assert.match(html, /file_download_chunk/);
  assert.match(html, /waitForCommand/);
});

test("remote workspace exposes real support controls and bidirectional browsing", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "remote-workspace.html"), "utf8");
  const agent = fs.readFileSync(path.join(process.cwd(), "client", "agent-client.js"), "utf8");
  const server = fs.readFileSync(path.join(process.cwd(), "src", "server.js"), "utf8" );
  const tray = fs.readFileSync(path.join(process.cwd(), "scripts", "sas-client-tray.ps1"), "utf8" );
  for (const marker of ["secure_attention", "text_input", "mouse_button", "key_down", "key_up", "release_input", "showSaveFilePicker", "showDirectoryPicker", "dual-file-manager", "file-transfer-center", "file_list", "upload-selected", "download-selected", "Características del equipo", "Resolución nativa", "Herramientas", "Captura de pantalla", "Grabación de pantalla", "Enviar por WhatsApp", "sendEventAndWait", "remoteOperatorPointer", "Activar UAC"]) assert.match(html, new RegExp(marker));
  assert.match(agent, /resolveRemoteFilePath/);
  assert.match(agent, /monitorOriginX/);
  assert.match(agent, /SasInputHelper\.exe/);
  assert.match(agent, /\/session-consent/);
  assert.match(agent, /data-session-decision/);
  assert.match(agent, /Tu ticket ya está con el técnico/);
  assert.doesNotMatch(tray, /BalloonTipClicked|Add_DoubleClick/);
  assert.match(tray, /\$supportItem\.Add_Click\(\{ Open-SupportPanel \}\)/);
  assert.match(server, /\/api\/agents\/control-consent/);
  assert.match(server, /webrtcSignals/);
  assert.match(agent, /node-datachannel/);
  assert.match(agent, /sendWebRtcFrame/);
  assert.match(html, /createDataChannel\('sas-screen'/);
  assert.match(server, /webrtc_datachannel_with_https_fallback/);
});