// Diagnóstico de una referencia concreta, solo SELECT. Nunca imprime datos
// personales, documentos, stock, ventas ni códigos de proveedor locales.
// Se ejecuta bajo control de CI en el VPS del cliente.
import pg from "pg";
import {readUnifiedSupplierCN} from "./unifiedSuppliers.js";
const CN="151130",SLUG="ampedia";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:5000,statement_timeout:40000,query_timeout:42000});
const normalized=v=>String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .toUpperCase().replace(/[^A-Z0-9]/g,"");
const supplier=v=>/^\d+$/.test(String(v||"").trim())?
 (String(v).trim().replace(/^0+/,"")||"0"):String(v||"").trim().toUpperCase();
const out={cn:CN,tenant:SLUG,mode:"read_only"};
try{
 const {rows:tenant}=await pool.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug=$1",[SLUG]);
 const schema=tenant[0]?.esquema_datos;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema inválido");
 const ctx={client:{slug:SLUG,schema}};
 const {rows:ph}=await pool.query(
  "SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo",[SLUG]);
 const ids=ph.map(p=>Number(p.id));
 const [{rows:allSuppliers},{rows:article},{rows:snap}]=await Promise.all([
  pool.query("SELECT id::text,nombre FROM farmetrica.proveedores_unificados WHERE cliente_slug=$1 AND activo",[SLUG]),
  pool.query({text:`SELECT a.farmacia_codigo,a.nombre,a.codigo_nacional,
   to_jsonb(a)->>'cn_normalizado' AS normalizado,
   to_jsonb(a)->>'proveedor_habitual_id' AS habitual,
   to_jsonb(a)->>'proveedor_id' AS proveedor,
   to_jsonb(a)->>'proveedor_codigo' AS proveedor_codigo,
   a.laboratorio
   FROM "${schema}".articulos a
   WHERE btrim(coalesce(a.codigo_nacional,''))=$1
    OR btrim(coalesce(to_jsonb(a)->>'cn_normalizado',''))=$1
    OR btrim(a.origen_id::text)=$1
   LIMIT 40`,values:[CN],query_timeout:40000}),
  pool.query({text:`SELECT lab_id::text AS lab,cn
    FROM farmetrica.preparador_ultima_recepcion_cache
    WHERE cliente_slug=$1 AND cn=$2`,values:[SLUG,CN],query_timeout:7000})
 ]);
 const selected=allSuppliers.filter(s=>normalized(s.nombre).includes("LOREAL"));
 out.laboratorios=selected.map(s=>({id:s.id,name:s.nombre}));
 out.erpRows=article.length;
 out.snapshotLab=snap.map(x=>({id:x.lab,
  nombre:allSuppliers.find(s=>s.id===x.lab)?.nombre||"Otro"}));
 const {rows:aliases}=selected.length?await pool.query({
  text:`SELECT proveedor_id::text AS id,farmacia_codigo,codigo_origen
  FROM farmetrica.proveedores_unificados_alias
  WHERE cliente_slug=$1 AND proveedor_id=ANY($2::bigint[])`,
  values:[SLUG,selected.map(s=>s.id)],query_timeout:7000}):{rows:[]};
 out.erp=article.map(row=>{
  const mapped=aliases.filter(a=>a.farmacia_codigo.trim().toUpperCase()===
   String(row.farmacia_codigo||"").trim().toUpperCase());
  const suppliers=[row.habitual,row.proveedor,row.proveedor_codigo]
   .filter(v=>v!==null&&v!==undefined&&String(v).trim()!=="");
  return {farmacia:row.farmacia_codigo,nombre:row.nombre,
   codigoOriginal:row.codigo_nacional,codigoNormalizado:row.normalizado,
   laboratorioERP:row.laboratorio,
   tieneProveedorHabitual:!!row.habitual,
   proveedorHabitualEsLoreal:mapped.some(a=>supplier(a.codigo_origen)===supplier(row.habitual)),
   algunProveedorEsLoreal:mapped.some(a=>suppliers.some(v=>supplier(a.codigo_origen)===supplier(v))),
   nombreLaboratorioEsLoreal:normalized(row.laboratorio).includes("LOREAL"),
   equivalenciasProveedor:selected.map(s=>({id:s.id,
    asociado:mapped.some(a=>suppliers.some(v=>supplier(a.codigo_origen)===supplier(v)))}))};
 });
 // Determinar si P0508 pertenece a un proveedor concreto o a otra entidad
 // ERP. Relación exacta y por farmacia, nunca por parecido del nombre.
 const labCodes=[...new Set(article.map(row=>String(row.laboratorio||"").trim()).filter(Boolean))];
 const {rows:labSourceLinks}=labCodes.length?await pool.query({text:`
  SELECT a.codigo_origen AS code,p.id::text AS id,p.nombre,
   count(DISTINCT a.farmacia_codigo)::int AS pharmacies
  FROM farmetrica.proveedores_unificados_alias a
  JOIN farmetrica.proveedores_unificados p ON p.id=a.proveedor_id
   AND p.cliente_slug=a.cliente_slug
  WHERE a.cliente_slug=$1 AND upper(btrim(a.codigo_origen))=ANY($2::text[])
  GROUP BY a.codigo_origen,p.id,p.nombre ORDER BY pharmacies DESC,p.nombre LIMIT 35`,
  values:[SLUG,labCodes],query_timeout:7000}):{rows:[]};
 out.labCodeAliases=labSourceLinks;
 const {rows:labProviders}=labCodes.length?await pool.query({text:`
  SELECT btrim(origen_id::text) AS code,nombre,
   count(DISTINCT farmacia_codigo)::int AS pharmacies
  FROM "${schema}".proveedores
  WHERE upper(btrim(origen_id::text))=ANY($1::text[])
  GROUP BY 1,2 ORDER BY pharmacies DESC,nombre LIMIT 20`,
  values:[labCodes],query_timeout:7000}):{rows:[]};
 out.labCodeSuppliers=labProviders;
 const {rows:labTables}=await pool.query({text:`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema=$1 AND table_name ILIKE '%laborator%'
  ORDER BY table_name LIMIT 15`,
  values:[schema],query_timeout:7000});
 out.erpLabTables=labTables.map(r=>r.table_name);
 const catalogs=[];
 for(const s of selected.slice(0,6)){
  try{
   const start=Date.now();
   const data=await readUnifiedSupplierCN(pool,ctx,{key:"P:"+s.id,pharmacies:ids,
    type:"parafarmacia",search:CN});
   catalogs.push({id:s.id,name:s.nombre,cnPresente:data.rows.some(r=>r.cn===CN),
    totalFiltrado:data.total,warning:!!data.warning,elapsedMs:Date.now()-start});
  }catch(e){catalogs.push({id:s.id,name:s.nombre,error:e.code||e.name})}
 }
 out.catalogs=catalogs;
}catch(e){out.error=e.code||e.name||"QUERY_ERROR";out.detail=String(e.message||"").slice(0,120)}
finally{
 console.info("PREPARADOR_CN_151130",JSON.stringify(out));
 await pool.end();
}
