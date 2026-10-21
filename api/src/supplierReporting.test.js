import "./pucComparator.test.js";
import "./pharmacyState.test.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {includedPurchaseSupplier,sourceSupplierRows,purchaseSupplierChannelSQL} from "./supplierReporting.js";
import {setupDashboardInsights} from "./dashboardInsights.js";
test("exclusión por código y nombre, vinculada al cliente SQL",()=>{
 const text=includedPurchaseSupplier({tenant:"$6",code:"t.proveedor_id",name:"t.proveedor_nombre"});
 assert.match(text,/pm.cliente_slug=\$6/);
 assert.match(text,/pm.codigo_origen/);
 assert.match(text,/pm.nombre/);
 assert.match(text,/pm.ignorar_informes=true/);
});
test("rechaza expresiones SQL externas",()=>{
 assert.throws(()=>includedPurchaseSupplier({tenant:"$1",code:"t.id);DROP TABLE x;--"}));
});
test("los proveedores sincronizados reciben indicadores guardables y overrides",()=>{
 const rows=sourceSupplierRows([{id:"9",sourceCode:"AAA",name:"Mi proveedor",type:"mayorista",cooperative:true,ignoreReports:true}],
 [{sourceCode:"aaa",name:"Nombre ERP"},{sourceCode:"BBB",name:"Externo"}]);
 assert.equal(rows.length,2);
 const a=rows.find(x=>x.sourceCode==="AAA"),b=rows.find(x=>x.sourceCode==="BBB");
 assert.equal(a.ignoreReports,true);assert.equal(a.cooperative,true);assert.equal(a.name,"Mi proveedor");
 assert.equal(b.id,null);assert.equal(b.ignoreReports,false);
});

test("Dashboard clasifica compras exclusivamente por el check de cooperativa",()=>{
 const sql=purchaseSupplierChannelSQL("pm");
 assert.equal(sql,"CASE WHEN pm.cooperativa IS TRUE THEN 'cooperativa' ELSE 'laboratorio' END");
 assert.doesNotMatch(sql,/\.tipo|sin_clasificar|mayorista/);
 assert.throws(()=>purchaseSupplierChannelSQL("pm; DROP TABLE proveedores"),/Alias SQL/);
});

test("Inicio permite comparar PUC del mismo artículo entre cooperativa y laboratorio",async()=>{
 const routes={},queries=[];
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const pool={async query(sql,params=[]){
  queries.push({sql,params});
  if(sql.includes("information_schema.columns")&&sql.includes("fm_recepciones_analitica"))
   return {rows:["farmacia_codigo","fecha","articulo_id","proveedor_id","unidades","coste_unitario"]
    .map(column_name=>({column_name}))};
  if(sql.includes("SELECT channel,sum(units*puc)"))
   return {rows:[{channel:"cooperativa",value:120,units:40,lines:4},
    {channel:"laboratorio",value:60,units:30,lines:3}]};
  if(sql.includes("HAVING count(DISTINCT channel)=2"))
   return {rows:[{pharmacyId:"1",articleId:"1234",coopPuc:3,labPuc:2,
    coopUnits:40,labUnits:30}]};
  if(sql.includes("information_schema.columns")&&sql.includes("table_name='articulos'"))
   return {rows:[]};
  throw Error("Consulta inesperada: "+sql.slice(0,140));
 }};
 setupDashboardInsights(app,pool,{requireTenant:()=>[]});
 const req={query:{desde:"2026-10-01",hasta:"2026-10-21",farmacias:"1"},
  context:{role:"superadministrador",modules:{dashboard:true},
   allowedPharmacyIds:[1],pharmacies:[{id:"1",name:"Farmacia 1",databaseCode:"ABA"}],
   client:{slug:"ampedia",schema:"ampedia"}}};
 let status=200,answer=null,error=null;
 const res={status(value){status=value;return this},json(value){answer=value;return this}};
 await routes["/api/analytics/dashboard/canales-compra"](req,res,e=>{error=e});
 if(error)throw error;
 assert.equal(status,200);
 assert.equal(answer.available,true);
 assert.deepEqual(answer.channels.map(c=>c.channel),["cooperativa","laboratorio"]);
 assert.equal(answer.comparisons.length,1,"el comparador no debe ocultar referencias compartidas");
 assert.equal(answer.comparisons[0].articleId,"1234");
 assert.equal(answer.comparisons[0].difference,1);
 assert.equal(answer.comparisons[0].potentialSaving,40);
 const sql=queries.find(({sql})=>sql.includes("HAVING count(DISTINCT channel)=2")).sql;
 assert.match(sql,/CASE WHEN pm\.cooperativa IS TRUE THEN 'cooperativa' ELSE 'laboratorio' END/);
 assert.doesNotMatch(sql,/pm\.tipo/,"no debe depender del tipo histórico del proveedor");
 assert.match(sql,/pm\.ignorar_informes=true/,"respetar proveedores excluidos");
 assert.match(sql,/f\.id=ANY\(\$3::int\[\]\)/,"respetar farmacias autorizadas");
});
