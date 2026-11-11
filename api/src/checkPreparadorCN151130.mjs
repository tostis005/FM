// Diagnóstico de una referencia concreta, solo SELECT. Nunca imprime datos
// personales, documentos, stock ni ventas.
// Se ejecuta bajo control de CI en el VPS del cliente.
import pg from "pg";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readUnifiedSupplierCN} from "./unifiedSuppliers.js";
const CN=String(process.env.FM_PREPARADOR_CN||"151130").trim(),SLUG="ampedia";
if(!/^[0-9]{6,7}$/.test(CN))throw Error("CN inválido");
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
 const selected=allSuppliers.filter(s=>snap.some(row=>String(row.lab)===String(s.id)) ||
 (CN==="151130"&&normalized(s.nombre).includes("LOREAL")));
 out.laboratorios=selected.map(s=>({id:s.id,name:s.nombre}));
 out.erpRows=article.length;
 // Evidencia propia del artículo: recepciones por ID ERP exacto y proveedor
 // local de la misma farmacia. No se deduce ningún dato desde otros artículos.
 try{
  const {rows:receiptEvidence}=await pool.query({text:`
   WITH own_receipts AS (
    SELECT h.farmacia_codigo,
     CASE WHEN btrim(coalesce(h.proveedor_origen_id::text,'')) ~ '^[0-9]+$'
      THEN coalesce(nullif(ltrim(btrim(h.proveedor_origen_id::text),'0'),''),'0')
      ELSE upper(btrim(coalesce(h.proveedor_origen_id::text,''))) END AS provider_code,
     count(*)::int AS lineas,max(h.fecha) AS ultima
    FROM "${schema}".fm_recepciones_lineas l
    JOIN "${schema}".fm_recepciones_cabeceras h
     ON h.farmacia_codigo=l.farmacia_codigo AND h.sistema_origen=l.sistema_origen
      AND h.documento_id=l.documento_id
    WHERE l.articulo_origen_id::text=$1
     AND h.lineas_completas AND NOT h.eliminada_logicamente
     AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
     AND NOT l.eliminada_logicamente AND l.cantidad>0 AND l.devuelta IS NOT TRUE
    GROUP BY h.farmacia_codigo,provider_code
   )
   SELECT r.farmacia_codigo AS farmacia, f.id::text AS farmacia_id,
    coalesce(f.activo,false) AS farmacia_activa,p.id::text AS proveedor_id,
    coalesce(p.nombre,'SIN_PROVEEDOR_UNIFICADO') AS nombre,
    coalesce(p.clase,'SIN_CLASIFICAR') AS clase,
    r.provider_code AS codigo_proveedor,a.nombre_origen AS nombre_alias,
    a.procedencia AS procedencia_alias,a.vigencia AS vigencia_alias,
    (SELECT min(sp.nombre) FROM "${schema}".proveedores sp
      WHERE upper(btrim(sp.farmacia_codigo))=upper(btrim(r.farmacia_codigo))
       AND (CASE WHEN btrim(sp.origen_id::text) ~ '^[0-9]+ AS lineas,max(r.ultima) AS ultima
   FROM own_receipts r
   LEFT JOIN farmetrica.proveedores_unificados_alias a
    ON a.cliente_slug=$2 AND upper(btrim(a.farmacia_codigo))=upper(btrim(r.farmacia_codigo))
     AND (CASE WHEN btrim(a.codigo_origen) ~ '^[0-9]+$'
      THEN coalesce(nullif(ltrim(btrim(a.codigo_origen),'0'),''),'0')
      ELSE upper(btrim(a.codigo_origen)) END)=r.provider_code
   LEFT JOIN farmetrica.proveedores_unificados p
    ON p.cliente_slug=$2 AND p.id=a.proveedor_id
   LEFT JOIN farmetrica.farmacias f
    ON f.cliente_slug=$2 AND ${pharmacyDataCodeSQL("f")}=upper(btrim(r.farmacia_codigo))
   GROUP BY r.farmacia_codigo,f.id,f.activo,p.id,p.nombre,p.clase,
    r.provider_code,a.nombre_origen,a.procedencia,a.vigencia
   ORDER BY ultima DESC LIMIT 50`,
    values:[CN,SLUG],query_timeout:22000});
  out.ownReceiptEvidence=receiptEvidence.map(r=>({
   farmacia:r.farmacia,farmacia_id:r.farmacia_id,farmacia_activa:r.farmacia_activa,
   proveedor_id:r.proveedor_id,proveedor:r.nombre,clase:r.clase,
   lineas:r.lineas,ultima:r.ultima,
   codigoProveedor:r.codigo_proveedor,nombreERP:r.nombre_erp,
   nombreAlias:r.nombre_alias,origenAlias:r.procedencia_alias,
   vigenciaAlias:r.vigencia_alias}));
 }catch(e){out.ownReceiptError=e.code||e.name||"QUERY_ERROR"}

 const labCodes=[...new Set(article.map(r=>String(r.laboratorio||"").trim()).filter(Boolean))];
 const {rows:erpSuppliers}=await pool.query({text:`
  SELECT farmacia_codigo,origen_id::text AS code,nombre
  FROM "${schema}".proveedores
  WHERE upper(btrim(origen_id::text))=ANY($1::text[])
  LIMIT 40`,values:[labCodes.map(c=>c.toUpperCase())],query_timeout:10000});
 const {rows:aliasesForLab}=await pool.query({text:`
  SELECT ua.farmacia_codigo,ua.codigo_origen,
   p.id::text AS id,p.nombre
  FROM farmetrica.proveedores_unificados_alias ua
  JOIN farmetrica.proveedores_unificados p ON p.cliente_slug=ua.cliente_slug
   AND p.id=ua.proveedor_id
  WHERE ua.cliente_slug=$1 AND upper(btrim(ua.codigo_origen))=ANY($2::text[])
  LIMIT 40`,values:[SLUG,labCodes.map(c=>c.toUpperCase())],query_timeout:10000});
 out.labCodeLinks={codes:labCodes,erpSuppliers:erpSuppliers.map(r=>({farmacia:r.farmacia_codigo,nombre:r.nombre})),
  unified:aliasesForLab.map(r=>({farmacia:r.farmacia_codigo,id:r.id,nombre:r.nombre}))};
 const {rows:labColumns}=await pool.query({text:`
  SELECT table_name,column_name FROM information_schema.columns
  WHERE table_schema=$1 AND table_name IN ('laboratorios','articulos')
   AND column_name IN ('laboratorio','laboratorio_id','codigo','origen_id','nombre',
    'proveedor_habitual_id','proveedor_id','codigo_nacional','cn_normalizado')`,
  values:[schema],query_timeout:5000});
 out.availableLabColumns=labColumns;
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
 const catalogs=[];
 for(const s of selected.slice(0,6)){
  try{
   const start=Date.now();
   const data=await readUnifiedSupplierCN(pool,ctx,{key:"P:"+s.id,pharmacies:ids,
    type:"parafarmacia",search:CN});
   catalogs.push({id:s.id,name:s.nombre,items:data.rows.slice(0,3).map(r=>({
    referencia:r.referencia,cn:r.cn,nombre:r.nombre,provisional:r.provisional,
    fuenteRecepciones:r.inReceipts,fuenteERP:!!r.pharmacyIds
   })),cnPresente:data.rows.some(r=>r.cn===CN),
    totalFiltrado:data.total,warning:!!data.warning,elapsedMs:Date.now()-start});
  }catch(e){catalogs.push({id:s.id,name:s.nombre,error:e.code||e.name})}
 }
 out.catalogs=catalogs;
}catch(e){out.error=e.code||e.name||"QUERY_ERROR";out.detail=String(e.message||"").slice(0,120)}
finally{
 console.info("PREPARADOR_CN_DIAGNOSTICO",JSON.stringify(out));
 await pool.end();
}
