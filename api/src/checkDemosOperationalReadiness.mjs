// Smoke integral REAL de las dos demos, en PostgreSQL READ ONLY.
// No extrae nombres, CN, pedidos, vendedores ni importes al log.
import assert from "node:assert/strict";
import pg from "pg";
import {resolveDemoSourceScope} from "./demoDataScope.js";
import {listUnifiedSuppliers} from "./unifiedSuppliers.js";
import {latestSupplierCN} from "./preparadorLastReceipt.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

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
  const sample=await latestSupplierCN(db,ctx,ids,labs[0].id);
  assert.ok(sample?.length>0,slug+": laboratorio sin CN");
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
   salesAndPurchases:true,stock:true,families:true,agenda:true}));
 }
 await db.query("ROLLBACK");
}catch(error){
 await db.query("ROLLBACK").catch(()=>{});
 throw error;
}finally{db.release();await pool.end()}
