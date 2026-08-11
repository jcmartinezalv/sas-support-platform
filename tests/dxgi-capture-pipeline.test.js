import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("DXGI capture uses Desktop Duplication and WIC without replacing the GDI fallback", () => {
  const source = read("tools", "sas-dxgi-capture", "Program.cpp");
  for (const marker of [
    "D3D11CreateDevice",
    "DuplicateOutput",
    "AcquireNextFrame",
    "CopyResource",
    "D3D11_MAP_READ",
    "GUID_ContainerFormatJpeg",
    "DrawCursor",
    "MeasureFrame",
    "blankFrame",
    "dxgi_desktop_duplication"
  ]) assert.match(source, new RegExp(marker));
  assert.match(source, /ReleaseFrame/);
  assert.match(source, /DesktopCoordinates/);
});

test("SAS Cliente prefers DXGI and falls back to GDI on every capture failure", () => {
  const agent = read("client", "agent-client.js");
  assert.match(agent, /SAS_DXGI_CAPTURE_HELPER_PATH/);
  assert.match(agent, /requestNativeHelper\("capture_dxgi"/);
  assert.match(agent, /requestNativeHelper\("capture_gdi"/);
  const dxgiIndex = agent.indexOf('requestNativeHelper("capture_dxgi"');
  const gdiIndex = agent.indexOf('requestNativeHelper("capture_gdi"');
  assert.ok(dxgiIndex >= 0 && dxgiIndex < gdiIndex);
  assert.match(agent, /captureFallbackReason/);
  assert.match(agent, /captureLooksBlank/);
  assert.match(agent, /dxgi_blank_frame/);
  assert.match(agent, /gdi_blank_frame/);
  assert.match(agent, /DXGI no estuvo disponible; SAS mantuvo la imagen mediante respaldo GDI/);
});

test("GDI capture reports luminance evidence before SAS accepts a frame", () => {
  const helper = read("tools", "sas-capture-helper", "Program.cs");
  assert.match(helper, /MeasureFrame/);
  assert.match(helper, /MeanLuma/);
  assert.match(helper, /LumaStdDev/);
  assert.match(helper, /DarkPixelRatio/);
  assert.match(helper, /BlankFrame/);
});

test("the installer and cleanup lifecycle include the versioned DXGI executable", () => {
  const installer = read("installer", "windows11", "SAS-Cliente.nsi");
  const installClient = read("scripts", "install-client.ps1");
  const cleanup = read("scripts", "stop-client-components.ps1");
  const release = read("scripts", "build-windows11-final-installer.ps1");
  assert.match(installer, /sas-dxgi-capture\\bin\\Release\\SasDxgiCapture\.exe/);
  assert.match(installClient, /SAS_DXGI_CAPTURE_HELPER_PATH=\$dxgiCaptureHelperEnv/);
  assert.match(installClient, /DxgiCaptureHelper/);
  assert.match(cleanup, /SasDxgiCapture/);
  assert.match(release, /"sas-dxgi-capture"/);
  assert.match(read("scripts", "test-client-preflight.ps1"), /dxgi_capture_helper_signature/);
  const publisher = read("scripts", "publish-update-channel.mjs");
  assert.match(publisher, /tools\/sas-dxgi-capture\/bin\/Release\/SasDxgiCapture\.exe/);
  assert.match(publisher, /client\/adaptive-screen-controller\.js/);
});

test("DXGI build script fails clearly when Visual C++ Build Tools are unavailable", () => {
  const script = read("scripts", "build-dxgi-capture.ps1");
  assert.match(script, /Microsoft\.VisualStudio\.Component\.VC\.Tools\.x86\.x64/);
  assert.match(script, /cl\.exe/);
  assert.match(script, /d3d11\.lib dxgi\.lib windowscodecs\.lib/);
  assert.match(script, /Falta Visual Studio Build Tools con C\+\+ de escritorio/);
});
