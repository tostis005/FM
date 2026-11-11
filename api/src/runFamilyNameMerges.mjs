// Consolidación real de familias por nombre normalizado.
// node src/runFamilyNameMerges.mjs --cliente ampedia          (solo lectura)
// node src/runFamilyNameMerges.mjs --cliente ampedia --apply  (atómico)
import pg from "pg";
import {consolidateFamiliesByName,consolidateFamilyNamesUntilStable} from "./familyNameMerge.js";
const args=process.argv;
const slug=args.includes("--cliente")?args[args.indexOf("--cliente")+1]:"ampedia";
const apply=args.includes("--apply");
if(!/^[a-z][a-z0-9_]{1,62}$/.test(String(slug)))throw Error("Cliente incorrecto");
if(!process.env.DATABASE_URL)throw Error("DATABASE_URL ausente");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
 max:2,connectionTimeoutMillis:12000,query_timeout:150000,statement_timeout:150000});
const db=await pool.connect();
try{
 await db.query("BEGIN");
 await db.query("SET LOCAL statement_timeout = '150s'");
 await db.query("SELECT pg_advisory_xact_lock(hashtext('familias:' || $1))",[slug]);
 const baseline=apply?(await db.query(
  "SELECT (SELECT count(*)::int FROM farmetrica.familias_globales_articulos WHERE cliente_slug=$1) AS articulos,"+
  " (SELECT count(*)::int FROM farmetrica.familias_globales_alias WHERE cliente_slug=$1) AS alias",
  [slug])).rows[0]:null;
 const result=apply?await consolidateFamilyNamesUntilStable(db,slug):
  await consolidateFamiliesByName(db,slug,{dryRun:true});
 if(apply){
  const {rows:after}=await db.query(
   "SELECT (SELECT count(*)::int FROM farmetrica.familias_globales_articulos WHERE cliente_slug=$1) AS articulos,"+
   " (SELECT count(*)::int FROM farmetrica.familias_globales_alias WHERE cliente_slug=$1) AS alias",
   [slug]);
  if(after[0].articulos!==baseline.articulos||after[0].alias!==baseline.alias)
   throw Error("La unificación no conservó todos los artículos y nombres locales");
  const {rows:invalid}=await db.query(
   "SELECT count(*)::int AS n FROM farmetrica.familias_globales_articulos l"+
   " JOIN farmetrica.familias_globales g ON g.cliente_slug=l.cliente_slug AND g.id=l.familia_id"+
   " WHERE l.cliente_slug=$1 AND NOT g.activo",[slug]);
  if(invalid[0].n)throw Error("Hay artículos asociados a familias inactivas; se cancela la operación");
 }
 await db.query(apply?"COMMIT":"ROLLBACK");
 console.log("FAMILIAS_MISMO_NOMBRE",JSON.stringify({
  cliente:slug,modo:apply?"aplicado":"simulacion",
  activasAntes:result.activeFamilies,unificaciones:result.actions.length,
  familiasEsperadas:result.uniqueFamilies,fusionadas:result.merged,
  nombresLocalesMovidos:result.aliasesMoved,articulosMovidos:result.articlesMoved,
  exposicionesMigradas:result.stockRulesMoved,
  ambiguasEntreSegmentos:result.ambiguousCrossSegment,
  casosQueRequierenRevision:(result.ambiguousExamples||[]).slice(0,20),
  pasadas:result.passes||0,
  muestras:result.actions.slice(0,20).map(a=>({nombre:a.canonicalName,
   origen:a.sourceId,destino:a.destinationId,segmento:a.toSegment,razon:a.reason}))
 }));
}catch(error){
 try{await db.query("ROLLBACK")}catch{}
 throw error;
}finally{db.release();await pool.end();}
