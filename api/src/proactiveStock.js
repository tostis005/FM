// Alertas y stock sin ventas: cómputo incremental, sin bloquear la petición HTTP.
// Todos los resultados provienen de stock actual y documentos completos del ERP.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {madridDay} from "./dashboardConsolidations.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const DAY_OPTIONS=new Set([90,180]);
const MODES=new Set(["alertas","inmovilizado"]);
const TODAY="(now() AT TIME ZONE 'Europe/Madrid')::date";
const TTL=10*60*1000;
const jobs=new Map(),queue=[];
let active=0;
const number=v=>Number(v||0);
const round=(v,d=1)=>Math.round(v*10**d)/10**d;
const shift=(date,n)=>new Date(Date.parse(date+"T00:00:00Z")+n*86400000).toISOString().slice(0,10);
const invalid=(message,status=400)=>Object.assign(Error(message),{status});

export function proactiveFilters(req,mode){
 if(!MODES.has(mode))throw invalid("Análisis desconocido");
 const ctx=req.context||{},schema=ctx.client?.schema;
 if(!SCHEMA.test(schema||""))throw invalid("Esquema no válido");
 const allowed=(ctx.allowedPharmacyIds||[]).map(Number).filter(Number.isSafeInteger);
 const raw=String(req.query?.farmacias||"");
 if(raw.length>500||(raw&&!/^\d+(,\d+)*$/.test(raw)))throw invalid("Farmacias no válidas");
 const ids=raw?raw.split(",").map(Number):allowed;
 if(ids.some(id=>!allowed.includes(id)))throw invalid("Farmacia no autorizada",403);
 const days=Number(req.query?.dias||90);
 if(!DAY_OPTIONS.has(days))throw invalid("Selecciona 90 o 180 días");
 const search=String(req.query?.buscar||"").trim();
 if(search.length>90)throw invalid("Búsqueda demasiado larga");
 const page=Number(req.query?.pagina||1),size=Number(req.query?.tamano||50);
 if(!Number.isSafeInteger(page)||page<1||page>2000||![25,50,100].includes(size))
  throw invalid("Paginación incorrecta");
 const refresh=String(req.query?.recalcular||"");
 if(refresh&&!/^\d{1,16}$/.test(refresh))throw invalid("Recálculo no válido");
 return {schema,slug:ctx.client.slug,ids:[...new Set(ids)].sort((a,b)=>a-b),
  days,search,page,size,mode,refresh};
}
export function proactiveCoverageSQL(schema){
 if(!SCHEMA.test(schema||""))throw Error("Esquema inválido");
 const q='"'+schema+'"';
 return [
  "WITH sites AS (SELECT f.id,f.nombre,"+pharmacyDataCodeSQL("f")+" AS code",
  " FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND f.activo=true)",
  " SELECT s.id,s.nombre,s.code,",
  " EXISTS (SELECT 1 FROM "+q+".articulos a WHERE upper(btrim(a.farmacia_codigo))=s.code",
  " AND a.sincronizado_en>=now()-interval '7 days' LIMIT 1) AS stock_ok,",
  " EXISTS (SELECT 1 FROM "+q+".fm_ventas_cabeceras h WHERE upper(btrim(h.farmacia_codigo))=s.code",
  " AND h.fecha>="+TODAY+"-interval '13 days'",
  " AND h.lineas_completas AND NOT h.eliminado_logicamente",
  " AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')",
  " LIMIT 1) AS sales_ok FROM sites s ORDER BY s.id"
 ].join("\n");
}
export function proactiveInventorySQL(schema){
 if(!SCHEMA.test(schema||""))throw Error("Esquema inválido");
 const q='"'+schema+'"';
 return [
  'SELECT f.id::text AS "pharmacyId",f.nombre AS "pharmacyName",',
  ' a.origen_id::text AS "articleId",nullif(btrim(a.codigo_nacional),\'\') AS cn,',
  ' a.nombre AS name,a.stock_actual::float8 AS stock,',
  ' (CASE WHEN a.pmc>0 THEN a.pmc WHEN a.puc>0 THEN a.puc END)::float8 AS "unitCost",',
  ' a.sincronizado_en AS "stockAt"',
  " FROM "+q+".articulos a JOIN farmetrica.farmacias f ON f.cliente_slug=$1",
  " AND upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f"),
  " WHERE f.id=$2::int AND f.activo=true AND a.stock_actual>0",
  " AND a.sincronizado_en>=now()-interval '7 days'",
  " AND ($3::text='' OR a.nombre ILIKE '%'||$3||'%'",
  " OR a.codigo_nacional ILIKE '%'||$3||'%' OR a.origen_id ILIKE '%'||$3||'%')"
 ].join("\n");
}
export function proactiveSalesSliceSQL(schema){
 if(!SCHEMA.test(schema||""))throw Error("Esquema inválido");
 const q='"'+schema+'"';
 const net="CASE WHEN l.devuelta IS TRUE THEN -abs(l.cantidad) ELSE l.cantidad END";
 return [
  'SELECT l.articulo_origen_id::text AS "articleId",',
  " sum("+net+")::float8 AS units,",
  " sum(CASE WHEN h.fecha>=$4::date THEN "+net+" ELSE 0 END)::float8 AS \"units30\",",
  " max(h.fecha::date) FILTER(WHERE l.cantidad>0 AND l.devuelta IS NOT TRUE) AS \"lastSaleDate\"",
  " FROM "+q+".fm_ventas_cabeceras h JOIN "+q+".fm_ventas_lineas l",
  " ON l.farmacia_codigo=h.farmacia_codigo AND l.sistema_origen=h.sistema_origen",
  " AND l.documento_id=h.documento_id",
  " WHERE upper(btrim(h.farmacia_codigo))=$1::text",
  " AND h.fecha >= $2::date AND h.fecha < $3::date",
  " AND h.lineas_completas AND NOT h.eliminado_logicamente",
  " AND NOT l.eliminada_logicamente AND coalesce(l.anulada,false)=false",
  " AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')",
  " AND nullif(btrim(l.articulo_origen_id),'') IS NOT NULL",
  " GROUP BY l.articulo_origen_id"
 ].join("\n");
}
// Última venta efectiva anterior al período de análisis, no una devolución.
// Se consulta por lotes de referencias inmovilizadas; nunca es necesaria para
// decidir si una referencia está inmovilizada y no bloquea el listado principal.
export function proactiveLastSaleSQL(schema){
 if(!SCHEMA.test(schema||""))throw Error("Esquema inválido");
 const q='"'+schema+'"';
 return [
  'SELECT l.articulo_origen_id::text AS "articleId",',
  ' max(h.fecha::date) AS "lastSaleDate"',
  ' FROM '+q+'.fm_ventas_lineas l JOIN '+q+'.fm_ventas_cabeceras h',
  ' ON h.farmacia_codigo=l.farmacia_codigo AND h.sistema_origen=l.sistema_origen',
  ' AND h.documento_id=l.documento_id',
  ' WHERE upper(btrim(l.farmacia_codigo))=$1::text',
  ' AND l.articulo_origen_id=ANY($2::text[]) AND h.fecha<$3::date',
  ' AND l.cantidad>0 AND l.devuelta IS NOT TRUE',
  ' AND h.lineas_completas AND NOT h.eliminado_logicamente',
  ' AND NOT l.eliminada_logicamente AND coalesce(l.anulada,false)=false',
  " AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')",
  ' GROUP BY l.articulo_origen_id'
 ].join("\n");
}
export function classifyProactiveStock(stock,sale,days){
 const unitsPeriod=Math.max(0,number(sale?.units));
 const units30=Math.max(0,number(sale?.units30));
 const coverDays=unitsPeriod>0?round(number(stock.stock)*days/unitsPeriod):null;
 const capital=stock.unitCost!=null&&Number(stock.unitCost)>0?
  round(number(stock.stock)*Number(stock.unitCost),2):null;
 const alertType=units30>0&&number(stock.stock)*30/units30<=7?"rotura":
  unitsPeriod<=0?"sin_ventas":
  number(stock.stock)*days/unitsPeriod>=120?"exceso":null;
 return {...stock,unitsPeriod,units30,coverDays,capital,alertType,
  lastSaleDate:sale?.lastSaleDate||null,
  lastSaleStatus:sale?.lastSaleDate?"found":"pending"};
}
const sortProactive=(rows,mode)=>rows.sort((a,b)=>{
 const order={rotura:0,sin_ventas:1,exceso:2};
 const severity=mode==="alertas"?(order[a.alertType]??4)-(order[b.alertType]??4):0;
 if(severity)return severity;
 const left=a.capital??-1,right=b.capital??-1;
 return right-left||b.stock-a.stock||
  a.pharmacyId.localeCompare(b.pharmacyId,"es",{numeric:true})||
  a.articleId.localeCompare(b.articleId,"es",{numeric:true});
});
function windows(days,day=madridDay()){
 const start=shift(day,1-days),end=shift(day,1);
 const list=[];
 for(let current=start;current<end;){
  const next=shift(current,14)<end?shift(current,14):end;
  list.push([current,next]);current=next;
 }
 return list;
}
function timeout(e){
 return ["57014","55P03","53300"].includes(e.code)||e.message==="Query read timeout";
}
async function salesSlice(pool,sql,code,from,to,last30,totals,job){
 try{
  const response=await pool.query({text:sql,values:[code,from,to,last30],query_timeout:23000});
  for(const r of response.rows){
   const key=String(r.articleId),prev=totals.get(key)||{units:0,units30:0};
   prev.units+=number(r.units);prev.units30+=number(r.units30);
   const date=r.lastSaleDate?String(r.lastSaleDate).slice(0,10):null;
   if(date&&(!prev.lastSaleDate||date>prev.lastSaleDate))prev.lastSaleDate=date;
   totals.set(key,prev);
  }
  job.progress.done++;
 }catch(e){
  const days=Math.round((Date.parse(to)-Date.parse(from))/86400000);
  if(!timeout(e)||days<=1)throw e;
  const middle=shift(from,Math.floor(days/2));
  job.progress.total++;
  await salesSlice(pool,sql,code,from,middle,last30,totals,job);
  await salesSlice(pool,sql,code,middle,to,last30,totals,job);
 }
}
async function runJob(pool,job){
 const f=job.filters,started=Date.now();
 try{
  job.status="checking";
  const tables=[f.schema+".articulos",f.schema+".fm_ventas_cabeceras",
   f.schema+".fm_ventas_lineas"];
  const exists=await pool.query({text:"SELECT "+tables.map((_,i)=>
   "to_regclass($"+(i+1)+") IS NOT NULL AS t"+i).join(","),
   values:tables,query_timeout:8000});
  if(!Object.values(exists.rows[0]||{}).every(Boolean)){
   job.status="unavailable";
   job.message="Faltan el catálogo y los documentos completos de ventas para este análisis.";
   return;
  }
  const coverage=await pool.query({text:proactiveCoverageSQL(f.schema),
   values:[f.slug,f.ids],query_timeout:17000});
  const chosen=coverage.rows.filter(r=>r.stock_ok&&r.sales_ok);
  job.excluded=coverage.rows.filter(r=>!r.stock_ok||!r.sales_ok).map(r=>({
   pharmacyId:String(r.id),name:r.nombre,
   reason:!r.stock_ok?"Stock sin actualizar en los últimos 7 días":
    "No se han verificado ventas documentales en los últimos 14 días"
  }));
  if(!chosen.length){
   job.status="unavailable";
   job.message="No hay farmacias con stock reciente y ventas documentales verificadas.";
   return;
  }
  job.status="calculating";
  const spans=windows(f.days);
  const last30=shift(madridDay(),-29);
  job.progress.total=chosen.length*(spans.length+1);
  const inventorySQL=proactiveInventorySQL(f.schema),salesSQL=proactiveSalesSliceSQL(f.schema);
  const historyBatches=[];
  for(const site of chosen){
   try{
    const inventory=await pool.query({text:inventorySQL,
     values:[f.slug,Number(site.id),f.search],query_timeout:22000});
    job.progress.done++;
    if(!inventory.rows.length){
     job.progress.done+=spans.length;job.completedSites++;
     continue;
    }
    const sold=new Map();
    for(const [from,to] of spans){
     // Cada bloque ocupa como máximo 14 días: el índice de fecha evita un
     // único GROUP BY de seis meses y permite avanzar con datos parciales.
     await salesSlice(pool,salesSQL,site.code,from,to,last30,sold,job);
    }
    const alertRows=[],idleRows=[];
    for(const stock of inventory.rows){
     const calculated=classifyProactiveStock(stock,sold.get(String(stock.articleId)),f.days);
     if(calculated.alertType)alertRows.push(calculated);
     if(calculated.unitsPeriod<=0)idleRows.push(calculated);
    }
    job.rows.alertas.push(...alertRows);
    job.rows.inmovilizado.push(...idleRows);
    const pendingDates=idleRows.filter(r=>r.lastSaleStatus==="pending");
    for(let start=0;start<pendingDates.length;start+=150)
     historyBatches.push({code:site.code,items:pendingDates.slice(start,start+150)});
    sortProactive(job.rows.alertas,"alertas");
    sortProactive(job.rows.inmovilizado,"inmovilizado");
    job.completedSites++;
   }catch(e){
    console.warn("GESTION_PROACTIVA_FARMACIA",JSON.stringify({
     code:e.code||e.name,pharmacyId:Number(site.id),elapsedMs:Date.now()-started
    }));
    job.excluded.push({pharmacyId:String(site.id),name:site.nombre,
     reason:timeout(e)?"La consulta de ventas de esta farmacia superó el límite de tiempo":
      "No se pudo verificar todo el período de ventas"});
   }
  }
  // Enriquecer fechas de venta anteriores a los 90/180 días. Los resultados
  // principales ya están publicados para que el usuario pueda consultarlos.
  if(historyBatches.length){
   job.status="dates";job.progress.total+=historyBatches.length;
   const lastSaleSQL=proactiveLastSaleSQL(f.schema);
   const startDate=shift(madridDay(),1-f.days);
   for(const batch of historyBatches){
    try{
     const result=await pool.query({text:lastSaleSQL,
      values:[batch.code,batch.items.map(r=>String(r.articleId)),startDate],
      query_timeout:22000});
     const dates=new Map(result.rows.map(r=>[String(r.articleId),
      r.lastSaleDate?String(r.lastSaleDate).slice(0,10):null]));
     for(const row of batch.items){
      row.lastSaleDate=dates.get(String(row.articleId))||null;
      row.lastSaleStatus=row.lastSaleDate?"found":"not_found";
     }
    }catch(e){
     job.dateIncomplete+=batch.items.length;
     for(const row of batch.items)row.lastSaleStatus="unavailable";
     console.warn("GESTION_PROACTIVA_ULTIMA_VENTA",JSON.stringify({
      code:e.code||e.name,items:batch.items.length,slug:f.slug
     }));
    }finally{job.progress.done++;}
   }
  }
  job.status=job.completedSites===0?"unavailable":job.excluded.length?"partial":"complete";
  if(job.status==="unavailable")job.message=
   "No se ha podido completar ninguna farmacia. Revisa la sincronización y los índices documentales.";
  console.info("GESTION_PROACTIVA",JSON.stringify({status:job.status,slug:f.slug,
   pharmacies:job.completedSites,excluded:job.excluded.length,elapsedMs:Date.now()-started}));
 }catch(e){
  job.status="error";job.message=timeout(e)?
   "No se ha podido comprobar la cobertura documental a tiempo. Selecciona una farmacia y reintenta.":
   ["42P01","42703"].includes(e.code)?
    "Faltan tablas o columnas necesarias en la sincronización.":
    "No se pudo calcular el análisis. Consulta el estado de la sincronización.";
  console.error("GESTION_PROACTIVA",JSON.stringify({code:e.code||e.name,slug:f.slug,
   elapsedMs:Date.now()-started}));
 }finally{job.finishedAt=Date.now();job.expires=job.finishedAt+TTL;}
}
function pump(pool){
 if(active||!queue.length)return;
 const next=queue.shift();active++;
 void runJob(next.pool,next.job).finally(()=>{active--;pump(pool);});
}
export function getProactiveJob(pool,filters){
 const f=filters,base=[f.slug,f.schema,f.ids.join(","),f.days,f.search.toLowerCase()].join("|");
 const now=Date.now();
 for(const [k,job] of jobs)if(job.expires&&job.expires<now)jobs.delete(k);
 for(const [k,job] of jobs)
  if(k===base||k.startsWith(base+"|")){
   if(!job.expires||(!f.refresh&&job.expires>now))return job;
  }
 const key=f.refresh?base+"|"+f.refresh:base;
 if(jobs.has(key))return jobs.get(key);
 const job={status:"queued",message:"",filters:f,rows:{alertas:[],inmovilizado:[]},
  progress:{done:0,total:0},excluded:[],dateIncomplete:0,
  completedSites:0,createdAt:now,expires:0};
 jobs.set(key,job);queue.push({pool,job});pump(pool);
 return job;
}
export function proactiveJobResponse(job,f){
 const rows=job.rows[f.mode]||[],total=rows.length;
 const valued=rows.filter(x=>x.capital!=null);
 const status=job.status;
 return {available:!["unavailable","error"].includes(status),status,
  mode:f.mode,days:f.days,page:f.page,pageSize:f.size,total,
  progress:job.progress,completedSites:job.completedSites,
  summary:{valuedSubtotal:round(valued.reduce((n,r)=>n+r.capital,0),2),
   valuedCount:valued.length,stockUnits:rows.reduce((n,r)=>n+number(r.stock),0),
   riskCount:rows.filter(r=>r.alertType==="rotura").length},
  excluded:job.excluded,dateIncomplete:job.dateIncomplete||0,
  message:job.message||null,
  rows:rows.slice((f.page-1)*f.size,f.page*f.size)};
}
export function setupProactiveStock(app,pool,{requireTenant}){
 const guard=[...requireTenant(),(req,res,next)=>{
  if(req.user?.role!=="superadministrador"||req.context?.role!=="superadministrador")
   return res.status(403).json({error:"Solo el superadministrador puede acceder a este análisis"});
  next();
 }];
 for(const mode of MODES){
  app.get("/api/analytics/gestion-proactiva/"+mode,...guard,(req,res)=>{
   try{
    const f=proactiveFilters(req,mode);
    if(!f.ids.length)return res.json({available:true,status:"complete",rows:[],
     total:0,excluded:[],progress:{done:0,total:0},
     summary:{valuedSubtotal:0,valuedCount:0,stockUnits:0,riskCount:0}});
    const job=getProactiveJob(pool,f);
    return res.json(proactiveJobResponse(job,f));
   }catch(e){
    console.error("GESTION_PROACTIVA_API",e.code||e.name);
    res.status(e.status||500).json({error:e.status?e.message:"No se pudo iniciar el análisis"});
   }
  });
 }
}
