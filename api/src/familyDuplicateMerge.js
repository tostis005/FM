// Aplicar exclusivamente fusiones aprobadas tras revisar evidencia CN real.
// Un único bloqueo por cliente, transacción atómica y auditoría irreversible.
import {cleanFamilyName} from "./familyMatching.js";
import {dedupFamilySlug,groupFamilyDuplicates,scoreFamilyPair} from "./familyDuplicates.js";
const id=x=>/^[1-9]\d*$/.test(String(x??""));
const accentCount=value=>(String(value||"").match(/[áéíóúüÁÉÍÓÚÜ]/g)||[]).length;
function preferAccents(destination,source,origins,normalized){
 const items=[destination,source,...origins.map(o=>o.sourceName||"")]
  .map(name=>cleanFamilyName(name,"")).filter(name=>dedupFamilySlug(name)===normalized);
 items.sort((a,b)=>accentCount(b)-accentCount(a));
 return accentCount(items[0])>accentCount(destination)?items[0]:null;
}
export function validateApprovedFamilyPair(scored,approval,aliases,cnById){
 const sourceId=String(approval.sourceId),destinationId=String(approval.destinationId);
 const samePair=scored&&new Set([scored.a,scored.b]).has(sourceId)&&
  new Set([scored.a,scored.b]).has(destinationId);
 const specialRequested=approval.allowMixedRange===true;
 // Dos excepciones de categoría no determinada contrastadas por artículo,
 // sin inferir ni cambiar su clasificación medicación/parafarmacia.
 const special=specialRequested&&samePair&&scored.proof==="nombre_global"&&
  scored.segment==="SIN_DETERMINAR"&&scored.shared>=15&&scored.ratio>=0.8;
 if(!samePair||(specialRequested&&!special)||
    (!specialRequested&&(!scored.safe||scored.sourceId!==sourceId||
      scored.destinationId!==destinationId))||
    scored.normalized!==approval.slug||scored.segment!==approval.segment||
    scored.shared<Number(approval.minimumShared||3))
  throw Error("Evidencia insuficiente para fusión "+sourceId+" → "+destinationId);
 const ids=new Set([sourceId,destinationId]);
 if(aliases.some(a=>ids.has(String(a.familyId))&&a.method==="manual"))
  throw Error("Hay equivalencias corregidas manualmente; no fusionar "+sourceId);
 const selected=[scored.left,scored.right];
 const source=selected.find(g=>String(g.id)===sourceId);
 const dest=selected.find(g=>String(g.id)===destinationId);
 if(!source||!dest||source.referencePharmacy||dest.customName||source.customName||
    (special&&dest.referencePharmacy))
  throw Error("La referencia o nombre editado impide esta fusión");
 for(const f of [source,dest]){
  const cns=cnById.get(String(f.id))||new Set();
  if(cns.size===0)throw Error("Familia sin CN contrastables");
  const below=[...cns].filter(cn=>Number(cn)<400000).length/cns.size;
  if(approval.segment==="SIN_DETERMINAR"){
   if(!special&&below>0.05&&below<0.95)
    throw Error("Familia sin clasificar con productos de ambos segmentos: "+f.id);
  }else{
   const compatible=approval.segment==="PARAFARMACIA"?below:1-below;
   if(compatible<0.95)
    throw Error("Mezcla de medicamentos/parafarmacia en familia "+f.id);
  }
 }
 return true;
}
export async function applyApprovedFamilyMerges(pool,slug,approvals,{apply=false}={}){
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(slug))throw Error("Cliente incorrecto");
 if(!Array.isArray(approvals)||!approvals.length||approvals.length>50)
  throw Error("Es necesario un listado explícito y acotado de fusiones");
 const seenSources=new Set(),seenTargets=new Set();
 for(const a of approvals){
  if(!id(a.sourceId)||!id(a.destinationId)||a.sourceId===a.destinationId||
     typeof a.slug!=="string"||!["MEDICACION","PARAFARMACIA","SIN_DETERMINAR"].includes(a.segment)||
     seenSources.has(a.sourceId)||seenSources.has(a.destinationId)||seenTargets.has(a.sourceId))
   throw Error("Lista de fusiones inválida o con cadenas conflictivas");
  seenSources.add(a.sourceId);seenTargets.add(a.destinationId);
 }
 const db=await pool.connect(),result=[];
 try{
  await db.query("BEGIN");
  await db.query("SET LOCAL statement_timeout = '155s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('familias:' || $1))",[slug]);
  await db.query("SELECT id FROM farmetrica.familias_globales"+
   " WHERE cliente_slug=$1 AND id=ANY($2::bigint[]) FOR UPDATE",
   [slug,[...new Set(approvals.flatMap(a=>[a.sourceId,a.destinationId]))]]);
  const [groups,aliases,countRows]=await Promise.all([
   // No lanzar consultas simultáneas sobre el mismo cliente PostgreSQL.
   db.query("SELECT id::text AS id,nombre AS name,segmento AS segment,"+
    " referencia_farmacia AS \"referencePharmacy\",nombre_manual AS \"customName\","+
    " activo AS active,fusionado_a::text AS \"mergedInto\""+
    " FROM farmetrica.familias_globales WHERE cliente_slug=$1",[slug]),
   db.query("SELECT familia_id::text AS \"familyId\",farmacia_codigo AS \"pharmacyCode\","+
    " codigo_origen AS \"sourceCode\",nombre_origen AS \"sourceName\",metodo AS method"+
    " FROM farmetrica.familias_globales_alias WHERE cliente_slug=$1",[slug]),
   db.query("SELECT familia_id::text AS id,count(*)::int AS n"+
    " FROM farmetrica.familias_globales_articulos WHERE cliente_slug=$1"+
    " AND familia_id=ANY($2::bigint[]) GROUP BY familia_id",
    [slug,[...new Set(approvals.flatMap(a=>[a.sourceId,a.destinationId]))]])
  ]);
  const all=groups.rows,allAliases=aliases.rows,
   byId=new Map(all.map(g=>[g.id,g]));
  const pending=approvals.filter(a=>{
   const source=byId.get(String(a.sourceId));
   if(!source)throw Error("Familia origen inexistente");
   if(!source.active){
    if(source.mergedInto!==String(a.destinationId))
     throw Error("Fusión anterior incompatible "+a.sourceId);
    result.push({sourceId:a.sourceId,destinationId:a.destinationId,status:"ya_aplicado"});
    return false;
   }
   return true;
  });
  const cnRows=pending.length?(await db.query({
   text:"SELECT DISTINCT familia_id::text AS id,articulo_origen_id AS cn"+
    " FROM farmetrica.familias_globales_articulos"+
    " WHERE cliente_slug=$1 AND familia_id=ANY($2::bigint[])"+
    " AND articulo_origen_id ~ '^[0-9]{6}$'",
   values:[slug,[...new Set(pending.flatMap(a=>[a.sourceId,a.destinationId]))]],
   query_timeout:90000
  })).rows:[];
  const sets=new Map(pending.flatMap(a=>[a.sourceId,a.destinationId]).map(id=>[String(id),new Set()]));
  for(const row of cnRows)sets.get(row.id)?.add(row.cn);
  const totals=new Map(countRows.rows.map(r=>[r.id,Number(r.n)]));
  const pairs=groupFamilyDuplicates(all.filter(f=>f.active),allAliases);
  for(const a of pending){
   const item=pairs.find(p=>
    (p.a===String(a.sourceId)&&p.b===String(a.destinationId))||
    (p.b===String(a.sourceId)&&p.a===String(a.destinationId)));
   if(!item){
    result.push({sourceId:a.sourceId,destinationId:a.destinationId,status:"omitido",
     reason:"Las denominaciones ya no son equivalentes"});
    continue;
   }
   const scored=scoreFamilyPair(item,sets,totals);
   try{validateApprovedFamilyPair(scored,a,allAliases,sets)}
   catch(e){
    result.push({sourceId:a.sourceId,destinationId:a.destinationId,status:"omitido",
     reason:String(e.message).slice(0,200),sharedCn:scored.shared,ratio:scored.ratio});
    continue;
   }
   const source=byId.get(String(a.sourceId)),dest=byId.get(String(a.destinationId));
   const rename=preferAccents(dest.name,source.name,
    allAliases.filter(o=>o.familyId===source.id||o.familyId===dest.id),a.slug);
   if(!apply){
    result.push({sourceId:source.id,destinationId:dest.id,status:"verificado",
     sharedCn:scored.shared,ratio:scored.ratio,newName:rename||dest.name});
    continue;
   }
   await db.query(
    "INSERT INTO farmetrica.transferidor_exposicion_familias"+
    " (cliente_slug,farmacia_id,familia_id,exposicion_dias,actualizado_por,actualizado_en)"+
    " SELECT cliente_slug,farmacia_id,$3,exposicion_dias,actualizado_por,now()"+
    " FROM farmetrica.transferidor_exposicion_familias"+
    " WHERE cliente_slug=$1 AND familia_id=$2"+
    " ON CONFLICT(cliente_slug,farmacia_id,familia_id) DO UPDATE SET"+
    " exposicion_dias=greatest(farmetrica.transferidor_exposicion_familias.exposicion_dias,EXCLUDED.exposicion_dias),"+
    " actualizado_en=now()",[slug,source.id,dest.id]);
   await db.query("DELETE FROM farmetrica.transferidor_exposicion_familias"+
    " WHERE cliente_slug=$1 AND familia_id=$2",[slug,source.id]);
   const aliasChange=await db.query(
    "UPDATE farmetrica.familias_globales_alias SET familia_id=$3,"+
    " metodo='manual',actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND familia_id=$2",[slug,source.id,dest.id]);
   const articleChange=await db.query(
    "UPDATE farmetrica.familias_globales_articulos"+
    " SET familia_id=$3,actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND familia_id=$2",[slug,source.id,dest.id]);
   await db.query(
    "UPDATE farmetrica.familias_globales SET"+
    " nombre=coalesce($3,nombre),nombre_manual=true,actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND id=$2 AND NOT nombre_manual",
    [slug,dest.id,rename]);
   if(rename)dest.name=rename;
   await db.query("UPDATE farmetrica.familias_globales SET activo=false,"+
    " fusionado_a=$3,actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND id=$2 AND activo",[slug,source.id,dest.id]);
   await db.query("INSERT INTO farmetrica.familias_globales_fusiones"+
    " (cliente_slug,familia_origen,familia_destino,nombre_origen,nombre_destino,"+
    " nombre_normalizado,cn_compartidos,ratio_familia_menor,criterio)"+
    " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)"+
    " ON CONFLICT(cliente_slug,familia_origen) DO NOTHING",
    [slug,source.id,dest.id,source.name,dest.name,a.slug,scored.shared,scored.ratio,
     a.allowMixedRange===true?"solapamiento_cn_mayor_80_rangos_mixtos_aprobados":"nombre_equivalente_y_cn_compartidos"]);
   result.push({sourceId:source.id,destinationId:dest.id,status:"fusionado",
    sharedCn:scored.shared,ratio:scored.ratio,
    aliases:aliasChange.rowCount,articles:articleChange.rowCount,newName:dest.name});
  }
  await db.query(apply?"COMMIT":"ROLLBACK");
  return result;
 }catch(error){await db.query("ROLLBACK");throw error}
 finally{db.release()}
}
