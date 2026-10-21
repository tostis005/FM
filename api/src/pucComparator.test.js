import test from "node:test";
import assert from "node:assert/strict";
import {setupPucComparator} from "./pucComparator.js";

function fixture(){
 const routes={},queries=[];
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const pool={async query(sql,values=[]){
  const text=typeof sql==="string"?sql:sql.text;
  const params=typeof sql==="string"?values:sql.values;
  queries.push({text,params});
  if(text.includes("information_schema.columns")&&text.includes("table_name IN"))
   return {rows:["farmacia_codigo","fecha","articulo_id","proveedor_id",
    "unidades","coste_unitario"].map(column_name=>({table_name:"fm_recepciones_analitica",column_name}))};
  if(text.includes("WITH classified AS"))
   return {rows:[{total:31,pharmacyId:"1",articleId:"1578",coopPuc:3.25,
    labPuc:2.50,difference:0.75,differencePct:23.0769,
    cheaper:"Laboratorio",potentialSaving:9}]};
  if(text.includes("table_name='articulos'"))return {rows:[]};
  throw Error("Unexpected SQL "+text.slice(0,180));
 }};
 setupPucComparator(app,pool,{requireTenant:()=>[]});
 const req={query:{desde:"2026-10-01",hasta:"2026-10-21",farmacias:"1"},
  context:{role:"superadministrador",modules:{dashboard:true},
   client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1],
   pharmacies:[{id:"1",name:"Farmacia 1",databaseCode:"ABA"}]}};
 async function request(query={}){
  let body,status=200,error;
  const res={json(value){body=value;return this},status(n){status=n;return this}};
  await routes["/api/analytics/dashboard/comparador-puc"]({...req,query:{...req.query,...query}},
   res,e=>{error=e});
  if(error)throw error;
  return {status,body};
 }
 return {request,queries};
}
test("el comparador pagina el universo completo y solo empareja ambos canales",async()=>{
 const {request,queries}=fixture();
 const {status,body}=await request({pagina:"2",tamano:"10",orden:"labPuc",direccion:"asc",
  columnas:JSON.stringify({pharmacy:["Farmacia 1"],cheaper:["Laboratorio"],article:"1578"})});
 assert.equal(status,200);
 assert.equal(body.total,31);
 assert.equal(body.page,2);
 assert.equal(body.rows.length,1);
 assert.equal(body.rows[0].labPuc,2.5);
 const {text,params}=queries.find(q=>q.text.includes("WITH classified AS"));
 assert.match(text,/HAVING count\(DISTINCT channel\)=2/);
 assert.match(text,/CASE WHEN pm\.cooperativa IS TRUE THEN 'cooperativa' ELSE 'laboratorio' END/);
 assert.match(text,/pm\.ignorar_informes=true/);
 assert.match(text,/t\.unidades>0 AND t\.coste_unitario>0/);
 assert.match(text,/ORDER BY "labPuc" ASC/);
 assert.match(text,/LIMIT \$\d+::int OFFSET \$\d+::int/);
 assert.match(text,/pharmacy_id=ANY\(\$\d+::text\[\]\)/);
 assert.match(text,/"cheaper"=ANY/);
 assert.match(text,/article ILIKE/);
 assert.equal(params.at(-2),10);
 assert.equal(params.at(-1),10);
});
test("no permite campos SQL, páginas o farmacias fuera del ámbito",async()=>{
 const {request}=fixture();
 const bad=await request({orden:"labPuc;DROP TABLE"});
 assert.equal(bad.status,400);
 const badSize=await request({tamano:"100000"});
 assert.equal(badSize.status,400);
 const forbidden=await request({farmacias:"2"});
 assert.equal(forbidden.status,403);
});
