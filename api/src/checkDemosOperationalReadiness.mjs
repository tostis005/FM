// Smoke integral REAL de las dos demos, en PostgreSQL READ ONLY.
// No extrae nombres, CN, pedidos, vendedores ni importes al log.
import assert from "node:assert/strict";
import pg from "pg";
import {resolveDemoSourceScope} from "./demoDataScope.js";
import {listUnifiedSuppliers,readUnifiedSupplierCN} from "./unifiedSuppliers.js";
import {latestSupplierCN} from "./preparadorLastReceipt.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readLaboratoryOrderMatrix,setupLaboratoryOrderPlanner} from "./laboratoryOrderPlanner.js";
import {demoAgendaLaboratoryCounts} from "./demoPreparadorSnapshot.js";

if(!process.env.DATABASE_URL)throw Error("DATABASE_URL necesario");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
 max:1,connectionTimeoutMillis:5000,statement_timeout:20000,query_timeout:22000});
const db=await pool.connect();
try{
 await db.query("BEGIN READ ONLY");
 await db.query("SET LOCAL statement_timeout='20s'");
 for(const slug of ["demo_farmetrica","demo_individual"]){
  const {rows:clients}=await db.query(
   "SELECT slug,esquema_datos,demo_origen_slug FROM farmetrica.clientes WHERE slug=$1 AND activo",
   [slug]);
  assert.equal(clients.length,1,slug+": cliente inexistente");
  const client=clients[0];
  assert.equal(client.demo_origen_slug,"ampedia");
  assert.match(client.esquema_datos,/^[a-z][a-z0-9_]{1,62}$/);
  const {rows:pharmacies}=await db.query(
   "SELECT id::text,nombre AS name,activo AS active,codigo_origen AS \"databaseCode\""+
   " FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo AND "+
   "coalesce(tipo_establecimiento,'farmacia')='farmacia' ORDER BY id",[slug]);
  const ids=pharmacies.map(p=>Number(p.id));
  assert.ok(ids.length>=1,
   slug+": ninguna farmacia activa; el administrador puede activar o desactivar farmacias");
  const ctx={client:{slug,schema:client.esquema_datos,demo:true},
   pharmacies,allowedPharmacyIds:ids,role:"superadministrador",
   modules:{compras:true,stock:true,ventas:true}};
  const origin=await resolveDemoSourceScope(db,ctx,ids);
  assert.equal(origin.ids.length,ids.length);
  const {rows:catalog}=await db.query({text:
   'SELECT EXISTS(SELECT 1 FROM "'+client.esquema_datos+'".articulos a '+
   'JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[]) '+
   'WHERE upper(btrim(a.farmacia_codigo))='+pharmacyDataCodeSQL("f")+
   ' AND a.stock_actual>0 LIMIT 1) AS stock',
   values:[slug,ids],query_timeout:12000});
  assert.equal(catalog[0]?.stock,true,slug+": catálogo sin existencias");
  const {rows:docs}=await db.query({text:
   'SELECT EXISTS(SELECT 1 FROM "'+client.esquema_datos+
   '".fm_recepciones_analitica r '+
   'JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[]) '+
   'WHERE upper(btrim(r.farmacia_codigo))='+pharmacyDataCodeSQL("f")+
   ' LIMIT 1) AS receipts',
   values:[slug,ids],query_timeout:12000});
  assert.equal(docs[0]?.receipts,true,slug+": compras no disponibles");
  const labs=await listUnifiedSuppliers(db,ctx,ids,true);
  assert.ok(labs.length>0,slug+": selector de laboratorios vacío");
  const agendaCN=await demoAgendaLaboratoryCounts(db,ctx,ids);
  assert.ok(agendaCN.size>0&&agendaCN.has(String(labs[0].id)),
    slug+": agenda no muestra el laboratorio seleccionado");
  const sample=await latestSupplierCN(db,ctx,ids,labs[0].id);
  assert.ok(sample?.length>0,slug+": laboratorio sin CN");
  // Ejecutar exactamente la agregación que utiliza el preparador, no solo
  // validar la existencia del caché: al elegir un laboratorio debe aparecer CN.
  const selected=sample[0];
  const prepared=await readUnifiedSupplierCN(db,ctx,{
   key:labs[0].key,pharmacies:ids,type:selected.tipo,search:selected.cn
  });
  assert.ok(prepared.rows.some(item=>String(item.cn)===String(selected.cn)),
   slug+": el preparador no muestra un CN confirmado del laboratorio");
  // Los CN del selector no bastan: validar en producción las columnas que
  // realmente muestra el preparador (stock, 3/12 meses, ventas y propuesta).
  const references=sample.filter(item=>item.tipo===selected.tipo).slice(0,25);
  const matrix=await readLaboratoryOrderMatrix(db,ctx,{
   key:labs[0].key,pharmacies:ids,type:selected.tipo,
   from:new Date(Date.now()-90*86400000).toISOString().slice(0,10),
   to:new Date().toISOString().slice(0,10),
   prefetchedRows:references.map(item=>({
    referencia:item.referencia,cn:item.cn,nombre:item.nombre
   }))
  });
  assert.equal(matrix.metricsUnavailable,false,
   slug+": fallo al calcular stock y ventas: "+(matrix.metricsErrorCode||"sin código"));
  assert.equal(matrix.rows.length,references.length,
   slug+": matriz con referencias incompletas");
  assert.ok(matrix.rows.every(item=>ids.every(id=>{
   const ph=item.byPharmacy?.[String(id)];
   return ph&&Number.isFinite(ph.stock)&&
    Number.isFinite(ph.units3)&&Number.isFinite(ph.units12)&&
    Number.isFinite(ph.unitsPeriod)&&Number.isFinite(ph.suggested);
  })),slug+": stock, ventas o propuesta ausentes en la matriz");
  // Validación del contrato HTTP: los códigos demo y el cuerpo enviado por
  // la interfaz deben superar la validación y devolver filas con métricas.
  const routes=new Map(),routeApp={
   post:(route,...handlers)=>routes.set(route,handlers),
   get:()=>{},put:()=>{},delete:()=>{}
  };
  setupLaboratoryOrderPlanner(routeApp,db,{requireTenant:()=>[(req,res,next)=>next()]});
  const endpoint=routes.get("/api/analytics/pedidos/matriz-referencias");
  assert.ok(endpoint,slug+": no existe endpoint de métricas");
  const req={context:ctx,body:{
   laboratorio:labs[0].key,tipo:selected.tipo,farmacias:ids,
   desde:new Date(Date.now()-90*86400000).toISOString().slice(0,10),
   hasta:new Date().toISOString().slice(0,10),
   referencias:references.slice(0,1).map(item=>({
    referencia:item.referencia,cn:item.cn,nombre:item.nombre
   }))
  }};
  let status=200,response,routeError;
  const res={status(code){status=code;return this},
   json(value){response=value;return this}};
  await endpoint.at(-1)(req,res,error=>{routeError=error});
  assert.equal(routeError,undefined,slug+": excepción al responder métricas");
  assert.equal(status,200,slug+": el endpoint rechaza una farmacia válida");
  assert.equal(response?.metricsUnavailable,false,
   slug+": el endpoint no entrega stock/ventas");
  assert.equal(response?.rows?.length,1,slug+": respuesta de métricas incompleta");
  const {rows:master}=await db.query(
   "SELECT EXISTS(SELECT 1 FROM farmetrica.familias_globales_articulos "+
   "WHERE cliente_slug=$1 LIMIT 1) AS families, "+
   "EXISTS(SELECT 1 FROM farmetrica.preparador_frecuencia_laboratorio "+
   "WHERE cliente_slug=$1 LIMIT 1) AS agenda",[slug]);
  assert.equal(master[0]?.families,true,slug+": clasificación inexistente");
  assert.equal(master[0]?.agenda,true,slug+": agenda inexistente");
  // Comprobar que la prueba se ejecutó solo en lectura, nunca contra ERP en escritura.
  console.info("DEMO_INTEGRAL_OK",JSON.stringify({slug,pharmacies:ids.length,
   laboratories:labs.length,sampleReferences:sample.length,
   salesAndPurchases:true,stock:true,families:true,agenda:true,
   verifiedMetrics:matrix.rows.length}));
 }
 await db.query("ROLLBACK");
}catch(error){
 await db.query("ROLLBACK").catch(()=>{});
 throw error;
}finally{db.release();await pool.end()}
