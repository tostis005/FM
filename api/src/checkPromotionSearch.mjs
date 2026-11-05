// Comprobación de solo lectura con el catálogo instalado en producción.
// No imprime nombres, CN, farmacia, credenciales ni datos de clientes.
import pg from "pg";
import {promotionCatalogSearchSQL} from "./promotionCatalogSearch.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

if(!process.env.DATABASE_URL)throw Error("Sin conexión de solo lectura a PostgreSQL");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:3500,statement_timeout:7500,query_timeout:8000,
 options:"-c lock_timeout=3s"});
try{
 const slug="ampedia";
 const {rows:tenants}=await pool.query({
  text:"SELECT esquema_datos AS schema FROM farmetrica.clientes WHERE slug=$1",
  values:[slug],query_timeout:3500});
 const schema=tenants[0]?.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))
  throw Error("Esquema de búsqueda inexistente");
 const {rows:fields}=await pool.query({
  text:"SELECT table_name,column_name FROM information_schema.columns "+
   "WHERE table_schema=$1 AND table_name IN ('articulos','proveedores')",
  values:[schema],query_timeout:3500});
 const sql=promotionCatalogSearchSQL(schema,fields);
 const {rows:samples}=await pool.query({
  text:"SELECT f.id,a.nombre::text AS name FROM \""+schema+"\".articulos a "+
   "JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
   "AND upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f")+" "+
   "WHERE f.activo=true AND nullif(btrim(a.nombre::text),'') IS NOT NULL "+
   "AND btrim(a.codigo_nacional::text) ~ '^[0-9]{6,7}$' LIMIT 1",
  values:[slug],query_timeout:6500});
 if(!samples.length)throw Error("El maestro no contiene artículos consultables");
 const id=Number(samples[0].id),term=samples[0].name.slice(0,90);
 const {rows:products}=await pool.query({
  text:sql.direct,values:[slug,[id],term,[],240,0],query_timeout:7000});
 if(!products.length)throw Error("El buscador no devuelve un artículo que existe en el maestro");
 console.log("BÚSQUEDA POR ARTÍCULO: OK");
 if(sql.supplierReady){
  const {rows:source}=await pool.query({
   text:"SELECT sp.nombre::text AS name FROM \""+schema+"\".proveedores sp "+
    "JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
    "AND upper(btrim(sp.farmacia_codigo))="+pharmacyDataCodeSQL("f")+" "+
    "WHERE f.id=$2 AND nullif(btrim(sp.nombre),'') IS NOT NULL LIMIT 1",
   values:[slug,id],query_timeout:4500});
  if(source.length){
   const provider=(await pool.query({
    text:sql.suppliers,values:[slug,[id],source[0].name.slice(0,90),80],
    query_timeout:6500
   })).rows;
   if(!provider.length)throw Error("El buscador no devuelve un proveedor que existe");
   await pool.query({
    text:sql.bySupplier,values:[slug,[id],JSON.stringify(provider),180,0],
    query_timeout:7000
   });
   console.log("BÚSQUEDA POR PROVEEDOR: OK");
  }else console.log("BÚSQUEDA POR PROVEEDOR: maestro sin fichas para la muestra");
 }else console.log("BÚSQUEDA POR PROVEEDOR: falta campo de relación o maestro ERP");

 // Control de cobertura, no solo que exista un producto: comprobar que los
 // primeros lotes contienen todos los CN distintos en una búsqueda amplia.
 const {rows:active}=await pool.query({
  text:"SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo=true",
  values:[slug],query_timeout:3500
 });
 const scoped=active.map(row=>Number(row.id));
 let checkedBroad=false;
 for(const term of ["EUCERIN","ISDIN","VICHY"]){
  if(!scoped.length)break;
  const {rows:counts}=await pool.query({
   text:"SELECT count(DISTINCT left(btrim(a.codigo_nacional::text),6))::int AS n "+
    "FROM \""+schema+"\".articulos a JOIN farmetrica.farmacias f "+
    "ON f.cliente_slug=$1 AND upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f")+" "+
    "WHERE f.id=ANY($2::int[]) AND a.nombre ILIKE '%'||$3||'%' "+
    "AND btrim(a.codigo_nacional::text) ~ '^[0-9]{6,7}$'",
   values:[slug,scoped,term],query_timeout:7500
  });
  const expected=Number(counts[0]?.n||0);
  if(expected<15)continue;
  const first=(await pool.query({text:sql.direct,
   values:[slug,scoped,term,[],181,0],query_timeout:8000})).rows;
  if(first.length<Math.min(180,expected))
   throw Error("El buscador está ocultando CN en una consulta amplia");
  if(expected>180){
   const second=(await pool.query({text:sql.direct,
    values:[slug,scoped,term,[],181,180],query_timeout:8000})).rows;
   const found=new Set([...first.slice(0,180),...second].map(row=>row.resolved_cn));
   if(found.size<Math.min(360,expected))
    throw Error("La paginación pierde CN reales del catálogo");
  }
  checkedBroad=true;
  console.log("BÚSQUEDA AMPLIA: CN únicos y paginación correctos");
  break;
 }
 if(!checkedBroad)console.log("BÚSQUEDA AMPLIA: sin término de muestra suficientemente representativo");
}finally{
 await pool.end();
}
