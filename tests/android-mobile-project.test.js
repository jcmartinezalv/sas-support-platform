import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../android-app/${path}`, import.meta.url), "utf8");

test("Android app requires Internet but rejects cleartext transport", () => {
  const manifest = read("app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.match(manifest, /allowBackup="false"/);
});

test("Android session is encrypted with Android Keystore and a random installation ID", () => {
  const store = read("app/src/main/java/mx/setinfo/fisher/SecureSessionStore.kt");
  assert.match(store, /AndroidKeyStore/);
  assert.match(store, /AES\/GCM\/NoPadding/);
  assert.match(store, /UUID\.randomUUID/);
  assert.doesNotMatch(store, /ANDROID_ID|IMEI/);
  assert.match(store, /saveServerUrl/);
  assert.match(store, /saveDashboard/);
  assert.match(store, /dashboard_cache/);
});

test("Android client covers login, dashboard, activity, Fisher and logout routes", () => {
  const api = read("app/src/main/java/mx/setinfo/fisher/FisherApi.kt");
  for (const route of ["auth/login", "auth/refresh", "dashboard", "activity", "notifications", "notification-preferences", "auth/change-password", "fisher/ask", "auth/logout"]) assert.match(api, new RegExp(route.replace("/", "\\/")));
  const ui = read("app/src/main/java/mx/setinfo/fisher/MainActivity.kt");
  assert.match(ui, /Tablero.*Actividad.*Consultar/s);
  assert.match(ui, /no ejecuta reparaciones/i);
  assert.match(ui, /ChangePasswordScreen/);
  assert.match(ui, /isExpiring/);
  assert.match(ui, /delay\(60_000\)/);
  assert.match(api, /path\.endsWith\("\/auth\/refresh"\)/);
  assert.match(ui, /error is HttpFailure/);
  assert.match(ui, /Reconectando sin cerrar tu sesi.n/);
  assert.doesNotMatch(ui, /result\.fold\(\{ store\.save\(it\).*\}, \{ store\.clear\(\)/);
  assert.match(ui, /PreferencesScreen/);
  assert.match(ui, /Sin conexión.*datos guardados/);
  assert.match(ui, /Leer todas/);
  assert.match(ui, /Cargar más alertas/);
  assert.match(ui, /Cargar más actividad/);
  assert.match(ui, /minOf\(100/);
  assert.match(ui, /server\.startsWith\("https:\/\/"\)/);
  assert.match(ui, /Tickets urgentes.*Actividad crítica de Fisher.*Conocimiento listo/s);
  assert.match(ui, /contraseña temporal antes de consultar/i);
});







