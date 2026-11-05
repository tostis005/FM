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
  "SELECT to_regclass($1::text) IS NOT NULL AS present",
  [client.schema+".articulos"]);
 if(!meta[0]?.present)return [];
 const {rows}=await pool.query(`
  SELECT DISTINCT f.id::text AS pharmacy_id,
    btrim(a.codigo_nacional::text) AS cn,
    btrim(a.origen_id::text) AS source_id
  FROM ${schema}.articulos a JOIN farmetrica.farmacias f
    ON f.cliente_slug=$1 AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  WHERE f.id=ANY($2::int[]) AND btrim(a.codigo_nacional::text)=ANY($3::text[])
    AND nullif(btrim(a.origen_id::text),'') IS NOT NULL
 `,[client.slug,ids,cns]);
 return rows.map(r=>({cn:String(r.cn),key:String(r.pharmacy_id)+"|"+String(r.source_id)}));
}
export function articleKeysForCNs(rows,cns){
 const selected=new Set((cns||[]).map(String));
 return [...new Set((rows||[]).filter(r=>selected.has(r.cn)).map(r=>r.key))];
}
