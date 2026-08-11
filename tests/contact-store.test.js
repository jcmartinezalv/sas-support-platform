import test from "node:test";
import assert from "node:assert/strict";
import { createContactStore } from "../src/contacts/contact-store.js";

test("agenda rejects empty and duplicate customer cards", () => {
  const store=createContactStore();
  assert.throws(()=>store.create({name:""}),error=>error.statusCode===400);
  store.create({name:"Cliente Uno",company:"Empresa",phone:"+52 55 1234 5678",email:"cliente@empresa.test"});
  assert.throws(()=>store.create({name:"Otro",company:"Otra",phone:"525512345678"}),error=>error.statusCode===409);
  assert.throws(()=>store.create({name:"cliente uno",company:"empresa"}),error=>error.statusCode===409);
  assert.throws(()=>store.create({name:"Otro correo",company:"Empresa B",email:"CLIENTE@empresa.test"}),error=>error.statusCode===409);
  assert.equal(store.findByPhone("525512345678").email,"cliente@empresa.test");
});
