import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const output=path.resolve(process.argv[2]||"C:/SAS-Secrets/update-signing");fs.mkdirSync(output,{recursive:true});
const {privateKey,publicKey}=crypto.generateKeyPairSync("ed25519");
const privatePath=path.join(output,"sas-update-private.pem"),publicPath=path.join(output,"sas-update-public.pem");
if(fs.existsSync(privatePath)) throw new Error("La clave privada ya existe; no se reemplazo.");
fs.writeFileSync(privatePath,privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600});fs.writeFileSync(publicPath,publicKey.export({type:"spki",format:"pem"}));
console.log(JSON.stringify({privateKey:privatePath,publicKey:publicPath,warning:"Guarda la clave privada fuera del paquete y con respaldo seguro."},null,2));
