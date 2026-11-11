// Auditoría conservadora de denominaciones globales y sus CN compartidos.
// Sin --apply: 100 % SELECT y no cambia ningún artículo ni familia.
import pg from "pg";
import {groupFamilyDuplicates,scoreFamilyPair,planFamilyMerges} from "./familyDuplicates.js";

const slug=process.argv.includes("--cliente")?
 process.argv[process.argv.indexOf("--cliente")+1]:"ampedia";
if(!/^[a-z][a-z0-9_]{1,62}$/.test(slug))throw Error("Cliente inválido");
if(!process.env.DATABASE_URL)throw Error("DATABASE_URL no está disponible");
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:12000,query_timeout:90000,statement_timeout:90000});
const stamp=Date.now();
try{
 const [{rows:families},{rows:aliases},{rows:totals}]=await Promise.all([
  db.query("SELECT id::text AS id,nombre AS name,segmento AS segment,"+
   " referencia_farmacia AS \"referencePharmacy\",referencia_codigo AS \"referenceCode\","+
   " nombre_manual AS \"customName\",clave AS key"+
   " FROM farmetrica.familias_globales WHERE cliente_slug=$1 AND activo",[slug]),
  db.query("SELECT familia_id::text AS \"familyId\",farmacia_codigo AS \"pharmacyCode\","+
   " codigo_origen AS \"sourceCode\",nombre_origen AS \"sourceName\",metodo AS method"+
   " FROM farmetrica.familias_globales_alias WHERE cliente_slug=$1",[slug]),
  db.query("SELECT familia_id::text AS id,count(*)::int AS n"+
   " FROM farmetrica.familias_globales_articulos WHERE cliente_slug=$1 GROUP BY familia_id",[slug])
 ]);
 const pairs=groupFamilyDuplicates(families,aliases);
 if(pairs.length>1500)throw Error("Demasiados candidatos; requiere segmentación manual");
 const ids=[...new Set(pairs.flatMap(p=>[p.a,p.b]))];
 const articles=ids.length?(await db.query({
  text:"SELECT DISTINCT familia_id::text AS id,articulo_origen_id AS cn"+
   " FROM farmetrica.familias_globales_articulos"+
   " WHERE cliente_slug=$1 AND familia_id=ANY($2::bigint[])"+
   " AND articulo_origen_id ~ '^[0-9]{6}$'",
  values:[slug,ids],query_timeout:90000
 })).rows:[];
 const cnById=new Map(ids.map(id=>[id,new Set()]));
 for(const row of articles)cnById.get(row.id)?.add(row.cn);
 const counts=new Map(totals.map(r=>[r.id,Number(r.n)]));
 const scored=pairs.map(p=>scoreFamilyPair(p,cnById,counts))
  .sort((a,b)=>Number(b.safe)-Number(a.safe)||b.shared-a.shared||b.ratio-a.ratio);
 const planned=planFamilyMerges(scored);
 const candidates=scored.map(p=>({
  sourceId:p.sourceId,destinationId:p.destinationId,
  sourceName:p.left.id===p.sourceId?p.left.name:p.right.name,
  destinationName:p.left.id===p.destinationId?p.left.name:p.right.name,
  normalized:p.normalized,segment:p.segment,
  sourceReference:p.left.id===p.sourceId?p.left.referencePharmacy:p.right.referencePharmacy,
  destinationReference:p.left.id===p.destinationId?p.left.referencePharmacy:p.right.referencePharmacy,
  sharedCn:p.shared,ratioSmall:p.ratio,cnA:p.countA,cnB:p.countB,
  evidence:p.proof,exampleCns:p.samples,safe:p.safe,
  reason:p.reason
 }));
 const seen=ids.length,actionIds=new Set(planned.map(x=>x.sourceId));
 console.log("FAMILIAS_DUPLICADAS_AUDITORIA",JSON.stringify({
  slug,activeFamilies:families.length,localAliases:aliases.length,
  candidates:pairs.length,familiesConsidered:seen,
  suggestedMerges:planned.length,sharedCnCandidates:scored.filter(x=>x.shared>0).length,
  exactNameCandidates:scored.filter(x=>x.proof==="nombre_global").length,
  uncertainCandidates:scored.filter(x=>!x.safe).length,
  retainedAfterSafeMerges:families.length-planned.length,
  elapsedMs:Date.now()-stamp,
  safe:planned.slice(0,80).map(p=>candidates.find(x=>x.sourceId===p.sourceId&&x.destinationId===p.destinationId)),
  examplesForReview:candidates.filter(x=>!actionIds.has(x.sourceId)).slice(0,30)
 }));
}finally{await db.end()}
