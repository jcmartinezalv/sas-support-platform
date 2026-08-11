import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8").replace(/^\uFEFF/, "");

test("privileged desktop broker is narrow, authenticated and locally authorized", () => {
  const broker = read("tools", "sas-secure-attention-broker", "Program.cs");
  assert.match(broker, /HMACSHA256/);
  assert.match(broker, /expired_request/);
  assert.match(broker, /replayed_request/);
  assert.match(broker, /FixedEquals/);
  assert.match(broker, /PipeSecurity/);
  assert.match(broker, /AuthenticatedUserSid/);
  assert.match(broker, /operation=="AUTHORIZE"/);
  assert.match(broker, /WTSSendMessage/);
  assert.match(broker, /privileged_control_rejected/);
  assert.match(broker, /privileged_grant_(required|expired)/);
  assert.match(broker, /DateTime\.UtcNow\.AddMinutes\(20\)/);
  assert.equal(broker.includes('operation=="INPUT"){ValidateInput(args);result=RunServiceInput(args);}'), true);
  assert.match(broker, /operation=="INPUT_USER"/);
  assert.match(broker, /operation=="INPUT_USER"\)\{ValidateInput\(args\);result=RunUserInput\(args\);\}/);
  assert.match(broker, /GetActiveUserSid/);
  assert.match(broker, /FileSystemRights\.Modify/);
  assert.match(broker, /operation=="INPUT_HEALTH"/);
  assert.match(broker, /SASInputServiceDesktop/);
  assert.match(broker, /RunInputSupervisor/);
  assert.match(broker, /StartInActiveSession/);
  assert.match(broker, /service_supervised_session_bridge/);
  assert.match(broker, /WTSQueryUserToken/);
  assert.match(broker, /RunInActiveUserSession/);
  assert.match(broker, /operation=="CAPTURE"/);
  assert.match(broker, /operation=="SEND_SAS"/);
  assert.match(broker, /operation_not_allowed/);
  assert.match(broker, /CreateProcessAsUser/);
  assert.match(broker, /WTSGetActiveConsoleSessionId/);
  assert.match(broker, /lpDesktop="winsta0\\\\default"/);
  assert.match(broker, /ResolveHelper\("sas-input-helper","SasInputHelper\.exe"\)/);
  assert.equal(broker.includes('operation=="INPUT"){ValidateInput(args);result=RunServiceInput(args);}'), true);
  assert.equal(broker.includes('operation=="INPUT"){ValidateInput(args);result=RunWorker'), false);
  assert.match(broker, /ResolveHelper\("sas-capture-helper","SasCaptureHelper\.exe"\)/);
  assert.match(broker, /--console/);
  assert.match(broker, /broker-startup\.log/);
  assert.doesNotMatch(broker, /Process\.Start\(/);
  assert.doesNotMatch(broker, /cmd\.exe|powershell\.exe/i);
  assert.match(broker, /private static string Quote\(string value\)\{return "\\\""\+\(value\?\?""\)\.Replace\("\\\"","\\\\\\\""\)\+"\\\"";\}/);
});

