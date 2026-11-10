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
   "ultima_fila=$3,actualizado_por=$4,actualizado_en=now() WHERE cliente_slug=$1",
   [slug,origin,lines.length,user]);
  await tx.query("COMMIT");
  return {rows:lines.length};
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
  "ultimo_origen AS origin,(nullif(csv_url,'') IS NOT NULL) AS \"sourceConfigured\" "+
  "FROM farmetrica.picking_list_fuentes WHERE cliente_slug=$1",[slug]);
 return rows[0]||{lastImportedAt:null,lineCount:0,origin:null,sourceConfigured:false};
}
async function getInventory(pool,ctx,codes){
 const schema=ctx.client.schema;
 if(!SCHEMA.test(schema))throw new Error("Esquema de cliente inválido.");
 const source=await readFile(new URL("./pickingListStock.sql",import.meta.url),"utf8");
 const sql=source.replaceAll("__SCHEMA__","\""+schema+"\"")
  .replaceAll("__PHARMACY_CODE__",pharmacyDataCodeSQL("f"));
 const {rows}=await pool.query(sql,[ctx.client.slug,JSON.stringify(codes)]);
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
 const locations=sites.filter(s=>s.kind==="farmacia");
 const report=entries.map(entry=>{
  const stock=sites.map(s=>{
   const inv=items.get(s.id+"|"+entry.key);
   return {...s,stock:s.ready?(inv?.stock===null?null:inv?Math.max(0,inv.stock):0):null,
    matched:Boolean(inv?.matched),stockAt:inv?.stockAt||null,planned:0};
  });
  const wh=stock.find(s=>s.kind==="almacen"&&s.code==="ALMACEN");
  const pharm=stock.filter(s=>s.kind==="farmacia");
  const matched=entry.cn||stock.some(s=>s.matched);
  const proposal=matched&&wh?allocatePending(entry.required,wh.stock,pharm,{reserve:1}):null;
  for(const s of stock)s.planned=proposal?
   (s.kind==="almacen"?proposal.warehouse||0:proposal.bySite[s.code]||0):0;
  const hasMissing=!wh||stock.some(s=>!s.ready);
  const old=stock.some(s=>s.stockAt&&
   Date.now()-new Date(s.stockAt).getTime()>48*60*60*1000);
  const shortage=proposal?.remaining??null;
  const status=!matched?"sin_cn":hasMissing?"sin_datos":old?"desactualizado":
   shortage>0?"sin_stock":"cubierto";
  return {
   key:entry.key,cn:entry.cn,sku:entry.sku,
   name:entry.name||stock.map(s=>items.get(s.id+"|"+entry.key)?.name).find(Boolean)||"",
   required:entry.required,orders:entry.orderKeys.size,
   lines:entry.lines,channels:[...entry.channels],details:entry.details,
   stock,allocated:proposal?.fulfilled??null,shortage,status,
   stockTotal:stock.every(s=>s.stock!==null)?stock.reduce((sum,s)=>sum+s.stock,0):null,
   exhausted:proposal?.zeroedSites||[]
  };
 }).sort((a,b)=>b.required-a.required||a.key.localeCompare(b.key));
 return {
  meta,channels,selectedChannel:channel,sites,rows:report,
  totals:{orders:new Set(filtered.map(r=>r.orderId)).size,
   products:report.length,units:report.reduce((n,r)=>n+r.required,0),
   allocated:report.reduce((n,r)=>n+(r.allocated||0),0),
   shortage:report.reduce((n,r)=>n+(r.shortage||0),0),
   incomplete:report.filter(r=>["sin_cn","sin_datos","desactualizado"].includes(r.status)).length}
 };
}
export function setupPickingList(app,pool,{requireTenant}){
 const guard=requireTenant();
 const allowed=(req,res,next)=>managed(req.context)?next():res.status(403).json({
  error:"La Picking List requiere perfil gestor/administrador y acceso a Stock"});
 const write=(req,res,next)=>writable(req.context)?next():res.status(403).json({
  error:"Tu perfil no permite importar o configurar la Picking List"});
 app.get("/api/picking-list/report",...guard,allowed,async(req,res,next)=>{
  try{res.json(await readPickingReport(pool,req.context,{
   channel:String(req.query.channel||"").slice(0,120)
  }));}catch(e){next(e);}
 });
 app.put("/api/picking-list/source",...guard,allowed,write,async(req,res,next)=>{
  try{
   const url=validateDropboxCsvUrl(req.body?.url);
   await pool.query("INSERT INTO farmetrica.picking_list_fuentes(cliente_slug,csv_url,actualizado_por) "+
    "VALUES($1,$2,$3) ON CONFLICT(cliente_slug) DO UPDATE SET csv_url=EXCLUDED.csv_url,"+
    "actualizado_por=EXCLUDED.actualizado_por,actualizado_en=now()",
    [req.context.client.slug,url,req.user.email]);
   res.json({ok:true,sourceConfigured:true});
  }catch(e){if(e.message?.includes("Dropbox"))return res.status(400).json({error:e.message});
   next(e);}
 });
 app.post("/api/picking-list/refresh",...guard,allowed,write,async(req,res,next)=>{
  try{res.json({ok:true,...await refreshPendingSource(pool,req.context.client.slug)});}
  catch(e){res.status(502).json({error:e.message?.includes("Configura")?e.message:
   "No se ha podido obtener el CSV desde Dropbox. Se mantienen los pedidos anteriores."});}
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
    "AND (f.ultima_importacion IS NULL OR f.ultima_importacion<now()-interval '15 minutes')");
   await Promise.all(rows.slice(0,20).map(async r=>{
    try{await refreshPendingSource(pool,r.cliente_slug);}
    catch{console.warn("Picking List: no se pudo actualizar un origen remoto.");}
   }));
  }catch{console.warn("Picking List: no se pudo verificar la programación remota.");}
 };
 const timer=setInterval(()=>void tick(),interval);
 timer.unref?.();
 void tick();
 return ()=>clearInterval(timer);
}
