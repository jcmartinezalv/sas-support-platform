import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Isolated server stopped");
    try { if ((await fetch(baseUrl + "/health")).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Isolated server did not become healthy");
}
async function json(baseUrl, pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}
const bearer = (token) => ({ "Content-Type": "application/json", Authorization: "Bearer " + token });

test("web console uses the shared mobile account session instead of a visible console token", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(process.cwd(), "public", "app.js"), "utf8");
  assert.match(html, /id="consoleLoginForm"/);
  assert.match(html, /misma cuenta autorizada de la aplicaci\u00f3n m\u00f3vil/);
  assert.match(html, /Acceso de recuperaci\u00f3n local/);
  assert.doesNotMatch(html, /id="roleSelect"|id="consoleToken"/);
  assert.equal(app.includes("localStorage.setItem(CONSOLE_SESSION_KEY"), true);
  assert.match(app, /Authorization/);
  assert.match(app, /Bearer/);
  assert.equal(app.includes("/api/mobile/v1/auth/refresh"), true);
  assert.match(app, /scheduleConsoleRefresh/);
  assert.match(app, /scheduleConsoleRefreshRetry/);
  assert.match(app, /BroadcastChannel\("sas-console-auth"\)/);
  assert.match(app, /navigator\.locks/);
  assert.match(app, /refreshFailureKind\s*===\s*"invalid"/);
  assert.match(app, /expiresAt-Date\.now\(\)-60000/);
  assert.match(app, /consoleLoginSafety/);
  assert.match(app, /closedRemoteSessions/);
  assert.match(app, /sesiones remotas abiertas por seguridad/);
  assert.match(html, /id="consoleLoginSafety"/);
  assert.match(html, /se conserva y se sincroniza entre pestañas/);
  assert.equal(app.includes("/api/mobile/v1/auth/logout"), true);
  assert.equal(app.includes("response.status === 403"), true);
  assert.equal(app.includes("hasVisiblePasswordDraft()"), true);
  assert.equal(app.includes("const passwordDrafts = new Map"), true);
  assert.equal(app.includes("input.value = passwordDrafts.get"), true);
  assert.equal((app.match(/#createMobileUser"\)\?\.addEventListener/g) ?? []).length, 1);
  assert.match(html, /id="mobileCreateResult"/);
});

test("shared identity authenticates web, renews tokens safely, enforces roles and supports recovery", async () => {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sas-console-auth-"));
  const baseUrl = "http://127.0.0.1:" + port;
  const recoveryToken = "console-recovery-token-123456";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HTTP_PORT: String(port), ENABLE_HTTP: "true", ENABLE_HTTPS: "false", PUBLIC_BASE_URL: baseUrl,
      DATA_FILE_PATH: path.join(tempRoot, "db.json"), BACKUP_DIR: path.join(tempRoot, "backups"), AGENT_SHARED_SECRET: "console-auth-agent-secret",
      CONSOLE_SHARED_TOKEN: recoveryToken, MOBILE_BOOTSTRAP_USERNAME: "administrador", MOBILE_BOOTSTRAP_PASSWORD: "Admin-console-pass-123", MOBILE_BOOTSTRAP_DISPLAY_NAME: "Administrador SAS" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  try {
    await waitForHealth(baseUrl, child);
    const login = await json(baseUrl, "/api/mobile/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "administrador", password: "Admin-console-pass-123", deviceId: "sas-web-admin-test", deviceName: "Consola web", platform: "web" }) });
    assert.equal(login.response.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.session.user.role, "admin");
    assert.equal(login.body.session.device.platform, "web");
    assert.equal((await json(baseUrl, "/api/admin/storage", { headers: bearer(login.body.session.accessToken) })).response.status, 200);

    const refreshed = await json(baseUrl, "/api/mobile/v1/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: login.body.session.refreshToken, deviceId: login.body.session.device.id }) });
    assert.equal(refreshed.response.status, 200);
    assert.notEqual(refreshed.body.session.accessToken, login.body.session.accessToken);
    assert.equal(refreshed.body.session.refreshToken, login.body.session.refreshToken);
    assert.equal((await json(baseUrl, "/api/admin/storage", { headers: bearer(login.body.session.accessToken) })).response.status, 200);
    assert.equal((await json(baseUrl, "/api/admin/storage", { headers: bearer(refreshed.body.session.accessToken) })).response.status, 200);

    const created = await json(baseUrl, "/api/mobile-admin/v1/users", { method: "POST", headers: bearer(refreshed.body.session.accessToken), body: JSON.stringify({ username: "tecnico", displayName: "Tecnico SAS", role: "technician", password: "Temporary-tech-pass-123" }) });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const techLogin = await json(baseUrl, "/api/mobile/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "tecnico", password: "Temporary-tech-pass-123", deviceId: "sas-web-tech-test", deviceName: "Consola web", platform: "web" }) });
    assert.equal(techLogin.response.status, 200);
    const changed = await json(baseUrl, "/api/mobile/v1/auth/change-password", { method: "POST", headers: bearer(techLogin.body.session.accessToken), body: JSON.stringify({ currentPassword: "Temporary-tech-pass-123", newPassword: "Definitive-tech-pass-456" }) });
    assert.equal(changed.response.status, 200);
    const techRelogin = await json(baseUrl, "/api/mobile/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "tecnico", password: "Definitive-tech-pass-456", deviceId: "sas-web-tech-test", deviceName: "Consola web", platform: "web" }) });
    assert.equal((await json(baseUrl, "/api/tickets", { headers: bearer(techRelogin.body.session.accessToken) })).response.status, 200);
    assert.equal((await json(baseUrl, "/api/admin/storage", { headers: bearer(techRelogin.body.session.accessToken) })).response.status, 403);

    const supportTicket = await json(baseUrl, "/api/tickets", { method: "POST", headers: bearer(refreshed.body.session.accessToken), body: JSON.stringify({ customerName: "Equipo prueba", customerPhone: "", subject: "Prueba cierre seguro", description: "Validar cierre al salir", source: "console" }) });
  assert.equal(supportTicket.response.status, 201, JSON.stringify(supportTicket.body));
  const supportSession = await json(baseUrl, "/api/remote-sessions", { method: "POST", headers: bearer(refreshed.body.session.accessToken), body: JSON.stringify({ ticketId: supportTicket.body.ticket.id }) });
  assert.equal(supportSession.response.status, 201, JSON.stringify(supportSession.body));
  const logout = await json(baseUrl, "/api/mobile/v1/auth/logout", { method: "POST", headers: bearer(refreshed.body.session.accessToken) });
  assert.equal(logout.response.status, 200);
  assert.deepEqual(logout.body.closedRemoteSessions, [supportSession.body.session.id]);
    assert.equal((await json(baseUrl, "/api/admin/storage", { headers: bearer(refreshed.body.session.accessToken) })).response.status, 401);
    assert.equal((await json(baseUrl, "/api/admin/storage", { headers: { "x-sas-role": "admin", "x-sas-actor": "recovery-test", "x-sas-console-token": recoveryToken } })).response.status, 200);
  } finally {
    child.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
