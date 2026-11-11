import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {retiredProductSQL} from "./laboratoryRetirements.js";

const SAFE_SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const cleanName=value=>String(value||"").normalize("NFD")
 .replace(/[\u0300-\u036f]/g,"").toLocaleUpperCase("es")
 .replace(/[^A-Z0-9]+/g," ").trim().replace(/\s+/g," ");

/** Un regalo R1/R2 con CN explícito identifica su artículo base.
 * No inferir parentescos solo por una palabra comercial o un CN parecido. */
export function variantRootCandidates(rows,type="parafarmacia"){
 const byKey=new Map();
 for(const row of rows||[]){
  const match=/^(.+?)\s+R[1-9]\d*\s+(\d{6,7})\s*$/i.exec(String(row.nombre||"").trim());
  if(!match)continue;
  const cn=match[2],base=cleanName(match[1]);
  if(!base||(Number(cn.slice(0,6))>=400000?"medicacion":"parafarmacia")!==type)
   continue;
  byKey.set(cn+"|"+base,{cn,base});
 }
 return [...byKey.values()];
}

/** Completar únicamente referencias raíz verificadas contra el ERP real.
 * El código de laboratorio del ERP puede no tener correspondencia con
 * proveedor habitual, pero la variante sí está asociada a ese proveedor.
 * No se extrapolan artículos por código local ni se crean CN inventados. */
export async function recoverSupplierVariantRoots(pool,ctx,{rows,pharmacies,type,patterns=[]}){
 const candidates=variantRootCandidates(rows,type);
 if(!candidates.length)return rows;
 if(!SAFE_SCHEMA.test(ctx.client.schema))throw Error("Esquema inválido");
 const schema='"'+ctx.client.schema+'"';
 const gathered=new Map();
 try{
  // Las búsquedas exactas se resuelven con el índice de farmacia + origen_id.
  for(let i=0;i<candidates.length;i+=250){
   const {rows:matched}=await pool.query({text:`
    WITH chosen AS (
     SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
     FROM farmetrica.farmacias f
     WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND f.activo
    ), candidate AS (
     SELECT x.cn,x.base FROM jsonb_to_recordset($3::jsonb) AS x(cn text,base text)
    )
    SELECT c.cn,c.base,a.nombre,a.codigo_nacional AS declared_cn,
     f.id AS pharmacy_id,${retiredProductSQL("a.nombre","$4")} AS excluded
    FROM candidate c CROSS JOIN chosen f
    JOIN ${schema}.articulos a
     ON upper(btrim(a.farmacia_codigo))=f.code
     AND a.origen_id::text=c.cn
    WHERE nullif(btrim(a.nombre),'') IS NOT NULL`,
    values:[ctx.client.slug,pharmacies,JSON.stringify(candidates.slice(i,i+250)),patterns],
    query_timeout:12000});
   for(const hit of matched){
    // El nombre debe coincidir con el texto anterior a R1/R2; una referencia
    // ERP igual en otra farmacia no basta para incorporarla al laboratorio.
    if(cleanName(hit.nombre)!==hit.base)continue;
    const declared=String(hit.declared_cn||"").trim();
    if(/^\d{6,7}$/.test(declared)&&declared!==hit.cn)continue;
    const prior=gathered.get(hit.cn);
    if(prior){
     prior.pharmacyIds.add(Number(hit.pharmacy_id));
     prior.excluded=prior.excluded||hit.excluded===true;
    }else{
     gathered.set(hit.cn,{referencia:hit.cn,cn:hit.cn,nombre:hit.nombre,
      tipo:type,inMaster:false,inReceipts:false,inPurchases:false,
      inSales:false,generic:false,provisional:false,
      excluded:hit.excluded===true,pharmacyIds:new Set([Number(hit.pharmacy_id)])});
    }
   }
  }
 }catch(error){
  // No sacrificar el catálogo original si una búsqueda complementaria falla.
  console.warn("PREPARADOR_RAICES_VARIANTES",error.code||error.name);
  return rows;
 }
 return [...rows,...[...gathered.values()].map(r=>({
  ...r,pharmacyIds:[...r.pharmacyIds].sort((a,b)=>a-b).join(",")
 }))];
}
