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
 const isCode=value=>value+" ~ '^[0-9]{6,7}
 const code="CASE WHEN "+isCode(raw)+" THEN left("+raw+",6) "+
  "WHEN "+isCode(normalized)+" THEN left("+normalized+",6) "+
  "WHEN "+official+" IS NOT NULL THEN "+official+"::text "+
  "WHEN "+isOriginCN+" THEN "+origin+" ELSE NULL::text END";
 const hasCN="("+isCode(raw)+" OR "+isCode(normalized)+" OR "+official+
  " IS NOT NULL OR "+isOriginCN+")";
 const referenceType="CASE WHEN "+isCode(raw)+" OR "+isCode(normalized)+
  " OR "+official+" IS NOT NULL THEN 'cn' "+
  "WHEN "+isOriginCN+" THEN 'farmatic' ELSE NULL END";
 const lab=has(columns,"articulos","laboratorio")?col("a","laboratorio"):"NULL::text";
 const refs=["proveedor_habitual_id","proveedor_id","proveedor_codigo","proveedor","laboratorio_id"]
  .filter(name=>has(columns,"articulos",name));
 const primary=refs.length?col("a",refs[0]):"NULL::text";
 const refCondition=refs.map(ref=>upper(col("a",ref))+"=matched.supplier_code").join(" OR ");
 const fields=(supplier="NULL::text")=>[
  "f.id::text AS pharmacy_id",col("a","origen_id")+" AS source_id",
  col("a","nombre")+" AS description",col("a","codigo_nacional")+" AS national_code",
  normalized+" AS normalized_code",lab+" AS laboratory",
  primary+" AS supplier_ref",supplier+" AS supplier_name",
  code+" AS resolved_cn",referenceType+" AS reference_type"
 ].join(", ");
 const scope="JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
  "AND "+upper("a.farmacia_codigo::text")+"="+pharmacyDataCodeSQL("f")+" "+
  "AND f.id=ANY($2::int[]) ";
 const officialJoin="LEFT JOIN farmetrica.nomenclator_presentaciones official "+
  "ON official.cn=btrim(a.origen_id::text) "+
  "AND btrim(a.origen_id::text) ~ '^[0-9]{6}$' ";
 // Cada palabra debe encontrarse, pero puede estar en CUALQUIER orden
 // y en CUALQUIERA de los campos: nombre ERP, laboratorio, CN, nombre AEMPS.
 // Los patrones son parámetros bindados; nunca se interpolan en el SQL.
 const searchable="concat_ws(' ', a.nombre::text, "+lab+", "+
  "a.origen_id::text, "+raw+", "+normalized+", official.cn, "+
  "official.nombre, official.laboratorio, "+
  "official.laboratorio_titular, official.laboratorio_comercializador)";
 const supplierSearchable="concat_ws(' ', a.nombre::text, "+lab+", "+
  "a.origen_id::text, "+raw+", "+normalized+", official.cn, "+
  "official.nombre, official.laboratorio, "+
  "official.laboratorio_titular, official.laboratorio_comercializador, matched.supplier_name)";
 // Deduplicación en PostgreSQL antes de LIMIT/OFFSET; estable entre páginas.
 const page=(candidate,limit,offset)=>
  "SELECT DISTINCT ON (resolved_cn) * FROM ("+candidate+") found "+
  "WHERE resolved_cn IS NOT NULL ORDER BY resolved_cn,description NULLS LAST "+
  "LIMIT "+limit+"::int OFFSET "+offset+"::int";
 const direct=page("SELECT "+fields()+" FROM "+a+" a "+scope+officialJoin+
  "WHERE "+hasCN+" AND ((cardinality($3::text[])>0 AND "+searchable+" ILIKE ALL($3::text[])) "+
  "OR "+raw+"=ANY($4::text[]) "+
  "OR ("+isCode(raw)+" AND left("+raw+",6)=ANY($4::text[])) "+
  (has(columns,"articulos","cn_normalizado")?
   "OR "+normalized+"=ANY($4::text[]) "+
   "OR ("+isCode(normalized)+" AND left("+normalized+",6)=ANY($4::text[])) ":"")+
  "OR (official.cn IS NOT NULL AND official.cn=ANY($4::text[])) "+
  "OR ("+isOriginCN+" AND "+origin+"=ANY($4::text[])))","$5","$6");
 // Fuente complementaria: la ficha AEMPS puede existir aunque la farmacia
 // no la tenga en su maestro. Ofrecer el CN con nombre oficial sin inventar
 // ninguna relación de stock o venta para ese producto.
 const officialCatalog=
  "SELECT n.cn::text AS resolved_cn,n.cn::text AS national_code, "+
  "n.nombre::text AS description, "+
  "coalesce(nullif(n.laboratorio_comercializador::text,''), "+
  "nullif(n.laboratorio_titular::text,''),n.laboratorio::text) AS supplier_name, "+
  "NULL::text AS source_id,NULL::text AS pharmacy_id "+
  "FROM farmetrica.nomenclator_presentaciones n "+
  "WHERE cardinality($1::text[])>0 AND "+
  "concat_ws(' ',n.nombre,n.cn,n.laboratorio,n.laboratorio_titular, "+
   "n.laboratorio_comercializador) ILIKE ALL($1::text[]) "+
  "ORDER BY n.cn LIMIT $2::int OFFSET $3::int";
 const supplierReady=refs.length>0&&
  ["farmacia_codigo","origen_id","nombre"].every(n=>has(columns,"proveedores",n));
 const allowed="WITH allowed AS MATERIALIZED (SELECT "+
  pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f "+
  "WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])) ";
 const sources="SELECT p.code AS pharmacy_code,"+upper("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(sp.nombre::text),'') AS supplier_name "+
  "FROM "+p+" sp JOIN allowed p ON "+upper("sp.farmacia_codigo::text")+"=p.code "+
  "WHERE sp.nombre::text ILIKE ANY($3::text[])";
 const master="SELECT p.code AS pharmacy_code,"+upper("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(pm.nombre::text),'') AS supplier_name "+
  "FROM farmetrica.proveedores_maestro pm JOIN "+p+" sp ON "+
  upper("sp.origen_id::text")+"="+upper("pm.codigo_origen::text")+
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
  "AND ("+refCondition+") "+scope+officialJoin+
  "WHERE "+hasCN+" AND "+supplierSearchable+" ILIKE ALL($6::text[])":null;
 const bySupplier=supplierRows?page(supplierRows,"$4","$5"):null;
 return {direct,suppliers,bySupplier,officialCatalog,supplierReady};
}

export function promotionResultCN(row,verifiedOrigins=new Set()){
 if(/^\d{6}$/.test(String(row.resolved_cn||"")))return String(row.resolved_cn);
 const codes=[row.national_code,row.normalized_code];
 for(const value of codes){
  const s=String(value??"").trim();
  if(/^\d{6,7}$/.test(s))return s.slice(0,6);
 }
 const id=String(row.source_id??"").trim();
 return /^\d{6}$/.test(id)&&verifiedOrigins.has(id)?id:null;
}

export function mergePromotionCatalogRows(rows,verifiedOrigins=new Set(),max=2000){
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
  found.set(key,{cn,description,supplier,sourceId:String(r.source_id||"")||null,
   ...(r.reference_type==="farmatic"?{referenceType:"farmatic"}:{})});
  if(found.size>=max)break;
 }
 return [...found.values()];
}
";
 const origin="btrim(coalesce(a.origen_id::text,''))";
 const isOriginCN=origin+" ~ '^[0-9]{6}
 const code="CASE WHEN "+isCode(raw)+" THEN left("+raw+",6) "+
  "WHEN "+isCode(normalized)+" THEN left("+normalized+",6) "+
  "WHEN "+official+" IS NOT NULL THEN "+official+"::text ELSE NULL::text END";
 const hasCN="("+isCode(raw)+" OR "+isCode(normalized)+" OR "+official+" IS NOT NULL)";
 const lab=has(columns,"articulos","laboratorio")?col("a","laboratorio"):"NULL::text";
 const refs=["proveedor_habitual_id","proveedor_id","proveedor_codigo","proveedor","laboratorio_id"]
  .filter(name=>has(columns,"articulos",name));
 const primary=refs.length?col("a",refs[0]):"NULL::text";
 const refCondition=refs.map(ref=>upper(col("a",ref))+"=matched.supplier_code").join(" OR ");
 const fields=(supplier="NULL::text")=>[
  "f.id::text AS pharmacy_id",col("a","origen_id")+" AS source_id",
  col("a","nombre")+" AS description",col("a","codigo_nacional")+" AS national_code",
  normalized+" AS normalized_code",lab+" AS laboratory",
  primary+" AS supplier_ref",supplier+" AS supplier_name",
  code+" AS resolved_cn"
 ].join(", ");
 const scope="JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
  "AND "+upper("a.farmacia_codigo::text")+"="+pharmacyDataCodeSQL("f")+" "+
  "AND f.id=ANY($2::int[]) ";
 const officialJoin="LEFT JOIN farmetrica.nomenclator_presentaciones official "+
  "ON official.cn=btrim(a.origen_id::text) "+
  "AND btrim(a.origen_id::text) ~ '^[0-9]{6}$' ";
 // Cada palabra debe encontrarse, pero puede estar en CUALQUIER orden
 // y en CUALQUIERA de los campos: nombre ERP, laboratorio, CN, nombre AEMPS.
 // Los patrones son parámetros bindados; nunca se interpolan en el SQL.
 const searchable="concat_ws(' ', a.nombre::text, "+lab+", "+
  "a.origen_id::text, "+raw+", "+normalized+", official.cn, "+
  "official.nombre, official.laboratorio, "+
  "official.laboratorio_titular, official.laboratorio_comercializador)";
 const supplierSearchable="concat_ws(' ', a.nombre::text, "+lab+", "+
  "a.origen_id::text, "+raw+", "+normalized+", official.cn, "+
  "official.nombre, official.laboratorio, "+
  "official.laboratorio_titular, official.laboratorio_comercializador, matched.supplier_name)";
 // Deduplicación en PostgreSQL antes de LIMIT/OFFSET; estable entre páginas.
 const page=(candidate,limit,offset)=>
  "SELECT DISTINCT ON (resolved_cn) * FROM ("+candidate+") found "+
  "WHERE resolved_cn IS NOT NULL ORDER BY resolved_cn,description NULLS LAST "+
  "LIMIT "+limit+"::int OFFSET "+offset+"::int";
 const direct=page("SELECT "+fields()+" FROM "+a+" a "+scope+officialJoin+
  "WHERE "+hasCN+" AND ((cardinality($3::text[])>0 AND "+searchable+" ILIKE ALL($3::text[])) "+
  "OR "+raw+"=ANY($4::text[]) "+
  "OR ("+isCode(raw)+" AND left("+raw+",6)=ANY($4::text[])) "+
  (has(columns,"articulos","cn_normalizado")?
   "OR "+normalized+"=ANY($4::text[]) "+
   "OR ("+isCode(normalized)+" AND left("+normalized+",6)=ANY($4::text[])) ":"")+
  "OR (official.cn IS NOT NULL AND official.cn=ANY($4::text[])))","$5","$6");
 // Fuente complementaria: la ficha AEMPS puede existir aunque la farmacia
 // no la tenga en su maestro. Ofrecer el CN con nombre oficial sin inventar
 // ninguna relación de stock o venta para ese producto.
 const officialCatalog=
  "SELECT n.cn::text AS resolved_cn,n.cn::text AS national_code, "+
  "n.nombre::text AS description, "+
  "coalesce(nullif(n.laboratorio_comercializador::text,''), "+
  "nullif(n.laboratorio_titular::text,''),n.laboratorio::text) AS supplier_name, "+
  "NULL::text AS source_id,NULL::text AS pharmacy_id "+
  "FROM farmetrica.nomenclator_presentaciones n "+
  "WHERE cardinality($1::text[])>0 AND "+
  "concat_ws(' ',n.nombre,n.cn,n.laboratorio,n.laboratorio_titular, "+
   "n.laboratorio_comercializador) ILIKE ALL($1::text[]) "+
  "ORDER BY n.cn LIMIT $2::int OFFSET $3::int";
 const supplierReady=refs.length>0&&
  ["farmacia_codigo","origen_id","nombre"].every(n=>has(columns,"proveedores",n));
 const allowed="WITH allowed AS MATERIALIZED (SELECT "+
  pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f "+
  "WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])) ";
 const sources="SELECT p.code AS pharmacy_code,"+upper("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(sp.nombre::text),'') AS supplier_name "+
  "FROM "+p+" sp JOIN allowed p ON "+upper("sp.farmacia_codigo::text")+"=p.code "+
  "WHERE sp.nombre::text ILIKE ANY($3::text[])";
 const master="SELECT p.code AS pharmacy_code,"+upper("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(pm.nombre::text),'') AS supplier_name "+
  "FROM farmetrica.proveedores_maestro pm JOIN "+p+" sp ON "+
  upper("sp.origen_id::text")+"="+upper("pm.codigo_origen::text")+
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
  "AND ("+refCondition+") "+scope+officialJoin+
  "WHERE "+hasCN+" AND "+supplierSearchable+" ILIKE ALL($6::text[])":null;
 const bySupplier=supplierRows?page(supplierRows,"$4","$5"):null;
 return {direct,suppliers,bySupplier,officialCatalog,supplierReady};
}

export function promotionResultCN(row,verifiedOrigins=new Set()){
 if(/^\d{6}$/.test(String(row.resolved_cn||"")))return String(row.resolved_cn);
 const codes=[row.national_code,row.normalized_code];
 for(const value of codes){
  const s=String(value??"").trim();
  if(/^\d{6,7}$/.test(s))return s.slice(0,6);
 }
 const id=String(row.source_id??"").trim();
 return /^\d{6}$/.test(id)&&verifiedOrigins.has(id)?id:null;
}

export function mergePromotionCatalogRows(rows,verifiedOrigins=new Set(),max=2000){
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
";
 const official="official.cn";
 const code="CASE WHEN "+isCode(raw)+" THEN left("+raw+",6) "+
  "WHEN "+isCode(normalized)+" THEN left("+normalized+",6) "+
  "WHEN "+official+" IS NOT NULL THEN "+official+"::text ELSE NULL::text END";
 const hasCN="("+isCode(raw)+" OR "+isCode(normalized)+" OR "+official+" IS NOT NULL)";
 const lab=has(columns,"articulos","laboratorio")?col("a","laboratorio"):"NULL::text";
 const refs=["proveedor_habitual_id","proveedor_id","proveedor_codigo","proveedor","laboratorio_id"]
  .filter(name=>has(columns,"articulos",name));
 const primary=refs.length?col("a",refs[0]):"NULL::text";
 const refCondition=refs.map(ref=>upper(col("a",ref))+"=matched.supplier_code").join(" OR ");
 const fields=(supplier="NULL::text")=>[
  "f.id::text AS pharmacy_id",col("a","origen_id")+" AS source_id",
  col("a","nombre")+" AS description",col("a","codigo_nacional")+" AS national_code",
  normalized+" AS normalized_code",lab+" AS laboratory",
  primary+" AS supplier_ref",supplier+" AS supplier_name",
  code+" AS resolved_cn"
 ].join(", ");
 const scope="JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
  "AND "+upper("a.farmacia_codigo::text")+"="+pharmacyDataCodeSQL("f")+" "+
  "AND f.id=ANY($2::int[]) ";
 const officialJoin="LEFT JOIN farmetrica.nomenclator_presentaciones official "+
  "ON official.cn=btrim(a.origen_id::text) "+
  "AND btrim(a.origen_id::text) ~ '^[0-9]{6}$' ";
 // Cada palabra debe encontrarse, pero puede estar en CUALQUIER orden
 // y en CUALQUIERA de los campos: nombre ERP, laboratorio, CN, nombre AEMPS.
 // Los patrones son parámetros bindados; nunca se interpolan en el SQL.
 const searchable="concat_ws(' ', a.nombre::text, "+lab+", "+
  "a.origen_id::text, "+raw+", "+normalized+", official.cn, "+
  "official.nombre, official.laboratorio, "+
  "official.laboratorio_titular, official.laboratorio_comercializador)";
 const supplierSearchable="concat_ws(' ', a.nombre::text, "+lab+", "+
  "a.origen_id::text, "+raw+", "+normalized+", official.cn, "+
  "official.nombre, official.laboratorio, "+
  "official.laboratorio_titular, official.laboratorio_comercializador, matched.supplier_name)";
 // Deduplicación en PostgreSQL antes de LIMIT/OFFSET; estable entre páginas.
 const page=(candidate,limit,offset)=>
  "SELECT DISTINCT ON (resolved_cn) * FROM ("+candidate+") found "+
  "WHERE resolved_cn IS NOT NULL ORDER BY resolved_cn,description NULLS LAST "+
  "LIMIT "+limit+"::int OFFSET "+offset+"::int";
 const direct=page("SELECT "+fields()+" FROM "+a+" a "+scope+officialJoin+
  "WHERE "+hasCN+" AND ((cardinality($3::text[])>0 AND "+searchable+" ILIKE ALL($3::text[])) "+
  "OR "+raw+"=ANY($4::text[]) "+
  "OR ("+isCode(raw)+" AND left("+raw+",6)=ANY($4::text[])) "+
  (has(columns,"articulos","cn_normalizado")?
   "OR "+normalized+"=ANY($4::text[]) "+
   "OR ("+isCode(normalized)+" AND left("+normalized+",6)=ANY($4::text[])) ":"")+
  "OR (official.cn IS NOT NULL AND official.cn=ANY($4::text[])))","$5","$6");
 // Fuente complementaria: la ficha AEMPS puede existir aunque la farmacia
 // no la tenga en su maestro. Ofrecer el CN con nombre oficial sin inventar
 // ninguna relación de stock o venta para ese producto.
 const officialCatalog=
  "SELECT n.cn::text AS resolved_cn,n.cn::text AS national_code, "+
  "n.nombre::text AS description, "+
  "coalesce(nullif(n.laboratorio_comercializador::text,''), "+
  "nullif(n.laboratorio_titular::text,''),n.laboratorio::text) AS supplier_name, "+
  "NULL::text AS source_id,NULL::text AS pharmacy_id "+
  "FROM farmetrica.nomenclator_presentaciones n "+
  "WHERE cardinality($1::text[])>0 AND "+
  "concat_ws(' ',n.nombre,n.cn,n.laboratorio,n.laboratorio_titular, "+
   "n.laboratorio_comercializador) ILIKE ALL($1::text[]) "+
  "ORDER BY n.cn LIMIT $2::int OFFSET $3::int";
 const supplierReady=refs.length>0&&
  ["farmacia_codigo","origen_id","nombre"].every(n=>has(columns,"proveedores",n));
 const allowed="WITH allowed AS MATERIALIZED (SELECT "+
  pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f "+
  "WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])) ";
 const sources="SELECT p.code AS pharmacy_code,"+upper("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(sp.nombre::text),'') AS supplier_name "+
  "FROM "+p+" sp JOIN allowed p ON "+upper("sp.farmacia_codigo::text")+"=p.code "+
  "WHERE sp.nombre::text ILIKE ANY($3::text[])";
 const master="SELECT p.code AS pharmacy_code,"+upper("sp.origen_id::text")+
  " AS supplier_code,nullif(btrim(pm.nombre::text),'') AS supplier_name "+
  "FROM farmetrica.proveedores_maestro pm JOIN "+p+" sp ON "+
  upper("sp.origen_id::text")+"="+upper("pm.codigo_origen::text")+
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
  "AND ("+refCondition+") "+scope+officialJoin+
  "WHERE "+hasCN+" AND "+supplierSearchable+" ILIKE ALL($6::text[])":null;
 const bySupplier=supplierRows?page(supplierRows,"$4","$5"):null;
 return {direct,suppliers,bySupplier,officialCatalog,supplierReady};
}

export function promotionResultCN(row,verifiedOrigins=new Set()){
 if(/^\d{6}$/.test(String(row.resolved_cn||"")))return String(row.resolved_cn);
 const codes=[row.national_code,row.normalized_code];
 for(const value of codes){
  const s=String(value??"").trim();
  if(/^\d{6,7}$/.test(s))return s.slice(0,6);
 }
 const id=String(row.source_id??"").trim();
 return /^\d{6}$/.test(id)&&verifiedOrigins.has(id)?id:null;
}

export function mergePromotionCatalogRows(rows,verifiedOrigins=new Set(),max=2000){
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
