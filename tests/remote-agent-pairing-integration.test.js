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
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Servidor aislado terminó con código ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("El servidor aislado no respondió a tiempo");
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test("isolated server pairs a WhatsApp session to the Windows agent end to end", async () => {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sas-pairing-"));
  const dataPath = path.join(tempRoot, "sas-db.json");
  const backupDir = path.join(tempRoot, "backups");
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = "pairing-integration-secret";
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HTTP_PORT: String(port),
      ENABLE_HTTP: "true",
      ENABLE_HTTPS: "false",
      PUBLIC_BASE_URL: baseUrl,
      SHORT_URL_PROVIDER: "internal",
      DATA_FILE_PATH: dataPath,
      BACKUP_DIR: backupDir,
      AGENT_SHARED_SECRET: secret,
      CONSOLE_SHARED_TOKEN: ""
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  try {
    await waitForHealth(baseUrl, child);
    const consoleHeaders = { "Content-Type": "application/json", "x-sas-role": "admin", "x-sas-actor": "pairing-test" };
    const created = await request(baseUrl, "/api/remote-sessions", {
      method: "POST",
      headers: consoleHeaders,
      body: JSON.stringify({ ticketId: "TCK-WHATSAPP-PAIR", customerPhone: "5215551002000", requestedBy: "Fisher" })
    });
    assert.equal(created.response.status, 201);
    assert.match(created.body.session.joinCode, /^[A-Z0-9]{6}$/);
    assert.equal(created.body.session.agentId, null);

    const agent = { machineId: "windows-agent-pair-1", hostname: "PC-CLIENTE", username: "cliente", os: "Windows 11", version: "0.4.0" };
    const paired = await request(baseUrl, "/api/agents/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": secret },
      body: JSON.stringify({ ...agent, joinCode: created.body.session.joinCode.toLowerCase() })
    });
    assert.equal(paired.response.status, 200, JSON.stringify(paired.body));
    assert.equal(paired.body.paired, true);
    assert.equal(paired.body.requiresConsent, true);
    assert.equal(paired.body.session.agentId, agent.machineId);
    assert.equal(paired.body.session.consent.decision, "pending");

    const conflicting = await request(baseUrl, "/api/agents/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": secret },
      body: JSON.stringify({ ...agent, machineId: "windows-agent-pair-2", joinCode: created.body.session.joinCode })
    });
    assert.equal(conflicting.response.status, 409);

    const consent = await request(baseUrl, `/api/remote-sessions/code/${created.body.session.joinCode}/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved", decidedBy: "customer" })
    });
    assert.equal(consent.response.status, 200);
    assert.equal(consent.body.session.status, "active");
    assert.equal(consent.body.session.controlConsent.decision, "approved");
    assert.equal(consent.body.session.screenShare.enabled, true);

    const polled = await request(baseUrl, "/api/agents/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-secret": secret },
      body: JSON.stringify(agent)
    });
    assert.equal(polled.response.status, 200);
    assert.equal(polled.body.sessions.length, 1);
    assert.equal(polled.body.sessions[0].id, created.body.session.id);

    const audit = await request(baseUrl, "/api/audit?limit=30", { headers: { "x-sas-role": "admin", "x-sas-actor": "pairing-test" } });
    assert.equal(audit.response.status, 200);
    assert.ok(audit.body.events.some((event) => event.action === "remote.pair_agent" && event.metadata.agentId === agent.machineId));
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve)).catch(() => {});
    const resolvedTemp = path.resolve(tempRoot);
    if (resolvedTemp.startsWith(path.resolve(os.tmpdir()))) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
});





test("temporary installation link enrolls one client with an individual credential", async () => {
  const port=await freePort(); const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),"sas-enroll-"));
  const baseUrl=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,["src/server.js"],{cwd:process.cwd(),env:{...process.env,HTTP_PORT:String(port),ENABLE_HTTP:"true",ENABLE_HTTPS:"false",PUBLIC_BASE_URL:baseUrl,SHORT_URL_PROVIDER:"internal",DATA_FILE_PATH:path.join(tempRoot,"db.json"),BACKUP_DIR:path.join(tempRoot,"backups"),AGENT_SHARED_SECRET:"global-test-secret",CONSOLE_SHARED_TOKEN:""},stdio:["ignore","pipe","pipe"],windowsHide:true});
  try {
    await waitForHealth(baseUrl,child); const headers={"Content-Type":"application/json","x-sas-role":"admin","x-sas-actor":"enroll-test"};
    const ticket=await request(baseUrl,"/api/tickets",{method:"POST",headers,body:JSON.stringify({customerName:"Cliente",customerPhone:"5215551002000",subject:"Instalar SAS",description:"Necesito soporte",source:"whatsapp"})});
    assert.equal(ticket.response.status,201);
    const link=await request(baseUrl,`/api/tickets/${ticket.body.ticket.id}/installation-link`,{method:"POST",headers,body:"{}"});
    assert.equal(link.response.status,201,JSON.stringify(link.body)); assert.match(link.body.installationUrl,/\/i\/[A-HJ-NP-Z2-9]{8}$/); assert.match(link.body.enrollment.shortCode,/^[A-HJ-NP-Z2-9]{8}$/);
    const code=link.body.installationUrl.split("/").pop();
    const inspected=await request(baseUrl,`/api/client-installations/code/${code}`); assert.equal(inspected.body.enrollment.status,"pending");
    const agent={machineId:"enrolled-agent-1",hostname:"DESKTOP-BRD5IOH",username:"cliente",os:"Windows 11",version:"0.4.0"};
    const enrolled=await request(baseUrl,"/api/agents/enroll",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...agent,enrollmentToken:code})});
    assert.equal(enrolled.response.status,201,JSON.stringify(enrolled.body)); assert.ok(enrolled.body.agentSecret); assert.notEqual(enrolled.body.agentSecret,"global-test-secret");
    const poll=await request(baseUrl,"/api/agents/poll",{method:"POST",headers:{"Content-Type":"application/json","x-agent-id":agent.machineId,"x-agent-secret":enrolled.body.agentSecret},body:JSON.stringify(agent)});
    assert.equal(poll.response.status,200);
    const invalidSupport=await request(baseUrl,"/api/agents/support-request",{method:"POST",headers:{"Content-Type":"application/json","x-agent-id":agent.machineId,"x-agent-secret":enrolled.body.agentSecret},body:JSON.stringify({customerName:"Ana",company:"",customerPhone:"123",email:"incorrecto",description:"Error"})});
    assert.equal(invalidSupport.response.status,400);
    const support=await request(baseUrl,"/api/agents/support-request",{method:"POST",headers:{"Content-Type":"application/json","x-agent-id":agent.machineId,"x-agent-secret":enrolled.body.agentSecret},body:JSON.stringify({customerName:"Ana",company:"Contoso",customerPhone:"5215551002000",email:"ana@example.com",description:"Outlook no abre"})});
    assert.equal(support.response.status,201,JSON.stringify(support.body)); assert.equal(support.body.ticket.equipmentId,agent.machineId); assert.equal(support.body.session.agentId,agent.machineId); assert.equal(support.body.ticket.customerPhone,"525551002000");
    const visibleTickets=await request(baseUrl,"/api/tickets",{headers}); assert.ok(visibleTickets.body.tickets.some((item)=>item.id===support.body.ticket.id&&item.equipmentId===agent.machineId));
    const reused=await request(baseUrl,"/api/agents/enroll",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...agent,machineId:"other",enrollmentToken:code})});
    assert.equal(reused.response.status,410);
    const agents=await request(baseUrl,"/api/agents",{headers}); assert.equal(agents.body.agents[0].authSecretHash,undefined);
  } finally {
    child.kill(); await new Promise((resolve)=>child.once("exit",resolve)).catch(()=>{}); const resolved=path.resolve(tempRoot); if(resolved.startsWith(path.resolve(os.tmpdir())))fs.rmSync(resolved,{recursive:true,force:true});
  }
});


test("unattended support keeps the password local and requires an authenticated device decision", async () => {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sas-unattended-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HTTP_PORT: String(port), ENABLE_HTTP: "true", ENABLE_HTTPS: "false", PUBLIC_BASE_URL: baseUrl, SHORT_URL_PROVIDER: "internal", DATA_FILE_PATH: path.join(tempRoot, "db.json"), BACKUP_DIR: path.join(tempRoot, "backups"), AGENT_SHARED_SECRET: "global-unattended-secret", CONSOLE_SHARED_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  try {
    await waitForHealth(baseUrl, child);
    const admin = { "Content-Type": "application/json", "x-sas-role": "admin", "x-sas-actor": "admin-fast" };
    const ticket = await request(baseUrl, "/api/tickets", { method: "POST", headers: admin, body: JSON.stringify({ customerName: "NOC", customerPhone: "5215551002001", subject: "Mantenimiento", description: "Soporte rápido", source: "console" }) });
    const link = await request(baseUrl, `/api/tickets/${ticket.body.ticket.id}/installation-link`, { method: "POST", headers: admin, body: "{}" });
    const code = link.body.installationUrl.split("/").pop();
    const agent = { machineId: "agent-unattended-e2e", hostname: "PC-NOC", username: "noc", os: "Windows 11", version: "0.4.0" };
    const enrolled = await request(baseUrl, "/api/agents/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...agent, enrollmentToken: code }) });
    const agentHeaders = { "Content-Type": "application/json", "x-agent-id": agent.machineId, "x-agent-secret": enrolled.body.agentSecret };

    const leaked = await request(baseUrl, "/api/agents/unattended-policy", { method: "POST", headers: agentHeaders, body: JSON.stringify({ machineId: agent.machineId, enabled: true, password: "Acceso-NOC-2026!", allowControl: false }) });
    assert.equal(leaked.response.status, 400);
    const configured = await request(baseUrl, "/api/agents/unattended-policy", { method: "POST", headers: agentHeaders, body: JSON.stringify({ machineId: agent.machineId, enabled: true, allowControl: false, configuredAt: new Date().toISOString(), policyRevision: "local-policy-1" }) });
    assert.equal(configured.response.status, 200, JSON.stringify(configured.body));
    assert.equal(configured.body.agent.unattendedAccess.enabled, true);
    assert.equal(configured.body.agent.unattendedAccess.passwordHash, undefined);

    const session = await request(baseUrl, "/api/remote-sessions", { method: "POST", headers: admin, body: JSON.stringify({ ticketId: ticket.body.ticket.id, agentId: agent.machineId }) });
    const tech = await request(baseUrl, `/api/remote-sessions/${session.body.session.id}/unattended-request`, { method: "POST", headers: { ...admin, "x-sas-role": "technician" }, body: "{}" });
    assert.equal(tech.response.status, 403);
    const requested = await request(baseUrl, `/api/remote-sessions/${session.body.session.id}/unattended-request`, { method: "POST", headers: admin, body: "{}" });
    assert.equal(requested.response.status, 202, JSON.stringify(requested.body));
    assert.equal(requested.body.session.status, "pending_unattended_authorization");
    const requestId = requested.body.session.unattendedRequest.id;

    const authorized = await request(baseUrl, "/api/agents/unattended-decision", { method: "POST", headers: agentHeaders, body: JSON.stringify({ machineId: agent.machineId, sessionId: session.body.session.id, requestId, decision: "approved", allowControl: false }) });
    assert.equal(authorized.response.status, 200, JSON.stringify(authorized.body));
    assert.equal(authorized.body.session.accessMode, "unattended");
    assert.equal(authorized.body.session.consent.decision, "approved");
    assert.equal(authorized.body.session.controlConsent.decision, "not_requested");
    assert.equal(authorized.body.session.status, "active");
    assert.equal(authorized.body.session.screenShare.enabled, true);

    const disabled = await request(baseUrl, "/api/agents/unattended-policy", { method: "POST", headers: agentHeaders, body: JSON.stringify({ machineId: agent.machineId, enabled: false, policyRevision: "local-policy-2" }) });
    assert.equal(disabled.response.status, 200);
    assert.deepEqual(disabled.body.closedSessions, [session.body.session.id]);
    const audit = await request(baseUrl, "/api/audit?limit=50", { headers: admin });
    assert.ok(audit.body.events.some((event) => event.action === "remote.unattended.requested"));
    assert.ok(audit.body.events.some((event) => event.action === "remote.unattended.approved"));
    assert.ok(audit.body.events.some((event) => event.action === "remote.close.unattended_policy_changed"));
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve)).catch(() => {});
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  }
});test("SAS Cliente answers desktop consent only for its assigned equipment", async () => {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sas-desktop-consent-"));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, HTTP_PORT: String(port), ENABLE_HTTP: "true", ENABLE_HTTPS: "false", PUBLIC_BASE_URL: baseUrl, SHORT_URL_PROVIDER: "internal", DATA_FILE_PATH: path.join(tempRoot, "db.json"), BACKUP_DIR: path.join(tempRoot, "backups"), AGENT_SHARED_SECRET: "desktop-consent-secret", CONSOLE_SHARED_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true
  });
  try {
    await waitForHealth(baseUrl, child);
    const admin = { "Content-Type": "application/json", "x-sas-role": "admin", "x-sas-actor": "desktop-consent-test" };
    const ticket = await request(baseUrl, "/api/tickets", { method: "POST", headers: admin, body: JSON.stringify({ customerName: "Ana", customerPhone: "5215557654321", subject: "Pantalla bloqueada", description: "Necesito soporte", source: "whatsapp" }) });
    const link = await request(baseUrl, `/api/tickets/${ticket.body.ticket.id}/installation-link`, { method: "POST", headers: admin, body: "{}" });
    const code = link.body.installationUrl.split("/").pop();
    const agent = { machineId: "desktop-consent-agent", hostname: "PC-ANA", username: "ana", os: "Windows 11", version: "0.5.0" };
    const enrolled = await request(baseUrl, "/api/agents/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...agent, enrollmentToken: code }) });
    const agentHeaders = { "Content-Type": "application/json", "x-agent-id": agent.machineId, "x-agent-secret": enrolled.body.agentSecret };
    const session = await request(baseUrl, "/api/remote-sessions", { method: "POST", headers: admin, body: JSON.stringify({ ticketId: ticket.body.ticket.id, agentId: agent.machineId, requestedBy: "tecnico-1" }) });
    const poll = await request(baseUrl, "/api/agents/poll", { method: "POST", headers: agentHeaders, body: JSON.stringify(agent) });
    assert.equal(poll.response.status, 200);
    assert.equal(poll.body.sessions[0].ticketSubject, "Pantalla bloqueada");
    const unauthenticated = await request(baseUrl, "/api/agents/session-consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: session.body.session.id, decision: "approved" }) });
    assert.equal(unauthenticated.response.status, 401);
    const consent = await request(baseUrl, "/api/agents/session-consent", { method: "POST", headers: agentHeaders, body: JSON.stringify({ machineId: agent.machineId, sessionId: session.body.session.id, decision: "approved", allowControl: false }) });
    assert.equal(consent.response.status, 200, JSON.stringify(consent.body));
    assert.equal(consent.body.session.consent.decision, "approved");
    assert.equal(consent.body.session.controlConsent.decision, "approved");
    assert.equal(consent.body.session.status, "active");
    assert.equal(consent.body.session.screenShare.enabled, true);
    const requested = await request(baseUrl, `/api/remote-sessions/${session.body.session.id}/control/request`, { method: "POST", headers: admin, body: "{}" });
    assert.equal(requested.response.status, 200, JSON.stringify(requested.body));
    const controlPoll = await request(baseUrl, "/api/agents/poll", { method: "POST", headers: agentHeaders, body: JSON.stringify(agent) });
    assert.equal(controlPoll.body.sessions[0].controlConsent.decision, "approved");
    const wrongAgent = await request(baseUrl, "/api/agents/control-consent", { method: "POST", headers: { ...agentHeaders, "x-agent-id": "otro-equipo" }, body: JSON.stringify({ sessionId: session.body.session.id, decision: "approved" }) });
    assert.equal(wrongAgent.response.status, 401);
    const control = await request(baseUrl, "/api/agents/control-consent", { method: "POST", headers: agentHeaders, body: JSON.stringify({ machineId: agent.machineId, sessionId: session.body.session.id, decision: "approved" }) });
    assert.equal(control.response.status, 409, JSON.stringify(control.body));
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve)).catch(() => {});
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()))) fs.rmSync(resolved, { recursive: true, force: true });
  }
});