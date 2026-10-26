import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

// Los períodos cerrados se precalculan. El mes abierto permanece en vivo.
// Todos los SQL leen documentos válidos (misma semántica que vistas 018).
const IDENT=/^[a-z][a-z0-9_]{1,62}$/;
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const round=n=>Math.round(n*100)/100;
const sum=(rows,k)=>rows.reduce((n,r)=>n+Number(r[k]||0),0);
const dstr=x=>x instanceof Date?x.toISOString().slice(0,10):String(x).slice(0,10);
const nextMonth=s=>{
 const d=new Date(s.slice(0,7)+"-01T00:00:00Z");
 d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,10);
};
const previousMonth=s=>{
 const d=new Date(s.slice(0,7)+"-01T00:00:00Z");
 d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,10);
};
const nextDay=s=>new Date(Date.parse(s+"T00:00:00Z")+86400000).toISOString().slice(0,10);
export const madridDay=(now=new Date())=>{
 const p=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Madrid",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
 const get=t=>p.find(x=>x.type===t).value;
 return get("year")+"-"+get("month")+"-"+get("day");
};
const valid=s=>ISO.test(s)&&Number.isFinite(Date.parse(s+"T00:00:00Z"))&&
 new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
export function compatibleConsolidatedRange(from,to,today=madridDay()){
 if(!valid(from)||!valid(to)||from>to||to>today||from<"2010-01-01"||
  !from.endsWith("-01"))return null;
 const active=to===today&&to.slice(0,7)===today.slice(0,7);
 if(!active&&nextDay(to)!==nextMonth(to))return null;
 const end=active?to.slice(0,7)+"-01":nextMonth(to),months=[];
 for(let month=from;month<end;month=nextMonth(month)){
  months.push(month);
  if(months.length>120)return null;
 }
 return {from,to,months,active,activeMonth:active?to.slice(0,7)+"-01":null};
}
export function buildDashboardMonthSQL(schema,source,{daily=false}={}){
 if(!IDENT.test(schema)||!["ventas","compras"].includes(source))
  throw Error("Origen inválido");
 const sales=source==="ventas",root='"'+schema+'"';
 const h=root+(sales?".fm_ventas_cabeceras":".fm_recepciones_cabeceras");
 const l=root+(sales?".fm_ventas_lineas":".fm_recepciones_lineas");
 const amount=sales?"l.importe_neto":"l.coste_neto";
 const net=col=>"CASE WHEN l.devuelta IS TRUE THEN -abs("+col+") ELSE "+col+" END";
 const product="nullif(btrim(l.articulo_origen_id),'') IS NOT NULL";
 const costed=sales?product+" AND l.coste_historico>=0 AND l.importe_neto IS NOT NULL":"false";
 return [
  "SELECT f.id AS farmacia_id,"+(daily?"day.dia::date AS dia":"$4::date AS mes")+",'"+source+"'::text AS fuente,",
  " coalesce(m.importe,0)::numeric AS importe,coalesce(m.unidades,0)::numeric AS unidades,",
  " m.filas,m.filas_importe,m.filas_unidades,m.filas_producto,m.documentos,",
  " m.filas_coste,coalesce(m.ventas_con_coste,0)::numeric AS ventas_con_coste,",
  " coalesce(m.margen_coste,0)::numeric AS margen_coste",
  "FROM jsonb_to_recordset($1::jsonb) AS f(id integer,code text)",
  ...(daily?["CROSS JOIN generate_series($2::date,$3::date-interval '1 day',interval '1 day') AS day(dia)"]:[]),
  "CROSS JOIN LATERAL (SELECT",
  " sum("+net(amount)+") AS importe,",
  " sum("+net("l.cantidad")+")"+(sales?" FILTER(WHERE "+product+")":"")+" AS unidades,",
  " count(*)::bigint AS filas,count("+amount+")::bigint AS filas_importe,",
  " count(l.cantidad)::bigint AS filas_unidades,",
  " count(*) FILTER(WHERE "+product+")::bigint AS filas_producto,",
  sales?" 0::bigint AS documentos,":
   " count(DISTINCT (h.sistema_origen,h.documento_id))::bigint AS documentos,",
  " count(*) FILTER(WHERE "+costed+")::bigint AS filas_coste,",
  sales?" sum("+net(amount)+") FILTER(WHERE "+costed+") AS ventas_con_coste,":
   " 0::numeric AS ventas_con_coste,",
  sales?" sum(("+net(amount)+")-("+net("l.cantidad")+")*l.coste_historico)"+
   " FILTER(WHERE "+costed+") AS margen_coste":" 0::numeric AS margen_coste",
  "FROM "+h+" h JOIN "+l+" l ON l.farmacia_codigo=h.farmacia_codigo",
  " AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id",
  "WHERE h.farmacia_codigo=f.code AND h.fecha >= "+(daily?"day.dia":"$2::date"),
  " AND h.fecha < "+(daily?"day.dia + interval '1 day'":"$3::date")+" AND h.lineas_completas",
  " AND NOT "+(sales?"h.eliminado_logicamente":"h.eliminada_logicamente"),
  " AND NOT l.eliminada_logicamente"+(sales?" AND coalesce(l.anulada,false)=false":""),
  " AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')",
  ") m"
 ].join("\n");
}

