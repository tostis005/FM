import express from "express";
import {readFile} from "node:fs/promises";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {allocatePending,downloadDropboxCsv,parsePendingCsv,validateDropboxCsvUrl} from "./pickingListCore.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const managed=ctx=>["superadministrador","administrador","gestor"].includes(ctx?.role)&&
 (ctx.role==="superadministrador"||ctx.modules?.stock===true);
const writable=ctx=>managed(ctx)&&(ctx.role==="superadministrador"||
  ctx.profilePermissions?.stock==null ||
  ctx.profilePermissions.stock.includes("importar") ||
  ctx.profilePermissions.stock.includes("editar"));
const pendingFetch=new Map();
// La presencia de una URL no implica que la descarga ni el parseo hayan tenido éxito.
// Se registran los intentos sin almacenar ni exponer el enlace privado en el reporte.
const sourceDiagnostics=new Map();
const SOURCE_INTERVAL_MS=15*60*1000;
const SOURCE_RETRY_MS=60*1000;
function safeSourceError(error){
 const message=String(error?.message||"").replace(/https?:\/\/\S+/g,"[enlace oculto]");
 if(/^(?:Falta la columna|Fila \d+|El fichero|El CSV|CSV |Dropbox |No hay|No hay líneas|Solo se aceptan|Introduce un enlace|Demasiadas redirecciones|El enlace)/i.test(message))
  return message.slice(0,300);
 return "No se ha podido descargar o interpretar el fichero de Dropbox. Comprueba el enlace y las columnas en Ajustes.";
}
async function monitoredRefresh(pool,slug,options={}){
 const lastAttemptAt=new Date().toISOString();
 sourceDiagnostics.set(slug,{state:"updating",lastAttemptAt,error:null});
 try{
  const result=await refreshPendingSource(pool,slug,options);
  sourceDiagnostics.set(slug,{state:"ok",lastAttemptAt,error:null});
  return result;
 }catch(error){
  const safe=safeSourceError(error);
  sourceDiagnostics.set(slug,{state:"error",lastAttemptAt,error:safe});
  try{
   await pool.query("UPDATE farmetrica.picking_list_fuentes "+
    "SET ultima_comprobacion=now(),ultimo_error=$2 WHERE cliente_slug=$1",[slug,safe]);
  }catch{console.warn("PICKING_LIST_SOURCE_DIAGNOSTIC",JSON.stringify({client:slug,state:"write_failed"}));}
  console.warn("PICKING_LIST_SOURCE",JSON.stringify({client:slug,state:"error",reason:safe}));
  throw error;
 }
}
export async function readReportWithCurrentSource(pool,ctx,{fetchFn,...options}={}){
 const slug=ctx.client.slug,meta=await getMetadata(pool,slug);
 const previous=sourceDiagnostics.get(slug);
 const lastSuccess=meta.lastImportedAt?new Date(meta.lastImportedAt).getTime():0;
 const lastCheck=meta.lastCheckedAt?new Date(meta.lastCheckedAt).getTime():0;
 const sourceModified=meta.sourceUpdatedAt?new Date(meta.sourceUpdatedAt).getTime():0;
 const needsRefresh=!lastSuccess||Date.now()-lastSuccess>SOURCE_INTERVAL_MS||
  sourceModified>lastSuccess;
 const now=Date.now();
 if(meta.sourceConfigured&&needsRefresh){
  // En el arranque ya puede haber una descarga programada en curso.
  // Esperar ese mismo intento evita responder con la tabla vacía mientras carga.
  if(pendingFetch.has(slug)){
   try{await pendingFetch.get(slug)}catch{ /* conservar último snapshot y diagnóstico */ }
  }else if(now-Math.max(lastCheck,previous?.lastAttemptAt?
     new Date(previous.lastAttemptAt).getTime():0)>SOURCE_RETRY_MS){
   try{await monitoredRefresh(pool,slug,{fetchFn})}catch{ /* conservar snapshot */ }
  }
 }
 const report=await readPickingReport(pool,ctx,options);
 const current=sourceDiagnostics.get(slug);
 report.meta={...report.meta,
  sourceState:!report.meta.sourceConfigured?"not_configured":
   current?.state==="error"||report.meta.lastError?"error":
   !report.meta.lastImportedAt?"pending":
   report.meta.lineCount===0?"empty":
   Date.now()-new Date(report.meta.lastImportedAt).getTime()>30*60*1000?"stale":"ok",
  sourceError:current?.error||report.meta.lastError||null,
  lastAttemptAt:report.meta.lastCheckedAt||current?.lastAttemptAt||null,
  stockLocations:report.sites.length,
  stockLocationsReady:report.sites.filter(s=>s.ready).length,
  unmatchedProducts:report.rows.filter(r=>r.status==="sin_cn").length};
 return report;
}

