import {pharmacySourceCodeMatchSQL} from "./pharmacyCodes.js";
const cn6=x=>/^\d{6}$/.test(String(x??"").trim())?String(x).trim():null;
const label=x=>String(x??"").trim();
// No alterar el descuento sincronizado. Si falta, recuperar la diferencia
// efectiva de la línea usando PVP, cantidad y neto, sólo si no consta un
// descuento de operación distinto de cero. No repartir descuentos de cabecera
// ni inventar cero cuando faltan importes. No aplicar a farmacias.
export function warehouseTicketDiscountSQL(){
 return "(CASE WHEN v.descuento_linea IS NOT NULL THEN v.descuento_linea"+
 " WHEN f.tipo_establecimiento='almacen' AND coalesce(v.descuento_operacion_documento,0)=0"+
 " AND v.precio_unitario IS NOT NULL AND v.unidades IS NOT NULL AND abs(v.unidades)>0"+
 " AND v.importe IS NOT NULL AND abs(v.precio_unitario*v.unidades)>0"+
 " AND abs(v.importe)<=abs(v.precio_unitario*v.unidades)"+
 " THEN round(abs(v.precio_unitario*v.unidades)-abs(v.importe),6) ELSE NULL END)";
}
// Completar exclusivamente filas de almacén autorizadas. Un ID ERP de otra
// farmacia no es un CN: usar el enlace de esta promoción, o un CN explícito.
export async function completeWarehouseTicketNames(pool,context,rows,{warehouseIds=[],cns=[],articleKeys=[]}={}){
 const allowed=new Set((context.allowedPharmacyIds||[]).map(Number));
 const warehouses=new Set(warehouseIds.map(Number).filter(id=>allowed.has(id)));
 const requested=new Set(cns.map(cn6).filter(Boolean)),links=new Map();
 for(const a of articleKeys){if(!requested.has(a.cn))continue;const set=links.get(a.key)||new Set();set.add(a.cn);links.set(a.key,set);}
 const candidates=rows.map(row=>{
  if(!warehouses.has(Number(row.pharmacyId)))return row;
  const local=links.get(String(row.pharmacyId)+"|"+label(row.sourceArticleId||row.cn));
  const explicit=cn6(row.nationalCode);
  const direct=cn6(row.cn);
  const cn=explicit&&requested.has(explicit)?explicit:local?.size===1?[...local][0]:!local?.size&&direct&&requested.has(direct)?direct:null;
  return cn?{...row,nationalCode:cn}:row;
 });
 const missing=[...new Set(candidates.filter(r=>warehouses.has(Number(r.pharmacyId))&&!label(r.articleName||r.description)).map(r=>cn6(r.nationalCode)).filter(Boolean))];
 if(!missing.length)return candidates;
 // Primero AEMPS, después un nombre asociado a CN explícito del catálogo
 // de establecimientos autorizados del mismo cliente. Nunca cruzar por ERP.
 const schema=context.client.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))throw Error("Contexto de artículos no autorizado");
 const names=new Map();
 for(const row of candidates){
  if(!allowed.has(Number(row.pharmacyId)))continue;
  const cn=cn6(row.nationalCode);
  const name=label(row.articleName||row.description);
  if(cn&&name)names.set(cn,name);
 }
 const {rows:official}=await pool.query("SELECT left(cn,6) AS cn,nombre AS name FROM farmetrica.nomenclator_presentaciones WHERE cn=ANY($1::text[]) AND nullif(btrim(nombre),'') IS NOT NULL",[missing]);
 for(const r of official)if(!names.has(r.cn))names.set(r.cn,label(r.name));
 const pending=missing.filter(cn=>!names.has(cn));
 if(pending.length){
  const {rows:meta}=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='articulos'",[schema]);
  const fields=new Set(meta.map(r=>r.column_name));
  if(["farmacia_codigo","codigo_nacional","nombre"].every(c=>fields.has(c))){
   const {rows:local}=await pool.query("SELECT DISTINCT ON(left(btrim(a.codigo_nacional::text),6)) left(btrim(a.codigo_nacional::text),6) AS cn,btrim(a.nombre) AS name FROM \""+schema+"\".articulos a JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND "+pharmacySourceCodeMatchSQL("f","a.farmacia_codigo")+" WHERE f.id=ANY($2::int[]) AND left(btrim(a.codigo_nacional::text),6)=ANY($3::text[]) AND nullif(btrim(a.nombre),'') IS NOT NULL ORDER BY left(btrim(a.codigo_nacional::text),6),CASE WHEN f.tipo_establecimiento='almacen' THEN 0 ELSE 1 END,f.id,a.nombre",[context.client.slug,[...allowed],pending]);
   for(const r of local)if(!names.has(r.cn))names.set(r.cn,label(r.name));
  }
 }
 return candidates.map(r=>{
  if(!warehouses.has(Number(r.pharmacyId))||label(r.articleName||r.description))return r;
  const name=names.get(r.nationalCode);return name?{...r,articleName:name,description:name}:r;
 });
}