export function compatibleDailyRange(from,to,today=madridDay()){
 if(!valid(from)||!valid(to)||from>to||to>today)return null;
 const ago=Date.parse(today+"T00:00:00Z")-90*86400000;
 const start=Date.parse(from+"T00:00:00Z");
 if(start<ago||(Date.parse(to+"T00:00:00Z")-start)>90*86400000)return null;
 const live=to===today,closedTo=live?new Date(Date.parse(today+"T00:00:00Z")-86400000).toISOString().slice(0,10):to;
 const days=closedTo>=from?
  Math.round((Date.parse(closedTo+"T00:00:00Z")-start)/86400000)+1:0;
 return {from,to,live,closedTo,days};
}

export function summarizeConsolidations(rows,from,to){
 const months=new Map(),src={salesRows:0,salesAmountRows:0,salesProducts:0,
  salesCosted:0,buyRows:0,buyAmountRows:0,buyUnitRows:0};
 for(const r of rows){
  const month=dstr(r.mes).slice(0,7);
  if(!months.has(month))months.set(month,{month,ventas:0,unidades:0,compras:0,
   unidadesCompradas:0,recepciones:0,lineasCompra:0,salesRows:0,
   salesAmountRows:0,buyRows:0,buyAmountRows:0,margin:0,coveredSales:0});
  const m=months.get(month),n=Number(r.importe||0);
  if(r.fuente==="ventas"){
   m.ventas+=n;m.unidades+=Number(r.unidades||0);
   m.salesRows+=Number(r.filas||0);m.salesAmountRows+=Number(r.filas_importe||0);
   m.margin+=Number(r.margen_coste||0);m.coveredSales+=Number(r.ventas_con_coste||0);
   src.salesRows+=Number(r.filas||0);src.salesAmountRows+=Number(r.filas_importe||0);
   src.salesProducts+=Number(r.filas_producto||0);src.salesCosted+=Number(r.filas_coste||0);
  }else if(r.fuente==="compras"){
   m.compras+=n;m.unidadesCompradas+=Number(r.unidades||0);
   m.recepciones+=Number(r.documentos||0);m.lineasCompra+=Number(r.filas_producto||0);
   m.buyRows+=Number(r.filas||0);m.buyAmountRows+=Number(r.filas_importe||0);
   src.buyRows+=Number(r.filas||0);src.buyAmountRows+=Number(r.filas_importe||0);
   src.buyUnitRows+=Number(r.filas_unidades||0);
  }
 }
 const sorted=[...months.values()].sort((a,b)=>a.month.localeCompare(b.month));
 const salesComplete=src.salesRows===src.salesAmountRows,
  buyComplete=src.buyRows===src.buyAmountRows;
 const marginReady=salesComplete&&src.salesProducts>0&&src.salesProducts===src.salesCosted;
 const margin=sum(sorted,"margin"),covered=sum(sorted,"coveredSales");
 const monthlySales=sorted.map(m=>({month:m.month,
  ventas:m.salesRows===m.salesAmountRows?round(m.ventas):null,
  unidades:m.unidades}));
 const monthlyBuys=sorted.map(m=>({month:m.month,
  compras:m.buyRows===m.buyAmountRows?round(m.compras):null,
  recepciones:m.recepciones}));
 return {from,to,available:true,
  sales:{from,to,granularity:"month",monthly:monthlySales,
   series:monthlySales.map(m=>({bucket:m.month,ventas:m.ventas,unidades:m.unidades})),
   hasAmounts:salesComplete,costBasis:{products:src.salesProducts,priced:src.salesCosted,
    coveredSales:covered,margin},
   kpis:{ventas:salesComplete?round(sum(sorted,"ventas")):null,
    unidades:sum(sorted,"unidades"),margen:marginReady?round(margin):null,
    margenPct:marginReady&&covered?round(margin/covered*100):null,
    coberturaCostes:src.salesProducts?round(src.salesCosted/src.salesProducts*100):null}},
  purchases:{from,to,available:true,hasAmounts:buyComplete,
   sourceRows:src.buyRows,amountRows:src.buyAmountRows,
   amountCoveragePct:src.buyRows?round(src.buyAmountRows/src.buyRows*100):100,
   hasArticleLines:sum(sorted,"lineasCompra")>0,
   monthly:monthlyBuys,
   kpis:{compras:buyComplete?round(sum(sorted,"compras")):null,
    unidadesCompradas:src.buyUnitRows===src.buyRows?sum(sorted,"unidadesCompradas"):null,
    recepciones:sum(sorted,"recepciones"),lineasCompra:sum(sorted,"lineasCompra"),
    proveedores:null}}};
}
