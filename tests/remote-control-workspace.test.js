import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRemoteSessionStore } from "../src/remote/remote-session-store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = fs.readFileSync(path.join(root, "public", "remote-workspace.html"), "utf8");
const styles = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

test("remote toolbar remains visible and focusing the screen does not scroll it away", () => {
  assert.match(styles, /\.remote-workspace-toolbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(styles, /\.remote-screen-placeholder:focus[^}]*outline:\s*none/s);
  assert.match(workspace, /focus\(\{preventScroll:true\}\)/);
});

test("workspace distinguishes permission from native keyboard and mouse readiness", () => {
  for (const marker of [
    "controlCapabilityStatus",
    "nativeControlReadiness",
    "inputHelperAvailable",
    "realInputEnabled",
    "unsignedRestrictedProduction",
    "Control activo · canal directo",
    "Falta el ayudante nativo de teclado y mouse"
  ]) assert.match(workspace, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("workspace maps browser key names to the native helper protocol", () => {
  assert.match(workspace, /ArrowUp:'UP'/);
  assert.match(workspace, /ArrowDown:'DOWN'/);
  assert.match(workspace, /ArrowLeft:'LEFT'/);
  assert.match(workspace, /ArrowRight:'RIGHT'/);
});

test("requesting control again does not revoke an approved authorization", () => {
  const store = createRemoteSessionStore();
  const session = store.create({ ticketId: "TCK-CONTROL", requestedBy: "test", agentId: "agent-1" });
  store.approveConsent(session.joinCode, { decidedBy: "customer" });
  store.start(session.id, "operator");
  store.requestControl(session.id, "operator");
  store.decideControl(session.joinCode, "approved", { decidedBy: "customer" });

  const requestedAgain = store.requestControl(session.id, "operator");

  assert.equal(requestedAgain.controlConsent.decision, "approved");
  assert.equal(requestedAgain.controlConsent.decidedBy, "customer");
});


test("Herramientas remains a horizontal top bar outside the sidebar", () => {
  const toolsAt = workspace.indexOf('class="remote-tools-toolbar"');
  assert.ok(toolsAt > 0 && toolsAt < workspace.indexOf('<main'));
  assert.doesNotMatch(workspace, /<section class="workspace-tools">/);
  assert.match(styles, /.remote-tools-toolbar{display:flex/);
  assert.match(styles, /.remote-tools-toolbar .workspace-tool-grid{display:flex/);
  assert.match(styles, /.remote-workspace-toolbar>.item-actions{flex:1 0 100%;flex-wrap:wrap;[^}]*overflow:visible/);
});

test("pointer control preserves native button down and up delivery", () => {
  assert.match(workspace, /function sendMouseTransition\(payload\)/);
  assert.match(workspace, /mouseTransitionChain\.catch\(\(\)=>\{\}\)\.then\(\(\)=>sendEvent\('mouse_button',payload\)\)/);
  assert.match(workspace, /sendMouseTransition\(\{relativeX:point\.relativeX,relativeY:point\.relativeY,button,action:'down'/);
  assert.match(workspace, /sendMouseTransition\(\{relativeX:point\.relativeX,relativeY:point\.relativeY,button,action:'up'/);
  assert.match(workspace, /releaseRemoteInput\('mouse_up_failed'\)/);
  assert.match(workspace, /releaseRemoteInput\('pointer_capture_lost'\)/);
  assert.match(workspace, /inside=event\.clientX>=left/);
  assert.match(workspace, /if\(!point\.inside\|\|remoteButtonsDown\.has\(button\)\)return/);
  assert.match(workspace, /if\(!remoteButtonsDown\.has\(button\)\)return/);
});

test("an authorized waiting session can be started from the control button in one click", () => {
  assert.match(workspace, /function ensureActiveRemoteSession/);
  assert.match(workspace, /\/api\/remote-sessions\/'\+sessionId\+'\/start/);
  assert.match(workspace, /ensureActiveRemoteSession\(\{startScreen:true\}\)/);
  assert.match(workspace, /button\.textContent='Iniciar soporte';button\.title=.*;button\.disabled=false/);
});

test("the remote image uses actionable cursors instead of a prohibited pointer", () => {
  assert.doesNotMatch(styles, /remote-screen-placeholder[^}]*cursor:not-allowed/);
  assert.match(styles, /data-control-state="ready"[^}]*#remoteFrame\{cursor:pointer\}/);
  assert.match(styles, /data-control-state="pending"[^}]*#remoteFrame\{cursor:progress\}/);
});

test("workspace exposes a copyable end-to-end input diagnostic", () => {
  for (const marker of ["Diagnóstico de control", "copyInputDiagnostic", "inputDiagnosticReport", "Evidencia nativa:", "SENDINPUT ENCOLÓ TODOS LOS EVENTOS", "EFECTO NO VERIFICADO", "lastInputChanged"]) {
    assert.ok(workspace.includes(marker), marker);
  }
});
