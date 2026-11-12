// Panorama de ventas por familias del maestro y por tickets completos.
import {validSalesDateRange} from "./salesAnalysisPeriod.js";
import {familyNameSlug,cleanFamilyName} from "./familyMatching.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const numeric=v=>Number.isFinite(Number(v))?Number(v):0;
const fallback=name=>String(name||"").toLocaleLowerCase("es")
 .replace(/ñ/g,"\u0001").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .replace(/\u0001/g,"ñ").replace(/\s+/g," ").trim();
const accents=s=>(String(s).match(/[áéíóúÁÉÍÓÚ]/g)||[]).length;
function salesScope(req,res){
 const c=req.context;
 if(c.role!=="superadministrador"&&!c.modules?.ventas&&!c.modules?.dashboard){
  res.status(403).json({error:"Módulo de ventas no habilitado"});return null;
 }
 const from=String(req.query.desde||""),to=String(req.query.hasta||"");
 const raw=String(req.query.farmacias||"");
 if(!validSalesDateRange(from,to)||raw.length>2000||
  (raw&&raw.split(",").some(x=>!/^[1-9]\d{0,8}$/.test(x)))){
  res.status(400).json({error:"Período o farmacias no válidos"});return null;
 }
 const allowed=(c.allowedPharmacyIds||[]).map(Number);
 const requested=raw?raw.split(",").map(Number):allowed;
 if(requested.some(id=>!allowed.includes(id))){
  res.status(403).json({error:"Farmacia no autorizada"});return null;
 }
 const ids=[...new Set(requested)];
 const codesById=new Map((c.pharmacies||[]).map(p=>[
  Number(p.id),String(p.databaseCode||p.sourceCode||"").trim().toUpperCase()]));
 if(ids.some(id=>!codesById.get(id))){
  res.status(503).json({error:"Falta correspondencia ERP de una farmacia"});return null;
 }
 const schema=String(c.client?.schema||"");
 if(!SCHEMA.test(schema))throw Error("Esquema de cliente no válido");
 return {from,to,ids,codes:[...new Set(ids.map(id=>codesById.get(id)))],
  schema,tenant:c.client.slug};
}
export function buildSalesFamilyRankingSQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema SQL no permitido");
 const q='"'+schema+'"';
 return [
  // Primero resolver familias -> identificadores ERP de producto, usando la
  // PK del maestro. Luego agregar directamente por familia, no por cada CN.
  "WITH mapped AS MATERIALIZED (",
  " SELECT link.farmacia_codigo,link.articulo_origen_id,link.familia_id",
  " FROM farmetrica.familias_globales_articulos link",
  " JOIN farmetrica.familias_globales g",
  " ON g.cliente_slug=link.cliente_slug AND g.id=link.familia_id AND g.activo",
  " WHERE link.cliente_slug=$4 AND link.farmacia_codigo=ANY($3::text[])",
  "), amounts AS (",
  " SELECT link.familia_id,",
  " sum(v.importe)::float8 AS sales,",
  " sum(CASE WHEN nullif(btrim(v.articulo_id),'') IS NOT NULL THEN v.unidades ELSE 0 END)::float8 AS units,",
  " count(*)::bigint AS lines",
  " FROM "+q+".fm_ventas_analitica v",
  " LEFT JOIN mapped link ON link.farmacia_codigo=v.farmacia_codigo",
  " AND link.articulo_origen_id=v.articulo_id",
  " WHERE v.farmacia_codigo=ANY($3::text[])",
  " AND v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'",
  " GROUP BY link.familia_id",
  ") SELECT g.id::text AS \"familyId\",g.nombre AS name,g.segmento AS segment,",
  " a.sales,a.units,a.lines FROM amounts a",
  " LEFT JOIN farmetrica.familias_globales g",
  " ON g.cliente_slug=$4 AND g.id=a.familia_id",
  " ORDER BY a.sales DESC NULLS LAST"
 ].join("\n");
}
export function mergeSalesFamilyRows(rows=[]){
 const groups=new Map();
 let totalSales=0,totalUnits=0,totalLines=0,classifiedLines=0;
 for(const r of rows){
  const sales=numeric(r.sales),units=numeric(r.units),lines=numeric(r.lines);
  totalSales+=sales;totalUnits+=units;totalLines+=lines;
  const classified=r.familyId!=null;
  if(classified)classifiedLines+=lines;
  const original=classified?String(r.name||"").trim():"Sin clasificar";
  const key=classified?(familyNameSlug(original,"")||"name:"+fallback(original)):"sin-clasificar";
  const name=classified?cleanFamilyName(original,""):original;
  const prev=groups.get(key)||{key,name,sales:0,units:0,lines:0,
   classified,segments:[]};
  if(accents(name)>accents(prev.name))prev.name=name;
  prev.sales+=sales;prev.units+=units;prev.lines+=lines;
  if(classified&&r.segment&&!prev.segments.includes(r.segment))
   prev.segments.push(r.segment);
  groups.set(key,prev);
 }
 const families=[...groups.values()].sort((a,b)=>
  Number(b.classified)-Number(a.classified)||
  b.sales-a.sales||a.name.localeCompare(b.name,"es"));
 return {families,totalSales,totalUnits,totalLines,classifiedLines,
  coveragePct:totalLines?Math.round(classifiedLines/totalLines*1000)/10:0};
}
export function buildSalesTicketsSQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema SQL no permitido");
 const q='"'+schema+'"';
 return [
  "WITH documents AS MATERIALIZED (",
  " SELECT upper(btrim(v.farmacia_codigo)) AS code,v.sistema_origen,v.documento_id,",
  " sum(v.importe)::float8 AS sales,",
  " sum(CASE WHEN nullif(btrim(v.articulo_id),'') IS NOT NULL THEN v.unidades ELSE 0 END)::float8 AS units",
  " FROM "+q+".fm_ventas_analitica v",
  " WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'",
  " AND v.farmacia_codigo=ANY($3::text[])",
  " GROUP BY 1,2,3",
  ") SELECT code,count(*)::bigint AS tickets,",
  " sum(sales)::float8 AS sales,sum(units)::float8 AS units",
  " FROM documents GROUP BY code ORDER BY sales DESC"
 ].join("\n");
}
// Ticket medio: contar cabeceras indexadas, sin GROUP BY de líneas por documento.
export function buildSalesTicketCountsSQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema SQL no permitido");
 const q='"'+schema+'"';
 return [
  "SELECT h.farmacia_codigo AS code,count(*)::bigint AS tickets",
  " FROM "+q+".fm_ventas_cabeceras h",
  " WHERE h.farmacia_codigo=ANY($3::text[])",
  " AND h.fecha >= $1::date AND h.fecha < $2::date+interval '1 day'",
  " AND h.lineas_completas AND NOT h.eliminado_logicamente",
  " AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')",
  " AND EXISTS(SELECT 1 FROM "+q+".fm_ventas_lineas l",
  " WHERE l.farmacia_codigo=h.farmacia_codigo AND l.sistema_origen=h.sistema_origen",
  " AND l.documento_id=h.documento_id AND NOT l.eliminada_logicamente",
  " AND coalesce(l.anulada,false)=false)",
  " GROUP BY h.farmacia_codigo"
 ].join("\n");
}
// Recuento real de operaciones: una cabecera/documento, no una línea de venta.
// Los filtros son exactamente los utilizados para el ticket medio rápido.
export function buildSalesTicketHeatmapSQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema SQL no permitido");
 const q='"'+schema+'"';
 return [
  "SELECT extract(isodow FROM h.fecha)::int AS weekday,",
  " extract(hour FROM h.fecha)::int AS hour,count(*)::bigint AS tickets,",
  " coalesce(sum(valid_lines.units),0)::float8 AS units",
  " FROM "+q+".fm_ventas_cabeceras h",
  " JOIN LATERAL (",
  " SELECT count(*)::bigint AS count,",
  " coalesce(sum(CASE WHEN nullif(btrim(l.articulo_origen_id),'') IS NOT NULL",
  " THEN CASE WHEN l.devuelta IS TRUE THEN -abs(l.cantidad) ELSE l.cantidad END",
  " ELSE 0 END),0)::numeric AS units",
  " FROM "+q+".fm_ventas_lineas l",
  " WHERE l.farmacia_codigo=h.farmacia_codigo AND l.sistema_origen=h.sistema_origen",
  " AND l.documento_id=h.documento_id AND NOT l.eliminada_logicamente",
  " AND coalesce(l.anulada,false)=false",
  " ) valid_lines ON valid_lines.count>0",
  " WHERE h.farmacia_codigo=ANY($3::text[])",
  " AND h.fecha >= $1::date AND h.fecha < $2::date+interval '1 day'",
  " AND h.lineas_completas AND NOT h.eliminado_logicamente",
  " AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')",
  " GROUP BY 1,2 ORDER BY 1,2"
 ].join("\n");
}
export function summarizeSalesTicketHeatmap(rows){
 const cells=(rows||[]).map(r=>({
  weekday:numeric(r.weekday),hour:numeric(r.hour),
  tickets:numeric(r.tickets),units:numeric(r.units)
 })).filter(r=>Number.isInteger(r.weekday)&&r.weekday>=1&&r.weekday<=7&&
  Number.isInteger(r.hour)&&r.hour>=0&&r.hour<=23&&r.tickets>=0);
 return {cells,total:cells.reduce((sum,r)=>sum+r.tickets,0),
  totalUnits:cells.reduce((sum,r)=>sum+r.units,0)};
}

