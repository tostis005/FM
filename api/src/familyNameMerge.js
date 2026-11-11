// Unifica nombres equivalentes dentro del cliente, conserva CN y auditoría.
// No depende de compartir productos: el CN solo resuelve tipo desconocido.
import {planSameNameMerges,preferredFamilyTitle} from "./familySameName.js";

const selectFamilies="SELECT id::text AS id,nombre AS name,segmento AS segment,"+
 " referencia_farmacia AS \"referencePharmacy\",nombre_manual AS \"customName\","+
 " activo AS active,clave AS key,actualizado_en AS \"updatedAt\""+
 " FROM farmetrica.familias_globales WHERE cliente_slug=$1 AND activo";
const safeSlug=x=>/^[a-z][a-z0-9_]{1,62}$/.test(String(x));
export async function consolidateFamiliesByName(db,slug,{dryRun=false}={}){
 if(!safeSlug(slug))throw Error("Cliente inválido para unificación");
 // Solo filas maestras y agregados por ID: no se descargan fichas individuales.
 const {rows:families}=await db.query({text:selectFamilies,values:[slug],query_timeout:20000});
 const ids=families.map(f=>f.id);
 const [aliases,articles,audits]=await Promise.all([
  db.query({
   text:"SELECT familia_id::text AS id,nombre_origen AS name"+
    " FROM farmetrica.familias_globales_alias WHERE cliente_slug=$1"+
    " AND familia_id=ANY($2::bigint[])",
   values:[slug,ids],query_timeout:20000
  }),
  db.query({
   text:"SELECT familia_id::text AS id,count(*)::int AS linked,"+
    " count(*) FILTER (WHERE articulo_origen_id ~ '^[0-9]{6}$' AND"+
    " (CASE WHEN articulo_origen_id ~ '^[0-9]{6}$' THEN articulo_origen_id::int<400000 ELSE false END))::int AS para,"+
    " count(*) FILTER (WHERE articulo_origen_id ~ '^[0-9]{6}$' AND"+
    " (CASE WHEN articulo_origen_id ~ '^[0-9]{6}$' THEN articulo_origen_id::int>=400000 ELSE false END))::int AS med"+
    " FROM farmetrica.familias_globales_articulos WHERE cliente_slug=$1"+
    " AND familia_id=ANY($2::bigint[]) GROUP BY familia_id",
   values:[slug,ids],query_timeout:50000
  }),
  db.query("SELECT familia_destino::text AS id,max(aplicado_en) AS \"mergedAt\""+
   " FROM farmetrica.familias_globales_fusiones WHERE cliente_slug=$1 GROUP BY familia_destino",[slug])
 ]);
 const byId=new Map(families.map(f=>[f.id,{...f,localNames:[],aliases:0,
  linked:0,para:0,med:0,machineNamed:false}]));
 for(const a of aliases.rows){
  const f=byId.get(a.id);if(f){f.aliases++;if(a.name)f.localNames.push(a.name)}
 }
 for(const a of articles.rows){
  const f=byId.get(a.id);if(f){f.linked=Number(a.linked);f.para=Number(a.para);f.med=Number(a.med)}
 }
 for(const a of audits.rows){
  const f=byId.get(a.id);
  if(f&&f.updatedAt&&a.mergedAt){
   const delta=Date.parse(f.updatedAt)-Date.parse(a.mergedAt);
   f.machineNamed=Number.isFinite(delta)&&Math.abs(delta)<3000;
  }
 }
 const planned=planSameNameMerges([...byId.values()]);
 // Corregir también la escritura de las familias que no necesitan fusión.
 // No se altera ningún nombre editado manualmente.
 const sourceIds=new Set(planned.actions.map(x=>x.sourceId));
 const groupedTitles=new Map(planned.groups.map(g=>[g.destinationId,g.name]));
 const renameOnly=[...byId.values()].filter(f=>!sourceIds.has(f.id)&&
   (!f.customName||f.machineNamed)).map(f=>({
    id:f.id,name:groupedTitles.get(f.id)||preferredFamilyTitle([f],f),
    previous:f.name
   })).filter(f=>f.name!==f.previous);
 const resultBase={...planned,renamesSuggested:renameOnly.length};
 if(!planned.actions.length&&!renameOnly.length)
  return {...resultBase,merged:0,namesUpdated:0,aliasesMoved:0,articlesMoved:0,stockRulesMoved:0,dryRun};
 if(dryRun)return {...resultBase,merged:0,namesUpdated:0,aliasesMoved:0,articlesMoved:0,stockRulesMoved:0,dryRun};
 // La función debe ejecutarse dentro de una transacción con bloqueo del cliente.
 const mapping=JSON.stringify(planned.actions.map(a=>({
  source:a.sourceId,destination:a.destinationId,
  slug:a.slug,reason:a.reason,
  sourceName:a.sourceName,targetName:a.canonicalName
 })));
 const param=[slug,mapping];
 const j=" FROM jsonb_to_recordset($2::jsonb) AS m("+
  "source text,destination text,slug text,reason text,\"sourceName\" text,\"targetName\" text)";
 // Cerrar sobre los registros actuales, sin borrar el histórico.
 const {rows:locked}=await db.query("SELECT g.id::text AS id FROM farmetrica.familias_globales g"+
  " JOIN jsonb_to_recordset($2::jsonb) AS m(source text,destination text)"+
  " ON g.id IN (m.source::bigint,m.destination::bigint)"+
  " WHERE g.cliente_slug=$1 AND g.activo FOR UPDATE",[slug,mapping]);
 const expected=new Set(planned.actions.flatMap(a=>[a.sourceId,a.destinationId]));
 if(new Set(locked.map(x=>x.id)).size!==expected.size)
  throw Error("Las familias cambiaron durante la conciliación; reintentar");
 const {rowCount:stockRulesMoved}=await db.query(
  "INSERT INTO farmetrica.transferidor_exposicion_familias"+
  " (cliente_slug,farmacia_id,familia_id,exposicion_dias,actualizado_por,actualizado_en)"+
  " SELECT e.cliente_slug,e.farmacia_id,m.destination::bigint,MAX(e.exposicion_dias),"+
  " MAX(e.actualizado_por),now() FROM farmetrica.transferidor_exposicion_familias e"+
  " JOIN jsonb_to_recordset($2::jsonb) AS m(source text,destination text)"+
  " ON e.familia_id=m.source::bigint"+
  " WHERE e.cliente_slug=$1 GROUP BY e.cliente_slug,e.farmacia_id,m.destination"+
  " ON CONFLICT(cliente_slug,farmacia_id,familia_id) DO UPDATE SET"+
  " exposicion_dias=GREATEST(farmetrica.transferidor_exposicion_familias.exposicion_dias,EXCLUDED.exposicion_dias),"+
  " actualizado_en=now()",param);
 await db.query("DELETE FROM farmetrica.transferidor_exposicion_familias e"+
  " USING jsonb_to_recordset($2::jsonb) AS m(source text,destination text)"+
  " WHERE e.cliente_slug=$1 AND e.familia_id=m.source::bigint",param);
 const {rowCount:aliasesMoved}=await db.query(
  "UPDATE farmetrica.familias_globales_alias a SET familia_id=m.destination::bigint,"+
  " actualizado_en=now()"+
  " FROM jsonb_to_recordset($2::jsonb) AS m(source text,destination text)"+
  " WHERE a.cliente_slug=$1 AND a.familia_id=m.source::bigint",param);
 const {rowCount:articlesMoved}=await db.query({
  text:"UPDATE farmetrica.familias_globales_articulos a SET familia_id=m.destination::bigint,"+
   " actualizado_en=now()"+
   " FROM jsonb_to_recordset($2::jsonb) AS m(source text,destination text)"+
   " WHERE a.cliente_slug=$1 AND a.familia_id=m.source::bigint",
  values:param,query_timeout:95000
 });
 // No cambiar nombres editados por el usuario. Solo títulos no manuales
 // (o creados automáticamente por fusiones anteriores).
 const titles=[...planned.groups.map(g=>({id:g.destinationId,name:g.name})),
  ...renameOnly.filter(x=>!groupedTitles.has(x.id)).map(x=>({id:x.id,name:x.name}))];
 const machineIds=[...byId.values()].filter(f=>f.machineNamed).map(f=>f.id);
 const {rowCount:namesUpdated}=await db.query(
  "UPDATE farmetrica.familias_globales g SET nombre=m.name,actualizado_en=now()"+
  " FROM jsonb_to_recordset($2::jsonb) AS m(id text,name text)"+
  " WHERE g.cliente_slug=$1 AND g.id=m.id::bigint AND g.nombre<>m.name"+
  " AND (NOT g.nombre_manual OR g.id=ANY($3::bigint[]))",
  [slug,JSON.stringify(titles),machineIds]);
 // Aplanar cadenas históricas para que futuras conciliaciones vuelvan siempre
 // al destino activo, incluso cuando el origen ya estaba fusionado.
 await db.query("UPDATE farmetrica.familias_globales g SET"+
  " fusionado_a=m.destination::bigint,actualizado_en=now()"+
  " FROM jsonb_to_recordset($2::jsonb) AS m(source text,destination text)"+
  " WHERE g.cliente_slug=$1 AND NOT g.activo AND g.fusionado_a=m.source::bigint",param);
 const {rowCount:merged}=await db.query(
  "UPDATE farmetrica.familias_globales g SET activo=false,"+
  " fusionado_a=m.destination::bigint,actualizado_en=now()"+
  " FROM jsonb_to_recordset($2::jsonb) AS m(source text,destination text)"+
  " WHERE g.cliente_slug=$1 AND g.id=m.source::bigint AND g.activo",param);
 await db.query(
  "INSERT INTO farmetrica.familias_globales_fusiones"+
  " (cliente_slug,familia_origen,familia_destino,nombre_origen,nombre_destino,"+
  " nombre_normalizado,cn_compartidos,ratio_familia_menor,criterio)"+
  " SELECT $1,m.source::bigint,m.destination::bigint,m.\"sourceName\",m.\"targetName\","+
  " m.slug,0,0,m.reason"+j+
  " ON CONFLICT(cliente_slug,familia_origen) DO NOTHING",param);
 if(merged!==planned.actions.length)
  throw Error("No se pudieron fusionar todas las familias planeadas");
 return {...resultBase,merged,namesUpdated,aliasesMoved,articlesMoved,stockRulesMoved,dryRun};
}


