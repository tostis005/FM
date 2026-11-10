// Busquedas por EAN/GTIN: equivalencias Farmatic acotadas a cada farmacia.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
// EAN-8, UPC-A, EAN-13 y GTIN-14. Conservar siempre ceros iniciales.
export function isBarcodeSearch(value){
 return /^\d{8,14}$/.test(String(value??"").trim());
}
export async function synonymsReady(pool,schema,value){
 if(!SCHEMA.test(schema||""))throw Error("Esquema de cliente no permitido");
 if(!isBarcodeSearch(value))return false;
 const {rows}=await pool.query(
  "SELECT to_regclass($1) IS NOT NULL AS available",[schema+".sinonimos"]);
 return rows[0]?.available===true;
}
// Usar únicamente expresiones SQL internas, nunca valores del usuario.
// s.codigo es texto (no convertir a número) y la farmacia participa en la relación.
export function synonymMatchSQL(schema,{pharmacy,article,term}){
 if(!SCHEMA.test(schema||""))throw Error("Esquema de cliente no permitido");
 if(!pharmacy||!article||!/^\$\d+$/.test(term))throw Error("Condición de EAN inválida");
 return `EXISTS (SELECT 1 FROM "${schema}".sinonimos syn
   WHERE upper(btrim(syn.farmacia_codigo))=upper(btrim(${pharmacy}))
     AND btrim(syn.articulo_id)=btrim(${article}::text)
     AND syn.codigo=${term}::text)`;
}
// Traducir un EAN a referencias visibles en catálogos de CN, sin utilizar
// sinonimos_maestro: su clave global no distingue a qué farmacia pertenece.
export async function resolveEANReferences(pool,context,ids,value){
 const schema=context?.client?.schema,slug=context?.client?.slug;
 if(!SCHEMA.test(schema||"")||!SCHEMA.test(slug||""))throw Error("Cliente inválido");
 if(!ids?.length||!await synonymsReady(pool,schema,value))return [];
 const q='"'+schema+'"';
 const {rows}=await pool.query({
  text:`SELECT DISTINCT f.id::text AS pharmacy_id,
    btrim(s.articulo_id) AS article_id,btrim(coalesce(a.codigo_nacional,'')) AS cn
   FROM ${q}.sinonimos s
   JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[])
    AND upper(btrim(s.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   LEFT JOIN ${q}.articulos a ON upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
    AND btrim(a.origen_id::text)=btrim(s.articulo_id)
   WHERE s.codigo=$3::text
   LIMIT 1000`,
  values:[slug,ids,String(value).trim()],query_timeout:4000
 });
 const refs=new Set();
 for(const row of rows){
  const article=String(row.article_id||"").trim(),id=String(row.pharmacy_id||"");
  const cn=String(row.cn||"").trim();
  if(/^\d{6,7}$/.test(cn))refs.add(cn);
  // No convertir IDs locales de seis cifras en CN: solo usar el CN real
  // o la referencia ERP con su farmacia para evitar coincidencias falsas.
  if(id&&article)refs.add("ERP:"+id+":"+article);
 }
 return [...refs];
}
