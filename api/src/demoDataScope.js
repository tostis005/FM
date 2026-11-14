// Las demos reutilizan las consolidaciones del origen en memoria. Nunca copiamos
// movimientos ni reescribimos snapshots históricos inmutables del ERP real.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const IDENT=/^[a-z][a-z0-9_]{1,62}$/;
export async function resolveDemoSourceScope(pool,ctx,ids){
 if(!ctx?.client?.demo)return null;
 const selected=[...new Set((ids||[]).map(Number))];
 if(!selected.length)return null;
 if(selected.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error("Farmacia demo inválida");
 const {rows}=await pool.query(
  'SELECT src.slug AS "sourceSlug",src.esquema_datos AS "sourceSchema",'+
  ' df.id::int AS "demoId",sf.id::int AS "sourceId",'+
  pharmacyDataCodeSQL("sf")+' AS code'+
  ' FROM farmetrica.clientes demo'+
  ' JOIN farmetrica.clientes src ON src.slug=demo.demo_origen_slug'+
  ' JOIN farmetrica.farmacias df ON df.cliente_slug=demo.slug'+
  ' JOIN farmetrica.farmacias sf ON sf.cliente_slug=src.slug'+
  ' AND upper(btrim(df.codigo_origen))='+pharmacyDataCodeSQL("sf")+
  ' WHERE demo.slug=$1 AND df.activo=true AND df.id=ANY($2::int[])',
  [ctx.client.slug,selected]);
 if(rows.length!==selected.length||
   new Set(rows.map(r=>Number(r.demoId))).size!==selected.length||
   new Set(rows.map(r=>Number(r.sourceId))).size!==selected.length||
   !rows.every(r=>IDENT.test(r.sourceSlug)&&IDENT.test(r.sourceSchema)&&r.code))
  throw Error("Una farmacia demo no corresponde de forma única con la farmacia de origen");
 const indexed=new Map(rows.map(r=>[Number(r.demoId),r]));
 const ordered=selected.map(id=>indexed.get(id));
 if(ordered.some(x=>!x))throw Error("Selección de farmacias demo incompleta");
 const demoPharmacies=new Map((ctx.pharmacies||[]).map(p=>[Number(p.id),p]));
 return {
  slug:ordered[0].sourceSlug,
  schema:ordered[0].sourceSchema,
  ids:ordered.map(r=>Number(r.sourceId)),
  farms:ordered.map(r=>({id:Number(r.sourceId),code:String(r.code).trim().toUpperCase()})),
  pharmacies:ordered.map(r=>({
   ...demoPharmacies.get(Number(r.demoId)),
   id:String(r.sourceId),sourceCode:String(r.code).trim().toUpperCase(),
   databaseCode:String(r.code).trim().toUpperCase()
  })),
  idMap:new Map(ordered.map(r=>[String(r.sourceId),String(r.demoId)]))
 };
}
// Sólo etiquetas de identificador de farmacia en resultados ya calculados.
// No tocar claves de artículos, CN, vendedor, proveedor ni cifras.
export function mapDemoPharmacyIds(value,idMap){
 if(Array.isArray(value))return value.map(v=>mapDemoPharmacyIds(v,idMap));
 if(!value||typeof value!=="object"||value instanceof Date)return value;
 const output={};
 for(const [key,v] of Object.entries(value)){
  if(["pharmacyId","farmaciaId","pharmacy_id"].includes(key) &&
    (typeof v==="string"||typeof v==="number")){
   const mapped=idMap.get(String(v));output[key]=mapped==null?v:
    typeof v==="number"?Number(mapped):mapped;
  }else output[key]=mapDemoPharmacyIds(v,idMap);
 }
 return output;
}
