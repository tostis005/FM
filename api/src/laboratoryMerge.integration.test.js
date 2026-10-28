import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
const run=promisify(execFile);
test("PostgreSQL: unir un laboratorio duplicado, conservar recepciones y revertir alias",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 const suffix="CI-UNIFICAR-LAB-TEST";
 let batch=null,ids=[];
 try{
  const a=await db.query(`INSERT INTO farmetrica.proveedores_unificados
   (cliente_slug,clave_unificada,nombre,clase)
   VALUES('ampedia',$1,'Laboratorios Rocalia, S.A.','DIRECTO'),
   ('ampedia',$2,'ROCALIA SL','DIRECTO') RETURNING id::text`,
   [suffix+"-A",suffix+"-B"]);
  ids=a.rows.map(x=>x.id);
  for(let i=0;i<ids.length;i++){
   await db.query(`INSERT INTO farmetrica.proveedores_unificados_alias
    (cliente_slug,proveedor_id,farmacia_codigo,codigo_origen,nombre_origen,procedencia)
    VALUES('ampedia',$1,'ABA',$2,$3,'farmatic')`,
    [ids[i],suffix+"-"+i,["Laboratorios Rocalia, S.A.","ROCALIA SL"][i]]);
  }
  const cwd=process.cwd();
  const cli=(action,id)=>run(process.execPath,["src/applyLaboratoryMerges.mjs"],{
   cwd:cwd.endsWith("/api")?cwd:cwd+"/api",
   env:{...process.env,DATABASE_URL:process.env.TEST_DB_URL,
    FM_LAB_MERGE_ACTION:action,FM_LAB_MERGE_BATCH_ID:id||""},timeout:30000});
  const applied=await cli("apply");
  const line=applied.stdout.split("\n").find(x=>x.startsWith("FM_UNIFICAR_LABORATORIOS "));
  assert.ok(line,"Lote registrado");
  const output=JSON.parse(line.slice("FM_UNIFICAR_LABORATORIOS ".length));
  assert.equal(output.success,true);
  assert.ok(output.mergedGroups>=1);
  batch=output.batch;
  const {rows:state}=await db.query(`SELECT p.id::text,p.activo,
   (SELECT count(*)::int FROM farmetrica.proveedores_unificados_alias a
    WHERE a.proveedor_id=p.id) AS aliases
   FROM farmetrica.proveedores_unificados p WHERE p.id=ANY($1::bigint[])
   ORDER BY p.id`,[ids]);
  assert.equal(state.filter(x=>x.activo).length,1);
  assert.equal(state.filter(x=>x.aliases>0).length,1);
  const restored=await cli("rollback",batch);
  const result=JSON.parse(restored.stdout.split("\n")
   .find(x=>x.startsWith("FM_UNIFICAR_LABORATORIOS "))
   .slice("FM_UNIFICAR_LABORATORIOS ".length));
  assert.equal(result.success,true);
  const {rows:original}=await db.query(`SELECT p.id::text,p.activo,
   (SELECT count(*)::int FROM farmetrica.proveedores_unificados_alias a
    WHERE a.proveedor_id=p.id) AS aliases
   FROM farmetrica.proveedores_unificados p WHERE p.id=ANY($1::bigint[])`,[ids]);
  assert.ok(original.every(x=>x.activo&&x.aliases===1));
 }finally{
  if(batch){
   await db.query("DELETE FROM farmetrica.laboratorios_unificacion_alias WHERE lote=$1",[batch]);
   await db.query("DELETE FROM farmetrica.laboratorios_unificacion_origenes WHERE lote=$1",[batch]);
   await db.query("DELETE FROM farmetrica.laboratorios_unificacion_lotes WHERE lote=$1",[batch]);
  }
  if(ids.length){
   await db.query("DELETE FROM farmetrica.proveedores_unificados_alias WHERE proveedor_id=ANY($1::bigint[])",[ids]);
   await db.query("DELETE FROM farmetrica.proveedores_unificados WHERE id=ANY($1::bigint[])",[ids]);
  }
  await db.end();
 }
});
