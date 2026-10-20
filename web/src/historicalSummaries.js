// Consultar históricos amplios sin enviar una sola agregación de cinco años
// que exceda los límites de tiempo del servidor. Cada tramo termina en su año.
const iso=d=>d.toISOString().slice(0,10);
const day=date=>new Date(date+"T00:00:00Z");
const addDay=(date,n)=>new Date(date.getTime()+n*86400000);
export function splitHistoricalYears(from,to){
 if(from>to)throw Error("Intervalo incorrecto");
 const a=day(from),b=day(to);
 if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime()))throw Error("Fechas incorrectas");
 const windows=[];
 let start=a;
 const years=b.getUTCFullYear()-a.getUTCFullYear()+1;
 // Para «todo el histórico», no lanzar cientos de consultas anuales vacías.
 const yearsPerWindow=years>12?5:1;
 while(start<=b){
  const year=start.getUTCFullYear();
  const boundary=new Date(Date.UTC(year+yearsPerWindow,0,1));
  const end=new Date(Math.min(b.getTime(),boundary.getTime()-86400000));
  windows.push({from:iso(start),to:iso(end)});
  start=addDay(end,1);
 }
 return windows;
}
const spanDays=(window)=>(day(window.to)-day(window.from))/86400000;
const bisect=window=>{
 const midpoint=addDay(day(window.from),Math.floor(spanDays(window)/2));
 return [{from:window.from,to:iso(midpoint)},
  {from:iso(addDay(midpoint,1)),to:window.to}];
};
const canRetry=error=>error?.name==="TimeoutError"||
 error?.name==="AbortError"||error?.name==="TimeoutError"||
 Number(error?.status)>=500;

export async function loadHistoricalSummary({from,to,load,kind,signal,onProgress}){
 const windows=splitHistoricalYears(from,to);
 const results=new Array(windows.length);
 async function readWindow(window,depth=0){
  if(signal?.aborted)throw Error("Consulta cancelada");
  try{return await load(window)}
  catch(error){
   if(signal?.aborted||!canRetry(error)||depth>=3||spanDays(window)<61)throw error;
   const parts=bisect(window);
   const left=await readWindow(parts[0],depth+1);
   const right=await readWindow(parts[1],depth+1);
   return mergeHistoricalSummaries([left,right],kind,window);
  }
 }
 let cursor=0,done=0;
 await Promise.all(Array.from({length:Math.min(2,windows.length)},async()=>{
  while(cursor<windows.length){
   const index=cursor++;
   results[index]=await readWindow(windows[index]);
   done++;
   if(!signal?.aborted)onProgress?.(done,windows.length);
  }
 }));
 return mergeHistoricalSummaries(results,kind,{from,to});
}
const sum=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
const sumNullable=(rows,key)=>rows.every(r=>r.kpis?.[key]!=null)?
 sum(rows.map(r=>r.kpis),key):null;
const round=(v)=>Math.round(v*100)/100;
export function mergeHistoricalSummaries(parts,kind,{from,to}){
 if(!parts.length||!["sales","purchases"].includes(kind))throw Error("Origen incorrecto");
 if(parts.some(p=>!p||!Array.isArray(p.monthly)||!p.kpis))
  throw Error("No se pudieron consultar todos los tramos históricos");
 // Al reintentar un año por semestres, el corte puede caer a mitad de mes.
 // Unir la misma mensualidad antes de dibujar la evolución o calcular el total.
 const grouped=new Map();
 for(const row of parts.flatMap(part=>part.monthly)){
  if(!row?.month)continue;
  const rows=grouped.get(row.month)||[];
  rows.push(row);grouped.set(row.month,rows);
 }
 const months=[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([month,rows])=>{
  const out={...rows[0],month};
  for(const key of ["ventas","compras","unidades","recepciones"]){
   if(rows.some(r=>r[key]!=null))
    out[key]=rows.reduce((n,r)=>n+Number(r[key]||0),0);
   else if(rows.some(r=>Object.hasOwn(r,key)))out[key]=null;
  }
  return out;
 });
 if(kind==="purchases"){
  const complete=parts.every(p=>p.available!==false);
  return {from,to,available:complete,monthly:months,sourceRows:sum(parts,"sourceRows"),
   hasArticleLines:parts.some(p=>p.hasArticleLines),hasAmounts:parts.some(p=>p.hasAmounts),
   kpis:{
    compras:sumNullable(parts,"compras"),
    unidadesCompradas:sumNullable(parts,"unidadesCompradas"),
    recepciones:sumNullable(parts,"recepciones"),
    lineasCompra:sumNullable(parts,"lineasCompra"),
    // Un mismo proveedor se repite en años diferentes; sumarlo sería falso.
    proveedores:parts.length===1?parts[0].kpis.proveedores:null
   }};
 }
 const basis=parts.every(p=>p.costBasis!=null);
 const priced=basis?sum(parts.map(p=>p.costBasis),"priced"):0;
 const products=basis?sum(parts.map(p=>p.costBasis),"products"):0;
 const covered=basis?sum(parts.map(p=>p.costBasis),"coveredSales"):0;
 const totalMargin=basis?sum(parts.map(p=>p.costBasis),"margin"):0;
 const complete=basis&&products>0&&priced===products;
 const ventas=sumNullable(parts,"ventas"),unidades=sumNullable(parts,"unidades");
 return {from,to,granularity:"month",monthly:months,
  series:months.map(m=>({bucket:m.month,ventas:m.ventas,unidades:m.unidades})),
  costBasis:basis?{priced,products,coveredSales:covered,margin:totalMargin}:null,
  kpis:{ventas,unidades,
   margen:complete?round(totalMargin):null,
   margenPct:complete&&covered!==0?round(totalMargin/covered*100):null,
   coberturaCostes:basis&&products>0?round(priced/products*100):null}};
}
