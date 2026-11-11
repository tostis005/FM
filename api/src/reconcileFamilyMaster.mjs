// Ejecutar una sola vez la conciliación real, después de que la API haya
// aplicado las migraciones. Nunca modifica artículos originales del ERP.
import pg from "pg";
import {reconcileFamilies} from "./familyMaster.js";

const slug=process.argv.includes("--cliente")?process.argv[process.argv.indexOf("--cliente")+1]:"ampedia";
const version="familias-ampedia-20261111-v3";
const force=process.argv.includes("--force");
if(!/^[a-z][a-z0-9_]{1,62}$/.test(slug))throw Error("Cliente incorrecto");
if(!process.env.DATABASE_URL)throw Error("DATABASE_URL no disponible");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
 connectionTimeoutMillis:10000,query_timeout:180000,statement_timeout:180000,max:2});
try{
 const {rows:clients}=await pool.query(
  "SELECT slug,esquema_datos AS schema FROM farmetrica.clientes WHERE slug=$1 AND activo",
  [slug]);
 const client=clients[0];
 if(!client||!/^[a-z][a-z0-9_]{1,62}$/.test(client.schema))throw Error("No existe un cliente activo");
 const {rows:already}=await pool.query("SELECT version FROM farmetrica.familias_reconciliaciones_iniciales WHERE cliente_slug=$1",[slug]);
 if(!force&&already[0]?.version===version){
  console.log("FAMILIAS_INICIALIZADAS",JSON.stringify({cliente:slug,version,estado:"ya_aplicado"}));
 }else{
  const {rows:sites}=await pool.query(
   "SELECT id::text AS id,nombre AS name,codigo_origen AS \"sourceCode\" "+
   "FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo ORDER BY id",[slug]);
  const ctx={client:{slug:client.slug,schema:client.schema},establishments:sites};
  if(slug==="ampedia"){
   const schema='"'+client.schema+'"';
   const {rows:ready}=await pool.query(
    "SELECT "+
    "EXISTS(SELECT 1 FROM "+schema+".articulos WHERE upper(btrim(farmacia_codigo))='ALMACEN' "+
    "AND origen_id~'^[0-9]{6}$' AND CASE WHEN origen_id~'^[0-9]{6}$' THEN origen_id::int<400000 ELSE false END LIMIT 1) AS para,"+
    "EXISTS(SELECT 1 FROM "+schema+".articulos WHERE upper(btrim(farmacia_codigo))='ABA' "+
    "AND origen_id~'^[0-9]{6}$' AND CASE WHEN origen_id~'^[0-9]{6}$' THEN origen_id::int>=400000 ELSE false END LIMIT 1) AS med");
   if(!ready[0]?.para||!ready[0]?.med)throw Error("No están completas las referencias de Almacén (parafarmacia) y Abadía (medicación)");
  }
  const result=await reconcileFamilies(pool,ctx);
  if(!result.namesAvailable||!result.references||!result.localFamilies)
   throw Error("El catálogo no contiene nombres o familias de referencia; revisar sincronización");
  await pool.query(
   "INSERT INTO farmetrica.familias_reconciliaciones_iniciales "+
   "(cliente_slug,version,familias,articulos,pendientes) VALUES($1,$2,$3,$4,$5) "+
   "ON CONFLICT(cliente_slug) DO UPDATE SET "+
   "version=EXCLUDED.version,familias=EXCLUDED.familias,articulos=EXCLUDED.articulos,"+
   "pendientes=EXCLUDED.pendientes,ejecutado_en=now()",
   [slug,version,result.families,result.linked,result.unresolved]);
  console.log("FAMILIAS_INICIALIZADAS",JSON.stringify({
   cliente:slug,version,familias:result.families,familiasLocales:result.localFamilies,
   referencias:result.references,metodos:result.methods,
   articulosVinculados:result.linked,articulosSinFamilia:result.unresolved
  }));
 }
}finally{await pool.end();}