export async function savePendingSnapshot(pool,slug,lines,{origin="archivo",user=""}={}){
 if(!SCHEMA.test(slug)||!Array.isArray(lines)||lines.length>50000)
  throw new Error("El CSV puede contener hasta 50.000 líneas.");
 const tx=await pool.connect();
 try{
  await tx.query("BEGIN");
  await tx.query("INSERT INTO farmetrica.picking_list_fuentes(cliente_slug) VALUES($1) ON CONFLICT DO NOTHING",[slug]);
  await tx.query("SELECT cliente_slug FROM farmetrica.picking_list_fuentes WHERE cliente_slug=$1 FOR UPDATE",[slug]);
  await tx.query("DELETE FROM farmetrica.picking_list_pendientes WHERE cliente_slug=$1",[slug]);
  for(let index=0;index<lines.length;index+=500){
   const batch=lines.slice(index,index+500).map((r,offset)=>({
    line:index+offset+1,order_id:r.orderId,order_name:r.orderName,
    order_created_at:r.createdAt,order_source_name:r.channel,
    quantity:r.quantity,sku:r.sku,cn:r.cn,variant_id:r.variantId,title:r.title
   }));
   await tx.query(
    "INSERT INTO farmetrica.picking_list_pendientes "+
    "(cliente_slug,linea,order_id,order_name,order_created_at,order_source_name,quantity,sku,cn,variant_id,title) "+
    "SELECT $1,r.line,r.order_id,r.order_name,r.order_created_at::timestamptz,"+
    "r.order_source_name,r.quantity,r.sku,r.cn,r.variant_id,r.title "+
    "FROM jsonb_to_recordset($2::jsonb) AS r(line integer,order_id text,order_name text,"+
    "order_created_at text,order_source_name text,quantity integer,sku text,cn text,"+
    "variant_id text,title text)",[slug,JSON.stringify(batch)]);
  }
  await tx.query(
   "UPDATE farmetrica.picking_list_fuentes SET ultimo_origen=$2,ultima_importacion=now(),"+
   "ultima_fila=$3,actualizado_por=$4,actualizado_en=now(),"+
   "ultima_comprobacion=now(),ultimo_error=NULL,ultima_advertencia=$5,"+
   "ultima_advertencia_detalle=$6::jsonb WHERE cliente_slug=$1",
   [slug,origin,lines.length,user,(lines.warnings||[]).join(" ").slice(0,600),
    JSON.stringify({headers:lines.csvHeaders||[],rows:lines.invalidRows||[]})]);
  await tx.query("COMMIT");
  return {rows:lines.length,skipped:lines.skippedCount||0,warning:(lines.warnings||[]).join(" ")};
 }catch(e){await tx.query("ROLLBACK");throw e}
 finally{tx.release();}
}
export async function refreshPendingSource(pool,slug,{fetchFn}={}){
 if(pendingFetch.has(slug))return pendingFetch.get(slug);
 const pending=(async()=>{
  const {rows}=await pool.query(
   "SELECT csv_url FROM farmetrica.picking_list_fuentes WHERE cliente_slug=$1",[slug]);
  if(!rows[0]?.csv_url)throw new Error("Configura primero el enlace de Dropbox al CSV pendiente.");
  const csv=await downloadDropboxCsv(rows[0].csv_url,{fetchFn});
  return savePendingSnapshot(pool,slug,parsePendingCsv(csv),{origin:"dropbox",user:"actualización programada"});
 })();
 pendingFetch.set(slug,pending);
 try{return await pending}finally{pendingFetch.delete(slug);}
}
async function getMetadata(pool,slug){
 const {rows}=await pool.query(
  "SELECT ultima_importacion AS \"lastImportedAt\",ultima_fila AS \"lineCount\","+
  "ultimo_origen AS origin,(nullif(csv_url,'') IS NOT NULL) AS \"sourceConfigured\","+
  "actualizado_en AS \"sourceUpdatedAt\",ultima_comprobacion AS \"lastCheckedAt\","+
  "ultimo_error AS \"lastError\",ultima_advertencia AS \"lastWarning\" "+
  "FROM farmetrica.picking_list_fuentes WHERE cliente_slug=$1",[slug]);
 return rows[0]||{lastImportedAt:null,lineCount:0,origin:null,sourceConfigured:false};
}
async function getInventory(pool,ctx,codes){
 const schema=ctx.client.schema;
 if(!SCHEMA.test(schema))throw new Error("Esquema de cliente inválido.");
 const source=await readFile(new URL("./pickingListStock.sql",import.meta.url),"utf8");

 // Sinónimos importados por Farmétrica Sync: IDs ERP limitados a cada
 // establecimiento, nunca se cruzan IDs entre dos farmacias.
 const wantsEan=codes.some(x=>!x.cn&&/^\d{8,14}$/.test(x.sku));
 const synonymsAvailable=wantsEan?
  (await pool.query("SELECT to_regclass($1) IS NOT NULL AS available",
   [schema+".sinonimos"])).rows[0]?.available===true:false;
 const synonymsSql=synonymsAvailable?[
  " UNION ALL",
  " SELECT s.site_id,c.key,a.origen_id::text AS article_id,",
  "  a.stock_actual::float8 AS stock,a.nombre,a.sincronizado_en AS stock_at",
  " FROM sites s CROSS JOIN codes c JOIN __SCHEMA__.sinonimos si",
  "  ON upper(btrim(si.farmacia_codigo))=s.source_code",
  "   AND btrim(si.codigo)=c.sku",
  " JOIN __SCHEMA__.articulos a",
  "  ON upper(btrim(a.farmacia_codigo))=s.source_code",
  "   AND a.origen_id::text=btrim(si.articulo_id)",
  " WHERE c.cn IS NULL AND c.sku ~ '^[0-9]{8,14}$'"
 ].join("\n"):"";
 const sql=source.replaceAll("__SCHEMA__","\""+schema+"\"")
  .replaceAll("__PHARMACY_CODE__",pharmacyDataCodeSQL("f"))
  .replace("__SYNONYM_EAN_MATCH__",()=>synonymsSql.replaceAll("__SCHEMA__","\""+schema+"\""));
 const {rows}=await pool.query(sql,[ctx.client.slug,JSON.stringify(codes),
  ctx.allowedPharmacyIds||[]]);
 const sites=new Map(),items=new Map();
 for(const row of rows){
  if(!sites.has(row.siteId))sites.set(row.siteId,{
   id:row.siteId,code:row.code,name:row.siteName,kind:row.kind,
   ready:row.ready===true
  });
  if(row.key)items.set(row.siteId+"|"+row.key,{
   stock:row.stock===null?null:Number(row.stock),
   matched:row.matched===true,name:row.name,stockAt:row.stockAt
  });
 }
 return {sites:[...sites.values()],items};
}
export async function readPickingReport(pool,ctx,{channel=""}={}){
 const slug=ctx.client.slug,meta=await getMetadata(pool,slug);
 const {rows}=await pool.query(
  "SELECT order_id AS \"orderId\",order_name AS \"orderName\","+
  "order_created_at AS \"createdAt\",order_source_name AS channel,"+
  "quantity,sku,cn,title FROM farmetrica.picking_list_pendientes "+
  "WHERE cliente_slug=$1 ORDER BY linea LIMIT 50001",[slug]);
 if(rows.length>50000)throw new Error("Demasiadas líneas pendientes.");
 const channels=[...new Set(rows.map(r=>r.channel||"Sin canal"))]
  .sort((a,b)=>a.localeCompare(b,"es"));
 const filtered=channel?rows.filter(r=>(r.channel||"Sin canal")===channel):rows;
 const grouped=new Map();
 for(const line of filtered){
  const key=line.cn||"SKU:"+line.sku;
  if(!grouped.has(key))grouped.set(key,{
   key,cn:line.cn||null,sku:line.sku,name:line.title||"",
   required:0,orderKeys:new Set(),channels:new Set(),details:[],lines:0
  });
  const row=grouped.get(key);
  row.required+=Number(line.quantity);row.lines++;
  row.orderKeys.add(line.orderId);row.channels.add(line.channel||"Sin canal");
  if(!row.name&&line.title)row.name=line.title;
  if(row.details.length<40)row.details.push({
   orderId:line.orderId,orderName:line.orderName,
   createdAt:line.createdAt,channel:line.channel||"Sin canal",
   quantity:Number(line.quantity)
  });
 }
 const entries=[...grouped.values()];
 const {sites,items}=await getInventory(pool,ctx,
  entries.map(x=>({key:x.key,cn:x.cn,sku:x.sku})));
 const report=entries.map(entry=>{
  const stock=sites.map(s=>{
   const inv=items.get(s.id+"|"+entry.key);
   return {...s,stock:s.ready?(inv?.stock===null?null:inv?Math.max(0,inv.stock):0):null,
    matched:Boolean(inv?.matched),stockAt:inv?.stockAt||null,planned:0};
  });
  const wh=stock.find(s=>s.kind==="almacen"&&s.code==="ALMACEN");
  const pharm=stock.filter(s=>s.kind==="farmacia");
  const matched=stock.some(s=>s.matched);
  // Si el almacén aún no ha sincronizado, enseñar igualmente qué podría
  // prepararse desde las farmacias, sin atribuir stock inexistente al almacén.
  // La asignación se etiqueta como provisional y NO confirma cobertura.
  const warehouseUnknown=!wh||wh.stock===null;
  const proposal=matched?allocatePending(entry.required,
   warehouseUnknown?0:wh.stock,pharm,{reserve:1}):null;
  for(const s of stock)s.planned=proposal?
   (s.kind==="almacen"?(warehouseUnknown?0:proposal.warehouse||0):proposal.bySite[s.code]||0):0;
  const hasMissing=warehouseUnknown||stock.some(s=>!s.ready);
  // No marcar un artículo como obsoleto solo por su fecha: la sincronización
  // puede ejecutarse sin cambiar ese timestamp cuando no hay movimientos.
  const shortage=proposal?.remaining??null;
  const status=!matched?"sin_cn":hasMissing?"sin_datos":
   shortage>0?"sin_stock":"cubierto";
  return {
   key:entry.key,cn:entry.cn,sku:entry.sku,
   name:entry.name||stock.map(s=>items.get(s.id+"|"+entry.key)?.name).find(Boolean)||"",
   required:entry.required,orders:entry.orderKeys.size,
   lines:entry.lines,channels:[...entry.channels],details:entry.details,
   stock,allocated:proposal?.fulfilled??null,shortage,
   pending:Math.max(0,entry.required-(proposal?.fulfilled||0)),status,
   allocationProvisional:Boolean(proposal)&&(warehouseUnknown||proposal.partial),
   stockTotal:stock.every(s=>s.stock!==null)?stock.reduce((sum,s)=>sum+s.stock,0):null,
   exhausted:proposal?.zeroedSites||[]
  };
 }).sort((a,b)=>b.required-a.required||a.key.localeCompare(b.key));
 return {
  meta,channels,selectedChannel:channel,sites,rows:report,
  totals:{orders:new Set(filtered.map(r=>r.orderId)).size,
   lines:filtered.length,products:report.length,
   units:report.reduce((n,r)=>n+r.required,0),
   allocated:report.reduce((n,r)=>n+(r.allocated||0),0),
   pending:report.reduce((n,r)=>n+r.pending,0),
   shortage:report.reduce((n,r)=>n+(r.shortage||0),0),
   incomplete:report.filter(r=>["sin_cn","sin_datos"].includes(r.status)).length}
 };
}
export function setupPickingList(app,pool,{requireTenant}){
 const guard=requireTenant();
 const allowed=(req,res,next)=>managed(req.context)?next():res.status(403).json({
  error:"La Picking List requiere perfil gestor/administrador y acceso a Stock"});
 const write=(req,res,next)=>writable(req.context)?next():res.status(403).json({
  error:"Tu perfil no permite importar o actualizar los pedidos de Picking List"});
 const settingsAdmin=(req,res,next)=>
  ["superadministrador","administrador","gestor"].includes(req.context?.role)?
   next():res.status(403).json({error:"Solo los administradores y gestores pueden configurar la fuente de Picking List"});
 app.get("/api/picking-list/report",...guard,allowed,async(req,res,next)=>{
  try{res.json(await readReportWithCurrentSource(pool,req.context,{
   channel:String(req.query.channel||"").slice(0,120)
  }));}catch(e){next(e);}
 });
 // La URL de Dropbox nunca forma parte del reporte. Solo se entrega
 // al administrador/gestor en Ajustes, donde se conserva la ya guardada.
 // Las filas descartadas se cargan solo cuando se abre "Ver más".
 // No exponer el enlace privado de Dropbox ni descargar todo el CSV al navegador.
 app.get("/api/picking-list/issues",...guard,allowed,async(req,res,next)=>{
  try{
   const offset=Math.max(0,Math.min(50000,Math.trunc(Number(req.query?.offset)||0)));
   const limit=25;
   const {rows}=await pool.query(
    "SELECT ultima_advertencia_detalle AS details,ultima_importacion AS imported_at "+
    "FROM farmetrica.picking_list_fuentes WHERE cliente_slug=$1",
    [req.context.client.slug]);
   const detail=rows[0]?.details||{},all=Array.isArray(detail.rows)?detail.rows:[];
   res.json({headers:Array.isArray(detail.headers)?detail.headers:[],
    rows:all.slice(offset,offset+limit),total:all.length,
    offset,limit,lastImportedAt:rows[0]?.imported_at||null});
  }catch(e){next(e);}
 });
 app.get("/api/picking-list/source",...guard,settingsAdmin,async(req,res,next)=>{
  try{
   const {rows}=await pool.query(
    'SELECT csv_url,ultima_importacion AS "lastImportedAt",actualizado_en AS "updatedAt",'+
    'ultima_comprobacion AS "lastCheckedAt",ultimo_error AS "lastError",'+
    'ultima_advertencia AS "lastWarning" '+
    'FROM farmetrica.picking_list_fuentes WHERE cliente_slug=$1',
    [req.context.client.slug]);
   const row=rows[0];
   const diagnostic=sourceDiagnostics.get(req.context.client.slug);
   res.json({url:row?.csv_url||"",sourceConfigured:Boolean(row?.csv_url),
    lastImportedAt:row?.lastImportedAt||null,updatedAt:row?.updatedAt||null,
    sourceError:diagnostic?.error||row?.lastError||null,
    lastAttemptAt:diagnostic?.lastAttemptAt||null,
    lastCheckedAt:row?.lastCheckedAt||null,lastWarning:row?.lastWarning||null});
  }catch(e){next(e);}
 });
 app.put("/api/picking-list/source",...guard,settingsAdmin,async(req,res,next)=>{
  try{
   const url=validateDropboxCsvUrl(req.body?.url);
   await pool.query("INSERT INTO farmetrica.picking_list_fuentes(cliente_slug,csv_url,actualizado_por) "+
    "VALUES($1,$2,$3) ON CONFLICT(cliente_slug) DO UPDATE SET csv_url=EXCLUDED.csv_url,"+
    "actualizado_por=EXCLUDED.actualizado_por,actualizado_en=now(),"+
    "ultima_comprobacion=NULL,ultimo_error=NULL,ultima_advertencia=NULL",
    [req.context.client.slug,url,req.user.email]);
   sourceDiagnostics.delete(req.context.client.slug);
   res.json({ok:true,sourceConfigured:true});
  }catch(e){if(e.message?.includes("Dropbox"))return res.status(400).json({error:e.message});
   next(e);}
 });
 app.post("/api/picking-list/refresh",...guard,allowed,write,async(req,res,next)=>{
  try{res.json({ok:true,...await monitoredRefresh(pool,req.context.client.slug)});}
  catch(e){res.status(502).json({error:safeSourceError(e)+
   " Se mantienen los pedidos anteriores."});}
 });
 app.post("/api/picking-list/import",...guard,allowed,write,
  express.text({type:["text/csv","text/plain"],limit:"8mb"}),async(req,res,next)=>{
   try{
    if(typeof req.body!=="string")return res.status(400).json({error:"Selecciona un CSV."});
    const imported=parsePendingCsv(req.body);
    res.json({ok:true,...await savePendingSnapshot(pool,req.context.client.slug,imported,{
     origin:"archivo",user:req.user.email})});
   }catch(e){if(/CSV|Fila|columna|líneas|fichero|No hay/.test(e.message||""))
    return res.status(400).json({error:e.message});next(e);}
  });
}
export function startPickingListPolling(pool,interval=15*60*1000){
 const tick=async()=>{
  try{
   const {rows}=await pool.query(
    "SELECT f.cliente_slug FROM farmetrica.picking_list_fuentes f "+
    "JOIN farmetrica.clientes c ON c.slug=f.cliente_slug WHERE c.activo "+
    "AND nullif(f.csv_url,'') IS NOT NULL "+
    "AND (f.ultima_importacion IS NULL OR f.actualizado_en>f.ultima_importacion "+
    "OR f.ultima_importacion<now()-interval '15 minutes')");
   await Promise.all(rows.slice(0,20).map(async r=>{
    try{await monitoredRefresh(pool,r.cliente_slug);}
    catch{ /* Se publica el fallo en la respuesta del reporte. */ }
   }));
  }catch{console.warn("Picking List: no se pudo verificar la programación remota.");}
 };
 const timer=setInterval(()=>void tick(),interval);
 timer.unref?.();
 void tick();
 return ()=>clearInterval(timer);
}