// Recuento independiente de cabeceras por vendedor y franja de evolución.
// Sólo se consulta al seleccionar "Ventas (tickets)": no se recuentan líneas.
export function buildSalesTicketActivitySQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema SQL no permitido");
 const q='"'+schema+'"';
 return [
  "SELECT CASE WHEN GROUPING(h.empleado_id)=0 THEN 'seller' ELSE 'period' END AS kind,",
  " h.farmacia_codigo AS code,h.empleado_id::text AS \"sellerId\",",
  " to_char(date_trunc($4::text,h.fecha),'YYYY-MM-DD\"T\"HH24:MI') AS bucket,",
  " count(*)::bigint AS tickets",
  " FROM "+q+".fm_ventas_cabeceras h",
  " WHERE h.farmacia_codigo=ANY($3::text[])",
  " AND h.fecha >= $1::date AND h.fecha < $2::date+interval '1 day'",
  " AND h.lineas_completas AND NOT h.eliminado_logicamente",
  " AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')",
  " AND EXISTS(SELECT 1 FROM "+q+".fm_ventas_lineas l",
  " WHERE l.farmacia_codigo=h.farmacia_codigo AND l.sistema_origen=h.sistema_origen",
  " AND l.documento_id=h.documento_id AND NOT l.eliminada_logicamente",
  " AND coalesce(l.anulada,false)=false)",
  " GROUP BY GROUPING SETS ((h.farmacia_codigo,h.empleado_id),",
  " (date_trunc($4::text,h.fecha)))"
 ].join("\n");
}
export function summarizeSalesTicketActivity(rows,pharmacies,ids,granularity){
 const codes=new Map((pharmacies||[]).filter(p=>ids.includes(Number(p.id))).map(p=>[
  String(p.databaseCode||p.sourceCode||"").trim().toUpperCase(),String(p.id)]));
 const width={hour:16,day:10,month:7,year:4}[granularity]||7;
 const sellers=[],series=[];
 for(const r of rows||[]){
  if(r.kind==="seller"){
   const pharmacyId=codes.get(String(r.code||"").trim().toUpperCase());
   if(pharmacyId)sellers.push({pharmacyId,sellerId:r.sellerId??null,tickets:numeric(r.tickets)});
  }else if(r.kind==="period"){
   series.push({bucket:String(r.bucket||"").slice(0,width),tickets:numeric(r.tickets)});
  }
 }
 return {sellers,series};
}
// Cada documento cuenta una sola vez EN CADA familia presente, aunque tenga
// cinco líneas de esa misma familia. Un ticket mixto aparece en dos familias.
export function buildSalesFamilyTicketSQL(schema){
 if(!SCHEMA.test(schema))throw Error("Esquema SQL no permitido");
 const q='"'+schema+'"';
 return [
  "WITH ticket_families AS (",
  " SELECT DISTINCT v.farmacia_codigo,v.sistema_origen,v.documento_id,",
  " coalesce(nullif(regexp_replace(",
  " translate(lower(btrim(g.nombre)),'áàäéèëíìïóòöúùüñ','aaaeeeiiiooouuun'),",
  " '[[:space:]]+',' ','g'),''),'sin clasificar') AS family",
  " FROM "+q+".fm_ventas_analitica v",
  " LEFT JOIN farmetrica.familias_globales_articulos a",
  " ON a.cliente_slug=$4 AND a.farmacia_codigo=v.farmacia_codigo",
  " AND a.articulo_origen_id=v.articulo_id",
  " LEFT JOIN farmetrica.familias_globales g",
  " ON g.cliente_slug=a.cliente_slug AND g.id=a.familia_id AND g.activo",
  " WHERE v.farmacia_codigo=ANY($3::text[])",
  " AND v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'",
  ") SELECT family AS key,count(*)::bigint AS tickets",
  " FROM ticket_families GROUP BY family"
 ].join("\n");
}
export function summarizeSalesFamilyTicketRows(rows){
 return {families:(rows||[]).map(r=>({key:String(r.key||""),tickets:numeric(r.tickets)}))};
}

