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
