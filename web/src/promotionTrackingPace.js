// Evaluación de objetivos según la parte del plazo comercial ya transcurrida.
// Solo para presentación del seguimiento: no cambia ventas, tickets ni objetivos.
import {objectiveMonthDates} from "./promotionMonthlyObjectives.js";

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const dayNumber=day=>DATE.test(day||"")?Date.parse(day+"T00:00:00Z")/86400000:NaN;
const days=(from,to)=>Math.max(0,Math.round(dayNumber(to)-dayNumber(from))+1);
const rounded=value=>Math.round(value*10)/10;
const pct=(part,whole)=>whole>0?rounded(100*part/whole):null;
const own=(map,id)=>Object.prototype.hasOwnProperty.call(map||{},id);
const maxDate=(a,b)=>a>b?a:b;
const minDate=(a,b)=>a<b?a:b;

function goalPeriods(campaign,id,month,today){
 const monthly=campaign.monthlyObjectives||{};
 if(Object.keys(monthly).length){
  const monthList=month?[month]:Object.keys(monthly).sort();
  return monthList.flatMap(key=>{
   const target=monthly[key]?.targets;
   if(!own(target,id))return [];
   const range=objectiveMonthDates(campaign,key);
   return range?[{...range,goal:Number(target[id])||0}]:[];
  });
 }
 // Los documentos anteriores siguen teniendo un único objetivo guardado.
 if(!own(campaign.targets,id))return [];
 const start=campaign.start;
 const end=campaign.closedOn||campaign.end||maxDate(start,today);
 if(!DATE.test(start||"")||!DATE.test(end||""))return [];
 if(month){
  const range=objectiveMonthDates(campaign,month);
  return range?[{...range,goal:Number(campaign.targets[id])||0}]:[];
 }
 return start<=end?[{from:start,to:end,goal:Number(campaign.targets[id])||0}]:[];
}

export function objectivePace(campaign,id,month="",today=new Date().toISOString().slice(0,10)){
 const periods=goalPeriods(campaign,String(id),month,today);
 const goal=periods.reduce((n,p)=>n+p.goal,0);
 const duration=periods.reduce((n,p)=>n+days(p.from,p.to),0);
 const elapsed=periods.reduce((n,p)=>n+
  (today<p.from?0:days(p.from,minDate(today,p.to))),0);
 const expected=periods.reduce((n,p)=>{
  const duration=days(p.from,p.to);
  const elapsed=today<p.from?0:days(p.from,minDate(today,p.to));
  return n+(duration?p.goal*elapsed/duration:0);
 },0);
 const sold=Number(campaign.sales?.[id])||0;
 const progress=pct(sold,goal);
 const timeProgress=pct(elapsed,duration);
 const rhythm=expected>0?pct(sold,expected):null;
 const finished=duration>0&&elapsed>=duration;
 const tone=goal<=0||!duration?"none":elapsed===0?"upcoming":
   rhythm>=100?"success":rhythm>=80?"warning":"danger";
 const status=goal<=0||!duration?"Sin objetivo":elapsed===0?"Por comenzar":
   finished?(progress>=100?"Objetivo alcanzado":progress>=80?"Cerca del objetivo":"Por debajo"):
   rhythm>=100?"En ritmo":rhythm>=80?"Cerca del ritmo":"Por debajo del ritmo";
 return {goal,sold,pct:progress,elapsedPct:timeProgress,pacePct:rhythm,
  tone,status,expectedUnits:rounded(expected),elapsedDays:elapsed,totalDays:duration,
  periodStart:periods[0]?.from||"",periodEnd:periods.at(-1)?.to||"",finished};
}

export function trackingColorRows(campaigns,pharmacyName,mode="promotion",pharmacyId="",month="",today){
 const rows=[];
 for(const campaign of campaigns||[]){
  for(const id of Object.keys(campaign.targets||{})){
   if(mode==="pharmacy"&&String(id)!==String(pharmacyId))continue;
   const result=objectivePace(campaign,id,month,today);
   rows.push({promotion:String(campaign.name||""),pharmacy:pharmacyName(id),
    pharmacyId:String(id),...result});
  }
 }
 return rows.sort((a,b)=>a.promotion.localeCompare(b.promotion,"es")||
  a.pharmacy.localeCompare(b.pharmacy,"es"));
}
