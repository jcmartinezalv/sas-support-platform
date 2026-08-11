import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUpdateService, compareVersions, signManifest, validateManifest } from "../src/updates/update-service.js";
function baseManifest(){return {schemaVersion:1,product:"SAS Support Platform",channel:"stable",version:"0.3.0",publishedAt:"2026-07-15T00:00:00.000Z",notes:["Mejora"],requiresRestart:true,package:{url:"stable/sas-update-0.3.0.zip",sha256:"A".repeat(64),size:4}};}
test("semantic versions compare without lexicographic errors",()=>{assert.equal(compareVersions("0.10.0","0.9.9"),1);assert.equal(compareVersions("1.0.0","1.0.0"),0);});
test("update manifest accepts a valid Ed25519 signature and same-origin package",()=>{const {privateKey,publicKey}=crypto.generateKeyPairSync("ed25519");const manifest=baseManifest();manifest.signature={algorithm:"ed25519",value:signManifest(manifest,privateKey)};const result=validateManifest(manifest,{channel:"stable",baseUrl:"https://setinfo.sytes.net/updates",publicKey:publicKey.export({type:"spki",format:"pem"}),requireSignature:true});assert.equal(result.signatureValid,true);assert.equal(result.package.url,"https://setinfo.sytes.net/updates/stable/sas-update-0.3.0.zip");});
test("update manifest rejects foreign origins and missing required signature",()=>{const foreign=baseManifest();foreign.package.url="https://evil.example/update.zip";assert.throws(()=>validateManifest(foreign,{channel:"stable",baseUrl:"https://setinfo.sytes.net/updates"}),/origen no autorizado/);assert.throws(()=>validateManifest(baseManifest(),{channel:"stable",baseUrl:"https://setinfo.sytes.net/updates",requireSignature:true}),/Firma/);});
test("update service checks, downloads and verifies a staged package",async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"sas-updater-"));const bytes=Buffer.from("test");const hash=crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();const manifest=baseManifest();manifest.package.sha256=hash;const config={updateRoot:path.join(root,"updates"),updateChannel:"stable",updateCheckEnabled:true,updateApplyEnabled:false,updateRequireSignature:false,updateBaseUrl:"https://setinfo.sytes.net/updates",updatePublicKey:"",updateAllowHttp:false,updateTimeoutMs:1000,updateDownloadTimeoutMs:1000,updateMaxBytes:1024,updateTaskName:"SAS",updateSchedulerTaskName:"SAS Update",updateHealthUrl:"https://setinfo.sytes.net/health"};let calls=0;const fetchImpl=async()=>{calls++;return calls===1?new Response(JSON.stringify(manifest),{status:200,headers:{"Content-Type":"application/json"}}):new Response(bytes,{status:200,headers:{"Content-Length":"4"}})};const service=createUpdateService({config,currentVersion:"0.2.7",projectRoot:process.cwd(),fetchImpl});const checked=await service.check();assert.equal(checked.available,true);const staged=await service.stage();assert.equal(staged.sha256,hash);assert.equal(fs.readFileSync(staged.packagePath,"utf8"),"test");fs.rmSync(root,{recursive:true,force:true});});
test("update apply persists a confirmed scheduler receipt",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"sas-updater-apply-"));
  fs.mkdirSync(path.join(root,"scripts"),{recursive:true});
  fs.writeFileSync(path.join(root,"scripts","apply-staged-update.ps1"),"test");
  fs.writeFileSync(path.join(root,"scripts","schedule-staged-update.ps1"),"test");
  const bytes=Buffer.from("scheduled-update");
  const hash=crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
  const manifest=baseManifest();
  manifest.package.sha256=hash;
  manifest.package.size=bytes.length;
  const config={
    updateRoot:path.join(root,"updates"),updateChannel:"stable",updateCheckEnabled:true,updateApplyEnabled:true,
    updateRequireSignature:false,updateBaseUrl:"https://setinfo.sytes.net/updates",updatePublicKey:"",updateAllowHttp:false,
    updateTimeoutMs:1000,updateDownloadTimeoutMs:1000,updateMaxBytes:1024,updateTaskName:"SAS Server",
    updateSchedulerTaskName:"SAS Update",updateHealthUrl:"https://setinfo.sytes.net/health"
  };
  let calls=0;
  const fetchImpl=async()=>++calls===1
    ?new Response(JSON.stringify(manifest),{status:200,headers:{"Content-Type":"application/json"}})
    :new Response(bytes,{status:200,headers:{"Content-Length":String(bytes.length)}});
  const spawnSyncImpl=(executable,args)=>{
    assert.equal(executable,"powershell.exe");
    const receiptPath=args[args.indexOf("-ReceiptPath")+1];
    assert.ok(receiptPath.endsWith("last-update-schedule.json"));
    fs.writeFileSync(receiptPath,JSON.stringify({status:"started",taskName:"SAS Update",targetVersion:"0.3.0"}));
    return {status:0,stdout:JSON.stringify({status:"scheduled"}),stderr:""};
  };
  const service=createUpdateService({config,currentVersion:"0.2.13",projectRoot:root,fetchImpl,spawnSyncImpl,platform:"win32"});
  await service.check();
  await service.stage();
  const applied=service.apply({version:"0.3.0",actorId:"admin"});
  assert.equal(applied.schedule.status,"started");
  assert.equal(service.status().lastSchedule.targetVersion,"0.3.0");
  fs.rmSync(root,{recursive:true,force:true});
});