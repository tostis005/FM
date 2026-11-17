import test from "node:test";
import assert from "node:assert/strict";
import {normalizeGenericOffers,calculateGenericAllocation,setupGenericosOfertas} from "./genericosOfertas.js";

const row=(overrides={})=>({
 laboratory:"CINFA",cn:"659407",name:"Medicamento EFG",pvl:6.4,
 discount:0.65,net:2.24,iva:0.04,puc:2.3296,
 minimum:null,pack:null,box:null,...overrides
});
test("importación de tarifas por pestaña y CN sin inventar equivalencias",()=>{
 const data=normalizeGenericOffers([
  row(),row({laboratory:"ALMUS",cn:"721824",puc:0.93184}),
  row()
 ]);
 assert.equal(data.rows.length,2);
 assert.equal(data.duplicates.length,1);
 assert.deepEqual(data.rows.map(r=>r.laboratory),["CINFA","ALMUS"]);
});
test("rechaza tarifas distintas para el mismo CN y laboratorio",()=>{
 assert.throws(()=>normalizeGenericOffers([row(),row({puc:2.1})]),/tarifas distintas/);
});
test("no acepta CN, porcentaje ni PUC no válidos",()=>{
 for(const invalid of [row({cn:"abc"}),row({puc:-1}),row({discount:65}),
  row({minimum:-10}),row({iva:1.2})])
  assert.throws(()=>normalizeGenericOffers([invalid]),/inválidos/);
});
test("reparto objetivo conserva porcentaje restante y unidades",()=>{
 assert.deepEqual(calculateGenericAllocation(101,[{percent:20},{percent:30}]),[20,31]);
 assert.deepEqual(calculateGenericAllocation(3,[{percent:50},{percent:50}]),[2,1]);
 assert.throws(()=>calculateGenericAllocation(100,[{percent:60},{percent:60}]),/superar/);
});

test("API de objetivos solo permite un laboratorio destino por DCPF",async()=>{
 const routes=new Map(),calls=[];
 const app={
  get(path,...handlers){routes.set("GET "+path,handlers.at(-1))},
  put(path,...handlers){routes.set("PUT "+path,handlers.at(-1))},
  post(path,...handlers){routes.set("POST "+path,handlers.at(-1))}
 };
 const connection={async query(sql,values){
  calls.push({sql,values});
  if(sql.includes("SELECT o.laboratorio_fuente AS laboratory,o.cn"))
   return {rows:[{laboratory:"NORMON",cn:"663922"},{laboratory:"CINFA",cn:"659407"}]};
  return {rows:[]};
 },release(){}};
 const pool={connect:async()=>connection};
 setupGenericosOfertas(app,pool,{requireTenantModule:()=>[]});
 const fn=routes.get("PUT /api/genericos/ofertas/objetivos/:dcpf");
 assert.equal(typeof fn,"function");
 const ctx={role:"gestor",client:{slug:"farmacia-prueba",demo:false},
  modules:{genericos:true}};
 const run=async(goals)=>{
  const req={params:{dcpf:"111"},body:{goals},context:ctx,user:{email:"gestor@test.es"}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   json(data){this.body=data;return this}};
  await fn(req,res,e=>{throw e});
  return res;
 };
 const multi=await run([{laboratory:"NORMON",cn:"663922",percent:40},
  {laboratory:"CINFA",cn:"659407",percent:50}]);
 assert.equal(multi.statusCode,400,"Dos objetivos se rechazan aunque sumen menos del 100%");
 assert.equal(calls.length,0,"La invalidación ocurre antes de abrir transacción");
 const one=await run([{laboratory:"NORMON",cn:"663922",percent:40}]);
 assert.equal(one.statusCode,200);
 assert.equal(one.body.count,1);
 assert.equal(calls.filter(x=>x.sql.includes("INSERT INTO farmetrica.genericos_objetivos_laboratorios")).length,1);
 assert.ok(calls.some(x=>x.sql.includes("DELETE FROM farmetrica.genericos_objetivos_laboratorios")),
  "Se reemplazan los objetivos antiguos, sin conservar cuotas anteriores");
});
