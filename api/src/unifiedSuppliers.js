import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {latestLaboratoryCN,laboratoryIdsFromSnapshot,lastReceiptMode,invalidateLastReceiptCache} from "./preparadorLastReceipt.js";
import {readCachedLaboratoryOptions,invalidateCachedLaboratoryOptions} from "./laboratoryOptionCache.js";
import {readRetirementPatterns,retiredProductSQL} from "./laboratoryRetirements.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const normalizeCode=expr=>`CASE WHEN btrim(coalesce(${expr}::text,'')) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(coalesce(${expr}::text,''))) END`;
const validId=s=>/^[1-9][0-9]{0,17}$/.test(String(s||""));
export const unifiedSupplierKey=id=>"P:"+id;

/** Real, tenant-scoped supplier identities. ERP codes are pharmacy-scoped. */
export async function listUnifiedSuppliers(pool,ctx,pharmacies,forOrders=false){
 if(!SCHEMA.test(ctx.client.schema))throw Error("Esquema inválido");
 if(!pharmacies.length)return [];
 const useLastReceipt=forOrders&&lastReceiptMode();
 if(useLastReceipt){
  // El cálculo de CN vencedores ya conoce los IDs de los laboratorios.
  // No agrupar miles de alias ni escanear el maestro para montar el selector.
  let keys;
  try{keys=await laboratoryIdsFromSnapshot(pool,ctx,pharmacies)}
  catch(error){console.warn("PREPARADOR_SELECTOR_SNAPSHOT",error.code||error.name)}
  if(keys===null||keys===undefined){
   const latest=await latestLaboratoryCN(pool,ctx,pharmacies);
   keys=[...latest.byLab.keys()];
  }
  if(!keys.length)return [];
  const {rows}=await pool.query({text:`
   SELECT p.id::text AS id,('P:'||p.id::text) AS key,p.nombre AS name,
    p.clase AS class,p.activo AS active,'[]'::json AS origins
   FROM farmetrica.proveedores_unificados p
   WHERE p.cliente_slug=$1 AND p.id=ANY($2::bigint[])
    AND p.activo AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')
    AND upper(p.nombre) !~ '(COOPERATIVA|COOP\\.?|MAYORISTA|DISTRIBUIDOR)'
    AND upper(p.nombre) !~ '(^|[^A-Z])FARMACIAS?([^A-Z]|$)'
   ORDER BY p.nombre`,
   values:[ctx.client.slug,keys],query_timeout:6000});
  return rows;
 }
 // La lista de proveedores y la última recepción se calculan sobre fuentes
 // independientes. En un acceso frío, lanzarlas simultáneamente evita sumar
 // sus latencias; la asignación CN->laboratorio y el filtro son idénticos.
 const supplierQuery=pool.query({text:`
 SELECT p.id::text AS id,('P:'||p.id::text) AS key,p.nombre AS name,
 p.clase AS class,p.activo AS active,
 coalesce(json_agg(json_build_object(
  'pharmacyCode',a.farmacia_codigo,'sourceCode',a.codigo_origen,
  'sourceName',a.nombre_origen,'origin',a.procedencia,
  'validity',a.vigencia) ORDER BY a.farmacia_codigo,a.codigo_origen)
  FILTER(WHERE a.id IS NOT NULL AND f.id=ANY($2::int[])),'[]'::json) AS origins
 FROM farmetrica.proveedores_unificados p
 LEFT JOIN farmetrica.proveedores_unificados_alias a
   ON a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id
 LEFT JOIN farmetrica.farmacias f ON f.cliente_slug=p.cliente_slug
  AND ${pharmacyDataCodeSQL("f")}=upper(btrim(a.farmacia_codigo))
  AND ($2::int[] IS NULL OR f.id=ANY($2::int[]))
 WHERE p.cliente_slug=$1 AND p.activo AND (a.id IS NULL OR f.id IS NOT NULL)
  ${forOrders?"AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')":""}
 GROUP BY p.id,p.nombre,p.clase,p.activo ORDER BY p.nombre`,
 values:[ctx.client.slug,pharmacies],query_timeout:10000});
 return (await supplierQuery).rows;
}

