// Relación segura de identificadores de Farmatic con su catálogo de artículos.
// El ID interno nunca se convierte en CN por semejanza de formato.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const normalized=v=>String(v??"").trim().toUpperCase();
const key=(pharmacyId,id)=>String(pharmacyId)+"|"+normalized(id);

export async function nameArticleRows(pool,context,rows,{code="articleId"}={}){
 if(!rows?.length)return rows||[];
 const {client,allowedPharmacyIds}=context||{};
 if(!client||!SCHEMA.test(client.schema)||!SCHEMA.test(client.slug))
  throw Error("Contexto de artículos no autorizado");
 const allowed=new Set((allowedPharmacyIds||[]).map(Number));
 const requested=rows.filter(row=>allowed.has(Number(row.pharmacyId))&&normalized(row[code]));
 const codes=[...new Set(requested.map(row=>normalized(row[code])))];
 const pharmacies=[...new Set(requested.map(row=>Number(row.pharmacyId)))];
 const enrich=(catalog=new Map())=>rows.map(row=>{
  const ref=String(row[code]??"").trim();
  const item=allowed.has(Number(row.pharmacyId))?catalog.get(key(row.pharmacyId,ref)):null;
  return {...row,articleId:ref||null,cn:item?.cn||null,articleName:item?.name||null};
 });
 if(!codes.length||!pharmacies.length)return enrich();
 const {rows:metadata}=await pool.query(
  "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='articulos'",
  [client.schema]);
 const fields=new Set(metadata.map(row=>row.column_name));
 if(!["farmacia_codigo","origen_id","nombre"].every(name=>fields.has(name)))return enrich();
 const q='"'+client.schema+'"';
 const cn=fields.has("codigo_nacional")?
  "nullif(btrim(a.codigo_nacional),'')":"NULL::text";
 const latest=fields.has("sincronizado_en")?
  "a.sincronizado_en DESC NULLS LAST,":"";
 const {rows:articles}=await pool.query(`
  SELECT DISTINCT ON (f.id,upper(btrim(a.origen_id)))
   f.id::text AS "pharmacyId",upper(btrim(a.origen_id)) AS id,
   ${cn} AS cn,nullif(btrim(a.nombre),'') AS name
  FROM ${q}.articulos a JOIN farmetrica.farmacias f
   ON f.cliente_slug=$1 AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  WHERE f.id=ANY($2::int[]) AND upper(btrim(a.origen_id))=ANY($3::text[])
  ORDER BY f.id,upper(btrim(a.origen_id)),${latest}a.nombre`,
  [client.slug,pharmacies,codes]);
 const catalog=new Map(articles.map(article=>[
  key(article.pharmacyId,article.id),{cn:article.cn,name:article.name}]));
 return enrich(catalog);
}

// Mantener el identificador ERP para compatibilidad con las búsquedas
// documentales, pero publicar el código nacional SOLO si consta en catálogo.
export async function nameTicketArticleRows(pool,context,rows){
 const named=await nameArticleRows(pool,context,rows,{code:"cn"});
 return named.map(row=>({
  ...row,
  sourceArticleId:row.articleId,
  nationalCode:row.cn,
  cn:row.articleId,
  description:row.articleName
 }));
}
