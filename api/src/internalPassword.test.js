import test from "node:test";
import assert from "node:assert/strict";
import {hashInternalPassword,verifyInternalPassword,validInternalPassword} from "./internalPassword.js";
test("no guardar contraseñas en claro; scrypt con sal única",async()=>{
 const password="ClaveMuySegura-2026!";
 const [a,b]=await Promise.all([hashInternalPassword(password),hashInternalPassword(password)]);
 assert.notEqual(a,b);
 assert.match(a,/^scrypt\$16384\$8\$1\$/);
 assert.equal(await verifyInternalPassword(password,a),true);
 assert.equal(await verifyInternalPassword(password,b),true);
 assert.equal(await verifyInternalPassword("equivocada",a),false);
 assert.equal(await verifyInternalPassword(password,"invalido"),false);
 assert.ok(!a.includes(password));
});
test("contraseñas fuertes, sin limitar a cuentas Gmail",async()=>{
 assert.equal(validInternalPassword("corta"),false);
 assert.equal(validInternalPassword("123456789012"),true);
 await assert.rejects(()=>hashInternalPassword("corta"),/12/);
});