export function summarizeSalesTicketCounts(rows,pharmacies,ids){
 const codes=new Map((pharmacies||[]).filter(p=>ids.includes(Number(p.id))).map(p=>[
  String(p.databaseCode||p.sourceCode||"").trim().toUpperCase(),{id:String(p.id),name:p.name}
 ]));
 const sites=(rows||[]).map(row=>{
  const p=codes.get(String(row.code||"").toUpperCase());
  return p?{...p,tickets:numeric(row.tickets)}:null;
 }).filter(Boolean);
 return {tickets:sites.reduce((n,p)=>n+p.tickets,0),pharmacies:sites};
}
export function summarizeSalesTickets(rows,pharmacies,ids){
 const names=new Map((pharmacies||[]).filter(p=>ids.includes(Number(p.id))).map(p=>[
  String(p.databaseCode||p.sourceCode||"").trim().toUpperCase(),
  {id:String(p.id),name:p.name}
 ]));
 const result=rows.map(r=>{
  const p=names.get(String(r.code||"").toUpperCase());
  return {id:p?.id||null,name:p?.name||"Farmacia",
   sales:numeric(r.sales),tickets:numeric(r.tickets),units:numeric(r.units),
   ticketMedio:numeric(r.tickets)?numeric(r.sales)/numeric(r.tickets):0};
 }).filter(r=>r.id).sort((a,b)=>b.sales-a.sales);
 const tickets=result.reduce((n,r)=>n+r.tickets,0);
 const sales=result.reduce((n,r)=>n+r.sales,0);
 const units=result.reduce((n,r)=>n+r.units,0);
 return {pharmacies:result,kpis:{tickets,sales,units,
  ticketMedio:tickets?sales/tickets:0,unidadesPorTicket:tickets?units/tickets:0}};
}
export function setupSalesOverview(app,pool,{requireTenant}){
 app.get("/api/analytics/ventas/familias-ranking",...requireTenant(),async(req,res,next)=>{
  try{
   const s=salesScope(req,res);if(!s)return;
   if(!s.ids.length)return res.json(mergeSalesFamilyRows([]));
   const {rows}=await pool.query({text:buildSalesFamilyRankingSQL(s.schema),
    values:[s.from,s.to,s.codes,s.tenant],query_timeout:22000});
   res.json(mergeSalesFamilyRows(rows));
  }catch(e){next(e)}
 });
 app.get("/api/analytics/ventas/ticket-actividad",...requireTenant(),async(req,res,next)=>{
  const scope=salesScope(req,res);if(!scope)return;
  const granularity=String(req.query.granularidad||"month");
  if(!["hour","day","month","year"].includes(granularity))
   return res.status(400).json({error:"Granularidad no válida"});
  if(!scope.ids.length)return res.json({sellers:[],series:[]});
  let conn;
  try{
   conn=await pool.connect();
   await conn.query("BEGIN READ ONLY");
   await conn.query("SET LOCAL statement_timeout='90s'");
   const {rows}=await conn.query({text:buildSalesTicketActivitySQL(scope.schema),
    values:[scope.from,scope.to,scope.codes,granularity],query_timeout:98000});
   await conn.query("ROLLBACK");
   res.setHeader?.("Cache-Control","private, no-store");
   res.json(summarizeSalesTicketActivity(rows,req.context.pharmacies,scope.ids,granularity));
  }catch(error){if(conn)await conn.query("ROLLBACK").catch(()=>{});next(error)}
  finally{conn?.release()}
 });
 app.get("/api/analytics/ventas/ticket-familias",...requireTenant(),async(req,res,next)=>{
  const scope=salesScope(req,res);if(!scope)return;
  if(!scope.ids.length)return res.json({families:[]});
  let conn;
  try{
   conn=await pool.connect();
   await conn.query("BEGIN READ ONLY");
   await conn.query("SET LOCAL statement_timeout='95s'");
   const {rows}=await conn.query({text:buildSalesFamilyTicketSQL(scope.schema),
    values:[scope.from,scope.to,scope.codes,scope.tenant],query_timeout:103000});
   await conn.query("ROLLBACK");
   res.setHeader?.("Cache-Control","private, no-store");
   res.json(summarizeSalesFamilyTicketRows(rows));
  }catch(error){if(conn)await conn.query("ROLLBACK").catch(()=>{});next(error)}
  finally{conn?.release()}
 });
 app.get("/api/analytics/ventas/horarios-tickets",...requireTenant(),async(req,res,next)=>{
  const s=salesScope(req,res);if(!s)return;
  if(!s.ids.length)return res.json(summarizeSalesTicketHeatmap([]));
  let conn;
  try{
   conn=await pool.connect();
   await conn.query("BEGIN READ ONLY");
   await conn.query("SET LOCAL statement_timeout='90s'");
   const {rows}=await conn.query({text:buildSalesTicketHeatmapSQL(s.schema),
    values:[s.from,s.to,s.codes],query_timeout:98000});
   await conn.query("ROLLBACK");
   res.setHeader?.("Cache-Control","private, no-store");
   res.json(summarizeSalesTicketHeatmap(rows));
  }catch(error){
   if(conn)await conn.query("ROLLBACK").catch(()=>{});
   next(error);
  }finally{conn?.release()}
 });
 app.get("/api/analytics/ventas/ticket-medio-rapido",...requireTenant(),async(req,res,next)=>{
  const s=salesScope(req,res);if(!s)return;
  if(!s.ids.length)return res.json(summarizeSalesTicketCounts([],[],[]));
  let conn;
  try{
   conn=await pool.connect();
   await conn.query("BEGIN READ ONLY");
   await conn.query("SET LOCAL statement_timeout='90s'");
   const {rows}=await conn.query({text:buildSalesTicketCountsSQL(s.schema),
    values:[s.from,s.to,s.codes],query_timeout:98000});
   await conn.query("ROLLBACK");
   res.json(summarizeSalesTicketCounts(rows,req.context.pharmacies,s.ids));
  }catch(error){
   if(conn)await conn.query("ROLLBACK").catch(()=>{});
   next(error);
  }finally{conn?.release()}
 });
 app.get("/api/analytics/ventas/ticket-medio",...requireTenant(),async(req,res,next)=>{
  try{
   const s=salesScope(req,res);if(!s)return;
   if(!s.ids.length)return res.json(summarizeSalesTickets([],[],[]));
   const {rows}=await pool.query({text:buildSalesTicketsSQL(s.schema),
    values:[s.from,s.to,s.codes],query_timeout:90000});
   res.json(summarizeSalesTickets(rows,req.context.pharmacies,s.ids));
  }catch(e){next(e)}
 });
}