// La primera fusión puede convertir una familia SIN_DETERMINAR en asignable
// a una referencia conocida. Repetir hasta punto fijo; nunca dejar una
// reconciliación parcialmente terminada por culpa de una sola pasada.
export async function consolidateFamilyNamesUntilStable(db,slug,{
 maxPasses=8,execute=consolidateFamiliesByName
}={}){
 if(!Number.isInteger(maxPasses)||maxPasses<1||maxPasses>16)
  throw Error("Número de pasadas incorrecto");
 const sum={actions:[],groups:[],activeFamilies:0,uniqueFamilies:0,
  ambiguousCrossSegment:0,ambiguousExamples:[],merged:0,aliasesMoved:0,
  articlesMoved:0,stockRulesMoved:0,namesUpdated:0,renamesSuggested:0,passes:0};
 for(let i=0;i<maxPasses;i++){
  const step=await execute(db,slug);
  if(!i)sum.activeFamilies=step.activeFamilies;
  sum.uniqueFamilies=step.uniqueFamilies;
  sum.ambiguousCrossSegment=step.ambiguousCrossSegment;
  sum.ambiguousExamples=step.ambiguousExamples||[];
  sum.merged+=step.merged;sum.aliasesMoved+=step.aliasesMoved;
  sum.articlesMoved+=step.articlesMoved;sum.stockRulesMoved+=step.stockRulesMoved;
  sum.namesUpdated+=step.namesUpdated||0;sum.renamesSuggested+=step.renamesSuggested||0;
  sum.actions.push(...step.actions);
  sum.groups.push(...step.groups);
  sum.passes++;
  if(!step.actions.length){
   if(sum.merged!==sum.activeFamilies-sum.uniqueFamilies)
    throw Error("La unificación no conserva el número de familias");
   return sum;
  }
  if(step.merged!==step.actions.length)
   throw Error("Una pasada no fusionó todos sus duplicados");
 }
 throw Error("Quedan duplicados tras "+maxPasses+" pasadas; se cancela toda la transacción");
}
