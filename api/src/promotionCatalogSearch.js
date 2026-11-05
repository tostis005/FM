import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SAFE=/^[a-z][a-z0-9_]{1,62}$/;
const has=(columns,table,name)=>columns.some(c=>c.table_name===table&&c.column_name===name);
const quote=s=>'"'+s+'"';
const col=(table,column)=>table+"."+quote(column)+"::text";
const upper=expr=>"upper(btrim(coalesce("+expr+",'')))";

/**
 * Three short, bounded queries. The supplier lookup MUST NOT appear as a
 * correlated subquery in the articles scan (large Farmatic catalogs).
 * Supplier codes are always resolved within the same pharmacy.
 */
export function promotionCatalogSearchSQL(schema,columns){
 if(!SAFE.test(schema))throw Error("Esquema de artículos inválido");
 if(!["farmacia_codigo","origen_id","nombre","codigo_nacional"]
   .every(name=>has(columns,"articulos",name)))
  throw Error("El catálogo no dispone de los campos necesarios para buscar artículos");
 const a=quote(schema)+".articulos",p=quote(schema)+".proveedores";
 const norm=has(columns,"articulos","cn_normalizado")?
  col("a","cn_normalizado"):"NULL::text";
 const lab=has(columns,"articulos","laboratorio")?col("a","laboratorio"):"NULL::text";
 const refs=["proveedor_habitual_id","proveedor_id","proveedor_codigo","proveedor","laboratorio_id"]
  .filter(name=>has(columns,"articulos",name));
 const primary=refs.length?col("a",refs[0]):"NULL::text";
 const refCondition=refs.map(ref=>upper(col("a",ref))+"=matched.supplier_code").join(" OR ");
 const fields=(supplier="NULL::text")=>[
  "f.id::text AS pharmacy_id",col("a","origen_id")+" AS source_id",
  col("a","nombre")+" AS description",col("a","codigo_nacional")+" AS national_code",
  norm+" AS normalized_code",lab+" AS laboratory",
  primary+" AS supplier_ref",supplier+" AS supplier_name"
 ].join(", ");
 const scope="JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
  "AND "+upper("a.farmacia_codigo::text")+"="+pharmacyDataCodeSQL("f")+" "+
  "AND f.id=ANY($2::int[]) ";
 const terms=[
  "a.nombre::text ILIKE '%'||$3||'%'",
  "a.codigo_nacional::text ILIKE '%'||$3||'%'",
  ...(has(columns,"articulos","cn_normalizado")?
   ["a.cn_normalizado::text ILIKE '%'||$3||'%'"]:[]),
  ...(has(columns,"articulos","laboratorio")?
   ["a.laboratorio::text ILIKE '%'||$3||'%'"]:[]),
  // ERP ids are searchable but never automatically returned as a valid CN.
  "a.origen_id::text ILIKE '%'||$3||'%'"
 ];
 const direct="SELECT "+fields()+" FROM "+a+" a "+scope+
  "WHERE (($3::text<>'' AND ("+terms.join(" OR ")+")) "+
  "OR btrim(a.codigo_nacional::text)=ANY($4::text[]) "+
  (has(columns,"articulos","cn_normalizado")?
   "OR btrim(a.cn_normalizado::text)=ANY($4::text[]) ":"")+
  "OR btrim(a.origen_id::text)=ANY($4::text[])) LIMIT $5::int";
 const supplierReady=refs.length>0&&
  ["farmacia_codigo","origen_id","nombre"].every(n=>has(columns,"proveedores",n));
 const allowed="WITH allowed AS MATERIALIZED (SELECT "+
  pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f "+
  "WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])) ";
 const sources="SELECT p.code AS pharmacy_code,"+upper("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(sp.nombre::text),'') AS supplier_name "+
  "FROM "+p+" sp JOIN allowed p ON "+upper("sp.farmacia_codigo::text")+"=p.code "+
  "WHERE sp.nombre::text ILIKE '%'||$3||'%'";
 // The master is client-scoped, but a code is only attributed to a pharmacy
 // if its source-supplier record really belongs to that pharmacy.
 const master="SELECT p.code AS pharmacy_code,"+upper("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(pm.nombre::text),'') AS supplier_name "+
  "FROM farmetrica.proveedores_maestro pm JOIN "+p+" sp ON "+
  upper("sp.origen_id::text")+"="+upper("pm.codigo_origen::text")+
  " JOIN allowed p ON "+upper("sp.farmacia_codigo::text")+"=p.code "+
  "WHERE pm.cliente_slug=$1 AND pm.nombre::text ILIKE '%'||$3||'%'";
 const suppliers=supplierReady?
  allowed+"SELECT DISTINCT pharmacy_code,supplier_code,supplier_name FROM ("+
   sources+" UNION ALL "+master+") found "+
   "WHERE supplier_code<>'' ORDER BY supplier_name LIMIT $4::int":null;
 const bySupplier=supplierReady?
  "SELECT "+fields("matched.supplier_name")+" FROM "+a+" a "+
  "JOIN jsonb_to_recordset($5::jsonb) AS matched("+
   "pharmacy_code text,supplier_code text,supplier_name text) "+
  "ON "+upper("a.farmacia_codigo::text")+"=matched.pharmacy_code "+
  "AND ("+refCondition+") "+
  scope+"LIMIT $6::int":null;
 return {direct,suppliers,bySupplier,supplierReady};
}

export function promotionResultCN(row,verifiedOrigins=new Set()){
 const codes=[row.national_code,row.normalized_code];
 for(const value of codes){
  const s=String(value??"").trim();
  if(/^\d{6,7}$/.test(s))return s.slice(0,6);
 }
 const id=String(row.source_id??"").trim();
 return /^\d{6}$/.test(id)&&verifiedOrigins.has(id)?id:null;
}

export function mergePromotionCatalogRows(rows,verifiedOrigins=new Set(),max=300){
 const found=new Map();
 for(const r of rows||[]){
  const cn=promotionResultCN(r,verifiedOrigins);
  const key=cn||"ERP:"+r.pharmacy_id+":"+r.source_id;
  const description=String(r.description||"").trim()||"Artículo sin nombre";
  const supplier=String(r.supplier_name||r.laboratory||"").trim()||null;
  const current=found.get(key);
  if(current){
   if(!current.supplier&&supplier)current.supplier=supplier;
   continue;
  }
  found.set(key,{cn,description,supplier,sourceId:String(r.source_id||"")||null});
  if(found.size>=max)break;
 }
 return [...found.values()];
}
