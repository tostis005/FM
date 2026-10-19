// Rangos calendario en zona horaria del cliente: no dependen del huso del navegador.
// El filtro de ventas se aplica en PostgreSQL con fechas inclusivas.
export const SALES_PERIODS=[
 ["today","Hoy"],["yesterday","Ayer"],["this_week","Esta semana"],
 ["last_week","Semana pasada"],["this_month","Este mes"],["this_year","Este año"],
 ["last_month","Mes pasado"],["last_7","Últimos 7 días"],
 ["last_30","Últimos 30 días"],["3","3 meses"],["6","6 meses"],
 ["12","12 meses"],["24","2 años"],["36","3 años"],["60","5 años"],
 ["all","Todo el histórico"],["custom","Personalizado"]
];
const iso=d=>d.toISOString().slice(0,10);
const add=(date,{days=0,months=0}={})=>{
 const d=new Date(date.getTime());
 if(months){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);}
 if(days)d.setUTCDate(d.getUTCDate()+days);
 return d;
};
function clientDay(now,timeZone){
 const parts=new Intl.DateTimeFormat("en-GB",{
  timeZone,year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(now);
 const get=type=>Number(parts.find(p=>p.type===type)?.value);
 return new Date(Date.UTC(get("year"),get("month")-1,get("day")));
}
export function resolveSalesPeriod(period,now=new Date(),custom={},timeZone="Europe/Madrid"){
 const today=clientDay(now,timeZone);
 const firstWeek=add(today,{days:-((today.getUTCDay()+6)%7)});
 const firstMonth=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1));
 let from=today,to=today,granularity="hour";
 switch(period){
  case "today":break;
  case "yesterday":from=add(today,{days:-1});to=from;break;
  case "this_week":from=firstWeek;granularity="day";break;
  case "last_week":from=add(firstWeek,{days:-7});to=add(firstWeek,{days:-1});granularity="day";break;
  case "this_month":from=firstMonth;granularity="day";break;
   case "this_year":from=new Date(Date.UTC(today.getUTCFullYear(),0,1));granularity="month";break;
  case "last_month":from=add(firstMonth,{months:-1});to=add(firstMonth,{days:-1});granularity="day";break;
  case "last_7":from=add(today,{days:-6});granularity="day";break;
  case "last_30":from=add(today,{days:-29});granularity="day";break;
  case "custom":{
   if(!/^20\d{2}-\d{2}-\d{2}$/.test(custom.from||"")||!/^20\d{2}-\d{2}-\d{2}$/.test(custom.to||""))
    return {valid:false,reason:"Selecciona las dos fechas del período."};
   const start=new Date(custom.from+"T00:00:00Z"),end=new Date(custom.to+"T00:00:00Z");
   if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||iso(start)!==custom.from||iso(end)!==custom.to||start>end)
    return {valid:false,reason:"La fecha final debe ser igual o posterior a la inicial."};
   if((end-start)/86400000>36525)return {valid:false,reason:"El rango personalizado no puede superar 100 años."};
   from=start;to=end;
   const days=(end-start)/86400000;
   granularity=days<=1?"hour":days<=90?"day":"month";
   break;
  }
  case "all":from=new Date(Date.UTC(1900,0,1));granularity="month";break;
  default:{
   const months=["3","6","12","24","36","60"].includes(String(period))?Number(period):6;
   from=add(firstMonth,{months:1-months});granularity="month";
  }
 }
 return {valid:true,from:iso(from),to:iso(to),granularity};
}
export function formatSalesBucket(bucket,granularity){
 if(granularity==="hour")return bucket.slice(11,16);
 if(granularity==="day")return bucket.slice(8,10)+"/"+bucket.slice(5,7);
 return bucket.slice(5,7)+"/"+bucket.slice(2,4);
}
