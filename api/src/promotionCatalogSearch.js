import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SAFE=/^[a-z][a-z0-9_]{1,62}$/;
const has=(columns,table,name)=>columns.some(c=>c.table_name===table&&c.column_name===name);
const quote=s=>'"'+s+'"';
const col=(table,column)=>table+"."+quote(column)+"::text";
const upper=expr=>"upper(btrim(coalesce("+expr+",'')))";

export function promotionSearchPatterns(search){
 const words=String(search||"").trim().split(/\s+/u).filter(Boolean);
 return words.map(word=>"%"+word.replace(/[\\%_]/g,character=>"\\"+character)+"%");
}

/**
 * Solo devolver artículos con CN identificable y paginar DESPUÉS de
 * deduplicar por CN. Antes el LIMIT se aplicaba a filas del ERP (muchas sin CN
 * o repetidas por farmacia); esos registros desplazaban artículos válidos.
 *
 * La búsqueda de nombres de proveedores se resuelve aparte en el mismo
 * ámbito de farmacias: nunca se unen códigos locales de farmacias distintas.
 */
export function promotionCatalogSearchSQL(schema,columns){
 if(!SAFE.test(schema))throw Error("Esquema de artículos inválido");
 if(!["farmacia_codigo","origen_id","nombre","codigo_nacional"]
   .every(name=>has(columns,"articulos",name)))
  throw Error("El catálogo no dispone de los campos necesarios para buscar artículos");
 const a=quote(schema)+".articulos",p=quote(schema)+".proveedores";
 const raw="btrim(coalesce(a.codigo_nacional::text,''))";
 const normalized=has(columns,"articulos","cn_normalizado")?
  "btrim(coalesce(a.cn_normalizado::text,''))":"''::text";
 const isCode=value=>value+" ~ '^[0-9]{6,7}$'";
 const origin="btrim(coalesce(a.origen_id::text,''))";
 const isOriginCode=origin+" ~ '^[0-9]{6}$'";
 // Las campañas sólo utilizan el catálogo Farmatic de cada farmacia.
 const code="CASE WHEN "+isCode(raw)+" THEN left("+raw+",6) "+
  "WHEN "+isCode(normalized)+" THEN left("+normalized+",6) "+
  "WHEN "+isOriginCode+" THEN "+origin+" ELSE NULL::text END";
 const hasCN="("+isCode(raw)+" OR "+isCode(normalized)+" OR "+isOriginCode+")";
 const referenceType="CASE WHEN "+isCode(raw)+" OR "+isCode(normalized)+
  " THEN 'cn' WHEN "+isOriginCode+" THEN 'farmatic' ELSE NULL END";
 const lab=has(columns,"articulos","laboratorio")?col("a","laboratorio"):"NULL::text";
 const refs=["proveedor_habitual_id","proveedor_id","proveedor_codigo","proveedor","laboratorio_id"]
  .filter(name=>has(columns,"articulos",name));
 const primary=refs.length?col("a",refs[0]):"NULL::text";
 const supplierCode=expr=>"CASE WHEN btrim(coalesce("+expr+",'')) ~ '^[0-9]+$' "+
  "THEN coalesce(nullif(ltrim(btrim(coalesce("+expr+",'')),'0'),''),'0') "+
  "ELSE "+upper(expr)+" END";
 const refCondition=refs.map(ref=>supplierCode(col("a",ref))+"=matched.supplier_code").join(" OR ");
 const fields=(supplier="NULL::text",requested=false)=>[

  "f.id::text AS pharmacy_id",col("a","origen_id")+" AS source_id",
  col("a","nombre")+" AS description",col("a","codigo_nacional")+" AS national_code",
  normalized+" AS normalized_code",lab+" AS laboratory",
  primary+" AS supplier_ref",supplier+" AS supplier_name",
  (requested?"CASE WHEN "+isOriginCode+" AND "+origin+"=ANY($4::text[]) THEN "+origin+
   " ELSE "+code+" END":code)+" AS resolved_cn",
  (requested?"CASE WHEN "+isOriginCode+" AND "+origin+"=ANY($4::text[]) THEN 'farmatic' ELSE "+
   referenceType+" END":referenceType)+" AS reference_type"
 ].join(", ");
 const scope="JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
  "AND "+upper("a.farmacia_codigo::text")+"="+pharmacyDataCodeSQL("f")+" "+
  "AND f.id=ANY($2::int[]) ";
 // Sólo nombre, CN, referencia, laboratorio y proveedores del ERP Farmatic.
 // Esta expresión coincide exactamente con el índice GIN de la migración 045.
 // La primera palabra (la más discriminante) activa pg_trgm, y las demás
 // conservan la coincidencia de palabras repartidas en varias columnas.
 const searchable="lower("+[
  "a.nombre::text","a.codigo_nacional::text",
  has(columns,"articulos","cn_normalizado")?"a.cn_normalizado::text":"NULL::text",
  "a.origen_id::text",lab,primary
 ].map(expr=>"coalesce("+expr+",'')").join(" || ' ' || ")+")";
 const supplierSearchable="concat_ws(' ', a.nombre::text, "+lab+", "+
  "a.origen_id::text, "+raw+", "+normalized+", matched.supplier_name)";
 // Deduplicación en PostgreSQL antes de LIMIT/OFFSET; estable entre páginas.
 const page=(candidate,limit,offset)=>
  "SELECT DISTINCT ON (resolved_cn) * FROM ("+candidate+") found "+
  "WHERE resolved_cn IS NOT NULL ORDER BY resolved_cn,description NULLS LAST "+
  "LIMIT "+limit+"::int OFFSET "+offset+"::int";
 // Buscar texto y consultar CN pegados no deben compartir una condición OR:
 // la rama de CN impedía al planificador aprovechar el índice GIN de texto.
 const direct=page("SELECT "+fields()+" FROM "+a+" a "+scope+
  "WHERE "+hasCN+" AND "+searchable+" LIKE $7::text "+
  "AND "+searchable+" ILIKE ALL($3::text[])","$5","$6");
 const codePredicates=[
  "a.origen_id::text=ANY($4::text[])",
  "left(btrim(a.codigo_nacional::text),6)=ANY($4::text[])"
 ];
 if(has(columns,"articulos","cn_normalizado"))
  codePredicates.push("left(btrim(a.cn_normalizado::text),6)=ANY($4::text[])");
 const byCodes=page("SELECT "+fields("NULL::text",true)+" FROM "+a+" a "+scope+
  "WHERE "+hasCN+" AND ("+codePredicates.join(" OR ")+")","$5","$6");
 const supplierReady=refs.length>0&&
  ["farmacia_codigo","origen_id","nombre"].every(n=>has(columns,"proveedores",n));
 const allowed="WITH allowed AS MATERIALIZED (SELECT "+
  pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f "+
  "WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])) ";
 const sources="SELECT p.code AS pharmacy_code,"+supplierCode("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(sp.nombre::text),'') AS supplier_name "+
  "FROM "+p+" sp JOIN allowed p ON "+upper("sp.farmacia_codigo::text")+"=p.code "+
  "WHERE sp.nombre::text ILIKE ANY($3::text[])";
 const master="SELECT p.code AS pharmacy_code,"+supplierCode("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(pm.nombre::text),'') AS supplier_name "+
  "FROM farmetrica.proveedores_maestro pm JOIN "+p+" sp ON "+
  supplierCode("sp.origen_id::text")+"="+supplierCode("pm.codigo_origen::text")+
  " JOIN allowed p ON "+upper("sp.farmacia_codigo::text")+"=p.code "+
  "WHERE pm.cliente_slug=$1 AND pm.nombre::text ILIKE ANY($3::text[])";
 const suppliers=supplierReady?
  allowed+"SELECT DISTINCT pharmacy_code,supplier_code,supplier_name FROM ("+
   sources+" UNION ALL "+master+") found "+
   "WHERE supplier_code<>'' ORDER BY supplier_name LIMIT $4::int":null;
 const supplierRows=supplierReady?
  "SELECT "+fields("matched.supplier_name")+" FROM "+a+" a "+
  "JOIN jsonb_to_recordset($3::jsonb) AS matched("+
   "pharmacy_code text,supplier_code text,supplier_name text) "+
  "ON "+upper("a.farmacia_codigo::text")+"=matched.pharmacy_code "+
  "AND ("+refCondition+") "+scope+
  "WHERE "+hasCN+" AND "+supplierSearchable+" ILIKE ALL($6::text[])":null;
 const bySupplier=supplierRows?page(supplierRows,"$4","$5"):null;
 // Farmatic no siempre sincroniza proveedor_habitual_id. Extraer también
 // los artículos recibidos de ese proveedor, vinculando siempre por farmacia.
 const receiptRows=supplierReady?
  "SELECT "+fields("matched.supplier_name")+" FROM "+a+" a "+
  "JOIN jsonb_to_recordset($3::jsonb) AS matched("+
   "pharmacy_code text,supplier_code text,supplier_name text) "+
  "ON "+upper("a.farmacia_codigo::text")+"=matched.pharmacy_code "+
  "JOIN "+quote(schema)+".fm_recepciones_analitica r ON "+
   upper("r.farmacia_codigo::text")+"=matched.pharmacy_code "+
  "AND btrim(r.articulo_id::text)=btrim(a.origen_id::text) "+
  "AND "+supplierCode("r.proveedor_id::text")+"=matched.supplier_code "+
  scope+
  "WHERE "+hasCN+" AND "+supplierSearchable+" ILIKE ALL($6::text[])":null;
 const byReceiptSupplier=receiptRows?page(receiptRows,"$4","$5"):null;
 return {direct,byCodes,suppliers,bySupplier,byReceiptSupplier,supplierReady};
}

export function promotionResultCN(row){
 if(/^\d{6}$/.test(String(row.resolved_cn||"")))return String(row.resolved_cn);
 const codes=[row.national_code,row.normalized_code];
 for(const value of codes){
  const s=String(value??"").trim();
  if(/^\d{6,7}$/.test(s))return s.slice(0,6);
 }
 const id=String(row.source_id??"").trim();
 return /^\d{6}$/.test(id)?id:null;
}

export function mergePromotionCatalogRows(rows,max=2000){
 const found=new Map();
 for(const r of rows||[]){
  const cn=promotionResultCN(r);
  const key=cn||"ERP:"+r.pharmacy_id+":"+r.source_id;
  const description=String(r.description||"").trim()||"Artículo sin nombre";
  const supplier=String(r.supplier_name||r.laboratory||"").trim()||null;
  const current=found.get(key);
  if(current){
   if(!current.supplier&&supplier)current.supplier=supplier;
   continue;
  }
  found.set(key,{cn,description,supplier,sourceId:String(r.source_id||"")||null,
   ...(r.reference_type==="farmatic"?{referenceType:"farmatic"}:{})});
  if(found.size>=max)break;
 }
 return [...found.values()];
}
