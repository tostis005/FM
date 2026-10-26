import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
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
 const {rows}=await pool.query({text:`
 SELECT p.id::text AS id,('P:'||p.id::text) AS key,p.nombre AS name,
 p.clase AS class,p.activo AS active,
 coalesce(json_agg(json_build_object(
  'pharmacyCode',a.farmacia_codigo,'sourceCode',a.codigo_origen,
  'sourceName',a.nombre_origen,'origin',a.procedencia,
  'validity',a.vigencia) ORDER BY a.farmacia_codigo,a.codigo_origen)
  FILTER(WHERE a.id IS NOT NULL),'[]'::json) AS origins
 FROM farmetrica.proveedores_unificados p
 JOIN farmetrica.proveedores_unificados_alias a
   ON a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id
 JOIN farmetrica.farmacias f ON f.cliente_slug=p.cliente_slug
  AND upper(btrim(f.codigo_origen))=upper(btrim(a.farmacia_codigo))
  AND f.id=ANY($2::int[])
 WHERE p.cliente_slug=$1 AND p.activo
  ${forOrders?"AND p.clase NOT IN ('MAYORISTA','INTERNO','SIN_CLASIFICAR')":""}
 GROUP BY p.id,p.nombre,p.clase,p.activo ORDER BY p.nombre`,
 values:[ctx.client.slug,pharmacies],query_timeout:10000});
 return rows;
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
 const sql=`
 WITH chosen AS MATERIALIZED (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f
  WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])
 ), aliases AS MATERIALIZED (
  SELECT c.code,${normalizeCode("a.codigo_origen")} AS supplier
  FROM farmetrica.proveedores_unificados_alias a
  JOIN chosen c ON c.code=upper(btrim(a.farmacia_codigo))
  WHERE a.cliente_slug=$1 AND a.proveedor_id=$3
 ), bought AS MATERIALIZED (
  SELECT DISTINCT r.farmacia_codigo,r.articulo_id::text AS article_id
  FROM ${q}.fm_recepciones_analitica r
  JOIN aliases a ON a.code=upper(btrim(r.farmacia_codigo))
    AND a.supplier=${normalizeCode("r.proveedor_id")}
  WHERE nullif(btrim(r.articulo_id::text),'') IS NOT NULL
   AND r.unidades>0
 ), products AS (
  SELECT DISTINCT coalesce(
   CASE WHEN btrim(a.codigo_nacional)~'^[0-9]{6,7}$'
    THEN btrim(a.codigo_nacional) END,
   CASE WHEN btrim(a.origen_id::text)~'^[0-9]{6,7}$'
    THEN btrim(a.origen_id::text) END) AS cn,
   coalesce(nullif(btrim(a.nombre),''),b.article_id) AS nombre
  FROM bought b JOIN ${q}.articulos a
   ON upper(btrim(a.farmacia_codigo))=upper(btrim(b.farmacia_codigo))
    AND a.origen_id::text=b.article_id
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
 const {rows}=await pool.query({text:sql,values:[ctx.client.slug,pharmacies,id,type,search],
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
  try{res.json({laboratories:await listUnifiedSuppliers(pool,req.context,ph,true)})}
  catch(e){next(e)}
 });
 app.put("/api/tenant/proveedores-unificados/:id",...requireTenantAdmin(),async(req,res,next)=>{
  if(!validId(req.params.id))return res.status(400).json({error:"ID incorrecto"});
  const name=String(req.body?.name||"").trim(),className=req.body?.class;
  if(name.length<2||name.length>200||
   !["DIRECTO","MAYORISTA","INTERNO","VACUNAS","FÓRMULAS","SIN_CLASIFICAR"].includes(className))
   return res.status(400).json({error:"Nombre o clasificación inválidos"});
  try{
   const {rows}=await pool.query(`UPDATE farmetrica.proveedores_unificados
    SET nombre=$3,clase=$4,actualizado_en=now()
    WHERE cliente_slug=$1 AND id=$2 RETURNING id,nombre,clase`,
    [req.context.client.slug,req.params.id,name,className]);
   if(!rows.length)return res.status(404).json({error:"Proveedor no encontrado"});
   res.json(rows[0]);
  }catch(e){next(e)}
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
     WHERE p.cliente_slug=$1 AND p.id=$2 AND upper(btrim(f.codigo_origen))=$3
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
    await db.query("COMMIT");res.json({saved:true});
   }catch(e){await db.query("ROLLBACK").catch(()=>{});throw e}finally{db.release()}
  }catch(e){next(e)}
 });
}
