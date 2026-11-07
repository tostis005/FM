// Traducción por farmacia del CN (seis dígitos) al identificador origen de Farmatic.
// El mismo identificador interno puede representar productos distintos entre farmacias.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const CN=/^\d{6}$/;
export async function resolvePromotionArticleKeys(pool,context,requestedCNs){
 const {client,allowedPharmacyIds}=context||{};
 if(!client||!SCHEMA.test(client.schema)||!SCHEMA.test(client.slug))
   throw new Error("Cliente de promociones no autorizado");
 const cns=[...new Set((requestedCNs||[]).map(String))].filter(v=>CN.test(v));
 const ids=(allowedPharmacyIds||[]).filter(Number.isSafeInteger);
 if(!cns.length||!ids.length)return [];
 const schema='"'+client.schema+'"';
 const {rows:meta}=await pool.query(
  "SELECT to_regclass($1::text) IS NOT NULL AS present, "+
  "EXISTS(SELECT 1 FROM information_schema.columns WHERE "+
  "table_schema=$2 AND table_name='articulos' AND column_name='cn_normalizado') AS has_normal",
  [client.schema+".articulos",client.schema]);
 if(!meta[0]?.present)return [];
 const normal=meta[0]?.has_normal===true?
  "left(btrim(a.cn_normalizado::text),6)":"NULL::text";
 // Reutilizar EXACTAMENTE la identificación del histórico por farmacia:
 // origen_id (CN Farmatic), seis primeras cifras de codigo_nacional y
 // cn_normalizado cuando existe. Antes solo se miraba codigo_nacional exacto
 // y el seguimiento podía devolver cero mientras el planificador tenía ventas.
 const code="left(btrim(a.codigo_nacional::text),6)";
 const match="(btrim(a.origen_id::text)=ANY($3::text[]) OR "+
  code+"=ANY($3::text[])"+
  (meta[0]?.has_normal===true?" OR "+normal+"=ANY($3::text[])":"")+")";
 const {rows}=await pool.query(`
  SELECT DISTINCT f.id::text AS pharmacy_id,
    code.cn AS cn,btrim(a.origen_id::text) AS source_id
  FROM ${schema}.articulos a JOIN farmetrica.farmacias f
    ON f.cliente_slug=$1 AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  CROSS JOIN LATERAL (VALUES (btrim(a.origen_id::text)),
    (${code}),(${normal})) AS code(cn)
  WHERE f.id=ANY($2::int[]) AND ${match}
    AND code.cn=ANY($3::text[])
    AND nullif(btrim(a.origen_id::text),'') IS NOT NULL
 `,[client.slug,ids,cns]);
 return rows.map(r=>({cn:String(r.cn),key:String(r.pharmacy_id)+"|"+String(r.source_id)}));
}
export function articleKeysForCNs(rows,cns){
 const selected=new Set((cns||[]).map(String));
 return [...new Set((rows||[]).filter(r=>selected.has(r.cn)).map(r=>r.key))];
}
