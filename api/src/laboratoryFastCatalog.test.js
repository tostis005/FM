import test from "node:test";
import assert from "node:assert/strict";
import {readDirectLaboratoryCatalog,diagnosticLaboratorySources} from "./laboratoryFastCatalog.js";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";

const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};
const opts={key:"N:CINFA",type:"medicacion",pharmacies:[1],
 from:"2026-10-01",to:"2026-10-24",page:1,size:40,search:""};
const catalogRow={referencia:"790321",cn:"790321",nombre:"Cinfa medicamento",
 tipo:"medicacion",inMaster:true,inReceipts:false,generic:false,total:1};

function fixture({metricsError=false,empty=false}={}){
 const calls=[];
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text;
  calls.push({sql,values:q.values||[]});
  if(sql.includes("FROM farmetrica.preparador_exclusiones"))return {rows:[{cadena:"DESCATALOGADO"}]};
  if(sql.includes("SELECT intervalo_dias AS days"))return {rows:[{days:4}]};
  if(sql.includes("information_schema.columns"))return {rows:[{available:true}]};
  if(sql.includes("WITH pharmacies AS"))return {rows:empty?[]:[catalogRow]};
  if(sql.includes("WITH refs AS")){
   if(metricsError)throw Object.assign(Error("Stock unavailable"),{code:"42703"});
   return {rows:[{reference:"790321",pharmacyId:"1",stock:8,
    units3:30,units12:100,unitsPeriod:3,ordered:0,suggested:11}]};
  }
  throw Error("Unexpected SQL: "+sql.slice(0,200));
 }};
 return {pool,calls};
}
test("preparador usa exclusivamente Nomenclátor, ventas y recepciones",async()=>{
 const {pool,calls}=fixture();
 const result=await readDirectLaboratoryCatalog(pool,ctx,opts);
 const query=calls.find(q=>q.sql.includes("WITH pharmacies AS"));
 assert.equal(result.total,1);
 assert.equal(result.rows[0].cn,"790321");
 assert.match(query.sql,/nomenclator_presentaciones/);
 assert.match(query.sql,/fm_ventas_analitica/);
 assert.match(query.sql,/fm_recepciones_analitica/);
 assert.match(query.sql,/proveedores_maestro/);
 assert.match(query.sql,/proveedores_laboratorios/);
 assert.match(query.sql,/preparador_exclusiones|unnest\(\$8::text\[\]\)/);
 assert.doesNotMatch(query.sql,/articulos_laboratorio_maestro/);
 assert.deepEqual(query.values,["N:CINFA",[1],"ampedia","medicacion","",40,0,["DESCATALOGADO"]]);
});
test("un fallo al calcular stock no oculta las presentaciones verificadas",async()=>{
 const {pool}=fixture({metricsError:true});
 const result=await readLaboratoryOrderMatrix(pool,ctx,opts);
 assert.equal(result.total,1);
 assert.equal(result.rows[0].cn,"790321");
 assert.equal(result.metricsUnavailable,true);
 assert.match(result.warning,/Se han recuperado los artículos/);
 assert.equal(result.rows[0].totalSold,null);
 assert.equal(result.frequencyDays,4);
});
test("sin farmacias siguen visibles las presentaciones oficiales",async()=>{
 const {pool}=fixture();
 const result=await readLaboratoryOrderMatrix(pool,ctx,{...opts,pharmacies:[]});
 assert.equal(result.total,1);
 assert.equal(result.metricsUnavailable,true);
 assert.match(result.warning,/No hay farmacias/);
});
test("ningún catálogo histórico rellena un catálogo vacío del preparador",async()=>{
 const {pool,calls}=fixture({empty:true});
 const result=await readLaboratoryOrderMatrix(pool,ctx,opts);
 assert.equal(result.total,0);
 assert.equal(result.rows.length,0);
 assert.ok(!calls.some(q=>q.sql.includes("WITH aliases AS")));
});
test("diagnóstico separa tipos sin inventar productos",async()=>{
 const {pool}=fixture();
 const result=await diagnosticLaboratorySources(pool,ctx,opts);
 assert.equal(result.pharmacyCount,1);
 assert.equal(result.sources[0].status,"ok");
 assert.equal(result.sources[0].total,1);
});
