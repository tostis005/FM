import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readRetirementPatterns} from "./laboratoryRetirements.js";
import {canonicalizeLaboratoryCatalog} from "./laboratoryCanonicalDescriptions.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const MAX_ROWS=5000;
export function validateCrossLaboratorySearch(input){
 const cns=input?.cns,eans=input?.eans,descriptions=input?.descriptions;
 if(!Array.isArray(cns)||!Array.isArray(eans)||!Array.isArray(descriptions))return null;
 if(cns.length+eans.length+descriptions.length>120||
  [...cns,...eans,...descriptions].some(v=>typeof v!=="string"))return null;
 const clean=items=>[...new Set(items.map(x=>x.trim()))].filter(Boolean);
 const codes=clean(cns),aliases=clean(eans),names=clean(descriptions);
 if(!codes.every(v=>/^[0-9]{6,7}$/.test(v))||
  !aliases.every(v=>/^[0-9]{8,14}$/.test(v))||
  !names.every(v=>v.length>=2&&v.length<=100&&!/[\x00-\x1f]/.test(v))||
  !(codes.length+aliases.length+names.length)||
  JSON.stringify({codes,aliases,names}).length>8000)return null;
 return {codes,aliases,names};
}

// La búsqueda abarca el catálogo de las farmacias autorizadas, nunca otros clientes.
// Un EAN puede ser un sinónimo, sin convertirlo artificialmente en CN.
export async function readCrossLaboratoryCatalog(pool,ctx,{pharmacies,type,filters}){
 if(!SCHEMA.test(ctx.client.schema)||!["medicacion","parafarmacia"].includes(type))
  throw Error("Esquema o tipo no válido");
 const input=validateCrossLaboratorySearch(filters);
 if(!input)throw Error("Introduce CN, EAN o descripciones válidas");
 const schema='"'+ctx.client.schema+'"';
 const sql=[
  "WITH pharmacies AS MATERIALIZED (",
  " SELECT f.id,__PHARMACY_CODE__ AS code FROM farmetrica.farmacias f",
  " WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])",
  "), matched_erp AS MATERIALIZED (",
  " SELECT p.id::text AS pharmacy_id,a.origen_id::text AS article_id,",
  "  btrim(coalesce(a.nombre,'')) AS name,",
  "  coalesce(nullif(btrim(a.codigo_nacional::text),''),",
  "   nullif(btrim(to_jsonb(a)->>'cn_normalizado'),''),",
  "   CASE WHEN btrim(a.origen_id::text) ~ '^[0-9]{6,7}$'",
  "    THEN btrim(a.origen_id::text) END) AS possible_cn",
  " FROM __SCHEMA__.articulos a",
  " JOIN pharmacies p ON upper(btrim(a.farmacia_codigo))=p.code",
  " WHERE btrim(coalesce(a.codigo_nacional::text,''))=ANY($3::text[])",
  "   OR btrim(a.origen_id::text)=ANY($3::text[])",
  "   OR btrim(coalesce(to_jsonb(a)->>'cn_normalizado',''))=ANY($3::text[])",
  "   OR EXISTS(SELECT 1 FROM unnest($4::text[]) AS e(ean)",
  "    WHERE btrim(a.origen_id::text)=e.ean",
  "     OR btrim(coalesce(a.codigo_nacional::text,''))=e.ean",
  "     OR concat_ws(' ',to_jsonb(a)->>'ean',to_jsonb(a)->>'eans',",
  "       to_jsonb(a)->>'sinonimos',to_jsonb(a)->>'sinonimo',",
  "       to_jsonb(a)->>'sinonimos_articulo',to_jsonb(a)->>'sinonimos_ean',",
  "       to_jsonb(a)->>'codigos_barras',to_jsonb(a)->>'codigo_barras',",
  "       to_jsonb(a)->>'barcode',to_jsonb(a)->>'barcodes',",
  "       to_jsonb(a)->>'codigo_ean',to_jsonb(a)->>'codigos_adicionales')",
  "       ~ ('(^|[^0-9])'||e.ean||'([^0-9]|$)'))",
  "   OR EXISTS(SELECT 1 FROM unnest($5::text[]) AS d(term)",
  "    WHERE position(lower(d.term) in lower(coalesce(a.nombre,'')))>0)",
  "), erp AS (",
  " SELECT CASE WHEN possible_cn ~ '^[0-9]{6,7}$' THEN possible_cn",
  "   ELSE 'ERP:'||pharmacy_id||':'||article_id END AS referencia,",
  "  CASE WHEN possible_cn ~ '^[0-9]{6,7}$' THEN possible_cn",
  "   ELSE NULL::text END AS cn,name AS nombre,",
  "  CASE WHEN possible_cn ~ '^[0-9]{6,7}$' THEN",
  "   CASE WHEN left(possible_cn,6)::int>=400000 THEN 'medicacion'",
  "    ELSE 'parafarmacia' END",
  "   ELSE 'parafarmacia' END AS tipo,pharmacy_id",
  " FROM matched_erp WHERE possible_cn ~ '^[0-9]{6,7}$'",
  "  OR article_id ~ '^[A-Za-z0-9._:-]{1,90}$'",
  "), official AS (",
  " SELECT n.cn::text AS referencia,n.cn::text AS cn,n.nombre::text AS nombre,",
  "  'medicacion'::text AS tipo,NULL::text AS pharmacy_id",
  " FROM farmetrica.nomenclator_presentaciones n",
  " WHERE $6::text='medicacion' AND",
  "  (n.cn=ANY($3::text[]) OR EXISTS(SELECT 1 FROM unnest($5::text[]) AS d(term)",
  "    WHERE position(lower(d.term) in lower(coalesce(n.nombre,'')))>0))",
  "), unioned AS (",
  " SELECT * FROM erp WHERE tipo=$6 UNION ALL SELECT * FROM official",
  "), grouped AS (",
  " SELECT referencia,max(cn) AS cn,",
  "  coalesce(min(nullif(nombre,'')),referencia) AS nombre,max(tipo) AS tipo,",
  "  string_agg(DISTINCT pharmacy_id,',' ORDER BY pharmacy_id)",
  "   FILTER(WHERE pharmacy_id IS NOT NULL) AS \"pharmacyIds\"",
  " FROM unioned GROUP BY referencia",
  ")",
  "SELECT referencia,cn,nombre,tipo,\"pharmacyIds\",",
  " true AS \"inMaster\",false AS \"inReceipts\",",
  " false AS \"inSales\",false AS \"inPurchases\",false AS provisional",
  " FROM grouped ORDER BY nombre,referencia LIMIT 5001"
 ].join("\n").replaceAll("__SCHEMA__",schema)
  .replaceAll("__PHARMACY_CODE__",pharmacyDataCodeSQL("f"));
 const {rows}=await pool.query({text:sql,
  values:[ctx.client.slug,pharmacies,input.codes,input.aliases,input.names,type],
  query_timeout:30000});
 if(rows.length>MAX_ROWS)
  throw Object.assign(new Error("Demasiados resultados; acota la búsqueda a menos de 5.000 artículos"),{code:"TOO_MANY"});
 const patterns=await readRetirementPatterns(pool,ctx.client.slug);
 return canonicalizeLaboratoryCatalog(pool,ctx,
  {rows,total:rows.length,metricsUnavailable:true},type,patterns);
}
