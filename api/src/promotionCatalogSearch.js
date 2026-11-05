import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SAFE=/^[a-z][a-z0-9_]{1,62}$/;
const has=(columns,table,name)=>columns.some(c=>c.table_name===table&&c.column_name===name);

// Search names, genuine national codes, article supplier/laboratory data and
// the matching tenant-scoped supplier master. Never treat an ERP id as a CN.
export function promotionCatalogSearchSQL(schema,columns){
 if(!SAFE.test(schema))throw Error("Esquema de artículos inválido");
 if(!["farmacia_codigo","origen_id","nombre","codigo_nacional"]
   .every(name=>has(columns,"articulos",name)))
   throw Error("El catálogo no dispone de los campos necesarios para buscar artículos");
 const catalog='"'+schema+'".articulos';
 const refs=["proveedor_id","proveedor_codigo","proveedor","laboratorio_id","laboratorio"]
   .filter(name=>has(columns,"articulos",name))
   .map(name=>'upper(btrim(a."'+name+'"::text))');
 const array=refs.length?"ARRAY["+refs.join(",")+"]::text[]":null;
 const lab=has(columns,"articulos","laboratorio")?
   "nullif(btrim(a.laboratorio::text),'')":"NULL::text";
 const direct=refs.map(ref=>"coalesce("+ref+",'') ILIKE '%'||$3||'%'");
 const canJoinSuppliers=["farmacia_codigo","origen_id","nombre"]
   .every(name=>has(columns,"proveedores",name));
 const external=canJoinSuppliers&&array?
   "EXISTS (SELECT 1 FROM \""+schema+"\".proveedores pr WHERE "+
   "upper(btrim(pr.farmacia_codigo::text))=upper(btrim(a.farmacia_codigo::text)) "+
   "AND upper(btrim(pr.origen_id::text))=ANY("+array+") "+
   "AND pr.nombre ILIKE '%'||$3||'%')":null;
 const master=array?
   "EXISTS (SELECT 1 FROM farmetrica.proveedores_maestro pm WHERE "+
   "pm.cliente_slug=$1 AND upper(btrim(pm.codigo_origen::text))=ANY("+array+") "+
   "AND pm.nombre ILIKE '%'||$3||'%')":null;
 const externalName=canJoinSuppliers&&array?
   "(SELECT nullif(btrim(pr.nombre::text),'') FROM \""+schema+"\".proveedores pr "+
   "WHERE upper(btrim(pr.farmacia_codigo::text))=upper(btrim(a.farmacia_codigo::text)) "+
   "AND upper(btrim(pr.origen_id::text))=ANY("+array+") LIMIT 1)":null;
 const masterName=array?
   "(SELECT nullif(btrim(pm.nombre::text),'') FROM farmetrica.proveedores_maestro pm "+
   "WHERE pm.cliente_slug=$1 AND upper(btrim(pm.codigo_origen::text))=ANY("+array+") LIMIT 1)":null;
 const supplier="coalesce("+[externalName,masterName,lab].filter(Boolean).join(",")+")";
 const terms=[
   "a.nombre::text ILIKE '%'||$3||'%'",
   "a.codigo_nacional::text ILIKE '%'||$3||'%'",
   ...direct,
   ...(external?[external]:[]),
   ...(master?[master]:[])
 ];
 return "WITH matching AS (SELECT "+
    "CASE WHEN btrim(a.codigo_nacional::text) ~ '^[0-9]{6}$' "+
    "THEN btrim(a.codigo_nacional::text) ELSE NULL END AS cn, "+
    "nullif(btrim(a.nombre::text),'') AS description, "+
    "btrim(a.origen_id::text) AS source_id, f.id::text AS pharmacy_id, "+
    supplier+" AS supplier "+
    "FROM "+catalog+" a JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
    "AND upper(btrim(a.farmacia_codigo::text))="+pharmacyDataCodeSQL("f")+" "+
    "WHERE f.id=ANY($2::int[]) AND "+
    "(($3::text<>'' AND ("+terms.join(" OR ")+")) "+
    "OR btrim(a.codigo_nacional::text)=ANY($4::text[])) "+
    "ORDER BY a.nombre LIMIT 600) "+
    "SELECT max(cn) AS cn,max(description) AS description, "+
    "max(supplier) AS supplier,max(source_id) AS \"sourceId\" "+
    "FROM matching "+
    "GROUP BY coalesce(cn, 'ERP:'||pharmacy_id||':'||source_id) "+
    "ORDER BY max(cn) IS NULL,max(description) NULLS LAST LIMIT 400";
}