/** Source = only received CN from the chosen laboratory, ever.
 * Once CN are found, sales/stock/wholesaler purchases can be aggregated
 * across selected pharmacies by the existing order metrics endpoints.
 */
export async function readUnifiedSupplierCN(pool,ctx,{key,pharmacies,type,search=""}){
 if(!SCHEMA.test(ctx.client.schema))throw Error("Esquema inválido");
 if(!/^P:[1-9][0-9]{0,17}$/.test(key)||!pharmacies.length||
  !["medicacion","parafarmacia"].includes(type))throw Error("Proveedor o categoría inválidos");
 const q='"'+ctx.client.schema+'"',id=key.slice(2);
 if(lastReceiptMode()){
  const latest=await latestLaboratoryCN(pool,ctx,pharmacies);
  const term=String(search||"").trim().toLocaleLowerCase("es");
  const rows=(latest.byLab.get(id)||[]).filter(r=>r.tipo===type&&
   (!term||r.cn.includes(term)||r.nombre.toLocaleLowerCase("es").includes(term)));
  if(rows.length>5000)
   throw Object.assign(Error("Más de 5000 referencias; refine la búsqueda"),{code:"TOO_MANY"});
  return {rows,total:rows.length,metricsUnavailable:true};
 }
 const patterns=await readRetirementPatterns(pool,ctx.client.slug);
 const sql=`
 WITH chosen AS MATERIALIZED (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f
  WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])
 ), aliases AS MATERIALIZED (
  SELECT DISTINCT c.code,${normalizeCode("a.codigo_origen")} AS supplier
  FROM farmetrica.proveedores_unificados_alias a
  JOIN chosen c ON c.code=upper(btrim(a.farmacia_codigo))
  WHERE a.cliente_slug=$1 AND a.proveedor_id=$3
 ), bought AS MATERIALIZED (
  -- Buscar primero las cabeceras del proveedor con índice compuesto,
  -- después únicamente las líneas de esos documentos por su PK.
  -- Equivalente a fm_recepciones_analitica (sólo entregas positivas válidas).
  SELECT DISTINCT h.farmacia_codigo,l.articulo_origen_id AS article_id
  FROM aliases a
  JOIN ${q}.fm_recepciones_cabeceras h
    ON h.farmacia_codigo=a.code
     AND ${normalizeCode("h.proveedor_origen_id")}=a.supplier
     AND h.lineas_completas AND NOT h.eliminada_logicamente
     AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
  JOIN ${q}.fm_recepciones_lineas l
    ON l.farmacia_codigo=h.farmacia_codigo
     AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id
  WHERE NOT l.eliminada_logicamente AND l.cantidad>0 AND l.devuelta IS NOT TRUE
    AND nullif(btrim(l.articulo_origen_id),'') IS NOT NULL
 ), products AS (
  SELECT DISTINCT coalesce(
   CASE WHEN btrim(a.codigo_nacional)~'^[0-9]{6,7}$'
    THEN btrim(a.codigo_nacional) END,
   CASE WHEN btrim(a.origen_id::text)~'^[0-9]{6,7}$'
    THEN btrim(a.origen_id::text) END) AS cn,
   coalesce(nullif(btrim(a.nombre),''),b.article_id) AS nombre
  FROM bought b JOIN ${q}.articulos a
   ON a.farmacia_codigo=b.farmacia_codigo
    AND a.origen_id::text=b.article_id
  WHERE NOT ${retiredProductSQL("a.nombre","$6")}
 )
 SELECT cn AS referencia,cn, min(nombre) AS nombre,$4::text AS tipo,
  false AS "inMaster",true AS "inReceipts",true AS "inPurchases",
  false AS "inSales",false AS generic,false AS provisional
 FROM products WHERE cn IS NOT NULL
  AND (CASE WHEN left(cn,6)::integer>=400000 THEN 'medicacion'
      ELSE 'parafarmacia' END)=$4
  AND (coalesce($5::text,'')='' OR cn ILIKE '%'||$5||'%'
     OR nombre ILIKE '%'||$5||'%')
 GROUP BY cn ORDER BY min(nombre),cn LIMIT 5001`;
 const {rows}=await pool.query({text:sql,values:[ctx.client.slug,pharmacies,id,type,search,patterns],
  query_timeout:25000});
 if(rows.length>5000)throw Object.assign(Error("Más de 5000 referencias; refine la búsqueda"),{code:"TOO_MANY"});
 return {rows,total:rows.length,metricsUnavailable:true};
}
export function setupUnifiedSuppliers(app,pool,{requireTenant,requireTenantAdmin}){
 const permitted=req=>req.context.role==="superadministrador"||req.context.modules?.compras===true;
 const ids=req=>{
  const allowed=new Set((req.context.pharmacies||[]).map(f=>Number(f.id)));
  const raw=String(req.query.farmacias||"");
  const chosen=raw?raw.split(",").map(Number):[...allowed];
  return chosen.every(x=>Number.isSafeInteger(x)&&allowed.has(x))?[...new Set(chosen)]:null;
 };
 app.get("/api/tenant/proveedores-unificados",...requireTenantAdmin(),async(req,res,next)=>{
  try{res.json(await listUnifiedSuppliers(pool,req.context,ids(req)||[],false))}
  catch(e){next(e)}
 });
 app.get("/api/analytics/pedidos/proveedores-unificados",...requireTenant(),async(req,res,next)=>{
  if(!permitted(req))return res.status(403).json({error:"Compras no habilitado"});
  const ph=ids(req);if(!ph)return res.status(400).json({error:"Farmacias no autorizadas"});
  try{res.json({laboratories:await readCachedLaboratoryOptions(
   pool,req.context.client.slug,ph,
   ()=>listUnifiedSuppliers(pool,req.context,ph,true),"unified")})}
  catch(e){next(e)}
 });
 // Importación del Excel inicial. Solo crea correspondencias no existentes:
 // los cambios manuales posteriores siempre prevalecen.
 app.post("/api/tenant/proveedores-unificados/importar",...requireTenantAdmin(),async(req,res,next)=>{
  const items=req.body?.rows;
  if(!Array.isArray(items)||!items.length||items.length>5000||
   items.some(x=>!x||!/^.{1,40}$/.test(String(x.pharmacyCode||""))||
    !/^.{1,60}$/.test(String(x.sourceCode||""))||
    !/^.{1,100}$/.test(String(x.targetCode||""))||
    !/^.{1,200}$/.test(String(x.targetName||""))||
    !["DIRECTO","MAYORISTA","INTERNO","VACUNAS","FÓRMULAS"].includes(x.class)||
    !["ACTUAL","ANTIGUO"].includes(x.validity)))
   return res.status(400).json({error:"El fichero tiene columnas o valores inválidos"});
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   await client.query(`CREATE TEMP TABLE fm_proveedor_import (
    farmacia_codigo text,codigo_origen text,nombre_origen text,
    clave_unificada text,nombre_unificado text,clase text,vigencia text
    ) ON COMMIT DROP`);
   const prepared=items.map(x=>({
    pharmacy:String(x.pharmacyCode).trim().toUpperCase(),
    code:String(x.sourceCode).trim(),source:String(x.sourceName||"").trim(),
    target:String(x.targetCode).trim(),name:String(x.targetName).trim(),
    type:String(x.class),validity:String(x.validity)}));
   await client.query(`INSERT INTO fm_proveedor_import
    SELECT pharmacy,code,source,target,name,type,validity
    FROM jsonb_to_recordset($1::jsonb) AS j(
     pharmacy text,code text,source text,target text,name text,type text,validity text)`,
    [JSON.stringify(prepared)]);
   const groups=await client.query(`
    WITH variants AS (
     SELECT clave_unificada,nombre_unificado,clase,
      count(*) FILTER(WHERE vigencia='ACTUAL') AS recent,count(*) AS total
     FROM fm_proveedor_import GROUP BY 1,2,3
    ), ranked AS (
     SELECT *,row_number() OVER (PARTITION BY clave_unificada
      ORDER BY recent DESC,total DESC,nombre_unificado,clase) AS rn
     FROM variants
    )
    INSERT INTO farmetrica.proveedores_unificados
     (cliente_slug,clave_unificada,nombre,clase)
    SELECT $1,'EXCEL:'||clave_unificada,nombre_unificado,clase
    FROM ranked WHERE rn=1 ON CONFLICT(cliente_slug,clave_unificada) DO NOTHING
    RETURNING id`,[req.context.client.slug]);
   const aliases=await client.query(`
    WITH ranked AS (
     SELECT *,row_number() OVER (
      PARTITION BY upper(btrim(farmacia_codigo)),btrim(codigo_origen)
      ORDER BY (vigencia='ACTUAL') DESC,clave_unificada) AS rn
     FROM fm_proveedor_import
    )
    INSERT INTO farmetrica.proveedores_unificados_alias
     (cliente_slug,proveedor_id,farmacia_codigo,codigo_origen,nombre_origen,procedencia,vigencia)
    SELECT $1,p.id,upper(btrim(r.farmacia_codigo)),btrim(r.codigo_origen),
     r.nombre_origen,'excel',r.vigencia
    FROM ranked r JOIN farmetrica.proveedores_unificados p
     ON p.cliente_slug=$1 AND p.clave_unificada='EXCEL:'||r.clave_unificada
    WHERE r.rn=1 AND NOT EXISTS (
     SELECT 1 FROM fm_proveedor_import collision
     WHERE upper(btrim(collision.farmacia_codigo))=upper(btrim(r.farmacia_codigo))
      AND btrim(collision.codigo_origen)=btrim(r.codigo_origen)
      AND collision.clave_unificada<>r.clave_unificada
    )
    ON CONFLICT(cliente_slug,farmacia_codigo,codigo_origen) DO NOTHING
    RETURNING id`,[req.context.client.slug]);
   const collision=await client.query(`SELECT count(*)::int AS n FROM (
     SELECT farmacia_codigo,codigo_origen FROM fm_proveedor_import GROUP BY 1,2
     HAVING count(DISTINCT clave_unificada)>1) x`);
   await client.query("COMMIT");
   invalidateLastReceiptCache(pool,req.context.client.slug);invalidateCachedLaboratoryOptions(pool,req.context.client.slug);
   res.json({imported:items.length,newSuppliers:groups.rowCount,
    newAliases:aliases.rowCount,sourceConflicts:collision.rows[0].n});
  }catch(e){await client.query("ROLLBACK").catch(()=>{});next(e)}
  finally{client.release()}
 });
 app.post("/api/tenant/proveedores-unificados",...requireTenantAdmin(),async(req,res,next)=>{
  const name=String(req.body?.name||"").trim(),className=req.body?.class||"SIN_CLASIFICAR";
  if(name.length<2||name.length>200||
   !["DIRECTO","MAYORISTA","INTERNO","OTROS","VACUNAS","FÓRMULAS","SIN_CLASIFICAR"].includes(className))
   return res.status(400).json({error:"Nombre o clasificación inválidos"});
  try{
   const {rows}=await pool.query(`INSERT INTO farmetrica.proveedores_unificados
    (cliente_slug,clave_unificada,nombre,clase)
    VALUES($1,'MANUAL:'||md5(random()::text||clock_timestamp()::text),$2,$3)
    RETURNING id::text,nombre`,
    [req.context.client.slug,name,className]);
   invalidateLastReceiptCache(pool,req.context.client.slug);invalidateCachedLaboratoryOptions(pool,req.context.client.slug);
   res.status(201).json({id:String(rows[0].id),name});
  }catch(e){next(e)}
 });
 app.put("/api/tenant/proveedores-unificados/:id",...requireTenantAdmin(),async(req,res,next)=>{
  if(!validId(req.params.id))return res.status(400).json({error:"ID incorrecto"});
  const name=String(req.body?.name||"").trim(),className=req.body?.class;
  if(name.length<2||name.length>200||
   !["DIRECTO","MAYORISTA","INTERNO","OTROS","VACUNAS","FÓRMULAS","SIN_CLASIFICAR"].includes(className))
   return res.status(400).json({error:"Nombre o clasificación inválidos"});
  try{
   const {rows}=await pool.query(`UPDATE farmetrica.proveedores_unificados
    SET nombre=$3,clase=$4,actualizado_en=now()
    WHERE cliente_slug=$1 AND id=$2 RETURNING id,nombre,clase`,
    [req.context.client.slug,req.params.id,name,className]);
   if(!rows.length)return res.status(404).json({error:"Proveedor no encontrado"});
   invalidateLastReceiptCache(pool,req.context.client.slug);invalidateCachedLaboratoryOptions(pool,req.context.client.slug);
   res.json(rows[0]);
  }catch(e){next(e)}
 });
 // Fusiona identidades canónicas: la clasificación pertenece solo al destino.
 // Conserva los proveedores origen como inactivos para trazabilidad y rollback.
 app.post("/api/tenant/proveedores-unificados/fusionar",...requireTenantAdmin(),async(req,res,next)=>{
  const destination=String(req.body?.destino||"");
  const sources=Array.isArray(req.body?.origenes)?[...new Set(req.body.origenes.map(String))]:[];
  if(!validId(destination)||!sources.length||sources.length>100||
   sources.some(id=>!validId(id)||id===destination))
   return res.status(400).json({error:"Selecciona un proveedor destino y otros proveedores distintos"});
  const db=await pool.connect(),slug=req.context.client.slug;
  try{
   await db.query("BEGIN");
   const {rows}=await db.query(`SELECT id::text,activo,clase,nombre FROM farmetrica.proveedores_unificados
    WHERE cliente_slug=$1 AND id=ANY($2::bigint[]) FOR UPDATE`,
    [slug,[destination,...sources]]);
   if(rows.length!==sources.length+1||rows.some(p=>!p.activo)){
    await db.query("ROLLBACK");
    return res.status(400).json({error:"Hay identidades no encontradas o previamente fusionadas"});
   }
   const target=rows.find(p=>p.id===destination);
   if(!target){
    await db.query("ROLLBACK");return res.status(404).json({error:"Proveedor destino no encontrado"});
   }
   if(!["DIRECTO","VACUNAS","FÓRMULAS"].includes(target.clase)||
    rows.some(p=>p.clase!==target.clase)){
    await db.query("ROLLBACK");
    return res.status(400).json({error:"Solo se pueden unificar laboratorios de la misma categoría. Mayoristas e internos no requieren unificación."});
   }
   const aliases=await db.query(`UPDATE farmetrica.proveedores_unificados_alias
    SET proveedor_id=$2,procedencia='manual',actualizado_en=now()
    WHERE cliente_slug=$1 AND proveedor_id=ANY($3::bigint[]) RETURNING id`,
    [slug,destination,sources]);
   // La frecuencia del destino prevalece; si no tiene una, se conserva una de origen.
   await db.query(`INSERT INTO farmetrica.preparador_frecuencia_laboratorio
    (cliente_slug,laboratorio_clave,intervalo_dias)
    SELECT $1,'P:'||$2::text,intervalo_dias
    FROM farmetrica.preparador_frecuencia_laboratorio
    WHERE cliente_slug=$1 AND laboratorio_clave=ANY($3::text[])
    ORDER BY actualizado_en DESC LIMIT 1
    ON CONFLICT(cliente_slug,laboratorio_clave) DO NOTHING`,
    [slug,destination,sources.map(id=>"P:"+id)]);
   await db.query(`DELETE FROM farmetrica.preparador_frecuencia_laboratorio
    WHERE cliente_slug=$1 AND laboratorio_clave=ANY($2::text[])`,
    [slug,sources.map(id=>"P:"+id)]);
   // Conservar borradores existentes. El destino prevalece ante coincidencia;
   // los borradores origen permanecen archivados para recuperarlos si hiciera falta.
   await db.query(`INSERT INTO farmetrica.pedidos_laboratorio_borradores
    (cliente_slug,laboratorio_clave,tipo,farmacias_clave,desde,hasta,lineas)
    SELECT cliente_slug,'P:'||$2::text,tipo,farmacias_clave,desde,hasta,lineas
    FROM farmetrica.pedidos_laboratorio_borradores
    WHERE cliente_slug=$1 AND laboratorio_clave=ANY($3::text[])
    ORDER BY actualizado_en DESC
    ON CONFLICT(cliente_slug,laboratorio_clave,tipo,farmacias_clave) DO NOTHING`,
    [slug,destination,sources.map(id=>"P:"+id)]);
   await db.query(`UPDATE farmetrica.preparador_pedidos_realizados SET laboratorio_id=$2
    WHERE cliente_slug=$1 AND laboratorio_id=ANY($3::bigint[])`,
    [slug,destination,sources]);
   await db.query(`UPDATE farmetrica.proveedores_unificados
    SET activo=false,fusionado_a=$2,actualizado_en=now()
    WHERE cliente_slug=$1 AND id=ANY($3::bigint[])`,
    [slug,destination,sources]);
   await db.query("COMMIT");
   invalidateLastReceiptCache(pool,slug);invalidateCachedLaboratoryOptions(pool,slug);
   res.json({merged:sources.length,aliases:aliases.rowCount,target:{id:destination,name:target.nombre,class:target.clase}});
  }catch(e){await db.query("ROLLBACK").catch(()=>{});next(e)}
  finally{db.release()}
 });
 // Clasificar un código local sin obligar a fusionarlo con otra farmacia.
 // La creación del proveedor y su asociación son atómicas.
 app.post("/api/tenant/proveedores-unificados/clasificar-origen",...requireTenantAdmin(),async(req,res,next)=>{
  const name=String(req.body?.name||"").trim();
  const className=String(req.body?.class||"SIN_CLASIFICAR");
  const pharmacy=String(req.body?.pharmacyCode||"").trim().toUpperCase();
  const code=String(req.body?.sourceCode||"").trim();
  const originName=String(req.body?.sourceName||name).trim();
  if(name.length<2||name.length>200||originName.length>200||!code||code.length>60||
   !/^[A-Z0-9_-]{1,40}$/.test(pharmacy)||
   !["DIRECTO","MAYORISTA","INTERNO","OTROS","VACUNAS","FÓRMULAS","SIN_CLASIFICAR"].includes(className))
   return res.status(400).json({error:"Revisa los datos del proveedor de Farmatic"});
  const slug=req.context.client.slug,db=await pool.connect();
  try{
   await db.query("BEGIN");
   const ids=req.context.pharmacies.map(f=>Number(f.id));
   const {rows:permitted}=await db.query(`SELECT id FROM farmetrica.farmacias f
    WHERE f.cliente_slug=$1 AND ${pharmacyDataCodeSQL("f")}=$2 AND f.id=ANY($3::int[])`,
    [slug,pharmacy,ids]);
   if(!permitted.length){
    await db.query("ROLLBACK");return res.status(403).json({error:"Farmacia no autorizada"});
   }
   const {rows:existing}=await db.query(`SELECT id FROM farmetrica.proveedores_unificados_alias
    WHERE cliente_slug=$1 AND farmacia_codigo=$2 AND codigo_origen=$3 FOR UPDATE`,
    [slug,pharmacy,code]);
   if(existing.length){
    await db.query("ROLLBACK");return res.status(409).json({error:"Este código ya pertenece a un proveedor. Actualiza el maestro para verlo."});
   }
   const {rows:[created]}=await db.query(`INSERT INTO farmetrica.proveedores_unificados
    (cliente_slug,clave_unificada,nombre,clase)
    VALUES($1,'MANUAL:'||md5(random()::text||clock_timestamp()::text),$2,$3)
    RETURNING id::text`,[slug,name,className]);
   const inserted=await db.query(`INSERT INTO farmetrica.proveedores_unificados_alias
    (cliente_slug,proveedor_id,farmacia_codigo,codigo_origen,nombre_origen,procedencia)
    VALUES($1,$2,$3,$4,$5,'manual')
    ON CONFLICT(cliente_slug,farmacia_codigo,codigo_origen) DO NOTHING RETURNING id`,
    [slug,created.id,pharmacy,code,originName]);
   if(inserted.rowCount!==1){
    await db.query("ROLLBACK");return res.status(409).json({error:"El origen se vinculó durante la operación. Actualiza la lista."});
   }
   await db.query("COMMIT");
   invalidateLastReceiptCache(pool,slug);invalidateCachedLaboratoryOptions(pool,slug);
   res.status(201).json({id:created.id,name,class:className,saved:true});
  }catch(e){await db.query("ROLLBACK").catch(()=>{});next(e)}
  finally{db.release()}
 });
 app.put("/api/tenant/proveedores-unificados/:id/origen",...requireTenantAdmin(),async(req,res,next)=>{
  if(!validId(req.params.id))return res.status(400).json({error:"ID incorrecto"});
  const pharmacy=String(req.body?.pharmacyCode||"").trim().toUpperCase(),
   code=String(req.body?.sourceCode||"").trim(),name=String(req.body?.sourceName||"").trim();
  if(!/^[A-Z0-9_-]{1,40}$/.test(pharmacy)||!code||code.length>60||name.length>200)
   return res.status(400).json({error:"Proveedor ERP inválido"});
  try{
   const db=await pool.connect();
   try{
    await db.query("BEGIN");
    const {rows:valid}=await db.query(`SELECT p.id
     FROM farmetrica.proveedores_unificados p JOIN farmetrica.farmacias f
      ON f.cliente_slug=p.cliente_slug
     WHERE p.cliente_slug=$1 AND p.id=$2 AND ${pharmacyDataCodeSQL("f")}=$3
      AND f.id=ANY($4::int[])`,
     [req.context.client.slug,req.params.id,pharmacy,req.context.pharmacies.map(f=>Number(f.id))]);
    if(!valid.length){await db.query("ROLLBACK");return res.status(404).json({error:"Proveedor o farmacia no autorizado"})}
    await db.query(`INSERT INTO farmetrica.proveedores_unificados_alias
      (cliente_slug,proveedor_id,farmacia_codigo,codigo_origen,nombre_origen,procedencia)
      VALUES($1,$2,$3,$4,$5,'manual')
      ON CONFLICT(cliente_slug,farmacia_codigo,codigo_origen) DO UPDATE
      SET proveedor_id=EXCLUDED.proveedor_id,nombre_origen=EXCLUDED.nombre_origen,
       procedencia='manual',vigencia='ACTUAL',actualizado_en=now()`,
     [req.context.client.slug,req.params.id,pharmacy,code,name]);
    await db.query("COMMIT");invalidateLastReceiptCache(pool,req.context.client.slug);invalidateCachedLaboratoryOptions(pool,req.context.client.slug);
    res.json({saved:true});
   }catch(e){await db.query("ROLLBACK").catch(()=>{});throw e}finally{db.release()}
  }catch(e){next(e)}
 });
}