test("agent requests a short-lived privileged grant and keeps a supervised user fallback", () => {
  const agent = read("client", "agent-client.js");
  assert.match(agent, /executePrivilegedBrokerRaw/);
  assert.match(agent, /createHmac\("sha256", agentSecret\)/);
  assert.match(agent, /executePrivilegedBrokerRaw\("AUTHORIZE", \[\], 70000\)/);
  assert.match(agent, /\["--grant", privilegedBrokerGrant, \.\.\.args\]/);
  assert.match(agent, /privilegedBrokerGrantExpiresAt/);
  assert.match(agent, /executePrivilegedBrokerRaw\("INPUT"/);
  assert.match(agent, /elevatedDesktopRequested/);
  assert.match(agent, /executePrivilegedBrokerRaw\("INPUT_USER"/);
  assert.match(agent, /service_supervised_user_fallback/);
  assert.match(agent, /retryInputThroughAuthorizedBroker/);
  assert.match(agent, /ensurePrivilegedBrokerGrant\(true, session\.id\)/);
  assert.match(agent, /native_input_wrong_session/);
  assert.match(agent, /executePrivilegedBrokerRaw\("INPUT_HEALTH"/);
  assert.match(agent, /elevatedDesktopRequested/);
  assert.match(agent, /SAS Interactive Desktop Broker/);
  assert.match(agent, /executeInputHelper\(args\)/);
  assert.match(agent, /revisa diagnostic\.native para confirmar/);
  assert.match(agent, /executePrivilegedBrokerRaw\("CAPTURE"/);
  assert.match(agent, /executePrivilegedBroker\("SEND_SAS"/);
  assert.match(agent, /event.type === "privileged_authorize"/);
});

test("native workers attach to the active input desktop and installers protect the service", () => {
  for (const helper of ["sas-input-helper", "sas-capture-helper"]) {
    const source = read("tools", helper, "Program.cs");
    assert.match(source, /OpenInputDesktop/);
    assert.match(source, /SetThreadDesktop/);
    assert.match(source, /--result-file/);
    assert.match(source, /--server/);
    assert.match(source, /Console\.ReadLine/);
    if (helper === "sas-input-helper") { assert.match(source, /SetProcessDpiAwarenessContext/); assert.match(source, /SendInputChecked/); assert.match(source, /Thread\.Sleep\(55\)/); }
  }
  const capture = read("tools", "sas-capture-helper", "Program.cs");
  assert.match(capture, /new Thread/);
  assert.match(capture, /ApartmentState\.MTA/);
  assert.match(capture, /DrawCursor/);
  assert.match(capture, /GetCursorInfo/);
  const brokerSource = read("tools", "sas-secure-attention-broker", "Program.cs");
  assert.match(brokerSource, /Path\.Combine\(AppDomain\.CurrentDomain\.BaseDirectory,file\)/);
  const serviceHost = read("tools", "sas-service-host", "SasServiceHost.cs");
  assert.match(serviceHost, /rawArguments=script\.StartsWith/);
  assert.match(serviceHost, /new ProcessStartInfo\(nodeExe, childArguments\)/);

  const install = read("scripts", "install-client.ps1");
  assert.match(install, /SAS Desktop Control Service/);
  assert.match(install, /"obj=", "LocalSystem"/);
  assert.match(install, /"start=", "delayed-auto"/);
  assert.match(install, /Invoke-ScCommand @\("failure"/);
  assert.match(install, /SAS_PRIVILEGED_BROKER_PIPE/);
  assert.match(install, /\*S-1-5-18:\(OI\)\(CI\)F/);
  assert.match(install, /secure_attention_service/);
  assert.match(install, /SAS Privileged Desktop Broker Recovery/); // removed during migration and cleanup
  assert.match(install, /\$brokerFallbackPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM"/);
  assert.match(install, /Wait-PrivilegedBrokerPipe/);
  assert.doesNotMatch(install, /throw "SAS Desktop Control Service no pudo iniciar ni repararse/);
  assert.match(install, /\$brokerStartupMode = "unavailable"/);
  assert.match(install, /\$brokerStartupMode = "system_task_fallback"/);

  const nsi = read("installer", "windows11", "SAS-Cliente.nsi");
  const cleanup = read("scripts", "stop-client-components.ps1");
  assert.match(nsi, /stop-client-components\.ps1/);
  assert.match(cleanup, /Invoke-NativeProcessBounded \$sc @\("stop", \$brokerServiceName\) 5000/);
  assert.match(cleanup, /"start=", "disabled"/);
  assert.match(cleanup, /FileShare\]::None/);
  assert.match(cleanup, /Stop-ScheduledTask -TaskName \$brokerFallbackTaskName/);
  assert.match(nsi, /Delete \/F \/TN "SAS Privileged Desktop Broker Recovery"/);
  assert.match(nsi, /RequestExecutionLevel admin/);

  const consent = read("scripts", "show-control-consent.ps1");
  assert.match(consent, /aplicaciones abiertas como administrador/i);
  assert.match(consent, /UAC/);
});

test("all privileged native executables exist after the release build", { skip: process.platform !== "win32" }, () => {
  for (const relative of [
    ["sas-secure-attention-broker", "SasSecureAttentionBroker.exe"],
    ["sas-input-helper", "SasInputHelper.exe"],
    ["sas-capture-helper", "SasCaptureHelper.exe"]
  ]) {
    assert.equal(fs.existsSync(path.join(root, "tools", relative[0], "bin", "Release", relative[1])), true, relative[1]);
  }
});
