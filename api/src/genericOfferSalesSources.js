// Segmentación exacta del período de genéricos: usar cierres mensuales
// inmutables solo cuando existe evidencia para esa farmacia y mes.
// Lo no consolidado se lee de los movimientos originales, sin inventar ceros.
const date=x=>new Date(x+"T00:00:00Z");
const iso=x=>x.toISOString().slice(0,10);
const nextDay=x=>iso(new Date(date(x).getTime()+86400000));
const nextMonth=month=>{
 const d=date(month);d.setUTCMonth(d.getUTCMonth()+1);return iso(d);
};
const endMonth=month=>iso(new Date(date(nextMonth(month)).getTime()-86400000));

export function planGenericSalesSources(from,to,today,pharmacies,closures=[]){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||
  !/^\d{4}-\d{2}-\d{2}$/.test(today)||from>to)throw Error("Período inválido");
 const closed=new Set(closures.map(x=>String(x.farmacia_id)+"|"+String(x.mes).slice(0,10)));
 const cached=[],pending=new Map();
 for(let month=from.slice(0,7)+"-01";month<=to.slice(0,7)+"-01";month=nextMonth(month)){
  const first=from>month?from:month,last=endMonth(month),end=to<last?to:last;
  const eligible=first===month&&end===last&&end<today;
  for(const ph of pharmacies){
   const key=String(ph.id)+"|"+month;
   if(eligible&&closed.has(key)){cached.push({id:ph.id,month});continue}
   const code=String(ph.code);
   const ranges=pending.get(code)||[];
   if(ranges.length&&nextDay(ranges.at(-1).to)===first)
    ranges[ranges.length-1].to=end;
   else ranges.push({from:first,to:end});
   pending.set(code,ranges);
  }
 }
 // Las farmacias con idéntico tramo se leen juntas en una sola consulta.
 const merged=new Map();
 for(const [code,ranges] of pending){
  for(const r of ranges){
   const key=r.from+"|"+r.to;
   if(!merged.has(key))merged.set(key,{...r,codes:[]});
   merged.get(key).codes.push(code);
  }
 }
 return {cached,raw:[...merged.values()]};
}


 // Los meses parciales de cualquier ventana deben leerse en origen, incluso
 // cuando el mes está cerrado. Así no se asignan ventas fuera del período.
export function planGenericOpportunitySources(from,to,today,annualStart,quarterStart,pharmacies,closures,includeWindows=true){
 const first=includeWindows&&annualStart<from?annualStart:from;
 const last=includeWindows&&today>to?today:to;
 const partial=new Set();
 if(from.slice(8)!=="01")partial.add(from.slice(0,7)+"-01");
 if(nextDay(to).slice(8)!=="01")partial.add(to.slice(0,7)+"-01");
 return planGenericSalesSources(first,last,today,pharmacies,
  closures.filter(c=>!partial.has(String(c.mes).slice(0,10))));
}

// Reutiliza los cierres confirmados de Ventas por artículo y farmacia.
// Solo consulta movimientos de los tramos no consolidados o parciales.
// Los parámetros iniciales son tenant, farmacias, desde, hasta y opcionales
// del llamador (p.ej. DCPF y artículos del conjunto).
export async function genericSalesRollup(pool,{schema,tenant,ids,from,to,extra=[],articleParam=null,includeWindows=true,pharmacyCodeSQL}){
 const [clock,pharmacies,closures]=await Promise.all([
  pool.query("SELECT current_date::text AS today,(date_trunc('month',current_date)-interval '11 months')::date::text AS annual,(date_trunc('month',current_date)-interval '2 months')::date::text AS quarter"),
  pool.query({text:"SELECT f.id,"+pharmacyCodeSQL+" AS code FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])",values:[tenant,ids],query_timeout:6000}),
  pool.query({text:"SELECT farmacia_id,mes::text AS mes FROM farmetrica.ventas_panorama_meses_cerrados WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) AND mes>=least(date_trunc('month',$3::date),date_trunc('month',current_date)-interval '11 months') AND mes<=greatest($4::date,current_date)",values:[tenant,ids,from,to],query_timeout:6000}).catch(e=>{if(e.code==="42P01")return {rows:[]};throw e})
 ]);
 const {today,annual,quarter}=clock.rows[0];
 const plan=planGenericOpportunitySources(from,to,today,annual,quarter,pharmacies.rows,closures.rows,includeWindows);
 const values=[tenant,ids,from,to,...extra], parts=[];
 const param=value=>"$"+values.push(value);
 const dateFilter=d=>d+">=$3::date AND "+d+"<$4::date+interval '1 day'";
 const aggregates=(d,u,r)=>"sum("+u+") FILTER(WHERE "+dateFilter(d)+")::float8 AS units,sum("+r+") FILTER(WHERE "+dateFilter(d)+")::float8 AS revenue,"+
  (includeWindows?"sum("+u+") FILTER(WHERE "+d+">=date_trunc('month',current_date)-interval '11 months' AND "+d+"<current_date+interval '1 day')::float8 AS annual,sum("+u+") FILTER(WHERE "+d+">=date_trunc('month',current_date)-interval '2 months' AND "+d+"<current_date+interval '1 day')::float8 AS quarter":"0::float8 AS annual,0::float8 AS quarter");
 const filter=column=>articleParam?" AND "+column+"=ANY($"+articleParam+"::text[])":"";
 if(plan.cached.length){
  const ph=param(plan.cached.map(x=>x.id)),months=param(plan.cached.map(x=>x.month));
  parts.push("SELECT f.id AS pharmacy,"+pharmacyCodeSQL+" AS code,m.clave AS article,"+aggregates("m.mes","m.unidades","m.importe")+
   " FROM farmetrica.ventas_panorama_mensual m JOIN unnest("+ph+"::int[],"+months+"::date[]) c(id,mes) ON c.id=m.farmacia_id AND c.mes=m.mes JOIN farmetrica.farmacias f ON f.id=m.farmacia_id AND f.cliente_slug=$1 WHERE m.cliente_slug=$1 AND f.id=ANY($2::int[]) AND m.dimension='articulo'"+filter("m.clave")+" GROUP BY 1,2,3");
 }
 // Una consulta por tramo dentro del mismo SQL; no repetir el histórico por CN.
 for(const segment of plan.raw.length?plan.raw:plan.cached.length?[]:[{from,to,codes:[]}]){
  const start=param(segment.from),end=param(segment.to),codes=param(segment.codes);
  parts.push("SELECT f.id AS pharmacy,upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id::text AS article,"+aggregates("v.fecha","v.unidades","v.importe")+
   " FROM "+schema+".fm_ventas_analitica v JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND v.farmacia_codigo="+pharmacyCodeSQL+
   " WHERE v.fecha>="+start+"::date AND v.fecha<"+end+"::date+interval '1 day' AND v.farmacia_codigo=ANY("+codes+"::text[])"+filter("v.articulo_id")+" GROUP BY 1,2,3");
 }
 return {cte:"WITH b AS MATERIALIZED(SELECT pharmacy,code,article,sum(units)::float8 AS units,sum(revenue)::float8 AS revenue,sum(annual)::float8 AS annual,sum(quarter)::float8 AS quarter FROM ("+parts.join(" UNION ALL ")+") movement GROUP BY 1,2,3) ",values};
}
