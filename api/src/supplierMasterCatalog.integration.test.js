import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupTenant} from "./tenant.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

test("PostgreSQL: el maestro incluye proveedores de recepciones aunque ya haya otros sincronizados, sin confundir farmacias",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  const {rows:shops}=await db.query(`SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
   FROM farmetrica.farmacias f WHERE f.cliente_slug='ampedia' ORDER BY f.id LIMIT 2`);
  if(!shops.length)return;
  const suffix=String(Date.now())+"_"+Math.floor(Math.random()*1e6);
  const erpOnly="QA_ERPM_"+suffix,receiptOnly="QA_RECM_"+suffix,shared="QA_SHARED_"+suffix;
  await db.query(`INSERT INTO ampedia.proveedores(farmacia_codigo,origen_id,nombre)
    VALUES($1,$2,$3)`,[shops[0].code,erpOnly,"LABORATORIO ERP QA"]);
  await db.query(`INSERT INTO ampedia.fm_recepciones_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,proveedor_origen_id,lineas_completas)
   VALUES($1,'farmatic',$2,'2026-10-24',$3,true)`,
   [shops[0].code,"QA-MASTER-"+suffix,receiptOnly]);
  if(shops.length>1){
   await db.query(`INSERT INTO ampedia.proveedores(farmacia_codigo,origen_id,nombre)
    VALUES ($1,$3,'COOPERATIVA QA'),($2,$3,'LABORATORIO QA')`,
    [shops[0].code,shops[1].code,shared]);
  }

  const routes=new Map();
  const app={
   get(path,...handlers){routes.set(path,handlers)},
   post(){},put(){},patch(){},delete(){}
  };
  setupTenant(app,db,{requireUser:(_req,_res,next)=>next(),
   requireSuperadmin:(_req,_res,next)=>next()});
  const handlers=routes.get("/api/tenant/proveedores");
  assert.ok(handlers);
  const req={user:{role:"superadministrador",tenants:[],email:"qa@example.test"},
   query:{},headers:{},get:name=>name==="x-farmetrica-cliente"?"ampedia":undefined};
  let data,code=200,error;
  const res={
   status(value){code=value;return this},
   json(value){data=value;return this}
  };
  for(const middleware of handlers.slice(0,-1))
   await middleware(req,res,e=>{if(e)error=e});
  if(error)throw error;
  await handlers.at(-1)(req,res,e=>{error=e});
  if(error)throw error;
  assert.equal(code,200);
  assert.ok(Array.isArray(data));
  assert.ok(data.some(s=>s.sourceCode===erpOnly),"proveedor sincronizado sigue presente");
  const rec=data.find(s=>s.sourceCode===receiptOnly);
  assert.ok(rec,"el proveedor presente solo en albaranes no desaparece");
  assert.equal(rec.fromReceipts,true);
  assert.ok(rec.pharmacies.includes(String(shops[0].id)));
  if(shops.length>1){
   const conflict=data.find(s=>s.sourceCode===shared);
   assert.ok(conflict);
   assert.equal(conflict.nameConflict,true);
   assert.equal(conflict.origins.filter(o=>o.source==="farmatic").length,2);
  }
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
